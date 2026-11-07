import { QueryCtx, MutationCtx } from "./_generated/server";
import { Doc, Id } from "./_generated/dataModel";

export const EMPLOYEE_PAGE_KEYS = [
  "tableau-de-bord",
  "pointage-presence",
  "conges",
  "finances",
  "rapports-mensuels",
  "mon-compte",
] as const;

export type EmployeePageKey = (typeof EMPLOYEE_PAGE_KEYS)[number];

/** @deprecated alias kept for older code paths */
export const PAGE_KEYS = EMPLOYEE_PAGE_KEYS;

export async function hashPassword(password: string): Promise<string> {
  const encoder = new TextEncoder();
  const data = encoder.encode(`gialco-salt:${password}`);
  const hashBuffer = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(hashBuffer))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

export function createToken(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

export async function getUserBySession(
  ctx: QueryCtx | MutationCtx,
  token: string | undefined | null
) {
  if (!token) return null;

  const session = await ctx.db
    .query("sessions")
    .withIndex("by_token", (q) => q.eq("token", token))
    .unique();

  if (!session || session.expiresAt < Date.now()) {
    return null;
  }

  const user = await ctx.db.get(session.userId);
  if (!user || !user.isActive) return null;

  return { user, session };
}

export async function requireUser(
  ctx: QueryCtx | MutationCtx,
  token: string
) {
  const result = await getUserBySession(ctx, token);
  if (!result) throw new Error("Session expirée. Veuillez vous reconnecter.");
  return result.user;
}

export async function requireAdmin(
  ctx: QueryCtx | MutationCtx,
  token: string
) {
  const user = await requireUser(ctx, token);
  if (user.role !== "admin") throw new Error("Accès administrateur requis");
  return user;
}

export function normalizeUsername(username: string) {
  return username.trim().toLowerCase().replace(/\s+/g, "");
}

/** Finance desk staff (department name contains "finance"). */
export function isFinanceDepartment(department?: string | null) {
  const d = (department ?? "").trim().toLowerCase();
  return d.includes("finance");
}

export function publicUser(user: Doc<"users">) {
  return {
    _id: user._id,
    name: user.name,
    firstName: user.firstName ?? "",
    lastName: user.lastName ?? "",
    username: user.username ?? "",
    email: user.email,
    role: user.role,
    allowedPages: user.allowedPages,
    isActive: user.isActive,
    phone: user.phone ?? "",
    department: user.department ?? "",
    departmentId: user.departmentId ?? null,
    workplace: user.workplace ?? "",
    workplaceId: user.workplaceId ?? null,
    managerId: user.managerId ?? null,
    bonusType: user.bonusType ?? "FIXED",
    baseBonus: user.baseBonus ?? 0,
    bonusPercent: user.bonusPercent ?? 0,
    hireDate: user.hireDate ?? null,
    resignedAt: user.resignedAt ?? null,
    annualLeaveBalance: user.annualLeaveBalance ?? 0,
    annualLeaveQuota: user.annualLeaveQuota ?? 30,
    baseSalary: user.baseSalary ?? 0,
    barcode: user.barcode ?? "",
    zktecoUserId: user.zktecoUserId ?? "",
  };
}

/** Average score / 5 → percentage (0–100). */
export function evaluationPercentage(
  scores: { points: number }[]
): number {
  if (!scores.length) return 0;
  const sum = scores.reduce((s, row) => s + row.points, 0);
  const max = scores.length * 5;
  return Math.round((sum / max) * 1000) / 10;
}

export function computeEvaluationBonus(baseBonus: number, percentage: number) {
  if (baseBonus <= 0 || percentage <= 0) return 0;
  return Math.round((baseBonus * percentage) / 100);
}

/**
 * Percentage-prime calculation:
 * primeBase = réalisation × employee%
 * objectif part = primeBase × weightObj% × (réalisation / objectif)  — >100% if exceeds
 * recouvrement part = primeBase × weightRec% × (recouvrement / objectif)
 * évaluation part = primeBase × weightEval% × (eval% / 100)
 */
export function computePercentagePrime(args: {
  realisation: number;
  objective: number;
  recouvrement: number;
  employeeBonusPercent: number;
  evaluationPercent: number;
  objectiveWeightPercent: number;
  recoveryWeightPercent: number;
  evaluationWeightPercent: number;
}) {
  const realisation = Math.max(0, args.realisation);
  const objective = Math.max(0, args.objective);
  const recouvrement = Math.max(0, args.recouvrement);
  const employeeBonusPercent = Math.max(0, args.employeeBonusPercent);
  const evaluationPercent = Math.max(0, Math.min(100, args.evaluationPercent));
  const objectiveWeightPercent = Math.max(0, args.objectiveWeightPercent);
  const recoveryWeightPercent = Math.max(0, args.recoveryWeightPercent);
  const evaluationWeightPercent = Math.max(0, args.evaluationWeightPercent);

  const primeBase = Math.round((realisation * employeeBonusPercent) / 100);
  const objectiveRatio = objective > 0 ? realisation / objective : 0;
  const recoveryRatio = objective > 0 ? recouvrement / objective : 0;

  const objectiveAmount = Math.round(
    primeBase * (objectiveWeightPercent / 100) * objectiveRatio
  );
  const recoveryAmount = Math.round(
    primeBase * (recoveryWeightPercent / 100) * recoveryRatio
  );
  const evaluationAmount = Math.round(
    primeBase * (evaluationWeightPercent / 100) * (evaluationPercent / 100)
  );
  const totalAmount = objectiveAmount + recoveryAmount + evaluationAmount;

  return {
    primeBase,
    objectiveRatio: Math.round(objectiveRatio * 1000) / 1000,
    recoveryRatio: Math.round(recoveryRatio * 1000) / 1000,
    objectiveAmount,
    recoveryAmount,
    evaluationAmount,
    evaluationPercent,
    totalAmount,
    objectiveWeightPercent,
    recoveryWeightPercent,
    evaluationWeightPercent,
    employeeBonusPercent,
  };
}

export async function requireManagerOf(
  ctx: QueryCtx | MutationCtx,
  token: string,
  employeeId: Id<"users">
) {
  const actor = await requireUser(ctx, token);
  if (actor.role === "admin") return actor;

  const employee = await ctx.db.get(employeeId);
  if (!employee) throw new Error("Employé introuvable");
  if (employee.managerId !== actor._id) {
    throw new Error("Vous n'êtes pas le manager de cet employé");
  }
  return actor;
}

/** Generates a unique Code128-friendly employee barcode (digits only). */
export async function generateUniqueBarcode(
  ctx: QueryCtx | MutationCtx
): Promise<string> {
  for (let attempt = 0; attempt < 20; attempt++) {
    const bytes = new Uint8Array(4);
    crypto.getRandomValues(bytes);
    const num =
      ((bytes[0]! << 24) | (bytes[1]! << 16) | (bytes[2]! << 8) | bytes[3]!) >>>
      0;
    const code = `G${String(num % 100000000).padStart(8, "0")}`;
    const existing = await ctx.db
      .query("users")
      .withIndex("by_barcode", (q) => q.eq("barcode", code))
      .unique();
    if (!existing) return code;
  }
  throw new Error("Impossible de générer un code-barres unique");
}

/** Algeria business timezone (UTC+1, no DST). */
export const APP_TIMEZONE = "Africa/Algiers";

/** Calendar date YYYY-MM-DD in Algeria — not UTC. */
export function todayISO(date = new Date()) {
  return date.toLocaleDateString("en-CA", { timeZone: APP_TIMEZONE });
}

/** Add calendar days to a YYYY-MM-DD date (timezone-safe via noon UTC). */
export function addDaysISO(isoDate: string, days: number) {
  const d = new Date(`${isoDate}T12:00:00.000Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

export function formatTimeAlgiers(
  ts: number,
  options?: { seconds?: boolean }
) {
  return new Date(ts).toLocaleTimeString("fr-DZ", {
    timeZone: APP_TIMEZONE,
    hour: "2-digit",
    minute: "2-digit",
    ...(options?.seconds ? { second: "2-digit" as const } : {}),
  });
}

export function monthBounds(year: number, month: number) {
  const start = `${year}-${String(month).padStart(2, "0")}-01`;
  const lastDay = new Date(year, month, 0).getDate();
  const end = `${year}-${String(month).padStart(2, "0")}-${String(lastDay).padStart(2, "0")}`;
  return { start, end };
}

/** Calendar days in month (1–12). */
export function daysInCalendarMonth(year: number, month: number) {
  return new Date(year, month, 0).getDate();
}

/**
 * Prorate full monthly salary by hire date in Africa/Algiers.
 * Hire day is included (start on 15th in a 30-day month → 16 days).
 */
export function prorateMonthlySalary(
  fullSalary: number,
  hireDateMs: number | null | undefined,
  year: number,
  month: number
) {
  const daysInMonth = daysInCalendarMonth(year, month);
  const full = Math.max(0, fullSalary);

  if (!hireDateMs) {
    return {
      amount: full,
      daysWorked: daysInMonth,
      daysInMonth,
      isProrated: false,
      hireDay: null as number | null,
      hiredThisMonth: false,
      notYetHired: false,
    };
  }

  const hireISO = new Date(hireDateMs).toLocaleDateString("en-CA", {
    timeZone: APP_TIMEZONE,
  });
  const [hyStr, hmStr, hdStr] = hireISO.split("-");
  const hy = Number(hyStr);
  const hm = Number(hmStr);
  const hd = Number(hdStr);

  if (hy > year || (hy === year && hm > month)) {
    return {
      amount: 0,
      daysWorked: 0,
      daysInMonth,
      isProrated: true,
      hireDay: hd,
      hiredThisMonth: false,
      notYetHired: true,
    };
  }

  if (hy < year || (hy === year && hm < month)) {
    return {
      amount: full,
      daysWorked: daysInMonth,
      daysInMonth,
      isProrated: false,
      hireDay: hd,
      hiredThisMonth: false,
      notYetHired: false,
    };
  }

  const daysWorked = Math.max(0, daysInMonth - hd + 1);
  const amount = Math.round((full * daysWorked) / daysInMonth);
  return {
    amount,
    daysWorked,
    daysInMonth,
    isProrated: daysWorked < daysInMonth,
    hireDay: hd,
    hiredThisMonth: true,
    notYetHired: false,
  };
}

/** Leave days: endDate is the return-to-work day and is NOT counted. */
export function daysBetween(startDate: string, endDate: string) {
  const start = new Date(startDate + "T00:00:00");
  const end = new Date(endDate + "T00:00:00");
  const diff = Math.round((end.getTime() - start.getTime()) / 86400000);
  return Math.max(diff, 0);
}

export async function getSettings(ctx: QueryCtx | MutationCtx) {
  const existing = await ctx.db
    .query("settings")
    .withIndex("by_key", (q) => q.eq("key", "default"))
    .unique();

  if (existing) {
    const required = existing.requiredWorkMinutes ?? 480;
    return {
      ...existing,
      workEndHour: existing.workEndHour ?? 17,
      workEndMinute: existing.workEndMinute ?? 0,
      requiredWorkMinutes: required,
      thursdayRequiredWorkMinutes:
        existing.thursdayRequiredWorkMinutes ?? Math.round(required / 2),
      thursdayWorkEndHour: existing.thursdayWorkEndHour ?? 12,
      thursdayWorkEndMinute: existing.thursdayWorkEndMinute ?? 30,
      workingDaysPerMonth: existing.workingDaysPerMonth ?? 26,
      primeObjectiveWeightPercent: existing.primeObjectiveWeightPercent ?? 80,
      primeRecoveryWeightPercent: existing.primeRecoveryWeightPercent ?? 10,
      primeEvaluationWeightPercent: existing.primeEvaluationWeightPercent ?? 10,
    };
  }

  return {
    _id: null as unknown as Id<"settings">,
    key: "default",
    workStartHour: 8,
    workStartMinute: 30,
    workEndHour: 17,
    workEndMinute: 0,
    lateToleranceMinutes: 10,
    requiredWorkMinutes: 480,
    thursdayRequiredWorkMinutes: 240,
    thursdayWorkEndHour: 12,
    thursdayWorkEndMinute: 30,
    workingDaysPerMonth: 26,
    primeObjectiveWeightPercent: 80,
    primeRecoveryWeightPercent: 10,
    primeEvaluationWeightPercent: 10,
  };
}

export async function getEmployeeSettings(
  ctx: QueryCtx | MutationCtx,
  employee: Doc<"users">
) {
  const settings = await getSettings(ctx);
  if (!employee.workplaceId) return settings;

  const workplace = await ctx.db.get(employee.workplaceId);
  if (!workplace) return settings;

  return {
    ...settings,
    workStartHour: workplace.workStartHour ?? settings.workStartHour,
    workStartMinute: workplace.workStartMinute ?? settings.workStartMinute,
    workEndHour: workplace.workEndHour ?? settings.workEndHour,
    workEndMinute: workplace.workEndMinute ?? settings.workEndMinute,
    lateToleranceMinutes:
      workplace.lateToleranceMinutes ?? settings.lateToleranceMinutes,
    requiredWorkMinutes:
      workplace.requiredWorkMinutes ?? settings.requiredWorkMinutes,
    thursdayRequiredWorkMinutes:
      workplace.thursdayRequiredWorkMinutes ??
      settings.thursdayRequiredWorkMinutes,
    thursdayWorkEndHour:
      workplace.thursdayWorkEndHour ?? settings.thursdayWorkEndHour,
    thursdayWorkEndMinute:
      workplace.thursdayWorkEndMinute ?? settings.thursdayWorkEndMinute,
  };
}

/** ISO date YYYY-MM-DD → weekday in Africa/Algiers (0=Sun … 4=Thu … 6=Sat). */
export function weekdayAlgiers(isoDate: string) {
  const noonUtc = new Date(`${isoDate}T12:00:00+01:00`);
  return noonUtc.getUTCDay();
}

export function isThursdayAlgiers(isoDate: string) {
  return weekdayAlgiers(isoDate) === 4;
}

/** Required work minutes for a calendar day (Thursday = half-day setting). */
export function requiredMinutesForDate(
  settings: {
    requiredWorkMinutes: number;
    thursdayRequiredWorkMinutes: number;
  },
  isoDate: string
) {
  if (isThursdayAlgiers(isoDate)) {
    return settings.thursdayRequiredWorkMinutes;
  }
  return settings.requiredWorkMinutes;
}

/** Leaving time (end of counted work) for a calendar day in Algiers. */
export function workEndForDate(
  settings: {
    workEndHour: number;
    workEndMinute: number;
    thursdayWorkEndHour: number;
    thursdayWorkEndMinute: number;
  },
  isoDate: string
) {
  if (isThursdayAlgiers(isoDate)) {
    return {
      hour: settings.thursdayWorkEndHour,
      minute: settings.thursdayWorkEndMinute,
    };
  }
  return { hour: settings.workEndHour, minute: settings.workEndMinute };
}

export function workEndMsForDate(
  settings: {
    workEndHour: number;
    workEndMinute: number;
    thursdayWorkEndHour: number;
    thursdayWorkEndMinute: number;
  },
  isoDate: string
) {
  const end = workEndForDate(settings, isoDate);
  return algiersLocalToUtcMs(isoDate, end.hour, end.minute);
}

/** Wall-clock in Africa/Algiers → UTC ms (Algeria is fixed UTC+1). */
export function algiersLocalToUtcMs(
  isoDate: string,
  hour: number,
  minute: number
) {
  const [y, m, d] = isoDate.split("-").map(Number);
  return Date.UTC(y!, m! - 1, d!, hour - 1, minute, 0, 0);
}

export function computeLateMinutes(
  clockInAt: number,
  workStartHour: number,
  workStartMinute: number,
  lateToleranceMinutes: number
) {
  const day = todayISO(new Date(clockInAt));
  const thresholdMs = algiersLocalToUtcMs(
    day,
    workStartHour,
    workStartMinute + lateToleranceMinutes
  );
  const diffMs = clockInAt - thresholdMs;
  if (diffMs <= 0) return 0;
  return Math.ceil(diffMs / 60000);
}

/** Pair scans as work intervals, optionally capping each interval at shift end. */
export function computeWorkedMinutes(
  scans: number[],
  now = Date.now(),
  workEndAt = Number.POSITIVE_INFINITY
) {
  const sorted = [...scans].sort((a, b) => a - b);
  let total = 0;
  for (let i = 0; i < sorted.length; i += 2) {
    const start = sorted[i]!;
    const end = Math.min(sorted[i + 1] ?? now, workEndAt);
    if (end > start) total += end - start;
  }
  return Math.floor(total / 60000);
}

export function computeDelayMinutes(
  workedMinutes: number,
  requiredMinutes: number,
  toleranceMinutes: number
) {
  return Math.max(0, requiredMinutes - workedMinutes - toleranceMinutes);
}

/** Minute rate from monthly salary (same base as late deductions). */
export function salaryMinuteRate(
  monthlySalary: number,
  requiredMinutesPerDay: number,
  workingDaysPerMonth: number
) {
  if (monthlySalary <= 0 || requiredMinutesPerDay <= 0) return 0;
  const days = Math.max(1, workingDaysPerMonth);
  return monthlySalary / (days * requiredMinutesPerDay);
}

/** Convert delay minutes to DZD from monthly salary. */
export function computeDelayAmount(
  monthlySalary: number,
  delayMinutes: number,
  requiredMinutesPerDay: number,
  workingDaysPerMonth: number
) {
  if (delayMinutes <= 0) return 0;
  const rate = salaryMinuteRate(
    monthlySalary,
    requiredMinutesPerDay,
    workingDaysPerMonth
  );
  return Math.round(rate * delayMinutes);
}

export async function notify(
  ctx: MutationCtx,
  userId: Id<"users">,
  title: string,
  message: string
) {
  await ctx.db.insert("notifications", {
    userId,
    title,
    message,
    read: false,
    createdAt: Date.now(),
  });
}
