import { mutation, query, MutationCtx } from "./_generated/server";
import { v } from "convex/values";
import { Id } from "./_generated/dataModel";
import { recalculateLeaveAttendance } from "./attendance";
import {
  addDaysISO,
  daysBetween,
  getSettings,
  monthBounds,
  notify,
  publicUser,
  requireAdmin,
  requireUser,
  todayISO,
} from "./lib";

/** Extra days beyond demand: acceptable = actual total; else requested + 2×extra. */
export function computeDeductedDays(
  requestedDays: number,
  actualDays: number,
  delayStatus?: "ACCEPTABLE" | "NON_ACCEPTABLE"
) {
  if (actualDays <= requestedDays) {
    return actualDays;
  }
  const extra = actualDays - requestedDays;
  if (delayStatus === "NON_ACCEPTABLE") {
    return requestedDays + extra * 2;
  }
  return actualDays;
}

/**
 * Split charged days between annual balance and salary.
 * - annuel → all from balance
 * - maladie paid → nothing
 * - maladie unpaid → balance first, remainder from salary
 * - sans_solde → all from salary
 */
export function splitLeaveCharges(args: {
  type: "annuel" | "maladie" | "sans_solde";
  isPaid?: boolean;
  days: number;
  annualBalance: number;
}) {
  const days = Math.max(0, args.days);
  if (args.type === "annuel") {
    return { fromBalance: days, fromSalary: 0 };
  }
  if (args.type === "maladie" && args.isPaid === true) {
    return { fromBalance: 0, fromSalary: 0 };
  }
  if (args.type === "maladie" && args.isPaid === false) {
    const fromBalance = Math.min(days, Math.max(0, args.annualBalance));
    return { fromBalance, fromSalary: days - fromBalance };
  }
  // sans_solde (and maladie without isPaid treated as unpaid at close if set)
  if (args.type === "sans_solde") {
    return { fromBalance: 0, fromSalary: days };
  }
  // maladie with isPaid unset — treat as paid (safe default)
  return { fromBalance: 0, fromSalary: 0 };
}

function isValidISODate(value: string) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return false;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const date = new Date(Date.UTC(year, month - 1, day));
  return (
    date.getUTCFullYear() === year &&
    date.getUTCMonth() === month - 1 &&
    date.getUTCDate() === day
  );
}

function isValidClockTime(value: string) {
  const match = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(value);
  return Boolean(match);
}

function dateRangesOverlap(
  firstStart: string,
  firstEnd: string,
  secondStart: string,
  secondEnd: string
) {
  return firstStart < secondEnd && secondStart < firstEnd;
}

async function syncMonthLeaveDeductions(
  ctx: MutationCtx,
  employeeId: Id<"users">,
  date: string
) {
  const [yearStr, monthStr] = date.split("-");
  const year = Number(yearStr);
  const month = Number(monthStr);
  const { start, end } = monthBounds(year, month);

  const employee = await ctx.db.get(employeeId);
  if (!employee) return;

  const leaves = await ctx.db
    .query("leaves")
    .withIndex("by_employee", (q) => q.eq("employeeId", employeeId))
    .collect();

  const leaveDeductions = leaves
    .filter(
      (l) =>
        l.status === "CLOTURE" &&
        l.actualStartDate &&
        l.actualStartDate >= start &&
        l.actualStartDate <= end
    )
    .reduce((sum, l) => sum + (l.salaryDeductionAmount ?? 0), 0);

  const existing = await ctx.db
    .query("salaries")
    .withIndex("by_employee_period", (q) =>
      q.eq("employeeId", employeeId).eq("year", year).eq("month", month)
    )
    .unique();

  const baseSalary = existing?.baseSalary || employee.baseSalary || 0;
  const netPay = Math.max(0, baseSalary - leaveDeductions);

  if (existing) {
    await ctx.db.patch(existing._id, {
      lateDeductions: 0,
      leaveDeductions,
      netPay,
      updatedAt: Date.now(),
    });
  } else if (leaveDeductions > 0 && baseSalary > 0) {
    await ctx.db.insert("salaries", {
      employeeId,
      baseSalary,
      lateDeductions: 0,
      leaveDeductions,
      netPay,
      month,
      year,
      updatedAt: Date.now(),
    });
  }
}

export const myLeaves = query({
  args: { token: v.string() },
  handler: async (ctx, args) => {
    const user = await requireUser(ctx, args.token);
    const rows = await ctx.db
      .query("leaves")
      .withIndex("by_employee", (q) => q.eq("employeeId", user._id))
      .collect();
    return rows
      .filter((leave) => !leave.companyLeaveHalfDay)
      .sort((a, b) => b.createdAt - a.createdAt);
  },
});

export const request = mutation({
  args: {
    token: v.string(),
    type: v.union(
      v.literal("annuel"),
      v.literal("maladie"),
      v.literal("sans_solde")
    ),
    startDate: v.string(),
    endDate: v.string(),
    reason: v.string(),
  },
  handler: async (ctx, args) => {
    const user = await requireUser(ctx, args.token);
    if (user.role !== "employee") {
      throw new Error("Seuls les employés peuvent demander un congé");
    }
    if (!args.reason.trim()) throw new Error("Le motif est obligatoire");
    if (args.endDate <= args.startDate) {
      throw new Error(
        "La date de retour doit être après la date de début (elle n'est pas décomptée)"
      );
    }

    const days = daysBetween(args.startDate, args.endDate);
    if (days < 1) {
      throw new Error("La période de congé doit compter au moins 1 jour");
    }
    if (args.type === "annuel") {
      // 15 full days of notice → earliest start = today + 16 (Algiers)
      const minStart = addDaysISO(todayISO(), 16);
      if (args.startDate < minStart) {
        throw new Error(
          `Pour un congé annuel, la date de départ doit être au plus tôt le ${minStart} (délai de 15 jours)`
        );
      }
    }
    const balance = user.annualLeaveBalance ?? 0;
    if (args.type === "annuel" && days > balance) {
      throw new Error(`Solde insuffisant (${balance} jour(s) restant(s))`);
    }

    const id = await ctx.db.insert("leaves", {
      employeeId: user._id,
      type: args.type,
      startDate: args.startDate,
      endDate: args.endDate,
      days,
      reason: args.reason.trim(),
      status: "EN_ATTENTE",
      isPaid: args.type === "sans_solde" ? false : undefined,
      balanceDeducted: false,
      createdAt: Date.now(),
    });

    const admins = (await ctx.db.query("users").collect()).filter(
      (u) => u.role === "admin" && u.isActive
    );
    for (const admin of admins) {
      await notify(
        ctx,
        admin._id,
        "Nouvelle demande de congé",
        `${user.name} a demandé ${days} jour(s) de congé (${args.type}).`
      );
    }

    return await ctx.db.get(id);
  },
});

export const pending = query({
  args: { token: v.string() },
  handler: async (ctx, args) => {
    await requireAdmin(ctx, args.token);
    const rows = await ctx.db
      .query("leaves")
      .withIndex("by_status", (q) => q.eq("status", "EN_ATTENTE"))
      .collect();

    const result = [];
    for (const row of rows) {
      const employee = await ctx.db.get(row.employeeId);
      if (!employee) continue;
      result.push({ ...row, employee: publicUser(employee) });
    }
    return result.sort((a, b) => b.createdAt - a.createdAt);
  },
});

/** Approved leaves waiting for actual leave/return dates. */
export const toClose = query({
  args: { token: v.string() },
  handler: async (ctx, args) => {
    await requireAdmin(ctx, args.token);
    const rows = await ctx.db
      .query("leaves")
      .withIndex("by_status", (q) => q.eq("status", "APPROUVE"))
      .collect();

    const result = [];
    for (const row of rows) {
      if (row.actualStartDate && row.actualEndDate) continue;
      const employee = await ctx.db.get(row.employeeId);
      if (!employee) continue;
      result.push({ ...row, employee: publicUser(employee) });
    }
    return result.sort((a, b) => (b.treatedAt ?? 0) - (a.treatedAt ?? 0));
  },
});

export const all = query({
  args: { token: v.string() },
  handler: async (ctx, args) => {
    await requireAdmin(ctx, args.token);
    const rows = await ctx.db.query("leaves").collect();
    const result = [];
    for (const row of rows) {
      const employee = await ctx.db.get(row.employeeId);
      if (!employee) continue;
      result.push({ ...row, employee: publicUser(employee) });
    }
    return result.sort((a, b) => b.createdAt - a.createdAt);
  },
});

export const companyHalfDaySchedules = query({
  args: { token: v.string() },
  handler: async (ctx, args) => {
    await requireAdmin(ctx, args.token);
    return await ctx.db.query("companyHalfDaySchedules").collect();
  },
});

/** Admin creates a leave request on behalf of an employee. */
export const requestForEmployee = mutation({
  args: {
    token: v.string(),
    employeeId: v.id("users"),
    type: v.union(
      v.literal("annuel"),
      v.literal("maladie"),
      v.literal("sans_solde")
    ),
    startDate: v.string(),
    endDate: v.string(),
    reason: v.string(),
    /** Required when type is maladie */
    isPaid: v.optional(v.boolean()),
    /** If true, skip queue and mark approved (still needs date closure). */
    autoApprove: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    await requireAdmin(ctx, args.token);
    const employee = await ctx.db.get(args.employeeId);
    if (!employee || employee.role !== "employee" || employee.resignedAt) {
      throw new Error("Employé introuvable");
    }
    if (!args.reason.trim()) throw new Error("Le motif est obligatoire");
    if (args.endDate <= args.startDate) {
      throw new Error(
        "La date de retour doit être après la date de début (elle n'est pas décomptée)"
      );
    }

    const days = daysBetween(args.startDate, args.endDate);
    if (days < 1) {
      throw new Error("La période de congé doit compter au moins 1 jour");
    }
    const balance = employee.annualLeaveBalance ?? 0;
    if (args.type === "annuel" && days > balance) {
      throw new Error(`Solde insuffisant (${balance} jour(s) restant(s))`);
    }

    if (args.type === "maladie" && args.isPaid === undefined) {
      throw new Error(
        "Pour un congé maladie, choisissez payé ou non payé avant validation"
      );
    }

    const autoApprove = args.autoApprove !== false;
    const now = Date.now();
    const isPaid =
      args.type === "sans_solde"
        ? false
        : args.type === "maladie"
          ? args.isPaid
          : true;

    const id = await ctx.db.insert("leaves", {
      employeeId: args.employeeId,
      type: args.type,
      startDate: args.startDate,
      endDate: args.endDate,
      days,
      reason: args.reason.trim(),
      status: autoApprove ? "APPROUVE" : "EN_ATTENTE",
      adminResponse: autoApprove ? "Créé et approuvé par l'admin" : undefined,
      isPaid,
      balanceDeducted: false,
      createdAt: now,
      treatedAt: autoApprove ? now : undefined,
    });

    const paidNote =
      args.type === "maladie"
        ? args.isPaid
          ? " (payé)"
          : " (non payé)"
        : "";

    await notify(
      ctx,
      args.employeeId,
      autoApprove ? "Congé enregistré" : "Demande de congé créée",
      autoApprove
        ? `Un congé ${args.type}${paidNote} du ${args.startDate} au ${args.endDate} (${days} j) a été créé par l'admin.`
        : `Une demande de congé ${args.type} du ${args.startDate} au ${args.endDate} a été créée pour vous.`
    );

    return await ctx.db.get(id);
  },
});

/** Creates and immediately charges a company-wide annual leave for active employees. */
export const createCompanyLeave = mutation({
  args: {
    token: v.string(),
    name: v.string(),
    startDate: v.string(),
    endDate: v.string(),
    halfDay: v.optional(v.boolean()),
    leavingTime: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    await requireAdmin(ctx, args.token);
    const name = args.name.trim();
    if (!name) throw new Error("Le nom du congé est obligatoire");
    if (!isValidISODate(args.startDate) || !isValidISODate(args.endDate)) {
      throw new Error("Saisissez des dates valides");
    }

    const days = daysBetween(args.startDate, args.endDate);
    if (days < 1) {
      throw new Error(
        "La date de retour doit être après la date de départ"
      );
    }
    if (args.halfDay && days !== 1) {
      throw new Error(
        "Un congé d'une demi-journée doit couvrir une seule journée"
      );
    }
    if (args.halfDay && !isValidClockTime(args.leavingTime ?? "")) {
      throw new Error("Saisissez une heure de départ valide pour le demi-jour");
    }
    const leaveDays = args.halfDay ? 0.5 : days;
    const chargedDays = args.halfDay ? 0 : days;

    const employees = (await ctx.db.query("users").collect()).filter(
      (user) =>
        user.role === "employee" && user.isActive && !user.resignedAt
    );
    if (!employees.length) {
      throw new Error("Aucun employé actif à qui appliquer ce congé");
    }

    if (args.halfDay) {
      const existingSchedules = await ctx.db
        .query("companyHalfDaySchedules")
        .withIndex("by_date", (q) => q.eq("date", args.startDate))
        .collect();
      if (
        existingSchedules.length ||
        (await ctx.db.query("leaves").collect()).some(
          (leave) =>
            leave.companyLeaveName &&
            dateRangesOverlap(
              leave.startDate,
              leave.endDate,
              args.startDate,
              args.endDate
            )
        )
      ) {
        throw new Error(
          "Un congé collectif existe déjà pour cette période"
        );
      }
      const now = Date.now();
      await ctx.db.insert("companyHalfDaySchedules", {
        name,
        date: args.startDate,
        leavingTime: args.leavingTime!,
        createdAt: now,
        updatedAt: now,
      });
      for (const employee of employees) {
        await recalculateLeaveAttendance(ctx, employee._id, [
          { startDate: args.startDate, endDate: args.endDate },
        ]);
      }
      return { employeeCount: employees.length, days: 0 };
    }

    const [existingLeaves, existingSchedules] = await Promise.all([
      ctx.db.query("leaves").collect(),
      ctx.db.query("companyHalfDaySchedules").collect(),
    ]);
    if (
      existingLeaves.some(
        (leave) =>
          leave.companyLeaveName &&
          dateRangesOverlap(
            leave.startDate,
            leave.endDate,
            args.startDate,
            args.endDate
          )
      ) ||
      existingSchedules.some(
        (schedule) =>
          schedule.date >= args.startDate && schedule.date < args.endDate
      )
    ) {
      throw new Error(
        "Un congé collectif existe déjà pour cette période"
      );
    }

    const now = Date.now();
    for (const employee of employees) {
      await ctx.db.patch(employee._id, {
        annualLeaveBalance: (employee.annualLeaveBalance ?? 0) - chargedDays,
      });
      await ctx.db.insert("leaves", {
        employeeId: employee._id,
        companyLeaveName: name,
        companyLeaveHalfDay: args.halfDay ?? false,
        companyLeaveLeavingTime: args.halfDay
          ? args.leavingTime
          : undefined,
        type: "annuel",
        startDate: args.startDate,
        endDate: args.endDate,
        actualStartDate: args.startDate,
        actualEndDate: args.endDate,
        days: leaveDays,
        deductedDays: chargedDays,
        balanceDeducted: chargedDays > 0,
        reason: `Congé collectif — ${name}`,
        status: "CLOTURE",
        isPaid: true,
        createdAt: now,
        treatedAt: now,
        closedAt: now,
      });
      await recalculateLeaveAttendance(ctx, employee._id, [
        { startDate: args.startDate, endDate: args.endDate },
      ]);
      await notify(
        ctx,
        employee._id,
        "Congé collectif enregistré",
        `Le congé collectif « ${name} » du ${args.startDate} au ${args.endDate}${args.halfDay ? ` (demi-journée, départ à ${args.leavingTime})` : ` (${chargedDays} jour(s) décompté(s))`} a été enregistré${chargedDays > 0 ? " et déduit de votre solde annuel" : " sans déduction du solde annuel"}.`
      );
    }

    return { employeeCount: employees.length, days: leaveDays };
  },
});

export const updateCompanyLeave = mutation({
  args: {
    token: v.string(),
    currentName: v.string(),
    currentStartDate: v.string(),
    currentEndDate: v.string(),
    name: v.string(),
    startDate: v.string(),
    endDate: v.string(),
    halfDay: v.optional(v.boolean()),
    leavingTime: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    await requireAdmin(ctx, args.token);
    const name = args.name.trim();
    if (!name) throw new Error("Le nom du congé est obligatoire");
    if (!isValidISODate(args.startDate) || !isValidISODate(args.endDate)) {
      throw new Error("Saisissez des dates valides");
    }
    const days = daysBetween(args.startDate, args.endDate);
    if (days < 1) {
      throw new Error("La date de retour doit être après la date de départ");
    }
    if (args.halfDay && days !== 1) {
      throw new Error(
        "Un congé d'une demi-journée doit couvrir une seule journée"
      );
    }
    if (args.halfDay && !isValidClockTime(args.leavingTime ?? "")) {
      throw new Error("Saisissez une heure de départ valide pour le demi-jour");
    }
    const leaveDays = args.halfDay ? 0.5 : days;
    const chargedDays = args.halfDay ? 0 : days;
    const allLeaves = await ctx.db.query("leaves").collect();
    const group = allLeaves.filter(
      (leave) =>
        leave.companyLeaveName === args.currentName &&
        leave.startDate === args.currentStartDate &&
        leave.endDate === args.currentEndDate
    );
    const schedules = await ctx.db.query("companyHalfDaySchedules").collect();
    const existingSchedule = schedules.find(
      (schedule) =>
        schedule.name === args.currentName &&
        schedule.date === args.currentStartDate &&
        args.currentEndDate === addDaysISO(schedule.date, 1)
    );
    if (!group.length && !existingSchedule) {
      throw new Error("Congé collectif introuvable");
    }
    if (
      allLeaves.some(
        (leave) =>
          leave.companyLeaveName &&
          dateRangesOverlap(
            leave.startDate,
            leave.endDate,
            args.startDate,
            args.endDate
          ) &&
          !group.some((member) => member._id === leave._id)
      ) ||
      schedules.some(
        (schedule) =>
          schedule.date >= args.startDate &&
          schedule.date < args.endDate &&
          !(
            existingSchedule &&
            schedule._id === existingSchedule._id
          )
      )
    ) {
      throw new Error(
        "Un autre congé collectif existe déjà pour cette période"
      );
    }

    const oldRange = {
      startDate: args.currentStartDate,
      endDate: args.currentEndDate,
    };
    const newRange = { startDate: args.startDate, endDate: args.endDate };
    if (existingSchedule) {
      if (args.halfDay) {
        await ctx.db.patch(existingSchedule._id, {
          name,
          date: args.startDate,
          leavingTime: args.leavingTime!,
          updatedAt: Date.now(),
        });
      } else {
        await ctx.db.delete(existingSchedule._id);
        const employees = (await ctx.db.query("users").collect()).filter(
          (user) =>
            user.role === "employee" && user.isActive && !user.resignedAt
        );
        const now = Date.now();
        for (const employee of employees) {
          await ctx.db.patch(employee._id, {
            annualLeaveBalance: (employee.annualLeaveBalance ?? 0) - days,
          });
          await ctx.db.insert("leaves", {
            employeeId: employee._id,
            companyLeaveName: name,
            companyLeaveHalfDay: false,
            type: "annuel",
            startDate: args.startDate,
            endDate: args.endDate,
            actualStartDate: args.startDate,
            actualEndDate: args.endDate,
            days,
            deductedDays: days,
            balanceDeducted: true,
            reason: `Congé collectif — ${name}`,
            status: "CLOTURE",
            isPaid: true,
            createdAt: now,
            treatedAt: now,
            closedAt: now,
          });
          await notify(
            ctx,
            employee._id,
            "Congé collectif modifié",
            `Le congé collectif « ${name} » du ${args.startDate} au ${args.endDate} a été modifié. ${days} jour(s) ont été déduits de votre solde annuel.`
          );
        }
      }
      const employees = (await ctx.db.query("users").collect()).filter(
        (user) =>
          user.role === "employee" && user.isActive && !user.resignedAt
      );
      for (const employee of employees) {
        await recalculateLeaveAttendance(ctx, employee._id, [oldRange, newRange]);
      }
      return {
        employeeCount: employees.length,
        days: args.halfDay ? 0 : days,
      };
    }

    if (args.halfDay) {
      const now = Date.now();
      await ctx.db.insert("companyHalfDaySchedules", {
        name,
        date: args.startDate,
        leavingTime: args.leavingTime!,
        createdAt: now,
        updatedAt: now,
      });
      for (const leave of group) {
        const employee = await ctx.db.get(leave.employeeId);
        if (!employee) continue;
        const previousDeduction = leave.deductedDays ?? leave.days;
        await ctx.db.patch(employee._id, {
          annualLeaveBalance:
            (employee.annualLeaveBalance ?? 0) + previousDeduction,
        });
        await ctx.db.delete(leave._id);
        await recalculateLeaveAttendance(ctx, employee._id, [
          oldRange,
          newRange,
        ]);
      }
      return { employeeCount: group.length, days: 0 };
    }

    for (const leave of group) {
      const employee = await ctx.db.get(leave.employeeId);
      if (!employee) continue;
      const previousDeduction = leave.deductedDays ?? leave.days;
      await ctx.db.patch(employee._id, {
        annualLeaveBalance:
          (employee.annualLeaveBalance ?? 0) + previousDeduction - chargedDays,
      });
      await ctx.db.patch(leave._id, {
        companyLeaveName: name,
        companyLeaveHalfDay: args.halfDay ?? false,
        companyLeaveLeavingTime: args.halfDay
          ? args.leavingTime
          : undefined,
        startDate: args.startDate,
        endDate: args.endDate,
        actualStartDate: args.startDate,
        actualEndDate: args.endDate,
        days: leaveDays,
        deductedDays: chargedDays,
        balanceDeducted: chargedDays > 0,
        reason: `Congé collectif — ${name}`,
      });
      await recalculateLeaveAttendance(ctx, employee._id, [oldRange, newRange]);
      await notify(
        ctx,
        employee._id,
        "Congé collectif modifié",
        `Le congé collectif « ${name} » du ${args.startDate} au ${args.endDate}${args.halfDay ? ` (demi-journée, départ à ${args.leavingTime})` : ` (${chargedDays} jour(s) décompté(s))`}. Votre solde annuel a été mis à jour${chargedDays === 0 ? " sans déduction pour cette demi-journée" : ""}.`
      );
    }

    return { employeeCount: group.length, days: leaveDays };
  },
});

export const decide = mutation({
  args: {
    token: v.string(),
    leaveId: v.id("leaves"),
    status: v.union(v.literal("APPROUVE"), v.literal("REFUSE")),
    adminResponse: v.optional(v.string()),
    /** Required when approving maladie */
    isPaid: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    await requireAdmin(ctx, args.token);
    const leave = await ctx.db.get(args.leaveId);
    if (!leave) throw new Error("Demande introuvable");
    if (leave.status !== "EN_ATTENTE") {
      throw new Error("Cette demande a déjà été traitée");
    }

    if (args.status === "APPROUVE" && leave.type === "maladie") {
      if (args.isPaid === undefined) {
        throw new Error(
          "Choisissez si le congé maladie est payé ou non payé"
        );
      }
    }

    if (args.status === "APPROUVE" && leave.type === "annuel") {
      const employee = await ctx.db.get(leave.employeeId);
      if (!employee) throw new Error("Employé introuvable");
      const balance = employee.annualLeaveBalance ?? 0;
      if (leave.days > balance) {
        throw new Error("Solde de congés insuffisant pour approuver");
      }
    }

    const isPaid =
      args.status === "APPROUVE"
        ? leave.type === "sans_solde"
          ? false
          : leave.type === "maladie"
            ? args.isPaid
            : true
        : leave.isPaid;

    await ctx.db.patch(args.leaveId, {
      status: args.status,
      adminResponse: args.adminResponse?.trim() || undefined,
      treatedAt: Date.now(),
      balanceDeducted: false,
      ...(args.status === "APPROUVE" ? { isPaid } : {}),
    });

    const paidLabel =
      leave.type === "maladie" && args.status === "APPROUVE"
        ? args.isPaid
          ? " (payé — solde annuel non touché)"
          : " (non payé — solde annuel puis salaire)"
        : leave.type === "sans_solde" && args.status === "APPROUVE"
          ? " (sans solde — déduit du salaire à la clôture)"
          : "";

    await notify(
      ctx,
      leave.employeeId,
      args.status === "APPROUVE" ? "Congé approuvé" : "Congé refusé",
      args.status === "APPROUVE"
        ? `Votre demande du ${leave.startDate} au ${leave.endDate} a été approuvée${paidLabel}. Le décompte se fait après saisie des dates réelles.`
        : `Votre demande du ${leave.startDate} au ${leave.endDate} a été refusée.${
            args.adminResponse ? ` Motif : ${args.adminResponse}` : ""
          }`
    );

    return await ctx.db.get(args.leaveId);
  },
});

/** Admin records actual leaving/returning dates and applies balance / salary charges. */
export const recordActualDates = mutation({
  args: {
    token: v.string(),
    leaveId: v.id("leaves"),
    actualStartDate: v.string(),
    actualEndDate: v.string(),
    delayStatus: v.optional(
      v.union(v.literal("ACCEPTABLE"), v.literal("NON_ACCEPTABLE"))
    ),
  },
  handler: async (ctx, args) => {
    await requireAdmin(ctx, args.token);
    const leave = await ctx.db.get(args.leaveId);
    if (!leave) throw new Error("Demande introuvable");
    if (leave.status !== "APPROUVE" && leave.status !== "CLOTURE") {
      throw new Error("Seuls les congés approuvés peuvent être clôturés");
    }
    if (args.actualEndDate <= args.actualStartDate) {
      throw new Error(
        "La date de retour doit être après la date de départ (elle n'est pas décomptée)"
      );
    }

    const actualDays = daysBetween(args.actualStartDate, args.actualEndDate);
    if (actualDays < 1) {
      throw new Error(
        "Les dates réelles doivent compter au moins 1 jour de congé"
      );
    }

    const requestedDays = leave.days;

    if (actualDays > requestedDays && !args.delayStatus) {
      throw new Error(
        "L'employé a pris plus de jours que demandé : choisissez si le retard est acceptable ou non"
      );
    }

    const chargedDays = computeDeductedDays(
      requestedDays,
      actualDays,
      args.delayStatus
    );

    const employee = await ctx.db.get(leave.employeeId);
    if (!employee) throw new Error("Employé introuvable");

    // Undo previous annual charge if re-closing a legacy/already-charged leave
    let previouslyChargedBalance = 0;
    if (leave.balanceDeducted === true) {
      previouslyChargedBalance = leave.deductedDays ?? leave.days;
    } else if (
      leave.balanceDeducted === undefined &&
      leave.status === "APPROUVE" &&
      leave.treatedAt &&
      !leave.actualStartDate &&
      leave.type === "annuel"
    ) {
      previouslyChargedBalance = leave.days;
    }

    const balanceBefore =
      (employee.annualLeaveBalance ?? 0) + previouslyChargedBalance;

    const { fromBalance, fromSalary } = splitLeaveCharges({
      type: leave.type,
      isPaid: leave.isPaid,
      days: chargedDays,
      annualBalance: balanceBefore,
    });

    if (fromBalance > balanceBefore) {
      throw new Error(
        `Solde insuffisant pour décompter ${fromBalance} jour(s) (solde ${balanceBefore})`
      );
    }

    const settings = await getSettings(ctx);
    const workingDays = Math.max(1, settings.workingDaysPerMonth);
    const dailyRate = (employee.baseSalary ?? 0) / workingDays;
    const salaryDeductionAmount = Math.round(dailyRate * fromSalary);

    await ctx.db.patch(leave.employeeId, {
      annualLeaveBalance: balanceBefore - fromBalance,
    });

    // If re-closing, clear previous salary amount before re-sync
    await ctx.db.patch(args.leaveId, {
      actualStartDate: args.actualStartDate,
      actualEndDate: args.actualEndDate,
      delayStatus:
        actualDays > requestedDays ? args.delayStatus : undefined,
      deductedDays: fromBalance,
      balanceDeducted: fromBalance > 0,
      salaryDeductedDays: fromSalary,
      salaryDeductionAmount,
      status: "CLOTURE",
      closedAt: Date.now(),
    });

    await syncMonthLeaveDeductions(
      ctx,
      leave.employeeId,
      args.actualStartDate
    );

    const parts: string[] = [];
    if (leave.type === "maladie" && leave.isPaid === true) {
      parts.push("Maladie payée — aucun décompte");
    } else {
      if (fromBalance > 0) {
        parts.push(`${fromBalance} j sur le solde annuel`);
      }
      if (fromSalary > 0) {
        parts.push(
          `${fromSalary} j déduits du salaire (${salaryDeductionAmount.toLocaleString("fr-DZ")} DZD)`
        );
      }
      if (fromBalance === 0 && fromSalary === 0) {
        parts.push("Aucun décompte");
      }
    }

    await notify(
      ctx,
      leave.employeeId,
      "Congé clôturé",
      `Départ ${args.actualStartDate} → retour ${args.actualEndDate}. ${parts.join(" · ")}.`
    );

    return await ctx.db.get(args.leaveId);
  },
});
