import { mutation, query, MutationCtx, QueryCtx } from "./_generated/server";
import { ConvexError, v } from "convex/values";
import { Doc, Id } from "./_generated/dataModel";
import {
  computeDelayAmount,
  computeLateMinutes,
  computeWorkedMinutes,
  algiersLocalToUtcMs,
  formatTimeAlgiers,
  getEmployeeSettings,
  getSettings,
  isThursdayAlgiers,
  monthBounds,
  publicUser,
  requireAdmin,
  requireAdminPage,
  requireUser,
  requiredMinutesForDate,
  todayISO,
  workEndForDate,
  workEndMsForDate,
  weekdayAlgiers,
} from "./lib";

function formatClock(ts: number) {
  return formatTimeAlgiers(ts, { seconds: true });
}

function getScans(row: Doc<"attendances"> | null): number[] {
  if (!row) return [];
  if (row.scans && row.scans.length > 0) return [...row.scans];
  const legacy: number[] = [];
  if (row.clockInAt) legacy.push(row.clockInAt);
  if (row.clockOutAt) legacy.push(row.clockOutAt);
  return legacy;
}

async function getWorkEndMsForDay(
  ctx: QueryCtx | MutationCtx,
  employeeId: Id<"users">,
  date: string,
  settings: {
    workEndHour: number;
    workEndMinute: number;
    thursdayWorkEndHour: number;
    thursdayWorkEndMinute: number;
  }
) {
  const schedule = await ctx.db
    .query("companyHalfDaySchedules")
    .withIndex("by_date", (q) => q.eq("date", date))
    .first();
  if (schedule) {
    const [hour, minute] = schedule.leavingTime.split(":").map(Number);
    return algiersLocalToUtcMs(date, hour!, minute!);
  }

  const leaves = await ctx.db
    .query("leaves")
    .withIndex("by_employee", (q) => q.eq("employeeId", employeeId))
    .collect();
  const legacyHalfDay = leaves.find(
    (leave) =>
      leave.companyLeaveHalfDay === true &&
      leave.startDate <= date &&
      date < leave.endDate &&
      leave.companyLeaveLeavingTime
  );
  if (legacyHalfDay?.companyLeaveLeavingTime) {
    const [hour, minute] = legacyHalfDay.companyLeaveLeavingTime
      .split(":")
      .map(Number);
    return algiersLocalToUtcMs(date, hour!, minute!);
  }
  return workEndMsForDate(settings, date);
}

async function recalculateDay(
  ctx: MutationCtx,
  employeeId: Id<"users">,
  date: string,
  scans: number[],
  options?: { lateMinutesOverride?: number; adminAdjusted?: boolean }
) {
  const employee = await ctx.db.get(employeeId);
  if (!employee) throw new Error("Employé introuvable");

  const settings = await getEmployeeSettings(ctx, employee);
  const halfDaySchedules = await ctx.db
    .query("companyHalfDaySchedules")
    .withIndex("by_date", (q) => q.eq("date", date))
    .collect();
  const halfDaySchedule = halfDaySchedules[0];
  const leaves = await ctx.db
    .query("leaves")
    .withIndex("by_employee", (q) => q.eq("employeeId", employeeId))
    .collect();
  const legacyHalfDay = leaves.find(
    (leave) =>
      leave.companyLeaveHalfDay === true &&
      leave.startDate <= date &&
      date < leave.endDate &&
      leave.companyLeaveLeavingTime
  );
  const isCompanyLeaveDay = Boolean(halfDaySchedule) || leaves.some(
    (leave) =>
      Boolean(leave.companyLeaveName) &&
      leave.companyLeaveHalfDay === true &&
      leave.startDate <= date &&
      date < leave.endDate
  );
  const leavingTime =
    halfDaySchedule?.leavingTime ?? legacyHalfDay?.companyLeaveLeavingTime;
  const scheduledEnd = leavingTime?.match(
    /^(\d{2}):(\d{2})$/
  );
  const workEndMs = await getWorkEndMsForDay(
    ctx,
    employeeId,
    date,
    settings
  );
  const scheduleDuration =
    scheduledEnd && leavingTime
      ? Number(scheduledEnd[1]) * 60 +
        Number(scheduledEnd[2]) -
        settings.workStartHour * 60 -
        settings.workStartMinute
      : undefined;
  const requiredMinutes =
    scheduleDuration !== undefined
      ? Math.max(
          0,
          Math.min(requiredMinutesForDate(settings, date), scheduleDuration)
        )
      : requiredMinutesForDate(settings, date);
  const expectedScans =
    isCompanyLeaveDay || isThursdayAlgiers(date) || settings.breakMinutes <= 0
      ? 2
      : 4;
  const workStartMs = algiersLocalToUtcMs(
    date,
    settings.workStartHour,
    settings.workStartMinute
  );
  const countedScans = [...scans]
    .sort((a, b) => a - b)
    .filter((scan) => scan >= workStartMs && scan <= workEndMs)
    .slice(0, expectedScans);
  const workedMinutes = computeWorkedMinutes(
    countedScans,
    Date.now(),
    workEndMs
  );
  const morningLateMinutes = countedScans[0]
    ? computeLateMinutes(
        countedScans[0],
        settings.workStartHour,
        settings.workStartMinute,
        settings.lateToleranceMinutes
      )
    : 0;
  const breakLateMinutes =
    expectedScans === 4 && countedScans[1] != null && countedScans[2] != null
      ? Math.max(
          0,
          Math.ceil(
            (countedScans[2] -
              countedScans[1] -
              (settings.breakMinutes + settings.lateToleranceMinutes) * 60000) /
              60000
          )
        )
      : 0;
  const autoDelay = morningLateMinutes + breakLateMinutes;
  const lateMinutes = isCompanyLeaveDay
    ? 0
    : options?.lateMinutesOverride !== undefined
      ? Math.max(0, Math.round(options.lateMinutesOverride))
      : autoDelay;

  const delayAmount = computeDelayAmount(
    employee.baseSalary ?? 0,
    lateMinutes,
    requiredMinutes,
    settings.workingDaysPerMonth
  );

  const sorted = countedScans;
  const clockInAt = sorted[0];
  const clockOutAt =
    sorted.length >= 2 && sorted.length % 2 === 0
      ? sorted[sorted.length - 1]
      : undefined;
  const isWorking = sorted.length % 2 === 1;

  let status: "present" | "late" | "working" = "present";
  if (isWorking) status = "working";
  else if (lateMinutes > 0) status = "late";

  return {
    scans: sorted,
    clockInAt,
    clockOutAt,
    workedMinutes,
    requiredMinutes,
    lateMinutes,
    morningLateMinutes:
      options?.lateMinutesOverride !== undefined
        ? Math.max(0, Math.round(options.lateMinutesOverride))
        : morningLateMinutes,
    breakLateMinutes:
      options?.lateMinutesOverride !== undefined ? 0 : breakLateMinutes,
    missingScans: Math.max(0, expectedScans - sorted.length),
    delayAmount,
    lateAdjustedByAdmin: isCompanyLeaveDay
      ? false
      : (options?.adminAdjusted ?? false),
    status,
  };
}

async function applyDayPatch(
  ctx: MutationCtx,
  employeeId: Id<"users">,
  date: string,
  existingId: Id<"attendances"> | null,
  computed: Awaited<ReturnType<typeof recalculateDay>>
) {
  let attendanceId: Id<"attendances">;
  if (existingId) {
    await ctx.db.patch(existingId, computed);
    attendanceId = existingId;
  } else {
    attendanceId = await ctx.db.insert("attendances", {
      employeeId,
      date,
      ...computed,
    });
  }

  return await ctx.db.get(attendanceId);
}

export async function recalculateLeaveAttendance(
  ctx: MutationCtx,
  employeeId: Id<"users">,
  ranges: { startDate: string; endDate: string }[]
) {
  const rows = await ctx.db
    .query("attendances")
    .withIndex("by_employee", (q) => q.eq("employeeId", employeeId))
    .collect();
  for (const row of rows) {
    if (
      !ranges.some(
        (range) => row.date >= range.startDate && row.date < range.endDate
      )
    ) {
      continue;
    }
    const computed = await recalculateDay(
      ctx,
      employeeId,
      row.date,
      getScans(row),
      row.lateAdjustedByAdmin
        ? { lateMinutesOverride: row.lateMinutes, adminAdjusted: true }
        : undefined
    );
    await applyDayPatch(ctx, employeeId, row.date, row._id, computed);
  }
}

/** Ignore only true double-taps / re-sent identical punches (not in→out pairs). */
const NEAR_DUPLICATE_MS = 8_000;

/** Append a scan for an employee at a given instant (barcode, biometric, manual). */
async function registerScanAt(
  ctx: MutationCtx,
  employeeId: Id<"users">,
  scanAt: number,
  options?: { allowNearDuplicateSkip?: boolean; minGapMs?: number }
) {
  const date = todayISO(new Date(scanAt));
  const existing = await ctx.db
    .query("attendances")
    .withIndex("by_employee_date", (q) =>
      q.eq("employeeId", employeeId).eq("date", date)
    )
    .unique();

  const employee = await ctx.db.get(employeeId);
  if (!employee) throw new Error("Employé introuvable");
  const settings = await getEmployeeSettings(ctx, employee);
  const workStartMs = algiersLocalToUtcMs(
    date,
    settings.workStartHour,
    settings.workStartMinute
  );
  const workEndMs = await getWorkEndMsForDay(ctx, employeeId, date, settings);
  const companyHalfDay = await ctx.db
    .query("companyHalfDaySchedules")
    .withIndex("by_date", (q) => q.eq("date", date))
    .first();
  const employeeLeaves = await ctx.db
    .query("leaves")
    .withIndex("by_employee", (q) => q.eq("employeeId", employeeId))
    .collect();
  const legacyHalfDay = employeeLeaves.some(
    (leave) =>
      leave.companyLeaveHalfDay === true &&
      leave.startDate <= date &&
      date < leave.endDate
  );
  const expectedScans =
    companyHalfDay ||
    legacyHalfDay ||
    isThursdayAlgiers(date) ||
    settings.breakMinutes <= 0
      ? 2
      : 4;
  const previous = getScans(existing)
    .filter((scan) => scan >= workStartMs && scan <= workEndMs)
    .sort((a, b) => a - b)
    .slice(0, expectedScans);
  const action = (previous.length % 2 === 0
    ? "clock_in"
    : "clock_out") as "clock_in" | "clock_out";

  if (
    scanAt < workStartMs ||
    scanAt > workEndMs ||
    previous.length >= expectedScans
  ) {
    return {
      action,
      attendance: existing,
      scanCount: previous.length,
      skipped: true as const,
    };
  }

  // Skip near-duplicate punches (device re-sync / double tap within 8s)
  if (
    options?.allowNearDuplicateSkip !== false &&
    previous.some((t) => Math.abs(t - scanAt) < NEAR_DUPLICATE_MS)
  ) {
    return {
      action: (previous.length % 2 === 0
        ? "clock_out"
        : "clock_in") as "clock_in" | "clock_out",
      attendance: existing,
      scanCount: previous.length,
      skipped: true as const,
    };
  }

  const minGap = options?.minGapMs ?? 5000;
  const last = previous[previous.length - 1];
  if (last && scanAt - last < minGap && scanAt >= last) {
    if (options?.allowNearDuplicateSkip !== false) {
      return {
        action: (previous.length % 2 === 0
          ? "clock_out"
          : "clock_in") as "clock_in" | "clock_out",
        attendance: existing,
        scanCount: previous.length,
        skipped: true as const,
      };
    }
    throw new ConvexError("Scan trop rapide — attendez quelques secondes");
  }

  const scans = [...previous, scanAt].sort((a, b) => a - b);
  const adminLocked = Boolean(existing?.lateAdjustedByAdmin);
  const computed = await recalculateDay(ctx, employeeId, date, scans, {
    lateMinutesOverride: adminLocked ? existing!.lateMinutes : undefined,
    adminAdjusted: adminLocked,
  });

  const attendance = await applyDayPatch(
    ctx,
    employeeId,
    date,
    existing?._id ?? null,
    computed
  );

  const isOut = scans.length % 2 === 0;
  return {
    action: isOut ? ("clock_out" as const) : ("clock_in" as const),
    attendance,
    scanCount: scans.length,
    skipped: false as const,
  };
}

/** Append a scan for an employee (barcode or manual) at now. */
async function registerScan(ctx: MutationCtx, employeeId: Id<"users">) {
  const result = await registerScanAt(ctx, employeeId, Date.now(), {
    allowNearDuplicateSkip: false,
    minGapMs: 5000,
  });
  if (result.skipped) {
    throw new ConvexError(
      "Le scan est hors des horaires prévus ou le nombre de scans attendu est atteint"
    );
  }
  return {
    action: result.action,
    attendance: result.attendance,
    scanCount: result.scanCount,
  };
}

export const clockIn = mutation({
  args: { token: v.string() },
  handler: async (ctx, args) => {
    const user = await requireUser(ctx, args.token);
    if (user.role !== "employee") {
      throw new Error("Le pointage est réservé aux employés");
    }
    const result = await registerScan(ctx, user._id);
    return result.attendance;
  },
});

export const clockOut = mutation({
  args: { token: v.string() },
  handler: async (ctx, args) => {
    const user = await requireUser(ctx, args.token);
    if (user.role !== "employee") {
      throw new Error("Le pointage est réservé aux employés");
    }
    const result = await registerScan(ctx, user._id);
    return result.attendance;
  },
});

export const myToday = query({
  args: { token: v.string() },
  handler: async (ctx, args) => {
    const user = await requireUser(ctx, args.token);
    const date = todayISO();
    const row = await ctx.db
      .query("attendances")
      .withIndex("by_employee_date", (q) =>
        q.eq("employeeId", user._id).eq("date", date)
      )
      .unique();
    if (!row) return null;
    const scans = getScans(row);
    const settings = await getEmployeeSettings(ctx, user);
    return {
      ...row,
      scans,
      workedMinutes: computeWorkedMinutes(
        scans,
        Date.now(),
        await getWorkEndMsForDay(ctx, user._id, date, settings)
      ),
      isWorking: scans.length % 2 === 1,
    };
  },
});

export const myWorkSchedule = query({
  args: { token: v.string() },
  handler: async (ctx, args) => {
    const user = await requireUser(ctx, args.token);
    const date = todayISO();
    const settings = await getEmployeeSettings(ctx, user);
    const schedule = await ctx.db
      .query("companyHalfDaySchedules")
      .withIndex("by_date", (q) => q.eq("date", date))
      .first();
    const [scheduleHour, scheduleMinute] = (schedule?.leavingTime ?? "").split(
      ":"
    );
    const end = schedule
      ? {
          hour: Number(scheduleHour),
          minute: Number(scheduleMinute),
        }
      : workEndForDate(settings, date);
    const requiredMinutes = schedule
      ? Math.max(
          0,
          Math.min(
            requiredMinutesForDate(settings, date),
            end.hour * 60 +
              end.minute -
              settings.workStartHour * 60 -
              settings.workStartMinute
          )
        )
      : requiredMinutesForDate(settings, date);
    const formatTime = (hour: number, minute: number) =>
      `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;

    return {
      workplace: user.workplace || "Lieu non défini",
      startTime: formatTime(settings.workStartHour, settings.workStartMinute),
      endTime: formatTime(end.hour, end.minute),
      requiredWorkMinutes: requiredMinutes,
      lateToleranceMinutes: settings.lateToleranceMinutes,
    };
  },
});

export const myMonth = query({
  args: {
    token: v.string(),
    year: v.number(),
    month: v.number(),
  },
  handler: async (ctx, args) => {
    const user = await requireUser(ctx, args.token);
    const { start, end } = monthBounds(args.year, args.month);
    const rows = await ctx.db
      .query("attendances")
      .withIndex("by_employee", (q) => q.eq("employeeId", user._id))
      .collect();

    return rows
      .filter((r) => r.date >= start && r.date <= end)
      .sort((a, b) => a.date.localeCompare(b.date));
  },
});

export const myLateMinutesThisMonth = query({
  args: { token: v.string() },
  handler: async (ctx, args) => {
    const user = await requireUser(ctx, args.token);
    const now = new Date();
    const { start, end } = monthBounds(now.getFullYear(), now.getMonth() + 1);
    const rows = await ctx.db
      .query("attendances")
      .withIndex("by_employee", (q) => q.eq("employeeId", user._id))
      .collect();

    return rows
      .filter((r) => r.date >= start && r.date <= end)
      .reduce((sum, r) => sum + r.lateMinutes, 0);
  },
});

export const listByDate = query({
  args: { token: v.string(), date: v.string() },
  handler: async (ctx, args) => {
    await requireAdminPage(ctx, args.token, "admin-pointages");
    const rows = await ctx.db
      .query("attendances")
      .withIndex("by_date", (q) => q.eq("date", args.date))
      .collect();

    const result = [];
    for (const row of rows) {
      const employee = await ctx.db.get(row.employeeId);
      if (!employee) continue;
      const scans = getScans(row);
      const settings = await getEmployeeSettings(ctx, employee);
      result.push({
        ...row,
        scans,
        workedMinutes:
          row.workedMinutes ??
          computeWorkedMinutes(
            scans,
            Date.now(),
            await getWorkEndMsForDay(ctx, row.employeeId, row.date, settings)
          ),
        delayAmount: row.delayAmount ?? 0,
        employee: publicUser(employee),
      });
    }
    return result.sort((a, b) =>
      a.employee.name.localeCompare(b.employee.name)
    );
  },
});

export const adjustLateMinutes = mutation({
  args: {
    token: v.string(),
    attendanceId: v.id("attendances"),
    lateMinutes: v.number(),
  },
  handler: async (ctx, args) => {
    await requireAdminPage(ctx, args.token, "admin-pointages");
    const row = await ctx.db.get(args.attendanceId);
    if (!row) throw new Error("Pointage introuvable");

    const scans = getScans(row);
    const computed = await recalculateDay(
      ctx,
      row.employeeId,
      row.date,
      scans,
      {
        lateMinutesOverride: args.lateMinutes,
        adminAdjusted: true,
      }
    );

    await applyDayPatch(
      ctx,
      row.employeeId,
      row.date,
      args.attendanceId,
      computed
    );
    return await ctx.db.get(args.attendanceId);
  },
});

export const monthlyLateDeductionsForAdmin = query({
  args: {
    token: v.string(),
    month: v.number(),
    year: v.number(),
  },
  handler: async (ctx, args) => {
    await requireAdminPage(ctx, args.token, "admin-pointages");
    if (args.month < 1 || args.month > 12) {
      throw new Error("Mois invalide");
    }

    const { start, end } = monthBounds(args.year, args.month);
    const today = todayISO();
    const calculationEnd = end < today ? end : today;
    const attendanceRows = await ctx.db
      .query("attendances")
      .withIndex("by_date", (q) => q.gte("date", start).lte("date", end))
      .collect();
    const periodRows = await ctx.db
      .query("approvedLateDeductions")
      .withIndex("by_period", (q) =>
        q.eq("year", args.year).eq("month", args.month)
      )
      .collect();
    const companyHalfDayDates = new Set(
      (await ctx.db.query("companyHalfDaySchedules").collect()).map(
        (schedule) => schedule.date
      )
    );

    const approvedByEmployee = new Map(
      periodRows.map((row) => [row.employeeId, row])
    );
    const attendanceByEmployee = new Map<string, Map<string, Doc<"attendances">>>();
    for (const row of attendanceRows) {
      const byDate =
        attendanceByEmployee.get(row.employeeId) ?? new Map<string, Doc<"attendances">>();
      byDate.set(row.date, row);
      attendanceByEmployee.set(row.employeeId, byDate);
    }

    const employees = (await ctx.db.query("users").collect()).filter(
      (employee) =>
        employee.role === "employee" &&
        (employee.isActive || approvedByEmployee.has(employee._id))
    );
    const settings = await getSettings(ctx);
    const result = [];
    for (const employee of employees) {
      const settingsForEmployee = await getEmployeeSettings(ctx, employee);
      const employeeLeaves = await ctx.db
        .query("leaves")
        .withIndex("by_employee", (q) => q.eq("employeeId", employee._id))
        .collect();
      const workdayAttendance = attendanceByEmployee.get(employee._id) ?? new Map();
      let morningLateMinutes = 0;
      let breakLateMinutes = 0;
      let missingScans = 0;
      let calculatedLateAmount = 0;
      let totalRateableLateMinutes = 0;

      const hireDate = employee.hireDate
        ? todayISO(new Date(employee.hireDate))
        : start;
      const resignedDate = employee.resignedAt
        ? todayISO(new Date(employee.resignedAt))
        : undefined;
      for (
        let day = new Date(`${start}T00:00:00Z`);
        day.toISOString().slice(0, 10) <= calculationEnd;
        day.setUTCDate(day.getUTCDate() + 1)
      ) {
        const date = day.toISOString().slice(0, 10);
        if (
          weekdayAlgiers(date) === 5 ||
          companyHalfDayDates.has(date) ||
          date < hireDate ||
          (resignedDate && date > resignedDate)
        ) {
          continue;
        }
        const leaveDay = employeeLeaves.some(
          (leave) =>
            ((leave.status === "APPROUVE" || leave.status === "CLOTURE") ||
              Boolean(leave.companyLeaveName)) &&
            leave.startDate <= date &&
            date < leave.endDate
        );
        if (leaveDay) continue;

        const expectedScans =
          isThursdayAlgiers(date) || settingsForEmployee.breakMinutes <= 0
            ? 2
            : 4;
        const attendance = workdayAttendance.get(date);
        const workEndMs = workEndMsForDate(settingsForEmployee, date);
        const workStartMs = algiersLocalToUtcMs(
          date,
          settingsForEmployee.workStartHour,
          settingsForEmployee.workStartMinute
        );
        const scans = getScans(attendance ?? null)
          .filter((scan) => scan >= workStartMs && scan <= workEndMs)
          .sort((a, b) => a - b)
          .slice(0, expectedScans);
        if (date < today || Date.now() >= workEndMs) {
          missingScans += Math.max(0, expectedScans - scans.length);
        }

        let dayMorningLateMinutes = 0;
        if (scans[0] != null) {
          const threshold = workStartMs + settingsForEmployee.lateToleranceMinutes * 60000;
          dayMorningLateMinutes = Math.max(
            0,
            Math.ceil((scans[0] - threshold) / 60000)
          );
        }
        let dayBreakLateMinutes = 0;
        if (
          expectedScans === 4 &&
          scans[1] != null &&
          scans[2] != null
        ) {
          const returnThreshold =
            scans[1] +
            (settingsForEmployee.breakMinutes +
              settingsForEmployee.lateToleranceMinutes) *
              60000;
          dayBreakLateMinutes = Math.max(
            0,
            Math.ceil((scans[2] - returnThreshold) / 60000)
          );
        }
        if (attendance?.lateAdjustedByAdmin) {
          dayMorningLateMinutes = attendance.lateMinutes;
          dayBreakLateMinutes = 0;
        }
        morningLateMinutes += dayMorningLateMinutes;
        breakLateMinutes += dayBreakLateMinutes;
        const dayLateMinutes = dayMorningLateMinutes + dayBreakLateMinutes;
        totalRateableLateMinutes += dayLateMinutes;
        calculatedLateAmount += computeDelayAmount(
          employee.baseSalary ?? 0,
          dayLateMinutes,
          requiredMinutesForDate(settingsForEmployee, date),
          settings.workingDaysPerMonth
        );
      }

      const noScanDeduction =
        Math.floor(missingScans / 4) *
        ((employee.baseSalary ?? 0) / settings.workingDaysPerMonth / 2);
      const calculatedAmount = Math.round(
        calculatedLateAmount + noScanDeduction
      );
      const approval = approvedByEmployee.get(employee._id);
      if (
        !approval &&
        morningLateMinutes === 0 &&
        breakLateMinutes === 0 &&
        missingScans === 0
      ) {
        continue;
      }
      result.push({
        employeeId: employee._id,
        employeeName: employee.name,
        morningLateMinutes:
          approval?.morningLateMinutes ?? morningLateMinutes,
        breakLateMinutes:
          approval?.breakLateMinutes ?? breakLateMinutes,
        lateMinutes:
          (approval?.morningLateMinutes ?? morningLateMinutes) +
          (approval?.breakLateMinutes ?? breakLateMinutes),
        missingScans: approval?.missingScans ?? missingScans,
        calculatedAmount,
        lateMinuteRate:
          totalRateableLateMinutes > 0
            ? calculatedLateAmount / totalRateableLateMinutes
            : (employee.baseSalary ?? 0) /
              settings.workingDaysPerMonth /
              settingsForEmployee.requiredWorkMinutes,
        halfDayAmount:
          (employee.baseSalary ?? 0) / settings.workingDaysPerMonth / 2,
        approvedAmount: approval?.amount ?? null,
        amount: approval?.amount ?? calculatedAmount,
      });
    }
    return result.sort((a, b) => a.employeeName.localeCompare(b.employeeName));
  },
});

export const approveMonthlyLateDeduction = mutation({
  args: {
    token: v.string(),
    employeeId: v.id("users"),
    month: v.number(),
    year: v.number(),
    amount: v.number(),
    morningLateMinutes: v.number(),
    breakLateMinutes: v.number(),
    missingScans: v.number(),
  },
  handler: async (ctx, args) => {
    const admin = await requireAdminPage(ctx, args.token, "admin-pointages");
    if (args.month < 1 || args.month > 12) {
      throw new Error("Mois invalide");
    }
    if (!Number.isFinite(args.amount) || args.amount < 0) {
      throw new Error("Montant de retenue invalide");
    }
    if (
      !Number.isInteger(args.morningLateMinutes) ||
      args.morningLateMinutes < 0 ||
      !Number.isInteger(args.breakLateMinutes) ||
      args.breakLateMinutes < 0 ||
      !Number.isInteger(args.missingScans) ||
      args.missingScans < 0
    ) {
      throw new Error("Les totaux de retard et de scans doivent être positifs");
    }
    const employee = await ctx.db.get(args.employeeId);
    if (!employee || employee.role !== "employee") {
      throw new Error("Employé introuvable");
    }

    const existing = await ctx.db
      .query("approvedLateDeductions")
      .withIndex("by_employee_period", (q) =>
        q
          .eq("employeeId", args.employeeId)
          .eq("year", args.year)
          .eq("month", args.month)
      )
      .unique();
    const approval = {
      amount: args.amount,
      morningLateMinutes: args.morningLateMinutes,
      breakLateMinutes: args.breakLateMinutes,
      missingScans: args.missingScans,
      approvedBy: admin._id,
      approvedAt: Date.now(),
    };

    if (existing) {
      await ctx.db.patch(existing._id, approval);
      return await ctx.db.get(existing._id);
    }

    const id = await ctx.db.insert("approvedLateDeductions", {
      employeeId: args.employeeId,
      month: args.month,
      year: args.year,
      ...approval,
    });
    return await ctx.db.get(id);
  },
});

type ClockBarcodeResult = {
  action: "clock_in" | "clock_out";
  employee: ReturnType<typeof publicUser>;
  attendance: Doc<"attendances"> | null;
  message: string;
  displayTime: string;
  difference: string;
  timeLabel: string;
  workedMinutes: number;
  delayAmount: number;
  scanCount: number;
};

async function processBarcodeClock(
  ctx: MutationCtx,
  barcode: string
): Promise<ClockBarcodeResult> {
  const code = barcode.trim().toUpperCase();
  if (!code) throw new Error("Code-barres vide");

  const employee = await ctx.db
    .query("users")
    .withIndex("by_barcode", (q) => q.eq("barcode", code))
    .unique();

  if (!employee || employee.role !== "employee") {
    throw new ConvexError("Employé introuvable pour ce code-barres");
  }
  if (!employee.isActive) {
    throw new ConvexError("Compte employé désactivé");
  }
  if (employee.resignedAt) {
    throw new ConvexError("Cet employé a démissionné");
  }

  const result = await registerScan(ctx, employee._id);
  const attendance = result.attendance;
  const worked = attendance?.workedMinutes ?? 0;
  const delay = attendance?.lateMinutes ?? 0;
  const amount = attendance?.delayAmount ?? 0;

  if (result.action === "clock_in") {
    return {
      action: "clock_in",
      employee: publicUser(employee),
      attendance,
      message: `Entrée enregistrée pour ${employee.name}`,
      displayTime: formatClock(Date.now()),
      difference: `${delay} min`,
      timeLabel: "وقت الدخول",
      workedMinutes: worked,
      delayAmount: amount,
      scanCount: result.scanCount,
    };
  }

  return {
    action: "clock_out",
    employee: publicUser(employee),
    attendance,
    message: `Sortie enregistrée pour ${employee.name}`,
    displayTime: formatClock(Date.now()),
    difference: `${delay} min`,
    timeLabel: "وقت الخروج",
    workedMinutes: worked,
    delayAmount: amount,
    scanCount: result.scanCount,
  };
}

export const clockByBarcode = mutation({
  args: {
    token: v.string(),
    barcode: v.string(),
  },
  handler: async (ctx, args) => {
    await requireAdmin(ctx, args.token);
    return await processBarcodeClock(ctx, args.barcode);
  },
});

export const clockByBarcodePublic = mutation({
  args: {
    barcode: v.string(),
  },
  handler: async (ctx, args) => {
    return await processBarcodeClock(ctx, args.barcode);
  },
});

/**
 * Ingest ZKTeco K50 Pro punches forwarded by the on-LAN sync agent.
 * Authenticated via ZK_SYNC_SECRET (Convex env) / SYNC_SECRET (Render).
 */
export const syncFromZk = mutation({
  args: {
    syncSecret: v.string(),
    punches: v.array(
      v.object({
        userId: v.string(),
        timestamp: v.string(),
        punchType: v.optional(v.number()),
      })
    ),
  },
  handler: async (ctx, args) => {
    const expected = process.env.ZK_SYNC_SECRET;
    if (!expected || args.syncSecret !== expected) {
      throw new ConvexError("Unauthorized sync source");
    }

    const sorted = [...args.punches].sort(
      (a, b) =>
        new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime()
    );

    let processed = 0;
    let skipped = 0;
    let unmatched = 0;
    const errors: string[] = [];

    for (const punch of sorted) {
      const deviceUserId = String(punch.userId ?? "").trim();
      if (!deviceUserId) {
        unmatched += 1;
        continue;
      }

      const scanAt = new Date(punch.timestamp).getTime();
      if (!Number.isFinite(scanAt)) {
        errors.push(`Horodatage invalide pour userId=${deviceUserId}`);
        continue;
      }

      // Match exact ID, then padded variants ("3" ↔ "03")
      let employee = await ctx.db
        .query("users")
        .withIndex("by_zkteco_user_id", (q) =>
          q.eq("zktecoUserId", deviceUserId)
        )
        .unique();
      if (!employee) {
        const normalized = String(Number(deviceUserId));
        if (normalized !== "NaN" && normalized !== deviceUserId) {
          employee = await ctx.db
            .query("users")
            .withIndex("by_zkteco_user_id", (q) =>
              q.eq("zktecoUserId", normalized)
            )
            .unique();
        }
        if (!employee && /^\d+$/.test(deviceUserId)) {
          const padded = deviceUserId.padStart(2, "0");
          if (padded !== deviceUserId) {
            employee = await ctx.db
              .query("users")
              .withIndex("by_zkteco_user_id", (q) =>
                q.eq("zktecoUserId", padded)
              )
              .unique();
          }
        }
      }

      if (!employee || employee.role !== "employee") {
        unmatched += 1;
        continue;
      }
      if (!employee.isActive || employee.resignedAt) {
        skipped += 1;
        continue;
      }

      try {
        const result = await registerScanAt(ctx, employee._id, scanAt, {
          allowNearDuplicateSkip: true,
          minGapMs: 5000,
        });
        if (result.skipped) skipped += 1;
        else processed += 1;
      } catch (err) {
        errors.push(
          `${employee.name}: ${err instanceof Error ? err.message : "erreur"}`
        );
      }
    }

    return {
      success: true,
      processed,
      skipped,
      unmatched,
      errors,
    };
  },
});
