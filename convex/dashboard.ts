import { query } from "./_generated/server";
import { v } from "convex/values";
import {
  annualLeaveBalanceForYear,
  isFinanceDepartment,
  monthBounds,
  publicUser,
  requireAdminPage,
  requireUser,
  todayISO,
} from "./lib";

export const employeeHome = query({
  args: { token: v.string() },
  handler: async (ctx, args) => {
    const user = await requireUser(ctx, args.token);
    const date = todayISO();
    const leaveYear = Number(date.slice(0, 4));
    const now = new Date();
    const { start, end } = monthBounds(now.getFullYear(), now.getMonth() + 1);

    const todayAttendance = await ctx.db
      .query("attendances")
      .withIndex("by_employee_date", (q) =>
        q.eq("employeeId", user._id).eq("date", date)
      )
      .unique();

    const monthAttendances = (
      await ctx.db
        .query("attendances")
        .withIndex("by_employee", (q) => q.eq("employeeId", user._id))
        .collect()
    ).filter((r) => r.date >= start && r.date <= end);

    const lateMinutes = monthAttendances.reduce(
      (sum, r) => sum + r.lateMinutes,
      0
    );

    const salaries = await ctx.db
      .query("salaries")
      .withIndex("by_employee", (q) => q.eq("employeeId", user._id))
      .collect();
    salaries.sort((a, b) =>
      a.year === b.year ? b.month - a.month : b.year - a.year
    );
    const lastSalary = salaries[0]
      ? {
          ...salaries[0],
          lateDeductions: 0,
          netPay: Math.max(
            0,
            salaries[0].baseSalary - (salaries[0].leaveDeductions ?? 0)
          ),
        }
      : null;

    const bonuses = await ctx.db
      .query("bonuses")
      .withIndex("by_employee", (q) => q.eq("employeeId", user._id))
      .collect();
    bonuses.sort((a, b) => b.attributedAt - a.attributedAt);

    const leaves = await ctx.db
      .query("leaves")
      .withIndex("by_employee", (q) => q.eq("employeeId", user._id))
      .collect();
    leaves.sort((a, b) => b.createdAt - a.createdAt);

    const payments = await ctx.db
      .query("paymentOrders")
      .withIndex("by_employee", (q) => q.eq("employeeId", user._id))
      .collect();
    payments.sort((a, b) => b.requestedAt - a.requestedAt);

    const notifications = (
      await ctx.db
        .query("notifications")
        .withIndex("by_user", (q) => q.eq("userId", user._id))
        .collect()
    )
      .sort((a, b) => b.createdAt - a.createdAt)
      .slice(0, 8);

    return {
      user: {
        ...publicUser(user),
        annualLeaveBalance: await annualLeaveBalanceForYear(
          ctx,
          user,
          leaveYear
        ),
      },
      todayAttendance,
      lateMinutes,
      lastSalary,
      lastBonus: bonuses[0] ?? null,
      recentLeaves: leaves
        .filter((leave) => leave.status !== "CLOTURE")
        .slice(0, 5),
      recentPayments: payments
        .filter((payment) => payment.status !== "PAYE")
        .slice(0, 5),
      notifications,
    };
  },
});

export const adminHome = query({
  args: { token: v.string() },
  handler: async (ctx, args) => {
    await requireAdminPage(ctx, args.token, "admin-dashboard");
    const date = todayISO();

    const users = await ctx.db.query("users").collect();
    const employees = users.filter((u) => u.role === "employee" && u.isActive);
    const todayRows = await ctx.db
      .query("attendances")
      .withIndex("by_date", (q) => q.eq("date", date))
      .collect();

    const presentCount = todayRows.filter(
      (r) => r.status === "present" || r.status === "late"
    ).length;
    const presenceRate =
      employees.length === 0
        ? 0
        : Math.round((presentCount / employees.length) * 100);

    const pendingLeaves = (
      await ctx.db
        .query("leaves")
        .withIndex("by_status", (q) => q.eq("status", "EN_ATTENTE"))
        .collect()
    ).length;

    const pendingPayments = (
      await ctx.db
        .query("paymentOrders")
        .withIndex("by_status", (q) => q.eq("status", "DEMANDE"))
        .collect()
    ).length;

    const significantLates = [];
    for (const row of todayRows.filter((r) => r.lateMinutes >= 15)) {
      const employee = await ctx.db.get(row.employeeId);
      if (!employee) continue;
      significantLates.push({
        ...row,
        employee: publicUser(employee),
      });
    }

    const payroll = employees.reduce((sum, e) => sum + (e.baseSalary ?? 0), 0);

    return {
      totalEmployees: employees.length,
      presenceRate,
      presentCount,
      pendingLeaves,
      pendingPayments,
      monthlyPayroll: payroll,
      significantLates: significantLates.sort(
        (a, b) => b.lateMinutes - a.lateMinutes
      ),
    };
  },
});

/** Pending confirmation counts for sidebar green dots (by nav link key). */
export const navPendingBadges = query({
  args: { token: v.string() },
  handler: async (ctx, args) => {
    const user = await requireUser(ctx, args.token);
    const badges: Record<string, number> = {};

    if (user.role === "admin") {
      const pendingLeaves = (
        await ctx.db
          .query("leaves")
          .withIndex("by_status", (q) => q.eq("status", "EN_ATTENTE"))
          .collect()
      ).length;

      const pendingPayments = (
        await ctx.db
          .query("paymentOrders")
          .withIndex("by_status", (q) => q.eq("status", "DEMANDE"))
          .collect()
      ).length;

      const pendingEvalPrimes = (
        await ctx.db.query("monthlyReports").collect()
      ).filter((r) => (r.status ?? "CONFIRME") === "EN_ATTENTE").length;

      const pendingPrimeRows = (
        await ctx.db
          .query("primeCalculations")
          .withIndex("by_status", (q) => q.eq("status", "BROUILLON"))
          .collect()
      );
      let pendingCalculatedPrimes = 0;
      for (const row of pendingPrimeRows) {
        if (row.calculationVersion !== 2) continue;
        const employee = await ctx.db.get(row.employeeId);
        if (employee?.role === "employee" && !employee.resignedAt) {
          pendingCalculatedPrimes += 1;
        }
      }

      const pendingPrimes = pendingCalculatedPrimes;

      if (pendingLeaves > 0) badges["admin-conges"] = pendingLeaves;
      if (pendingPayments > 0) badges["admin-ordres"] = pendingPayments;
      if (pendingPrimes > 0) badges["admin-primes"] = pendingPrimes;
      if (pendingEvalPrimes > 0) badges["admin-rapports"] = pendingEvalPrimes;
    } else {
      if (isFinanceDepartment(user.department)) {
        const pendingCash = (
          await ctx.db
            .query("paymentOrders")
            .withIndex("by_status", (q) => q.eq("status", "VALIDE"))
            .collect()
        ).length;
        if (pendingCash > 0) badges["caisse-paiements"] = pendingCash;
      }
    }

    return badges;
  },
});
