import { mutation, query, MutationCtx } from "./_generated/server";
import { ConvexError, v } from "convex/values";
import { Doc, Id } from "./_generated/dataModel";
import {
  computeDelayAmount,
  computeLateMinutes,
  computeWorkedMinutes,
  formatTimeAlgiers,
  getEmployeeSettings,
  monthBounds,
  publicUser,
  requireAdmin,
  requireUser,
  requiredMinutesForDate,
  todayISO,
  workEndForDate,
  workEndMsForDate,
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
  const requiredMinutes = requiredMinutesForDate(settings, date);
  const workedMinutes = computeWorkedMinutes(
    scans,
    Date.now(),
    workEndMsForDate(settings, date)
  );
  const firstScan = [...scans].sort((a, b) => a - b)[0];
  const autoDelay = firstScan
    ? computeLateMinutes(
        firstScan,
        settings.workStartHour,
        settings.workStartMinute,
        settings.lateToleranceMinutes
      )
    : 0;
  const lateMinutes =
    options?.lateMinutesOverride !== undefined
      ? Math.max(0, Math.round(options.lateMinutesOverride))
      : autoDelay;

  const delayAmount = computeDelayAmount(
    employee.baseSalary ?? 0,
    lateMinutes,
    settings.requiredWorkMinutes,
    settings.workingDaysPerMonth
  );

  const sorted = [...scans].sort((a, b) => a - b);
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
    delayAmount,
    lateAdjustedByAdmin: options?.adminAdjusted ?? false,
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

  const previous = getScans(existing);

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

  // Punches after shift end are accepted but excluded from counted work time.
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
        workEndMsForDate(settings, date)
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
    const end = workEndForDate(settings, date);
    const formatTime = (hour: number, minute: number) =>
      `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;

    return {
      workplace: user.workplace || "Lieu non défini",
      startTime: formatTime(settings.workStartHour, settings.workStartMinute),
      endTime: formatTime(end.hour, end.minute),
      requiredWorkMinutes: requiredMinutesForDate(settings, date),
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
    await requireAdmin(ctx, args.token);
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
            workEndMsForDate(settings, row.date)
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
    await requireAdmin(ctx, args.token);
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
    await requireAdmin(ctx, args.token);
    if (args.month < 1 || args.month > 12) {
      throw new Error("Mois invalide");
    }

    const { start, end } = monthBounds(args.year, args.month);
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

    const employeeTotals = new Map<
      string,
      { employeeId: Id<"users">; calculatedAmount: number; lateMinutes: number }
    >();
    for (const attendance of attendanceRows) {
      if ((attendance.delayAmount ?? 0) <= 0) continue;
      const current = employeeTotals.get(attendance.employeeId) ?? {
        employeeId: attendance.employeeId,
        calculatedAmount: 0,
        lateMinutes: 0,
      };
      current.calculatedAmount += attendance.delayAmount ?? 0;
      current.lateMinutes += attendance.lateMinutes;
      employeeTotals.set(attendance.employeeId, current);
    }

    const approvedByEmployee = new Map(
      periodRows.map((row) => [row.employeeId, row])
    );
    for (const row of periodRows) {
      if (!employeeTotals.has(row.employeeId)) {
        employeeTotals.set(row.employeeId, {
          employeeId: row.employeeId,
          calculatedAmount: 0,
          lateMinutes: 0,
        });
      }
    }

    const result = [];
    for (const item of employeeTotals.values()) {
      const employee = await ctx.db.get(item.employeeId);
      if (!employee) continue;
      const approval = approvedByEmployee.get(item.employeeId);
      result.push({
        employeeId: item.employeeId,
        employeeName: employee.name,
        lateMinutes: item.lateMinutes,
        calculatedAmount: item.calculatedAmount,
        approvedAmount: approval?.amount ?? null,
        amount: approval?.amount ?? item.calculatedAmount,
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
  },
  handler: async (ctx, args) => {
    const admin = await requireAdmin(ctx, args.token);
    if (args.month < 1 || args.month > 12) {
      throw new Error("Mois invalide");
    }
    if (!Number.isFinite(args.amount) || args.amount < 0) {
      throw new Error("Montant de retenue invalide");
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
