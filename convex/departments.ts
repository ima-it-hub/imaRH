import { mutation, query } from "./_generated/server";
import { v } from "convex/values";
import type { Id } from "./_generated/dataModel";
import { requireAdmin, requireUser } from "./lib";

export const list = query({
  args: { token: v.string() },
  handler: async (ctx, args) => {
    await requireAdmin(ctx, args.token);
    const rows = await ctx.db.query("departments").collect();
    const result = [];
    for (const dept of rows) {
      const conditions = await ctx.db
        .query("evaluationConditions")
        .withIndex("by_department", (q) => q.eq("departmentId", dept._id))
        .collect();
      const employeeCount = (
        await ctx.db
          .query("users")
          .withIndex("by_department", (q) => q.eq("departmentId", dept._id))
          .collect()
      ).length;
      const workplace = dept.workplaceId
        ? await ctx.db.get(dept.workplaceId)
        : null;
      result.push({
        ...dept,
        workplace: workplace
          ? { _id: workplace._id, name: workplace.name }
          : null,
        conditions: conditions.sort((a, b) => a.sortOrder - b.sortOrder),
        employeeCount,
      });
    }
    return result.sort((a, b) => a.name.localeCompare(b.name));
  },
});

/** Departments for a workplace (or all). */
export const listOptions = query({
  args: {
    token: v.string(),
    workplaceId: v.optional(v.id("workplaces")),
  },
  handler: async (ctx, args) => {
    await requireUser(ctx, args.token);
    const rows = args.workplaceId
      ? await ctx.db
          .query("departments")
          .withIndex("by_workplace", (q) =>
            q.eq("workplaceId", args.workplaceId!)
          )
          .collect()
      : await ctx.db.query("departments").collect();

    return rows
      .map((d) => ({
        _id: d._id,
        name: d.name,
        workplaceId: d.workplaceId ?? null,
      }))
      .sort((a, b) => a.name.localeCompare(b.name));
  },
});

export const listByWorkplace = query({
  args: {
    token: v.string(),
    workplaceId: v.id("workplaces"),
  },
  handler: async (ctx, args) => {
    await requireUser(ctx, args.token);
    const rows = await ctx.db
      .query("departments")
      .withIndex("by_workplace", (q) => q.eq("workplaceId", args.workplaceId))
      .collect();

    const result = [];
    for (const dept of rows) {
      const employeeCount = (
        await ctx.db
          .query("users")
          .withIndex("by_department", (q) => q.eq("departmentId", dept._id))
          .collect()
      ).length;
      const conditions = await ctx.db
        .query("evaluationConditions")
        .withIndex("by_department", (q) => q.eq("departmentId", dept._id))
        .collect();
      result.push({
        ...dept,
        employeeCount,
        conditions: conditions.sort((a, b) => a.sortOrder - b.sortOrder),
      });
    }
    return result.sort((a, b) => a.name.localeCompare(b.name));
  },
});

export const create = mutation({
  args: {
    token: v.string(),
    workplaceId: v.id("workplaces"),
    name: v.string(),
    description: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    await requireAdmin(ctx, args.token);
    const workplace = await ctx.db.get(args.workplaceId);
    if (!workplace) throw new Error("Lieu de travail introuvable");

    const name = args.name.trim();
    if (!name) throw new Error("Le nom du département est obligatoire");

    const siblings = await ctx.db
      .query("departments")
      .withIndex("by_workplace", (q) => q.eq("workplaceId", args.workplaceId))
      .collect();
    if (siblings.some((d) => d.name.toLowerCase() === name.toLowerCase())) {
      throw new Error("Ce département existe déjà dans ce lieu");
    }

    const id = await ctx.db.insert("departments", {
      name,
      description: args.description?.trim() ?? "",
      workplaceId: args.workplaceId,
      createdAt: Date.now(),
    });
    return await ctx.db.get(id);
  },
});

export const update = mutation({
  args: {
    token: v.string(),
    departmentId: v.id("departments"),
    name: v.string(),
    description: v.optional(v.string()),
    workplaceId: v.optional(v.id("workplaces")),
  },
  handler: async (ctx, args) => {
    await requireAdmin(ctx, args.token);
    const dept = await ctx.db.get(args.departmentId);
    if (!dept) throw new Error("Département introuvable");

    const name = args.name.trim();
    if (!name) throw new Error("Le nom du département est obligatoire");

    const workplaceId = args.workplaceId ?? dept.workplaceId;
    if (workplaceId) {
      const workplace = await ctx.db.get(workplaceId);
      if (!workplace) throw new Error("Lieu de travail introuvable");

      const siblings = await ctx.db
        .query("departments")
        .withIndex("by_workplace", (q) => q.eq("workplaceId", workplaceId))
        .collect();
      if (
        siblings.some(
          (d) =>
            d._id !== args.departmentId &&
            d.name.toLowerCase() === name.toLowerCase()
        )
      ) {
        throw new Error("Ce nom de département est déjà utilisé dans ce lieu");
      }
    }

    await ctx.db.patch(args.departmentId, {
      name,
      description: args.description?.trim() ?? "",
      ...(args.workplaceId !== undefined
        ? { workplaceId: args.workplaceId }
        : {}),
    });

    const users = await ctx.db
      .query("users")
      .withIndex("by_department", (q) => q.eq("departmentId", args.departmentId))
      .collect();
    for (const user of users) {
      const patch: {
        department: string;
        workplaceId?: Id<"workplaces">;
        workplace?: string;
      } = { department: name };
      if (workplaceId) {
        const wp = await ctx.db.get(workplaceId);
        patch.workplaceId = workplaceId;
        patch.workplace = wp?.name ?? "";
      }
      await ctx.db.patch(user._id, patch);
    }

    return await ctx.db.get(args.departmentId);
  },
});

export const remove = mutation({
  args: {
    token: v.string(),
    departmentId: v.id("departments"),
  },
  handler: async (ctx, args) => {
    await requireAdmin(ctx, args.token);
    const dept = await ctx.db.get(args.departmentId);
    if (!dept) throw new Error("Département introuvable");

    const users = await ctx.db
      .query("users")
      .withIndex("by_department", (q) => q.eq("departmentId", args.departmentId))
      .collect();
    if (users.length > 0) {
      throw new Error(
        "Impossible de supprimer : des collaborateurs sont encore rattachés"
      );
    }

    const conditions = await ctx.db
      .query("evaluationConditions")
      .withIndex("by_department", (q) => q.eq("departmentId", args.departmentId))
      .collect();
    for (const c of conditions) {
      await ctx.db.delete(c._id);
    }

    await ctx.db.delete(args.departmentId);
    return { ok: true };
  },
});

export const addCondition = mutation({
  args: {
    token: v.string(),
    departmentId: v.id("departments"),
    label: v.string(),
    description: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    await requireAdmin(ctx, args.token);
    const dept = await ctx.db.get(args.departmentId);
    if (!dept) throw new Error("Département introuvable");

    const label = args.label.trim();
    if (!label) throw new Error("Le libellé de la condition est obligatoire");

    const existing = await ctx.db
      .query("evaluationConditions")
      .withIndex("by_department", (q) => q.eq("departmentId", args.departmentId))
      .collect();

    const id = await ctx.db.insert("evaluationConditions", {
      departmentId: args.departmentId,
      label,
      description: args.description?.trim() ?? "",
      sortOrder: existing.length,
      isActive: true,
    });
    return await ctx.db.get(id);
  },
});

export const updateCondition = mutation({
  args: {
    token: v.string(),
    conditionId: v.id("evaluationConditions"),
    label: v.string(),
    description: v.optional(v.string()),
    isActive: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    await requireAdmin(ctx, args.token);
    const row = await ctx.db.get(args.conditionId);
    if (!row) throw new Error("Condition introuvable");

    const label = args.label.trim();
    if (!label) throw new Error("Le libellé est obligatoire");

    await ctx.db.patch(args.conditionId, {
      label,
      description: args.description?.trim() ?? row.description ?? "",
      ...(args.isActive !== undefined ? { isActive: args.isActive } : {}),
    });
    return await ctx.db.get(args.conditionId);
  },
});

export const removeCondition = mutation({
  args: {
    token: v.string(),
    conditionId: v.id("evaluationConditions"),
  },
  handler: async (ctx, args) => {
    await requireAdmin(ctx, args.token);
    const row = await ctx.db.get(args.conditionId);
    if (!row) throw new Error("Condition introuvable");
    await ctx.db.delete(args.conditionId);
    return { ok: true };
  },
});

export const conditionsForDepartment = query({
  args: {
    token: v.string(),
    departmentId: v.id("departments"),
  },
  handler: async (ctx, args) => {
    await requireUser(ctx, args.token);
    const rows = await ctx.db
      .query("evaluationConditions")
      .withIndex("by_department", (q) => q.eq("departmentId", args.departmentId))
      .collect();
    return rows
      .filter((c) => c.isActive)
      .sort((a, b) => a.sortOrder - b.sortOrder);
  },
});

/**
 * Invert legacy workplace→department links into department.workplaceId.
 * Safe to run multiple times.
 */
export const migrateWorkplaceOwnership = mutation({
  args: { token: v.string() },
  handler: async (ctx, args) => {
    await requireAdmin(ctx, args.token);
    const workplaces = await ctx.db.query("workplaces").collect();
    let linked = 0;
    let copied = 0;

    for (const wp of workplaces) {
      const legacyDeptId = (wp as { departmentId?: Id<"departments"> })
        .departmentId;
      if (!legacyDeptId) continue;

      const dept = await ctx.db.get(legacyDeptId);
      if (!dept) continue;

      if (!dept.workplaceId) {
        await ctx.db.patch(dept._id, { workplaceId: wp._id });
        linked += 1;
      } else if (dept.workplaceId !== wp._id) {
        // Department already on another workplace — clone for this site
        const newId = await ctx.db.insert("departments", {
          name: dept.name,
          description: dept.description ?? "",
          workplaceId: wp._id,
          createdAt: Date.now(),
        });
        const conditions = await ctx.db
          .query("evaluationConditions")
          .withIndex("by_department", (q) => q.eq("departmentId", dept._id))
          .collect();
        for (const c of conditions) {
          await ctx.db.insert("evaluationConditions", {
            departmentId: newId,
            label: c.label,
            description: c.description,
            sortOrder: c.sortOrder,
            isActive: c.isActive,
          });
        }
        // Point users of this workplace that used the old dept to the clone
        const users = await ctx.db
          .query("users")
          .withIndex("by_workplace", (q) => q.eq("workplaceId", wp._id))
          .collect();
        for (const u of users) {
          if (u.departmentId === dept._id) {
            await ctx.db.patch(u._id, { departmentId: newId });
          }
        }
        copied += 1;
      }
    }

    // Sync users: if they have a department with workplace, align workplaceId
    const users = await ctx.db.query("users").collect();
    let syncedUsers = 0;
    for (const user of users) {
      if (!user.departmentId) continue;
      const dept = await ctx.db.get(user.departmentId);
      if (!dept?.workplaceId) continue;
      if (user.workplaceId !== dept.workplaceId) {
        const wp = await ctx.db.get(dept.workplaceId);
        await ctx.db.patch(user._id, {
          workplaceId: dept.workplaceId,
          workplace: wp?.name ?? user.workplace,
        });
        syncedUsers += 1;
      }
    }

    return { linked, copied, syncedUsers };
  },
});

/** Backfill departments from user.department labels + default manager. */
export const migrateFromUsers = mutation({
  args: { token: v.string() },
  handler: async (ctx, args) => {
    const admin = await requireAdmin(ctx, args.token);
    const users = await ctx.db.query("users").collect();
    let createdDepts = 0;
    let linked = 0;
    let managersSet = 0;

    const nameToId = new Map<string, Id<"departments">>();
    const existingDepts = await ctx.db.query("departments").collect();
    for (const d of existingDepts) {
      nameToId.set(d.name.toLowerCase(), d._id);
    }

    for (const user of users) {
      const label = (user.department ?? "").trim();
      if (label && !user.departmentId) {
        const key = label.toLowerCase();
        let deptId = nameToId.get(key);
        if (!deptId) {
          deptId = await ctx.db.insert("departments", {
            name: label,
            description: "",
            workplaceId: user.workplaceId,
            createdAt: Date.now(),
          });
          nameToId.set(key, deptId);
          createdDepts += 1;
        }
        await ctx.db.patch(user._id, {
          departmentId: deptId,
          department: label,
        });
        linked += 1;
      }

      if (
        user.role === "employee" &&
        !user.managerId &&
        user._id !== admin._id
      ) {
        await ctx.db.patch(user._id, { managerId: admin._id });
        managersSet += 1;
      }

      if (user.role === "employee" && user.baseBonus === undefined) {
        await ctx.db.patch(user._id, { baseBonus: 10000 });
      }
    }

    return { createdDepts, linked, managersSet };
  },
});
