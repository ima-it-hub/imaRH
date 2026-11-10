import { mutation, query } from "./_generated/server";
import { v } from "convex/values";
import {
  annualLeaveBalanceForYear,
  annualLeaveEntitlement,
  EMPLOYEE_PAGE_KEYS,
  ASSIGNABLE_PAGE_KEYS,
  generateUniqueBarcode,
  getSettings,
  hashPassword,
  normalizeUsername,
  prorateMonthlySalary,
  publicUser,
  requireAdmin,
  requireAdminAnyPage,
  requireAdminPage,
  todayISO,
} from "./lib";

export const list = query({
  args: { token: v.string() },
  handler: async (ctx, args) => {
    await requireAdminPage(ctx, args.token, "admin-employes");
    const users = await ctx.db.query("users").collect();
    const enriched = [];
    const leaveYear = Number(todayISO().slice(0, 4));
    for (const u of users) {
      const base = publicUser(u);
      let managerName = "";
      if (u.managerId) {
        const manager = await ctx.db.get(u.managerId);
        managerName = manager?.name ?? "";
      }
      enriched.push({
        ...base,
        annualLeaveBalance:
          u.role === "employee"
            ? await annualLeaveBalanceForYear(ctx, u, leaveYear)
            : base.annualLeaveBalance,
        managerName,
      });
    }
    return enriched.sort((a, b) => a.name.localeCompare(b.name));
  },
});

export const listEmployees = query({
  args: { token: v.string() },
  handler: async (ctx, args) => {
    await requireAdminAnyPage(ctx, args.token, [
      "admin-employes",
      "admin-conges",
      "admin-salaires",
      "admin-primes",
      "admin-ordres",
      "admin-rapports",
    ]);
    const users = (await ctx.db.query("users").collect()).filter(
      (u) => u.role === "employee" && !u.resignedAt
    );
    const year = Number(todayISO().slice(0, 4));
    const result = [];
    for (const employee of users) {
      result.push({
        ...publicUser(employee),
        annualLeaveBalance: await annualLeaveBalanceForYear(
          ctx,
          employee,
          year
        ),
      });
    }
    return result.sort((a, b) => a.name.localeCompare(b.name));
  },
});

/** Potential managers: admins + employees (for assignment dropdown). */
export const listManagers = query({
  args: { token: v.string() },
  handler: async (ctx, args) => {
    await requireAdminPage(ctx, args.token, "admin-employes");
    const users = await ctx.db.query("users").collect();
    return users
      .filter((u) => u.isActive)
      .map(publicUser)
      .sort((a, b) => a.name.localeCompare(b.name));
  },
});

export const create = mutation({
  args: {
    token: v.string(),
    firstName: v.string(),
    lastName: v.string(),
    username: v.string(),
    email: v.optional(v.string()),
    password: v.string(),
    role: v.union(v.literal("admin"), v.literal("employee")),
    allowedPages: v.array(v.string()),
    department: v.optional(v.string()),
    departmentId: v.optional(v.id("departments")),
    workplaceId: v.optional(v.id("workplaces")),
    associatedAgentCode: v.optional(v.string()),
    managerId: v.optional(v.id("users")),
    phone: v.optional(v.string()),
    baseSalary: v.optional(v.number()),
    baseBonus: v.optional(v.number()),
    annualLeaveQuota: v.optional(v.number()),
    /** Hire date as timestamp (ms). Defaults to now. */
    hireDate: v.optional(v.number()),
    /** ZKTeco K50 Pro enrolled user ID (digits) */
    zktecoUserId: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const actor = await requireAdminPage(ctx, args.token, "admin-employes");
    if (actor.role !== "admin" && args.role !== "employee") {
      throw new Error("Seuls les administrateurs peuvent créer un compte admin");
    }

    const username = normalizeUsername(args.username);
    if (username.length < 3) {
      throw new Error("Le nom d'utilisateur doit contenir au moins 3 caractères");
    }

    const existingUsername = await ctx.db
      .query("users")
      .withIndex("by_username", (q) => q.eq("username", username))
      .unique();
    if (existingUsername) {
      throw new Error("Ce nom d'utilisateur est déjà pris");
    }

    const email = (args.email?.trim() || `${username}@ima.dz`).toLowerCase();
    const existingEmail = await ctx.db
      .query("users")
      .withIndex("by_email", (q) => q.eq("email", email))
      .unique();
    if (existingEmail) {
      throw new Error("Un utilisateur avec cet e-mail existe déjà");
    }

    if (args.password.length < 4) {
      throw new Error("Le mot de passe doit contenir au moins 4 caractères");
    }

    if (args.role === "employee" && !args.managerId) {
      throw new Error("Chaque employé doit avoir un manager");
    }

    if (args.role === "employee" && !args.departmentId) {
      throw new Error("Chaque employé doit avoir un département");
    }
    if (args.role === "employee" && !args.workplaceId) {
      throw new Error("Chaque employé doit avoir un lieu de travail");
    }
    if (args.role === "employee" && (args.baseBonus ?? 0) <= 0) {
      throw new Error("La prime de base de l'employé doit être supérieure à zéro");
    }

    let workplaceName = "";
    const workplaceId = args.workplaceId;
    if (workplaceId) {
      const wp = await ctx.db.get(workplaceId);
      if (!wp) throw new Error("Lieu de travail introuvable");
      workplaceName = wp.name;
    }

    let departmentName = args.department?.trim() ?? "";
    const departmentId = args.departmentId;
    if (departmentId) {
      const dept = await ctx.db.get(departmentId);
      if (!dept) throw new Error("Département introuvable");
      departmentName = dept.name;
    }

    if (args.managerId) {
      const manager = await ctx.db.get(args.managerId);
      if (!manager || !manager.isActive) {
        throw new Error("Manager introuvable");
      }
    }

    const firstName = args.firstName.trim();
    const lastName = args.lastName.trim();
    const name = `${firstName} ${lastName}`.trim();
    const quota = args.annualLeaveQuota ?? 30;
    if (!Number.isFinite(quota) || quota < 0) {
      throw new Error("Le quota annuel de congés doit être positif");
    }
    const hireDate =
      args.hireDate && args.hireDate > 0 ? args.hireDate : Date.now();
    const leaveYear = Number(todayISO().slice(0, 4));

    const allowedPageKeys =
      actor.role === "admin" ? ASSIGNABLE_PAGE_KEYS : EMPLOYEE_PAGE_KEYS;
    const allowedPages =
      args.role === "admin"
        ? [...EMPLOYEE_PAGE_KEYS]
        : args.allowedPages.filter((page) =>
            (allowedPageKeys as readonly string[]).includes(page)
          );

    const passwordHash = await hashPassword(args.password);
    const barcode =
      args.role === "employee" ? await generateUniqueBarcode(ctx) : undefined;

    const zktecoUserId =
      args.role === "employee" && args.zktecoUserId?.trim()
        ? args.zktecoUserId.trim()
        : undefined;
    if (zktecoUserId) {
      const taken = await ctx.db
        .query("users")
        .withIndex("by_zkteco_user_id", (q) =>
          q.eq("zktecoUserId", zktecoUserId)
        )
        .unique();
      if (taken) {
        throw new Error(
          `L'ID ZKTeco ${zktecoUserId} est déjà assigné à ${taken.name}`
        );
      }
    }

    const userId = await ctx.db.insert("users", {
      name,
      firstName,
      lastName,
      username,
      email,
      passwordHash,
      role: args.role,
      allowedPages,
      isActive: true,
      phone: args.phone?.trim() ?? "",
      department: departmentName,
      departmentId,
      workplace: workplaceName || undefined,
      workplaceId,
      associatedAgentCode: args.associatedAgentCode?.trim() || undefined,
      managerId: args.role === "employee" ? args.managerId : undefined,
      hireDate,
      annualLeaveBalance: annualLeaveEntitlement(
        quota,
        hireDate,
        leaveYear
      ),
      annualLeaveBalanceYear: leaveYear,
      annualLeaveQuota: quota,
      baseSalary: args.baseSalary ?? 0,
      bonusType: args.role === "employee" ? "FIXED" : undefined,
      baseBonus: args.role === "employee" ? args.baseBonus : 0,
      bonusPercent: 0,
      barcode,
      zktecoUserId,
    });

    // Salaries are defined only via admin Salaires page — never auto-created here.

    const user = await ctx.db.get(userId);
    return publicUser(user!);
  },
});

export const updatePages = mutation({
  args: {
    token: v.string(),
    userId: v.id("users"),
    allowedPages: v.array(v.string()),
  },
  handler: async (ctx, args) => {
    await requireAdmin(ctx, args.token);

    const user = await ctx.db.get(args.userId);
    if (!user) throw new Error("Utilisateur introuvable");
    if (user.role === "admin") {
      throw new Error("Les administrateurs ont toujours un accès complet");
    }

    const allowedPages = args.allowedPages.filter((page) =>
      (ASSIGNABLE_PAGE_KEYS as readonly string[]).includes(page)
    );

    await ctx.db.patch(args.userId, { allowedPages });
    const updated = await ctx.db.get(args.userId);
    return publicUser(updated!);
  },
});

export const updateEmployee = mutation({
  args: {
    token: v.string(),
    userId: v.id("users"),
    firstName: v.string(),
    lastName: v.string(),
    department: v.optional(v.string()),
    departmentId: v.optional(v.id("departments")),
    workplaceId: v.optional(v.id("workplaces")),
    associatedAgentCode: v.optional(v.string()),
    managerId: v.optional(v.id("users")),
    phone: v.string(),
    baseSalary: v.number(),
    baseBonus: v.number(),
    annualLeaveQuota: v.number(),
    /** Hire date as timestamp (ms) */
    hireDate: v.optional(v.number()),
    /** ZKTeco K50 Pro enrolled user ID (digits); empty clears */
    zktecoUserId: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const actor = await requireAdminPage(ctx, args.token, "admin-employes");
    const user = await ctx.db.get(args.userId);
    if (!user) throw new Error("Utilisateur introuvable");
    if (actor.role !== "admin" && user.role !== "employee") {
      throw new Error("Seuls les administrateurs peuvent modifier un compte admin");
    }

    const firstName = args.firstName.trim();
    const lastName = args.lastName.trim();

    if (args.hireDate !== undefined && args.hireDate <= 0) {
      throw new Error("Date d'embauche invalide");
    }

    let zktecoUserIdValue: string | undefined = undefined;
    let clearZkteco = false;
    if (args.zktecoUserId !== undefined) {
      const raw = args.zktecoUserId.trim();
      if (!raw) {
        clearZkteco = true;
      } else {
        const taken = await ctx.db
          .query("users")
          .withIndex("by_zkteco_user_id", (q) => q.eq("zktecoUserId", raw))
          .unique();
        if (taken && taken._id !== args.userId) {
          throw new Error(
            `L'ID ZKTeco ${raw} est déjà assigné à ${taken.name}`
          );
        }
        zktecoUserIdValue = raw;
      }
    }

    let workplaceId = args.workplaceId ?? user.workplaceId;
    let workplaceName = user.workplace ?? "";
    if (args.workplaceId) {
      const wp = await ctx.db.get(args.workplaceId);
      if (!wp) throw new Error("Lieu de travail introuvable");
      workplaceId = wp._id;
      workplaceName = wp.name;
    } else if (workplaceId) {
      const wp = await ctx.db.get(workplaceId);
      workplaceName = wp?.name ?? workplaceName;
    }

    let departmentName = args.department?.trim() ?? user.department ?? "";
    const departmentId = args.departmentId ?? user.departmentId;
    if (args.departmentId) {
      const dept = await ctx.db.get(args.departmentId);
      if (!dept) throw new Error("Département introuvable");
      departmentName = dept.name;
    }

    if (user.role === "employee" && !workplaceId) {
      throw new Error("Chaque employé doit avoir un lieu de travail");
    }

    if (args.managerId) {
      if (args.managerId === args.userId) {
        throw new Error("Un employé ne peut pas être son propre manager");
      }
      const manager = await ctx.db.get(args.managerId);
      if (!manager || !manager.isActive) {
        throw new Error("Manager introuvable");
      }
    }

    if (user.role === "employee" && !args.managerId && !user.managerId) {
      throw new Error("Chaque employé doit avoir un manager");
    }
    const baseBonus = args.baseBonus;
    if (user.role === "employee" && baseBonus <= 0) {
      throw new Error("La prime de base de l'employé doit être supérieure à zéro");
    }
    if (!Number.isFinite(args.annualLeaveQuota) || args.annualLeaveQuota < 0) {
      throw new Error("Le quota annuel de congés doit être positif");
    }
    const leaveYear = Number(todayISO().slice(0, 4));
    const leaveRows = await ctx.db
      .query("leaves")
      .withIndex("by_employee", (q) => q.eq("employeeId", args.userId))
      .collect();
    const previouslyUsedDays = leaveRows.reduce((sum, leave) => {
      const leaveStart = leave.actualStartDate ?? leave.startDate;
      return leave.balanceDeducted && leaveStart.slice(0, 4) === String(leaveYear)
        ? sum + (leave.deductedDays ?? leave.days)
        : sum;
    }, 0);
    const nextLeaveBalance = Math.max(
      0,
      annualLeaveEntitlement(
        args.annualLeaveQuota,
        args.hireDate ?? user.hireDate,
        leaveYear
      ) - previouslyUsedDays
    );

    await ctx.db.patch(args.userId, {
      firstName,
      lastName,
      name: `${firstName} ${lastName}`.trim(),
      department: departmentName,
      departmentId,
      workplace: workplaceName || undefined,
      workplaceId,
      associatedAgentCode: args.associatedAgentCode?.trim() || undefined,
      ...(args.managerId !== undefined
        ? { managerId: args.managerId }
        : {}),
      phone: args.phone.trim(),
      baseSalary: args.baseSalary,
      ...(user.role === "employee"
        ? { bonusType: "FIXED" as const, baseBonus, bonusPercent: 0 }
        : {}),
      annualLeaveQuota: args.annualLeaveQuota,
      annualLeaveBalance: nextLeaveBalance,
      annualLeaveBalanceYear: leaveYear,
      ...(args.hireDate !== undefined ? { hireDate: args.hireDate } : {}),
      ...(args.zktecoUserId !== undefined
        ? clearZkteco
          ? { zktecoUserId: undefined }
          : { zktecoUserId: zktecoUserIdValue }
        : {}),
    });

    const updated = await ctx.db.get(args.userId);
    return publicUser(updated!);
  },
});

export const setBaseBonus = mutation({
  args: {
    token: v.string(),
    userId: v.id("users"),
    baseBonus: v.number(),
  },
  handler: async (ctx, args) => {
    await requireAdmin(ctx, args.token);
    const user = await ctx.db.get(args.userId);
    if (!user || user.role !== "employee") {
      throw new Error("Employé introuvable");
    }
    if (args.baseBonus <= 0) {
      throw new Error("La prime de base de l'employé doit être supérieure à zéro");
    }
    await ctx.db.patch(args.userId, {
      baseBonus: args.baseBonus,
      bonusType: "FIXED",
      bonusPercent: 0,
    });
    return publicUser((await ctx.db.get(args.userId))!);
  },
});

/** Assign barcodes to employees that were created before barcode support. */
export const ensureBarcodes = mutation({
  args: { token: v.string() },
  handler: async (ctx, args) => {
    await requireAdminPage(ctx, args.token, "admin-employes");
    const users = await ctx.db.query("users").collect();
    let created = 0;
    for (const user of users) {
      if (user.role !== "employee") continue;
      if (user.barcode) continue;
      const barcode = await generateUniqueBarcode(ctx);
      await ctx.db.patch(user._id, { barcode });
      created += 1;
    }
    return { created };
  },
});

export const setActive = mutation({
  args: {
    token: v.string(),
    userId: v.id("users"),
    isActive: v.boolean(),
  },
  handler: async (ctx, args) => {
    const admin = await requireAdminPage(ctx, args.token, "admin-employes");

    if (admin._id === args.userId && !args.isActive) {
      throw new Error("Vous ne pouvez pas désactiver votre propre compte");
    }

    const user = await ctx.db.get(args.userId);
    if (!user) throw new Error("Utilisateur introuvable");
    if (admin.role !== "admin" && user.role !== "employee") {
      throw new Error("Seuls les administrateurs peuvent modifier un compte admin");
    }
    if (user.resignedAt) {
      throw new Error("Cet employé a déjà démissionné");
    }

    await ctx.db.patch(args.userId, { isActive: args.isActive });

    if (!args.isActive) {
      const sessions = await ctx.db
        .query("sessions")
        .withIndex("by_user", (q) => q.eq("userId", args.userId))
        .collect();
      for (const session of sessions) {
        await ctx.db.delete(session._id);
      }
    }

    const updated = await ctx.db.get(args.userId);
    return publicUser(updated!);
  },
});

/** Démission : archive l'employé (désactive + marque démissionné, sessions coupées). */
export const resign = mutation({
  args: {
    token: v.string(),
    userId: v.id("users"),
    stoppingDate: v.string(),
  },
  handler: async (ctx, args) => {
    const admin = await requireAdminPage(ctx, args.token, "admin-employes");
    if (admin._id === args.userId) {
      throw new Error("Vous ne pouvez pas enregistrer votre propre démission");
    }

    const user = await ctx.db.get(args.userId);
    if (!user) throw new Error("Utilisateur introuvable");
    if (user.role !== "employee") {
      throw new Error("Seuls les employés peuvent être marqués en démission");
    }
    if (user.resignedAt) {
      throw new Error("Cet employé a déjà démissionné");
    }

    if (
      !/^\d{4}-\d{2}-\d{2}$/.test(args.stoppingDate) ||
      args.stoppingDate > todayISO()
    ) {
      throw new Error("Saisissez une date de fin de travail valide");
    }
    const stoppingDateMs = new Date(
      `${args.stoppingDate}T12:00:00+01:00`
    ).getTime();
    if (
      !Number.isFinite(stoppingDateMs) ||
      todayISO(new Date(stoppingDateMs)) !== args.stoppingDate ||
      (user.hireDate != null &&
        todayISO(new Date(user.hireDate)) > args.stoppingDate)
    ) {
      throw new Error("Date de fin de travail invalide");
    }

    const [yearText, monthText] = args.stoppingDate.split("-");
    const year = Number(yearText);
    const month = Number(monthText);
    const settings = await getSettings(ctx);
    const proratedSalary = prorateMonthlySalary(
      user.baseSalary ?? 0,
      user.hireDate,
      year,
      month,
      stoppingDateMs
    );
    const existingSalary = await ctx.db
      .query("salaries")
      .withIndex("by_employee_period", (q) =>
        q.eq("employeeId", args.userId).eq("year", year).eq("month", month)
      )
      .unique();
    const leaveDeductions = existingSalary?.leaveDeductions ?? 0;
    const netPay = Math.max(0, proratedSalary.amount - leaveDeductions);
    const salaryOrder = existingSalary
      ? await ctx.db
        .query("paymentOrders")
        .withIndex("by_salary", (q) => q.eq("salaryId", existingSalary._id))
        .unique()
      : null;
    if (
      salaryOrder &&
      salaryOrder.amount !== netPay &&
      !["DEMANDE", "REJETE"].includes(salaryOrder.status)
    ) {
      throw new Error(
        "Le salaire de ce mois a déjà été validé ou payé. Régularisez-le avant d'enregistrer la démission."
      );
    }
    const salaryFields = {
      baseSalary: proratedSalary.amount,
      contractualSalary: user.baseSalary ?? 0,
      daysWorked: proratedSalary.daysWorked,
      daysInMonth: proratedSalary.daysInMonth,
      leaveDeductions,
      netPay,
      updatedAt: Date.now(),
    };
    if (existingSalary) {
      await ctx.db.patch(existingSalary._id, salaryFields);
    } else {
      await ctx.db.insert("salaries", {
        employeeId: args.userId,
        ...salaryFields,
        month,
        year,
      });
    }
    if (
      salaryOrder &&
      (salaryOrder.status === "DEMANDE" || salaryOrder.status === "REJETE") &&
      salaryOrder.amount !== netPay
    ) {
      if (netPay <= 0) {
        await ctx.db.delete(salaryOrder._id);
      } else {
        await ctx.db.patch(salaryOrder._id, {
          amount: netPay,
          status: "DEMANDE",
          note: `Salaire final au ${args.stoppingDate}`,
          requestedAt: Date.now(),
          treatedAt: undefined,
        });
      }
    }

    const annualBalance = await annualLeaveBalanceForYear(ctx, user, year);
    const accruedDays = annualLeaveEntitlement(
      user.annualLeaveQuota ?? 30,
      user.hireDate,
      year,
      args.stoppingDate
    );
    const settlementDays = annualBalance - accruedDays;
    const dailyRate =
      (user.baseSalary ?? 0) / Math.max(1, settings.workingDaysPerMonth);
    const settlementAmount = Math.round(settlementDays * dailyRate);
    const existingSettlement = await ctx.db
      .query("annualLeaveSettlements")
      .withIndex("by_employee_year_kind", (q) =>
        q
          .eq("employeeId", args.userId)
          .eq("year", year)
          .eq("kind", "RESIGNATION")
      )
      .unique();
    if (existingSettlement) {
      throw new Error("Le solde de congés de cette année a déjà été régularisé");
    }
    if (settlementDays !== 0) {
      await ctx.db.insert("annualLeaveSettlements", {
        employeeId: args.userId,
        year,
        kind: "RESIGNATION",
        days: settlementDays,
        amount: settlementAmount,
        createdAt: Date.now(),
      });
    }

    await ctx.db.patch(args.userId, {
      isActive: false,
      resignedAt: stoppingDateMs,
      annualLeaveBalance: annualBalance,
      annualLeaveBalanceYear: year,
    });

    const sessions = await ctx.db
      .query("sessions")
      .withIndex("by_user", (q) => q.eq("userId", args.userId))
      .collect();
    for (const session of sessions) {
      await ctx.db.delete(session._id);
    }

    // Clear manager link from anyone reporting to this employee
    const reports = await ctx.db
      .query("users")
      .withIndex("by_manager", (q) => q.eq("managerId", args.userId))
      .collect();
    for (const report of reports) {
      await ctx.db.patch(report._id, { managerId: undefined });
    }

    return {
      employee: publicUser((await ctx.db.get(args.userId))!),
      finalSalary: netPay,
      workingDays: proratedSalary.daysWorked,
      annualLeaveAdjustmentDays: settlementDays,
      annualLeaveAdjustmentAmount: settlementAmount,
    };
  },
});
