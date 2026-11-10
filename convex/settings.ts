import { mutation, query } from "./_generated/server";
import { v } from "convex/values";
import { getSettings, requireAdminPage } from "./lib";

export const get = query({
  args: { token: v.union(v.string(), v.null()) },
  handler: async (ctx, args) => {
    if (!args.token) return null;
    await requireAdminPage(ctx, args.token, "admin-parametres");
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
  },
  handler: async (ctx, args) => {
    await requireAdminPage(ctx, args.token, "admin-parametres");

    const existing = await ctx.db
      .query("settings")
      .withIndex("by_key", (q) => q.eq("key", "default"))
      .unique();

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
      primeObjectiveWeightPercent:
        existing?.primeObjectiveWeightPercent ?? 80,
      primeRecoveryWeightPercent: existing?.primeRecoveryWeightPercent ?? 0,
      primeEvaluationWeightPercent:
        existing?.primeEvaluationWeightPercent ?? 20,
    };

    if (existing) {
      await ctx.db.patch(existing._id, payload);
      return await ctx.db.get(existing._id);
    }

    const id = await ctx.db.insert("settings", payload);
    return await ctx.db.get(id);
  },
});
