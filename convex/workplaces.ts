import { mutation, query } from "./_generated/server";
import { v } from "convex/values";
import { requireAdmin, requireUser } from "./lib";

const scheduleValidator = v.object({
  workStartHour: v.number(),
  workStartMinute: v.number(),
  workEndHour: v.number(),
  workEndMinute: v.number(),
  lateToleranceMinutes: v.number(),
  requiredWorkMinutes: v.number(),
  thursdayRequiredWorkMinutes: v.number(),
  thursdayWorkEndHour: v.number(),
  thursdayWorkEndMinute: v.number(),
});

function validateSchedule(schedule: {
  workStartHour: number;
  workStartMinute: number;
  workEndHour: number;
  workEndMinute: number;
  lateToleranceMinutes: number;
  requiredWorkMinutes: number;
  thursdayRequiredWorkMinutes: number;
  thursdayWorkEndHour: number;
  thursdayWorkEndMinute: number;
}) {
  const validTime = (hour: number, minute: number) =>
    Number.isInteger(hour) &&
    hour >= 0 &&
    hour <= 23 &&
    Number.isInteger(minute) &&
    minute >= 0 &&
    minute <= 59;

  if (
    !validTime(schedule.workStartHour, schedule.workStartMinute) ||
    !validTime(schedule.workEndHour, schedule.workEndMinute) ||
    !validTime(schedule.thursdayWorkEndHour, schedule.thursdayWorkEndMinute)
  ) {
    throw new Error("Les horaires doivent être compris entre 00:00 et 23:59");
  }

  const start = schedule.workStartHour * 60 + schedule.workStartMinute;
  const end = schedule.workEndHour * 60 + schedule.workEndMinute;
  const thursdayEnd =
    schedule.thursdayWorkEndHour * 60 + schedule.thursdayWorkEndMinute;
  if (end <= start || thursdayEnd <= start) {
    throw new Error("Les heures de sortie doivent suivre l'heure de début");
  }
  if (
    !Number.isInteger(schedule.lateToleranceMinutes) ||
    schedule.lateToleranceMinutes < 0 ||
    !Number.isInteger(schedule.requiredWorkMinutes) ||
    schedule.requiredWorkMinutes <= 0 ||
    !Number.isInteger(schedule.thursdayRequiredWorkMinutes) ||
    schedule.thursdayRequiredWorkMinutes <= 0
  ) {
    throw new Error("La tolérance et les durées de travail sont invalides");
  }
}

export const list = query({
  args: { token: v.string() },
  handler: async (ctx, args) => {
    await requireAdmin(ctx, args.token);
    const rows = await ctx.db.query("workplaces").collect();
    const result = [];
    for (const wp of rows) {
      const departments = await ctx.db
        .query("departments")
        .withIndex("by_workplace", (q) => q.eq("workplaceId", wp._id))
        .collect();
      const employeeCount = (
        await ctx.db
          .query("users")
          .withIndex("by_workplace", (q) => q.eq("workplaceId", wp._id))
          .collect()
      ).length;
      result.push({
        ...wp,
        departments: departments.sort((a, b) => a.name.localeCompare(b.name)),
        departmentCount: departments.length,
        employeeCount,
      });
    }
    return result.sort((a, b) => a.name.localeCompare(b.name));
  },
});

/** All workplaces for selects. */
export const listOptions = query({
  args: { token: v.string() },
  handler: async (ctx, args) => {
    await requireUser(ctx, args.token);
    const rows = await ctx.db.query("workplaces").collect();
    return rows
      .map((w) => ({
        _id: w._id,
        name: w.name,
      }))
      .sort((a, b) => a.name.localeCompare(b.name));
  },
});

export const create = mutation({
  args: {
    token: v.string(),
    name: v.string(),
    description: v.optional(v.string()),
    schedule: v.optional(scheduleValidator),
  },
  handler: async (ctx, args) => {
    await requireAdmin(ctx, args.token);
    if (args.schedule) validateSchedule(args.schedule);
    const name = args.name.trim();
    if (!name) throw new Error("Le nom du lieu de travail est obligatoire");

    const existing = await ctx.db
      .query("workplaces")
      .withIndex("by_name", (q) => q.eq("name", name))
      .unique();
    if (existing) throw new Error("Ce lieu de travail existe déjà");

    const id = await ctx.db.insert("workplaces", {
      name,
      description: args.description?.trim() ?? "",
      ...(args.schedule ?? {}),
      createdAt: Date.now(),
    });
    return await ctx.db.get(id);
  },
});

export const update = mutation({
  args: {
    token: v.string(),
    workplaceId: v.id("workplaces"),
    name: v.string(),
    description: v.optional(v.string()),
    schedule: v.optional(scheduleValidator),
  },
  handler: async (ctx, args) => {
    await requireAdmin(ctx, args.token);
    if (args.schedule) validateSchedule(args.schedule);
    const wp = await ctx.db.get(args.workplaceId);
    if (!wp) throw new Error("Lieu de travail introuvable");

    const name = args.name.trim();
    if (!name) throw new Error("Le nom est obligatoire");

    const clash = await ctx.db
      .query("workplaces")
      .withIndex("by_name", (q) => q.eq("name", name))
      .unique();
    if (clash && clash._id !== args.workplaceId) {
      throw new Error("Ce nom de lieu est déjà utilisé");
    }

    await ctx.db.patch(args.workplaceId, {
      name,
      description: args.description?.trim() ?? "",
      ...(args.schedule ?? {}),
    });

    const users = await ctx.db
      .query("users")
      .withIndex("by_workplace", (q) => q.eq("workplaceId", args.workplaceId))
      .collect();
    for (const user of users) {
      await ctx.db.patch(user._id, { workplace: name });
    }

    return await ctx.db.get(args.workplaceId);
  },
});

export const remove = mutation({
  args: {
    token: v.string(),
    workplaceId: v.id("workplaces"),
  },
  handler: async (ctx, args) => {
    await requireAdmin(ctx, args.token);
    const wp = await ctx.db.get(args.workplaceId);
    if (!wp) throw new Error("Lieu de travail introuvable");

    const departments = await ctx.db
      .query("departments")
      .withIndex("by_workplace", (q) => q.eq("workplaceId", args.workplaceId))
      .collect();
    if (departments.length > 0) {
      throw new Error(
        "Impossible de supprimer : supprimez d'abord les départements de ce lieu"
      );
    }

    const users = await ctx.db
      .query("users")
      .withIndex("by_workplace", (q) => q.eq("workplaceId", args.workplaceId))
      .collect();
    if (users.length > 0) {
      throw new Error(
        "Impossible de supprimer : des collaborateurs sont encore rattachés"
      );
    }

    await ctx.db.delete(args.workplaceId);
    return { ok: true };
  },
});
