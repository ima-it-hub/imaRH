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

export const ADMIN_PAGE_KEYS = [
  "admin-dashboard",
  "admin-employes",
  "admin-departements",
  "admin-scan",
  "admin-pointages",
  "admin-conges",
  "admin-salaires",
  "admin-primes",
  "admin-calcul-primes",
  "admin-ordres",
  "admin-rapports",
  "admin-parametres",
] as const;

export type AdminPageKey = (typeof ADMIN_PAGE_KEYS)[number];
export const ASSIGNABLE_PAGE_KEYS = [
  ...EMPLOYEE_PAGE_KEYS,
  ...ADMIN_PAGE_KEYS,
] as const;

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

export async function requireAdminPage(
  ctx: QueryCtx | MutationCtx,
  token: string,
  pageKey: AdminPageKey
) {
  return await requireAdminAnyPage(ctx, token, [pageKey]);
}

export async function requireAdminAnyPage(
  ctx: QueryCtx | MutationCtx,
  token: string,
  pageKeys: readonly AdminPageKey[]
) {
  const user = await requireUser(ctx, token);
  if (
    user.role !== "admin" &&
    !pageKeys.some((pageKey) => user.allowedPages.includes(pageKey))
  ) {
    throw new Error("Accès à cette page administrateur requis");
  }
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
    associatedAgentCode: user.associatedAgentCode ?? "",
    managerId: user.managerId ?? null,
    baseBonus: user.baseBonus ?? 0,
    hireDate: user.hireDate ?? null,
    resignedAt: user.resignedAt ?? null,
    annualLeaveBalance: user.annualLeaveBalance ?? 0,
    annualLeaveBalanceYear: user.annualLeaveBalanceYear ?? null,
    annualLeaveQuota: user.annualLeaveQuota ?? 30,
    baseSalary: user.baseSalary ?? 0,
    barcode: user.barcode ?? "",
    zktecoUserId: user.zktecoUserId ?? "",
  };
}

/** Weighted score / 5 → percentage (0–100). */
export function evaluationPercentage(
  scores: { points: number; weightPercent?: number }[]
): number {
  if (!scores.length) return 0;
  const weights = scores.map((row) => row.weightPercent ?? 1);
  const totalWeight = weights.reduce((sum, weight) => sum + weight, 0);
  if (totalWeight <= 0) {
    const sum = scores.reduce((total, row) => total + row.points, 0);
    return Math.round((sum / (scores.length * 5)) * 1000) / 10;
  }
  const weightedScore = scores.reduce(
    (sum, row, index) => sum + row.points * weights[index]!,
    0
  );
  return Math.round((weightedScore / (totalWeight * 5)) * 1000) / 10;
}

export function departmentPrimeWeights(
  department?: Doc<"departments"> | null
) {
  return {
    evaluationWeightPercent: department?.evaluationWeightPercent ?? 20,
    realisationWeightPercent: department?.realisationWeightPercent ?? 80,
    companyRealisationWeightPercent:
      department?.companyRealisationWeightPercent ?? 0,
  };
}

export function computeBasePrime(args: {
  basePrime: number;
  realisation: number;
  objective: number;
  companyRealisationRatio?: number;
  recouvrement: number;
  recoveryObjective: number;
  evaluationPercent: number;
  applyRecoveryAdjustment: boolean;
  evaluationWeightPercent?: number;
  realisationWeightPercent?: number;
  companyRealisationWeightPercent?: number;
}) {
  const realisation = Math.max(0, args.realisation);
  const objective = Math.max(0, args.objective);
  const recouvrement = Math.max(0, args.recouvrement);
  const recoveryObjective = Math.max(0, args.recoveryObjective);
  const evaluationPercent = Math.max(0, Math.min(100, args.evaluationPercent));

  const objectiveRatio = objective > 0 ? realisation / objective : 0;
  const companyRealisationRatio = Math.max(
    0,
    args.companyRealisationRatio ?? 0
  );
  const recoveryRatio =
    recoveryObjective > 0 ? recouvrement / recoveryObjective : 0;
  const primeBase = Math.max(0, args.basePrime);
  const objectiveWeightPercent = args.realisationWeightPercent ?? 80;
  const evaluationWeightPercent = args.evaluationWeightPercent ?? 20;
  const companyRealisationWeightPercent =
    args.companyRealisationWeightPercent ?? 0;
  const objectiveAmount = Math.round(
    primeBase * (objectiveWeightPercent / 100) * objectiveRatio
  );
  const companyRealisationAmount = Math.round(
    primeBase *
      (companyRealisationWeightPercent / 100) *
      companyRealisationRatio
  );
  const evaluationAmount = Math.round(
    primeBase * (evaluationWeightPercent / 100) * (evaluationPercent / 100)
  );
  let recoveryAmount = 0;

  // Apply the recovery shortfall/overachievement against the defined tiers.
  if (args.applyRecoveryAdjustment && recoveryObjective > 0) {
    if (recoveryRatio < 0.5) {
      recoveryAmount = -primeBase * (1 - recoveryRatio) * 0.5;
    } else if (recoveryRatio < 1) {
      recoveryAmount = -primeBase * (1 - recoveryRatio) * 0.25;
    } else if (recoveryRatio < 1.5) {
      recoveryAmount = primeBase * (recoveryRatio - 1) * 0.25;
    } else {
      const cappedRatio = Math.min(recoveryRatio, 2);
      recoveryAmount =
        primeBase * (0.5 * 0.25 + (cappedRatio - 1.5) * 0.5);
    }
    recoveryAmount = Math.round(recoveryAmount);
  }

  const totalAmount = Math.max(
    0,
    objectiveAmount + companyRealisationAmount + evaluationAmount + recoveryAmount
  );

  return {
    primeBase,
    objectiveRatio: Math.round(objectiveRatio * 1000) / 1000,
    companyRealisationRatio:
      Math.round(companyRealisationRatio * 1000) / 1000,
    companyRealisationAmount,
    recoveryRatio: Math.round(recoveryRatio * 1000) / 1000,
    objectiveAmount,
    recoveryAmount,
    evaluationAmount,
    evaluationPercent,
    totalAmount,
    objectiveWeightPercent,
    recoveryWeightPercent: 0,
    evaluationWeightPercent,
    companyRealisationWeightPercent,
    employeeBonusPercent: 0,
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

export function annualLeaveEntitlement(
  quota: number,
  hireDate: number | null | undefined,
  year: number,
  employmentEndDate?: string
) {
  const yearStart = `${year}-01-01`;
  const yearEnd = `${year}-12-31`;
  const hiredOn = hireDate
    ? todayISO(new Date(hireDate))
    : yearStart;
  const start = hiredOn > yearStart ? hiredOn : yearStart;
  const end =
    employmentEndDate && employmentEndDate < yearEnd
      ? employmentEndDate
      : yearEnd;
  if (start > end) return 0;
  const employedDays =
    (Date.parse(`${end}T00:00:00Z`) -
      Date.parse(`${start}T00:00:00Z`)) /
      86_400_000 +
    1;
  const daysInYear =
    (Date.parse(`${yearEnd}T00:00:00Z`) -
      Date.parse(`${yearStart}T00:00:00Z`)) /
      86_400_000 +
    1;
  return Math.round((Math.max(0, quota) * employedDays) / daysInYear);
}

export async function annualLeaveBalanceForYear(
  ctx: QueryCtx | MutationCtx,
  employee: Doc<"users">,
  year: number
) {
  const storedBalance = employee.annualLeaveBalance ?? employee.annualLeaveQuota ?? 30;
  if (employee.annualLeaveBalanceYear === year) return storedBalance;

  const entitlement = annualLeaveEntitlement(
    employee.annualLeaveQuota ?? 30,
    employee.hireDate,
    year,
    employee.resignedAt
      ? todayISO(new Date(employee.resignedAt))
      : undefined
  );
  const leaves = await ctx.db
    .query("leaves")
    .withIndex("by_employee", (q) => q.eq("employeeId", employee._id))
    .collect();
  const usedDays = leaves.reduce((sum, leave) => {
    const leaveStart = leave.actualStartDate ?? leave.startDate;
    if (
      !leave.balanceDeducted ||
      leaveStart.slice(0, 4) !== String(year)
    ) {
      return sum;
    }
    return sum + (leave.deductedDays ?? leave.days);
  }, 0);
  return Math.max(0, entitlement - usedDays);
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
  month: number,
  resignedAtMs?: number | null
) {
  const daysInMonth = daysInCalendarMonth(year, month);
  const full = Math.max(0, fullSalary);
  const monthStart = `${year}-${String(month).padStart(2, "0")}-01`;
  const monthEnd = `${year}-${String(month).padStart(2, "0")}-${String(daysInMonth).padStart(2, "0")}`;
  const hireISO = hireDateMs
    ? new Date(hireDateMs).toLocaleDateString("en-CA", {
        timeZone: APP_TIMEZONE,
      })
    : monthStart;
  const resignationISO = resignedAtMs
    ? new Date(resignedAtMs).toLocaleDateString("en-CA", {
        timeZone: APP_TIMEZONE,
      })
    : monthEnd;
  const employedStart = hireISO > monthStart ? hireISO : monthStart;
  const employedEnd = resignationISO < monthEnd ? resignationISO : monthEnd;
  const outsideEmploymentPeriod = employedStart > employedEnd;
  const startDay = Number(employedStart.slice(8, 10));
  const endDay = Number(employedEnd.slice(8, 10));
  const daysWorked = outsideEmploymentPeriod
    ? 0
    : Math.max(0, endDay - startDay + 1);
  const hiredThisMonth =
    hireISO.slice(0, 7) === `${year}-${String(month).padStart(2, "0")}`;
  const notYetHired = hireISO > monthEnd || outsideEmploymentPeriod;
  const amount = Math.round((full * daysWorked) / daysInMonth);
  return {
    amount: notYetHired ? 0 : amount,
    daysWorked: notYetHired ? 0 : daysWorked,
    daysInMonth,
    isProrated: daysWorked < daysInMonth,
    hireDay: hireISO.slice(0, 7) === `${year}-${String(month).padStart(2, "0")}`
      ? Number(hireISO.slice(8, 10))
      : null as number | null,
    hiredThisMonth,
    notYetHired,
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
      breakMinutes: 0,
      workEndHour: existing.workEndHour ?? 17,
      workEndMinute: existing.workEndMinute ?? 0,
      requiredWorkMinutes: required,
      thursdayRequiredWorkMinutes:
        existing.thursdayRequiredWorkMinutes ?? Math.round(required / 2),
      thursdayWorkEndHour: existing.thursdayWorkEndHour ?? 12,
      thursdayWorkEndMinute: existing.thursdayWorkEndMinute ?? 30,
      workingDaysPerMonth: existing.workingDaysPerMonth ?? 26,
      primeObjectiveWeightPercent: existing.primeObjectiveWeightPercent ?? 80,
      primeRecoveryWeightPercent: existing.primeRecoveryWeightPercent ?? 0,
      primeEvaluationWeightPercent: existing.primeEvaluationWeightPercent ?? 20,
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
    breakMinutes: 0,
    requiredWorkMinutes: 480,
    thursdayRequiredWorkMinutes: 240,
    thursdayWorkEndHour: 12,
    thursdayWorkEndMinute: 30,
    workingDaysPerMonth: 26,
    primeObjectiveWeightPercent: 80,
    primeRecoveryWeightPercent: 0,
    primeEvaluationWeightPercent: 20,
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
    breakMinutes: workplace.breakMinutes ?? 0,
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

/** Minute rate from monthly salary used to calculate lateness penalties. */
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
