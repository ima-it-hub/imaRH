import { internalMutation } from "./_generated/server";
import {
  annualLeaveBalanceForYear,
  annualLeaveEntitlement,
  getSettings,
  todayISO,
} from "./lib";

export const settleYearEnd = internalMutation({
  args: {},
  handler: async (ctx) => {
    const year = Number(todayISO().slice(0, 4)) - 1;
    const settings = await getSettings(ctx);
    const dailyRateDenominator = Math.max(1, settings.workingDaysPerMonth);
    const employees = (await ctx.db.query("users").collect()).filter(
      (employee) => employee.role === "employee" && !employee.resignedAt
    );

    let settled = 0;
    for (const employee of employees) {
      const existing = await ctx.db
        .query("annualLeaveSettlements")
        .withIndex("by_employee_year_kind", (q) =>
          q
            .eq("employeeId", employee._id)
            .eq("year", year)
            .eq("kind", "YEAR_END")
        )
        .unique();
      if (existing) continue;

      const remainingDays = await annualLeaveBalanceForYear(
        ctx,
        employee,
        year
      );
      const amount = Math.round(
        (remainingDays * (employee.baseSalary ?? 0)) /
          dailyRateDenominator
      );
      if (remainingDays !== 0) {
        await ctx.db.insert("annualLeaveSettlements", {
          employeeId: employee._id,
          year,
          kind: "YEAR_END",
          days: remainingDays,
          amount,
          createdAt: Date.now(),
        });
      }
      await ctx.db.patch(employee._id, {
        annualLeaveBalance: annualLeaveEntitlement(
          employee.annualLeaveQuota ?? 30,
          employee.hireDate,
          year + 1
        ),
        annualLeaveBalanceYear: year + 1,
      });
      settled += 1;
    }

    return { year, settled };
  },
});
