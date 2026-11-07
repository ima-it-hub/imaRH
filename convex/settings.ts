import { mutation, query } from "./_generated/server";
import { v } from "convex/values";
import { getSettings, requireAdmin } from "./lib";

export const get = query({
  args: { token: v.union(v.string(), v.null()) },
  handler: async (ctx, args) => {
    if (!args.token) return null;
    return await getSettings(ctx);
  },
});

/** Public settings for scan kiosk calculations display (no secrets). */
export const getPublic = query({
  args: {},
  handler: async (ctx) => {
    const s = await getSettings(ctx);
    return {
      requiredWorkMinutes: s.requiredWorkMinutes,
      thursdayRequiredWorkMinutes: s.thursdayRequiredWorkMinutes,
      workingDaysPerMonth: s.workingDaysPerMonth,
      lateToleranceMinutes: s.lateToleranceMinutes,
      workStartHour: s.workStartHour,
      workStartMinute: s.workStartMinute,
      workEndHour: s.workEndHour,
      workEndMinute: s.workEndMinute,
      thursdayWorkEndHour: s.thursdayWorkEndHour,
      thursdayWorkEndMinute: s.thursdayWorkEndMinute,
    };
  },
});

export const update = mutation({
  args: {
    token: v.string(),
    workingDaysPerMonth: v.number(),
    primeObjectiveWeightPercent: v.number(),
    primeRecoveryWeightPercent: v.number(),
    primeEvaluationWeightPercent: v.number(),
  },
  handler: async (ctx, args) => {
    await requireAdmin(ctx, args.token);

    const existing = await ctx.db
      .query("settings")
      .withIndex("by_key", (q) => q.eq("key", "default"))
      .unique();

    const objW = Math.max(0, args.primeObjectiveWeightPercent);
    const recW = Math.max(0, args.primeRecoveryWeightPercent);
    const evalW = Math.max(0, args.primeEvaluationWeightPercent);
    const weightSum = objW + recW + evalW;
    if (weightSum <= 0) {
      throw new Error("Les pondérations de prime doivent être > 0");
    }

    const payload = {
      key: "default",
      workStartHour: existing?.workStartHour ?? 8,
      workStartMinute: existing?.workStartMinute ?? 30,
      workEndHour: existing?.workEndHour ?? 17,
      workEndMinute: existing?.workEndMinute ?? 0,
      lateToleranceMinutes: existing?.lateToleranceMinutes ?? 10,
      requiredWorkMinutes: existing?.requiredWorkMinutes ?? 480,
      thursdayRequiredWorkMinutes:
        existing?.thursdayRequiredWorkMinutes ?? 240,
      thursdayWorkEndHour: existing?.thursdayWorkEndHour ?? 12,
      thursdayWorkEndMinute: existing?.thursdayWorkEndMinute ?? 30,
      workingDaysPerMonth: Math.max(1, args.workingDaysPerMonth),
      primeObjectiveWeightPercent: objW,
      primeRecoveryWeightPercent: recW,
      primeEvaluationWeightPercent: evalW,
    };

    if (existing) {
      await ctx.db.patch(existing._id, payload);
      return await ctx.db.get(existing._id);
    }

    const id = await ctx.db.insert("settings", payload);
    return await ctx.db.get(id);
  },
});
