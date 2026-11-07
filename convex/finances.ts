import { mutation, query } from "./_generated/server";
import { MutationCtx, QueryCtx } from "./_generated/server";
import { v } from "convex/values";
import { Id } from "./_generated/dataModel";
import {
  isFinanceDepartment,
  monthBounds,
  notify,
  prorateMonthlySalary,
  publicUser,
  requireAdmin,
  requireUser,
} from "./lib";

async function requireFinanceStaff(ctx: MutationCtx | QueryCtx, token: string) {
  const user = await requireUser(ctx, token);
  if (user.role === "admin") return user;
  if (user.role === "employee" && isFinanceDepartment(user.department)) {
    return user;
  }
  throw new Error("Accès réservé au département Finance");
}

/** Finance staff only see payment orders for employees of their workplace. Admins see all. */
async function filterOrdersForFinanceWorkplace<
  T extends { employeeId: Id<"users"> },
>(
  ctx: QueryCtx | MutationCtx,
  staff: { role: string; workplaceId?: Id<"workplaces"> | null },
  rows: T[]
) {
  const result: Array<T & { employee: ReturnType<typeof publicUser> }> = [];
  for (const row of rows) {
    const employee = await ctx.db.get(row.employeeId);
    if (!employee) continue;
    if (staff.role !== "admin") {
      if (!staff.workplaceId) continue;
      if (employee.workplaceId !== staff.workplaceId) continue;
    }
    result.push({ ...row, employee: publicUser(employee) });
  }
  return result;
}

async function computeBalance(ctx: QueryCtx | MutationCtx, employeeId: Id<"users">) {
  const salaries = await ctx.db
    .query("salaries")
    .withIndex("by_employee", (q) => q.eq("employeeId", employeeId))
    .collect();
  const bonuses = await ctx.db
    .query("bonuses")
    .withIndex("by_employee", (q) => q.eq("employeeId", employeeId))
    .collect();
  const orders = await ctx.db
    .query("paymentOrders")
    .withIndex("by_employee", (q) => q.eq("employeeId", employeeId))
    .collect();

  const totalSalaries = salaries.reduce(
    (sum, s) => sum + (s.netPay ?? s.baseSalary),
    0
  );
  const totalBonuses = bonuses.reduce((sum, b) => sum + b.amount, 0);
  const totalCredits = totalSalaries + totalBonuses;

  // Pending, validated and paid requests reduce the available balance
  const reservedOrPaid = orders
    .filter((o) => o.status === "DEMANDE" || o.status === "VALIDE" || o.status === "PAYE")
    .reduce((sum, o) => sum + o.amount, 0);

  const available = Math.max(0, totalCredits - reservedOrPaid);

  return {
    totalSalaries,
    totalBonuses,
    totalCredits,
    reservedOrPaid,
    available,
  };
}

export const myBalance = query({
  args: { token: v.string() },
  handler: async (ctx, args) => {
    const user = await requireUser(ctx, args.token);
    return await computeBalance(ctx, user._id);
  },
});

export const mySalaries = query({
  args: { token: v.string() },
  handler: async (ctx, args) => {
    const user = await requireUser(ctx, args.token);
    const rows = await ctx.db
      .query("salaries")
      .withIndex("by_employee", (q) => q.eq("employeeId", user._id))
      .collect();
    return rows.sort((a, b) =>
      a.year === b.year ? b.month - a.month : b.year - a.year
    );
  },
});

export const myBonuses = query({
  args: { token: v.string() },
  handler: async (ctx, args) => {
    const user = await requireUser(ctx, args.token);
    const rows = await ctx.db
      .query("bonuses")
      .withIndex("by_employee", (q) => q.eq("employeeId", user._id))
      .collect();
    return rows.sort((a, b) => b.attributedAt - a.attributedAt);
  },
});

export const myPaymentOrders = query({
  args: { token: v.string() },
  handler: async (ctx, args) => {
    const user = await requireUser(ctx, args.token);
    const rows = await ctx.db
      .query("paymentOrders")
      .withIndex("by_employee", (q) => q.eq("employeeId", user._id))
      .collect();
    return rows.sort((a, b) => b.requestedAt - a.requestedAt);
  },
});

export const requestPayment = mutation({
  args: {
    token: v.string(),
    type: v.union(
      v.literal("SALAIRE_MENSUEL"),
      v.literal("ACOMPTE"),
      v.literal("PRIME")
    ),
    amount: v.number(),
    note: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const user = await requireUser(ctx, args.token);
    if (user.role !== "employee") {
      throw new Error("Réservé aux employés");
    }
    if (args.amount <= 0) throw new Error("Montant invalide");

    const balance = await computeBalance(ctx, user._id);
    if (args.amount > balance.available) {
      throw new Error(
        `Montant supérieur au solde disponible (${balance.available.toLocaleString("fr-DZ")} DZD)`
      );
    }

    const id = await ctx.db.insert("paymentOrders", {
      employeeId: user._id,
      type: args.type,
      amount: args.amount,
      status: "DEMANDE",
      note: args.note?.trim(),
      requestedAt: Date.now(),
    });

    const admins = (await ctx.db.query("users").collect()).filter(
      (u) => u.role === "admin" && u.isActive
    );
    for (const admin of admins) {
      await notify(
        ctx,
        admin._id,
        "Demande de paiement",
        `${user.name} a demandé ${args.amount.toLocaleString("fr-DZ")} DZD (${args.type}).`
      );
    }

    return await ctx.db.get(id);
  },
});

/** Admin creates a payment demand on behalf of an employee. */
export const requestPaymentForEmployee = mutation({
  args: {
    token: v.string(),
    employeeId: v.id("users"),
    type: v.union(
      v.literal("SALAIRE_MENSUEL"),
      v.literal("ACOMPTE"),
      v.literal("PRIME")
    ),
    amount: v.number(),
    note: v.optional(v.string()),
    /** If true, mark as VALIDE immediately (ready for Finance cash desk). */
    autoValidate: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    const admin = await requireAdmin(ctx, args.token);
    const employee = await ctx.db.get(args.employeeId);
    if (!employee || employee.role !== "employee" || employee.resignedAt) {
      throw new Error("Employé introuvable");
    }
    if (args.amount <= 0) throw new Error("Montant invalide");

    const balance = await computeBalance(ctx, args.employeeId);
    if (args.amount > balance.available) {
      throw new Error(
        `Montant supérieur au solde disponible (${balance.available.toLocaleString("fr-DZ")} DZD)`
      );
    }

    const autoValidate = args.autoValidate === true;
    const note =
      args.note?.trim() ||
      `Demande créée par l'admin (${admin.name})`;

    const id = await ctx.db.insert("paymentOrders", {
      employeeId: args.employeeId,
      type: args.type,
      amount: args.amount,
      status: autoValidate ? "VALIDE" : "DEMANDE",
      note,
      requestedAt: Date.now(),
      treatedAt: autoValidate ? Date.now() : undefined,
    });

    await notify(
      ctx,
      args.employeeId,
      autoValidate ? "Paiement validé" : "Demande de paiement créée",
      `Une demande de ${args.amount.toLocaleString("fr-DZ")} DZD (${args.type}) a été créée par l'admin.`
    );

    if (autoValidate) {
      const financeStaff = (await ctx.db.query("users").collect()).filter(
        (u) =>
          u.role === "employee" &&
          u.isActive &&
          !u.resignedAt &&
          isFinanceDepartment(u.department)
      );
      for (const staff of financeStaff) {
        await notify(
          ctx,
          staff._id,
          "Paiement à régler",
          `${employee.name} — ${args.amount.toLocaleString("fr-DZ")} DZD (${args.type}) créé/validé par l'admin.`
        );
      }
    }

    return await ctx.db.get(id);
  },
});

export const salariesForMonth = query({
  args: {
    token: v.string(),
    month: v.number(),
    year: v.number(),
  },
  handler: async (ctx, args) => {
    await requireAdmin(ctx, args.token);
    const { start, end } = monthBounds(args.year, args.month);
    const attendanceRows = await ctx.db
      .query("attendances")
      .withIndex("by_date", (q) => q.gte("date", start).lte("date", end))
      .collect();
    const lateDeductionsByEmployee = new Map<string, number>();
    for (const attendance of attendanceRows) {
      lateDeductionsByEmployee.set(
        attendance.employeeId,
        (lateDeductionsByEmployee.get(attendance.employeeId) ?? 0) +
          (attendance.delayAmount ?? 0)
      );
    }

    const employees = (await ctx.db.query("users").collect())
      .filter(
        (u) =>
          u.role === "employee" && u.isActive && !u.resignedAt
      )
      .sort((a, b) => a.name.localeCompare(b.name));

    const result = [];
    for (const employee of employees) {
      const salary = await ctx.db
        .query("salaries")
        .withIndex("by_employee_period", (q) =>
          q
            .eq("employeeId", employee._id)
            .eq("year", args.year)
            .eq("month", args.month)
        )
        .unique();

      const evalReport = await ctx.db
        .query("monthlyReports")
        .withIndex("by_employee_period", (q) =>
          q
            .eq("employeeId", employee._id)
            .eq("year", args.year)
            .eq("month", args.month)
        )
        .unique();

      const evalStatus = evalReport
        ? (evalReport.status ?? "CONFIRME")
        : null;

      const contractual = employee.baseSalary ?? 0;
      const proration = prorateMonthlySalary(
        contractual,
        employee.hireDate,
        args.year,
        args.month
      );

      result.push({
        employee: publicUser(employee),
        attendanceLateDeductions:
          lateDeductionsByEmployee.get(employee._id) ?? 0,
        salary: salary
          ? {
              _id: salary._id,
              baseSalary: salary.baseSalary,
              contractualSalary:
                salary.contractualSalary ?? contractual,
              daysWorked: salary.daysWorked,
              daysInMonth: salary.daysInMonth,
              lateDeductions: salary.lateDeductions ?? 0,
              leaveDeductions: salary.leaveDeductions ?? 0,
              netPay: salary.netPay ?? salary.baseSalary,
            }
          : null,
        proration: {
          contractualSalary: contractual,
          suggestedAmount: proration.amount,
          daysWorked: proration.daysWorked,
          daysInMonth: proration.daysInMonth,
          isProrated: proration.isProrated,
          hireDay: proration.hireDay,
          hiredThisMonth: proration.hiredThisMonth,
          notYetHired: proration.notYetHired,
        },
        evaluation: evalReport
          ? {
              reportId: evalReport._id,
              status: evalStatus as "EN_ATTENTE" | "CONFIRME",
              percentage: evalReport.percentage ?? 0,
              computedBonus: evalReport.computedBonus ?? 0,
              baseBonus: evalReport.baseBonus ?? employee.baseBonus ?? 0,
            }
          : {
              reportId: null,
              status: null as "EN_ATTENTE" | "CONFIRME" | null,
              percentage: 0,
              computedBonus: 0,
              baseBonus: employee.baseBonus ?? 0,
            },
      });
    }
    return result;
  },
});

/** Year overview: defined salaries + confirmed evaluation primes per month. */
export const yearSalaryPrimeSummary = query({
  args: {
    token: v.string(),
    year: v.number(),
  },
  handler: async (ctx, args) => {
    await requireAdmin(ctx, args.token);

    const salaries = (await ctx.db.query("salaries").collect()).filter(
      (s) => s.year === args.year
    );
    const reports = (await ctx.db.query("monthlyReports").collect()).filter(
      (r) => r.year === args.year && (r.status ?? "CONFIRME") === "CONFIRME"
    );

    const months = [];
    for (let month = 1; month <= 12; month++) {
      const monthSalaries = salaries.filter((s) => s.month === month);
      const monthPrimes = reports.filter((r) => r.month === month);
      const totalSalary = monthSalaries.reduce(
        (sum, s) => sum + (s.netPay ?? s.baseSalary),
        0
      );
      const totalDeductions = monthSalaries.reduce(
        (sum, s) =>
          sum + (s.lateDeductions ?? 0) + (s.leaveDeductions ?? 0),
        0
      );
      const totalBase = monthSalaries.reduce((sum, s) => sum + s.baseSalary, 0);
      const totalPrimes = monthPrimes.reduce(
        (sum, r) => sum + (r.computedBonus ?? 0),
        0
      );
      months.push({
        month,
        year: args.year,
        salaryCount: monthSalaries.length,
        primeCount: monthPrimes.length,
        totalBase,
        totalDeductions,
        totalSalary,
        totalPrimes,
        total: totalSalary + totalPrimes,
      });
    }

    return months;
  },
});

export const setSalariesBatch = mutation({
  args: {
    token: v.string(),
    month: v.number(),
    year: v.number(),
    entries: v.array(
      v.object({
        employeeId: v.id("users"),
        baseSalary: v.number(),
        lateDeductions: v.optional(v.number()),
      })
    ),
  },
  handler: async (ctx, args) => {
    await requireAdmin(ctx, args.token);

    if (args.month < 1 || args.month > 12) {
      throw new Error("Mois invalide");
    }

    let saved = 0;
    for (const entry of args.entries) {
      if (entry.baseSalary < 0) {
        throw new Error("Le salaire ne peut pas être négatif");
      }

      const employee = await ctx.db.get(entry.employeeId);
      if (!employee || employee.role !== "employee") {
        throw new Error("Employé introuvable");
      }

      const lateDeductions = Math.max(0, entry.lateDeductions ?? 0);
      const contractual = entry.baseSalary;

      // Keep contractual full monthly salary on the employee profile
      await ctx.db.patch(entry.employeeId, { baseSalary: contractual });

      const proration = prorateMonthlySalary(
        contractual,
        employee.hireDate,
        args.year,
        args.month
      );
      const monthAmount = proration.amount;

      const existing = await ctx.db
        .query("salaries")
        .withIndex("by_employee_period", (q) =>
          q
            .eq("employeeId", entry.employeeId)
            .eq("year", args.year)
            .eq("month", args.month)
        )
        .unique();

      const leaveDeductions = existing?.leaveDeductions ?? 0;
      const netPay = Math.max(
        0,
        monthAmount - lateDeductions - leaveDeductions
      );

      const salaryFields = {
        baseSalary: monthAmount,
        contractualSalary: contractual,
        daysWorked: proration.daysWorked,
        daysInMonth: proration.daysInMonth,
        lateDeductions,
        leaveDeductions,
        netPay,
        updatedAt: Date.now(),
      };

      if (existing) {
        await ctx.db.patch(existing._id, salaryFields);
      } else {
        await ctx.db.insert("salaries", {
          employeeId: entry.employeeId,
          ...salaryFields,
          leaveDeductions: leaveDeductions || 0,
          month: args.month,
          year: args.year,
        });
      }
      saved += 1;
    }

    return { saved };
  },
});

export const setBaseSalary = mutation({
  args: {
    token: v.string(),
    employeeId: v.id("users"),
    baseSalary: v.number(),
    month: v.number(),
    year: v.number(),
    lateDeductions: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    await requireAdmin(ctx, args.token);
    const employee = await ctx.db.get(args.employeeId);
    if (!employee) throw new Error("Employé introuvable");

    const lateDeductions = args.lateDeductions ?? 0;
    const contractual = args.baseSalary;

    await ctx.db.patch(args.employeeId, { baseSalary: contractual });

    const proration = prorateMonthlySalary(
      contractual,
      employee.hireDate,
      args.year,
      args.month
    );
    const monthAmount = proration.amount;

    const existing = await ctx.db
      .query("salaries")
      .withIndex("by_employee_period", (q) =>
        q
          .eq("employeeId", args.employeeId)
          .eq("year", args.year)
          .eq("month", args.month)
      )
      .unique();

    const leaveDeductions = existing?.leaveDeductions ?? 0;
    const netPay = Math.max(
      0,
      monthAmount - lateDeductions - leaveDeductions
    );

    const salaryFields = {
      baseSalary: monthAmount,
      contractualSalary: contractual,
      daysWorked: proration.daysWorked,
      daysInMonth: proration.daysInMonth,
      lateDeductions,
      leaveDeductions,
      netPay,
      updatedAt: Date.now(),
    };

    if (existing) {
      await ctx.db.patch(existing._id, salaryFields);
      return await ctx.db.get(existing._id);
    }

    const id = await ctx.db.insert("salaries", {
      employeeId: args.employeeId,
      ...salaryFields,
      leaveDeductions: 0,
      month: args.month,
      year: args.year,
    });
    return await ctx.db.get(id);
  },
});

export const grantBonus = mutation({
  args: {
    token: v.string(),
    employeeId: v.id("users"),
    amount: v.number(),
    title: v.string(),
    reason: v.string(),
  },
  handler: async (ctx, args) => {
    await requireAdmin(ctx, args.token);
    if (args.amount <= 0) throw new Error("Montant invalide");

    const id = await ctx.db.insert("bonuses", {
      employeeId: args.employeeId,
      amount: args.amount,
      title: args.title.trim(),
      reason: args.reason.trim(),
      attributedAt: Date.now(),
    });

    await notify(
      ctx,
      args.employeeId,
      "Nouvelle prime",
      `Une prime « ${args.title} » de ${args.amount.toLocaleString("fr-DZ")} DZD vous a été attribuée.`
    );

    return await ctx.db.get(id);
  },
});

export const listPaymentOrders = query({
  args: { token: v.string() },
  handler: async (ctx, args) => {
    await requireAdmin(ctx, args.token);
    const rows = await ctx.db.query("paymentOrders").collect();
    const result = [];
    for (const row of rows) {
      const employee = await ctx.db.get(row.employeeId);
      if (!employee) continue;
      result.push({ ...row, employee: publicUser(employee) });
    }
    return result.sort((a, b) => b.requestedAt - a.requestedAt);
  },
});

export const listBonuses = query({
  args: { token: v.string() },
  handler: async (ctx, args) => {
    await requireAdmin(ctx, args.token);
    const rows = await ctx.db.query("bonuses").collect();
    const result = [];
    for (const row of rows) {
      const employee = await ctx.db.get(row.employeeId);
      if (!employee) continue;
      result.push({ ...row, employee: publicUser(employee) });
    }
    return result.sort((a, b) => b.attributedAt - a.attributedAt);
  },
});

/** Full finance history for one employee (admin print / filter). */
export const employeeHistory = query({
  args: {
    token: v.string(),
    employeeId: v.id("users"),
  },
  handler: async (ctx, args) => {
    await requireAdmin(ctx, args.token);
    const employee = await ctx.db.get(args.employeeId);
    if (!employee || employee.role !== "employee") {
      throw new Error("Employé introuvable");
    }

    const salaries = (
      await ctx.db
        .query("salaries")
        .withIndex("by_employee", (q) => q.eq("employeeId", args.employeeId))
        .collect()
    ).sort((a, b) =>
      a.year === b.year ? b.month - a.month : b.year - a.year
    );

    const bonuses = (
      await ctx.db
        .query("bonuses")
        .withIndex("by_employee", (q) => q.eq("employeeId", args.employeeId))
        .collect()
    ).sort((a, b) => b.attributedAt - a.attributedAt);

    const orders = (
      await ctx.db
        .query("paymentOrders")
        .withIndex("by_employee", (q) => q.eq("employeeId", args.employeeId))
        .collect()
    ).sort((a, b) => b.requestedAt - a.requestedAt);

    const balance = await computeBalance(ctx, args.employeeId);

    return {
      employee: publicUser(employee),
      salaries,
      bonuses,
      orders,
      balance,
    };
  },
});

export const treatPaymentOrder = mutation({
  args: {
    token: v.string(),
    orderId: v.id("paymentOrders"),
    status: v.union(
      v.literal("VALIDE"),
      v.literal("PAYE"),
      v.literal("REJETE")
    ),
  },
  handler: async (ctx, args) => {
    await requireAdmin(ctx, args.token);
    const order = await ctx.db.get(args.orderId);
    if (!order) throw new Error("Ordre introuvable");

    await ctx.db.patch(args.orderId, {
      status: args.status,
      treatedAt: Date.now(),
    });

    const labels = {
      VALIDE: "validée",
      PAYE: "marquée comme payée",
      REJETE: "rejetée",
    } as const;

    await notify(
      ctx,
      order.employeeId,
      "Demande de paiement",
      `Votre demande de ${order.amount.toLocaleString("fr-DZ")} DZD a été ${labels[args.status]}.`
    );

    // After admin validation, finance desk can pay it
    if (args.status === "VALIDE") {
      const employee = await ctx.db.get(order.employeeId);
      const financeStaff = (await ctx.db.query("users").collect()).filter(
        (u) =>
          u.role === "employee" &&
          u.isActive &&
          !u.resignedAt &&
          isFinanceDepartment(u.department)
      );
      for (const staff of financeStaff) {
        await notify(
          ctx,
          staff._id,
          "Paiement à régler",
          `${employee?.name ?? "Un collaborateur"} — ${order.amount.toLocaleString("fr-DZ")} DZD (${order.type}) validé par l'admin.`
        );
      }
    }

    return await ctx.db.get(args.orderId);
  },
});

/** Finance department: validated payments waiting to be marked paid. */
export const listValidatedForFinance = query({
  args: { token: v.string() },
  handler: async (ctx, args) => {
    const staff = await requireFinanceStaff(ctx, args.token);
    const rows = await ctx.db
      .query("paymentOrders")
      .withIndex("by_status", (q) => q.eq("status", "VALIDE"))
      .collect();

    const result = await filterOrdersForFinanceWorkplace(ctx, staff, rows);
    return result.sort((a, b) => b.requestedAt - a.requestedAt);
  },
});

/** Finance department: recent paid orders (read-only history). */
export const listPaidForFinance = query({
  args: { token: v.string() },
  handler: async (ctx, args) => {
    const staff = await requireFinanceStaff(ctx, args.token);
    const rows = await ctx.db
      .query("paymentOrders")
      .withIndex("by_status", (q) => q.eq("status", "PAYE"))
      .collect();

    const result = await filterOrdersForFinanceWorkplace(ctx, staff, rows);
    return result
      .sort((a, b) => (b.treatedAt ?? 0) - (a.treatedAt ?? 0))
      .slice(0, 50);
  },
});

/** Finance staff marks a validated order as paid. */
export const markPaidByFinance = mutation({
  args: {
    token: v.string(),
    orderId: v.id("paymentOrders"),
  },
  handler: async (ctx, args) => {
    const staff = await requireFinanceStaff(ctx, args.token);
    const order = await ctx.db.get(args.orderId);
    if (!order) throw new Error("Ordre introuvable");
    if (order.status !== "VALIDE") {
      throw new Error("Seules les demandes validées par l'admin peuvent être payées");
    }

    if (staff.role !== "admin") {
      const employee = await ctx.db.get(order.employeeId);
      if (!employee || !staff.workplaceId) {
        throw new Error("Accès refusé pour ce paiement");
      }
      if (employee.workplaceId !== staff.workplaceId) {
        throw new Error(
          "Vous ne pouvez payer que les demandes de votre lieu de travail"
        );
      }
    }

    await ctx.db.patch(args.orderId, {
      status: "PAYE",
      treatedAt: Date.now(),
    });

    await notify(
      ctx,
      order.employeeId,
      "Paiement effectué",
      `Votre demande de ${order.amount.toLocaleString("fr-DZ")} DZD a été marquée comme payée par ${staff.name}.`
    );

    const admins = (await ctx.db.query("users").collect()).filter(
      (u) => u.role === "admin" && u.isActive
    );
    for (const admin of admins) {
      await notify(
        ctx,
        admin._id,
        "Paiement effectué",
        `${staff.name} a marqué payé ${order.amount.toLocaleString("fr-DZ")} DZD.`
      );
    }

    return await ctx.db.get(args.orderId);
  },
});
