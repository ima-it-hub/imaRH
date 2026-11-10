import { mutation, query } from "./_generated/server";
import { MutationCtx, QueryCtx } from "./_generated/server";
import { v } from "convex/values";
import { Id } from "./_generated/dataModel";
import {
  isFinanceDepartment,
  notify,
  prorateMonthlySalary,
  publicUser,
  requireAdmin,
  requireAdminPage,
  requireUser,
  todayISO,
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
  const approvedDeductions = await ctx.db
    .query("approvedLateDeductions")
    .withIndex("by_employee", (q) => q.eq("employeeId", employeeId))
    .collect();
  const orders = await ctx.db
    .query("paymentOrders")
    .withIndex("by_employee", (q) => q.eq("employeeId", employeeId))
    .collect();

  const totalSalaries = salaries.reduce(
    (sum, s) =>
      sum + Math.max(0, s.baseSalary - (s.leaveDeductions ?? 0)),
    0
  );
  const totalBonuses = bonuses.reduce((sum, b) => sum + b.amount, 0);
  const [currentYear, currentMonth] = todayISO()
    .slice(0, 7)
    .split("-")
    .map(Number);
  const currentPeriod = currentYear * 12 + currentMonth - 1;
  const availableBonuses = bonuses.reduce((sum, bonus) => {
    const [bonusYear, bonusMonth] =
      bonus.year != null && bonus.month != null
        ? [bonus.year, bonus.month]
        : todayISO(new Date(bonus.attributedAt))
            .slice(0, 7)
            .split("-")
            .map(Number);
    const bonusPeriod = bonusYear * 12 + bonusMonth - 1;
    return currentPeriod - bonusPeriod >= 3 ? sum + bonus.amount : sum;
  }, 0);
  const totalLateDeductions = approvedDeductions.reduce(
    (sum, deduction) => sum + deduction.amount,
    0
  );
  const totalCredits =
    totalSalaries + availableBonuses - totalLateDeductions;

  // Pending, validated, disbursed and paid requests reduce the available balance
  const reservedOrPaid = orders
    .filter((o) =>
      ["DEMANDE", "VALIDE", "A_CONFIRMER", "PAYE"].includes(o.status)
    )
    .reduce((sum, o) => sum + o.amount, 0);

  const available = Math.max(0, totalCredits - reservedOrPaid);

  return {
    totalSalaries,
    totalBonuses,
    availableBonuses,
    totalLateDeductions,
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
    return rows
      .map((salary) => ({
        ...salary,
        lateDeductions: 0,
        netPay: Math.max(0, salary.baseSalary - (salary.leaveDeductions ?? 0)),
      }))
      .sort((a, b) =>
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

export const myLateDeductions = query({
  args: { token: v.string() },
  handler: async (ctx, args) => {
    const user = await requireUser(ctx, args.token);
    const rows = await ctx.db
      .query("approvedLateDeductions")
      .withIndex("by_employee", (q) => q.eq("employeeId", user._id))
      .collect();
    return rows
      .filter((row) => row.amount > 0)
      .sort((a, b) =>
        a.year === b.year ? b.month - a.month : b.year - a.year
      )
      .map((row) => ({
        _id: row._id,
        month: row.month,
        year: row.year,
        amount: row.amount,
      }));
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
    /** If true, validate immediately and request employee receipt confirmation. */
    autoValidate: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    const admin = await requireAdminPage(ctx, args.token, "admin-ordres");
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
    const now = Date.now();
    const note =
      args.note?.trim() ||
      `Demande créée par l'admin (${admin.name})`;

    const id = await ctx.db.insert("paymentOrders", {
      employeeId: args.employeeId,
      type: args.type,
      amount: args.amount,
      status: autoValidate ? "A_CONFIRMER" : "DEMANDE",
      note,
      requestedAt: now,
      treatedAt: autoValidate ? now : undefined,
      disbursedAt: autoValidate ? now : undefined,
    });

    await notify(
      ctx,
      args.employeeId,
      autoValidate ? "Paiement validé" : "Demande de paiement créée",
      autoValidate
        ? `Une demande de ${args.amount.toLocaleString("fr-DZ")} DZD (${args.type}) a été créée et validée par l'admin. Confirmez sa réception dans votre espace Finances.`
        : `Une demande de ${args.amount.toLocaleString("fr-DZ")} DZD (${args.type}) a été créée par l'admin.`
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
          "Confirmation de paiement en attente",
          `${employee.name} — ${args.amount.toLocaleString("fr-DZ")} DZD (${args.type}) créé et validé par l'admin. En attente de confirmation de réception par l'employé.`
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
    await requireAdminPage(ctx, args.token, "admin-salaires");
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
        salary: salary
          ? {
              _id: salary._id,
              baseSalary: salary.baseSalary,
              contractualSalary:
                salary.contractualSalary ?? contractual,
              daysWorked: salary.daysWorked,
              daysInMonth: salary.daysInMonth,
              lateDeductions: 0,
              leaveDeductions: salary.leaveDeductions ?? 0,
              netPay: Math.max(
                0,
                salary.baseSalary - (salary.leaveDeductions ?? 0)
              ),
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

/** Year overview: defined salaries + monthly calculated primes. */
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
      (report) =>
        report.year === args.year &&
        (report.status ?? "CONFIRME") === "CONFIRME"
    );

    const months = [];
    for (let month = 1; month <= 12; month++) {
      const monthSalaries = salaries.filter((s) => s.month === month);
      const monthCalculations = await ctx.db
        .query("primeCalculations")
        .withIndex("by_period", (q) =>
          q.eq("year", args.year).eq("month", month)
        )
        .collect();
      const calculatedPrimes = monthCalculations.filter(
        (calculation) =>
          calculation.calculationVersion === 2 &&
          calculation.status === "CONFIRME"
      );
      const legacyPrimes =
        calculatedPrimes.length === 0
          ? reports.filter((report) => report.month === month)
          : [];
      const totalSalary = monthSalaries.reduce(
        (sum, s) =>
          sum + Math.max(0, s.baseSalary - (s.leaveDeductions ?? 0)),
        0
      );
      const totalDeductions = monthSalaries.reduce(
        (sum, s) => sum + (s.leaveDeductions ?? 0),
        0
      );
      const totalBase = monthSalaries.reduce((sum, s) => sum + s.baseSalary, 0);
      const totalPrimes =
        calculatedPrimes.length > 0
          ? calculatedPrimes.reduce(
              (sum, calculation) => sum + calculation.totalAmount,
              0
            )
          : legacyPrimes.reduce(
              (sum, report) => sum + (report.computedBonus ?? 0),
              0
            );
      months.push({
        month,
        year: args.year,
        salaryCount: monthSalaries.length,
        primeCount:
          calculatedPrimes.length > 0
            ? calculatedPrimes.length
            : legacyPrimes.length,
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

async function syncSalaryPaymentOrder(
  ctx: MutationCtx,
  args: {
    salaryId: Id<"salaries">;
    employeeId: Id<"users">;
    amount: number;
    month: number;
    year: number;
  },
  now: number,
  options?: { preservePaidOrder?: boolean }
) {
  const existing = await ctx.db
    .query("paymentOrders")
    .withIndex("by_salary", (q) => q.eq("salaryId", args.salaryId))
    .unique();
  const note = `Salaire mensuel ${args.month}/${args.year}`;

  if (args.amount <= 0) {
    if (existing) {
      if (existing.status === "PAYE") {
        if (options?.preservePaidOrder) return "unchanged" as const;
        throw new Error(
          `Le salaire de ${args.month}/${args.year} a déjà été payé et ne peut pas être modifié.`
        );
      }
      await ctx.db.delete(existing._id);
      return "removed" as const;
    }
    return "unchanged" as const;
  }

  if (existing) {
    if (existing.status === "PAYE" && existing.amount !== args.amount) {
      if (options?.preservePaidOrder) return "unchanged" as const;
      throw new Error(
        `Le salaire de ${args.month}/${args.year} a déjà été payé et ne peut pas être modifié.`
      );
    }
    if (existing.amount === args.amount) {
      return "unchanged" as const;
    }
    await ctx.db.patch(existing._id, {
      amount: args.amount,
      note,
      status: "DEMANDE",
      requestedAt: now,
      treatedAt: undefined,
    });
    return "updated" as const;
  }

  await ctx.db.insert("paymentOrders", {
    employeeId: args.employeeId,
    salaryId: args.salaryId,
    type: "SALAIRE_MENSUEL",
    amount: args.amount,
    status: "DEMANDE",
    note,
    requestedAt: now,
  });
  return "created" as const;
}

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
    await requireAdminPage(ctx, args.token, "admin-salaires");

    if (args.month < 1 || args.month > 12) {
      throw new Error("Mois invalide");
    }

    let saved = 0;
    let paymentOrdersCreated = 0;
    let paymentOrdersUpdated = 0;
    for (const entry of args.entries) {
      if (entry.baseSalary < 0) {
        throw new Error("Le salaire ne peut pas être négatif");
      }

      const employee = await ctx.db.get(entry.employeeId);
      if (!employee || employee.role !== "employee") {
        throw new Error("Employé introuvable");
      }

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

      const hadLateSalaryDeduction =
        existing != null &&
        existing.baseSalary === monthAmount &&
        (existing.lateDeductions ?? 0) > 0 &&
        (existing.netPay ??
          Math.max(
            0,
            existing.baseSalary -
              (existing.lateDeductions ?? 0) -
              (existing.leaveDeductions ?? 0)
          )) ===
          Math.max(
            0,
            existing.baseSalary -
              (existing.lateDeductions ?? 0) -
              (existing.leaveDeductions ?? 0)
          );
      const leaveDeductions = existing?.leaveDeductions ?? 0;
      const netPay = Math.max(0, monthAmount - leaveDeductions);

      const salaryFields = {
        baseSalary: monthAmount,
        contractualSalary: contractual,
        daysWorked: proration.daysWorked,
        daysInMonth: proration.daysInMonth,
        lateDeductions: 0,
        leaveDeductions,
        netPay,
        updatedAt: Date.now(),
      };

      let salaryId: Id<"salaries">;
      if (existing) {
        await ctx.db.patch(existing._id, salaryFields);
        salaryId = existing._id;
      } else {
        salaryId = await ctx.db.insert("salaries", {
          employeeId: entry.employeeId,
          ...salaryFields,
          leaveDeductions: leaveDeductions || 0,
          month: args.month,
          year: args.year,
        });
      }
      const orderResult = await syncSalaryPaymentOrder(
        ctx,
        {
          salaryId,
          employeeId: entry.employeeId,
          amount: netPay,
          month: args.month,
          year: args.year,
        },
        Date.now(),
        { preservePaidOrder: hadLateSalaryDeduction }
      );
      if (orderResult === "created") paymentOrdersCreated += 1;
      if (orderResult === "updated") paymentOrdersUpdated += 1;
      saved += 1;
    }

    return { saved, paymentOrdersCreated, paymentOrdersUpdated };
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
      monthAmount - leaveDeductions
    );

    const salaryFields = {
      baseSalary: monthAmount,
      contractualSalary: contractual,
      daysWorked: proration.daysWorked,
      daysInMonth: proration.daysInMonth,
      lateDeductions: 0,
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
    await requireAdminPage(ctx, args.token, "admin-primes");
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
    await requireAdminPage(ctx, args.token, "admin-ordres");
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
    await requireAdminPage(ctx, args.token, "admin-primes");
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
    await requireAdminPage(ctx, args.token, "admin-ordres");
    const employee = await ctx.db.get(args.employeeId);
    if (!employee || employee.role !== "employee") {
      throw new Error("Employé introuvable");
    }

    const salaryRows = (
      await ctx.db
        .query("salaries")
        .withIndex("by_employee", (q) => q.eq("employeeId", args.employeeId))
        .collect()
    ).sort((a, b) =>
      a.year === b.year ? b.month - a.month : b.year - a.year
    );
    const salaries = salaryRows.map((salary) => ({
      ...salary,
      lateDeductions: 0,
      netPay: Math.max(0, salary.baseSalary - (salary.leaveDeductions ?? 0)),
    }));

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
    const lateDeductions = await ctx.db
      .query("approvedLateDeductions")
      .withIndex("by_employee", (q) => q.eq("employeeId", args.employeeId))
      .collect();

    return {
      employee: publicUser(employee),
      salaries,
      bonuses,
      lateDeductions,
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
      v.literal("REJETE")
    ),
  },
  handler: async (ctx, args) => {
    await requireAdminPage(ctx, args.token, "admin-ordres");
    const order = await ctx.db.get(args.orderId);
    if (!order) throw new Error("Ordre introuvable");
    if (order.status !== "DEMANDE") {
      throw new Error("Seules les demandes en attente peuvent être traitées");
    }

    const treatedAt = Date.now();
    await ctx.db.patch(args.orderId, {
      status: args.status === "VALIDE" ? "A_CONFIRMER" : "REJETE",
      treatedAt,
      ...(args.status === "VALIDE" ? { disbursedAt: treatedAt } : {}),
    });

    const labels = {
      VALIDE: "validée",
      REJETE: "rejetée",
    } as const;

    await notify(
      ctx,
      order.employeeId,
      "Demande de paiement",
      args.status === "VALIDE"
        ? `Votre demande de ${order.amount.toLocaleString("fr-DZ")} DZD a été validée. Confirmez sa réception dans votre espace Finances.`
        : `Votre demande de ${order.amount.toLocaleString("fr-DZ")} DZD a été ${labels[args.status]}.`
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
          "Confirmation de paiement en attente",
          `${employee?.name ?? "Un collaborateur"} — ${order.amount.toLocaleString("fr-DZ")} DZD (${order.type}) validé par l'admin. En attente de confirmation de réception par l'employé.`
        );
      }
    }

    return await ctx.db.get(args.orderId);
  },
});

export const validatePaymentOrdersBatch = mutation({
  args: {
    token: v.string(),
    orderIds: v.array(v.id("paymentOrders")),
  },
  handler: async (ctx, args) => {
    await requireAdminPage(ctx, args.token, "admin-ordres");
    const uniqueIds = [...new Set(args.orderIds)];
    if (uniqueIds.length === 0) {
      throw new Error("Sélectionnez au moins une demande");
    }

    const orders = [];
    for (const orderId of uniqueIds) {
      const order = await ctx.db.get(orderId);
      if (!order) throw new Error("Une demande sélectionnée est introuvable");
      if (order.status !== "DEMANDE") {
        throw new Error(
          "Toutes les demandes sélectionnées doivent être en attente"
        );
      }
      orders.push(order);
    }

    const now = Date.now();
    const financeStaff = (await ctx.db.query("users").collect()).filter(
      (user) =>
        user.role === "employee" &&
        user.isActive &&
        !user.resignedAt &&
        isFinanceDepartment(user.department)
    );

    for (const order of orders) {
      await ctx.db.patch(order._id, {
        status: "A_CONFIRMER",
        treatedAt: now,
        disbursedAt: now,
      });

      const employee = await ctx.db.get(order.employeeId);
      await notify(
        ctx,
        order.employeeId,
        "Demande de paiement",
        `Votre demande de ${order.amount.toLocaleString("fr-DZ")} DZD a été validée. Confirmez sa réception dans votre espace Finances.`
      );
      for (const staff of financeStaff) {
        await notify(
          ctx,
          staff._id,
          "Confirmation de paiement en attente",
          `${employee?.name ?? "Un collaborateur"} — ${order.amount.toLocaleString("fr-DZ")} DZD (${order.type}) validé par l'admin. En attente de confirmation de réception par l'employé.`
        );
      }
    }

    return { validated: orders.length };
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

/** Finance department: handed payments awaiting employee confirmation. */
export const listPaidForFinance = query({
  args: { token: v.string() },
  handler: async (ctx, args) => {
    const staff = await requireFinanceStaff(ctx, args.token);
    const rows = await ctx.db
      .query("paymentOrders")
      .withIndex("by_status", (q) => q.eq("status", "A_CONFIRMER"))
      .collect();

    const result = await filterOrdersForFinanceWorkplace(ctx, staff, rows);
    return result
      .sort((a, b) => (b.disbursedAt ?? 0) - (a.disbursedAt ?? 0))
      .slice(0, 50);
  },
});

/** Finance staff records that a validated payment was handed to the employee. */
export const markDisbursedByFinance = mutation({
  args: {
    token: v.string(),
    orderId: v.id("paymentOrders"),
  },
  handler: async (ctx, args) => {
    const staff = await requireFinanceStaff(ctx, args.token);
    const order = await ctx.db.get(args.orderId);
    if (!order) throw new Error("Ordre introuvable");
    if (order.status !== "VALIDE") {
      throw new Error("Seules les demandes validées par l'admin peuvent être remises");
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
      status: "A_CONFIRMER",
      disbursedAt: Date.now(),
    });

    await notify(
      ctx,
      order.employeeId,
      "Confirmation de réception requise",
      `Le paiement de ${order.amount.toLocaleString("fr-DZ")} DZD (${order.type}) vous a été remis. Confirmez sa réception dans votre espace Finances.`
    );

    const admins = (await ctx.db.query("users").collect()).filter(
      (u) => u.role === "admin" && u.isActive
    );
    for (const admin of admins) {
      await notify(
        ctx,
        admin._id,
        "Paiement remis — confirmation attendue",
        `${staff.name} a remis ${order.amount.toLocaleString("fr-DZ")} DZD à l'employé. En attente de sa confirmation.`
      );
    }

    return await ctx.db.get(args.orderId);
  },
});

export const confirmPaymentReceived = mutation({
  args: {
    token: v.string(),
    orderId: v.id("paymentOrders"),
  },
  handler: async (ctx, args) => {
    const employee = await requireUser(ctx, args.token);
    if (employee.role !== "employee") {
      throw new Error("Seul l'employé destinataire peut confirmer la réception");
    }
    const order = await ctx.db.get(args.orderId);
    if (!order || order.employeeId !== employee._id) {
      throw new Error("Demande de paiement introuvable");
    }
    if (order.status !== "A_CONFIRMER") {
      throw new Error("Ce paiement n'attend pas de confirmation");
    }

    const orders = await ctx.db.query("paymentOrders").collect();
    const usedReferences = new Set(
      orders
        .map((paymentOrder) => paymentOrder.receiptReference)
        .filter((reference): reference is string => reference !== undefined)
    );
    let receiptNumber = 1;
    while (
      receiptNumber <= 9999 &&
      usedReferences.has(String(receiptNumber).padStart(4, "0"))
    ) {
      receiptNumber += 1;
    }
    if (receiptNumber > 9999) {
      throw new Error("Tous les numéros de reçu à quatre chiffres sont utilisés");
    }

    await ctx.db.patch(order._id, {
      status: "PAYE",
      confirmedAt: Date.now(),
      receiptReference: String(receiptNumber).padStart(4, "0"),
    });

    const admins = (await ctx.db.query("users").collect()).filter(
      (user) => user.role === "admin" && user.isActive
    );
    for (const admin of admins) {
      await notify(
        ctx,
        admin._id,
        "Réception de paiement confirmée",
        `${employee.name} a confirmé la réception de ${order.amount.toLocaleString("fr-DZ")} DZD (${order.type}). Le reçu est disponible dans les ordres de paiement.`
      );
    }
    return await ctx.db.get(order._id);
  },
});
