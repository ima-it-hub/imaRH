import { mutation, query } from "./_generated/server";
import { v } from "convex/values";
import type { Id } from "./_generated/dataModel";
import { requireAdmin, requireAdminPage, requireUser } from "./lib";

function normalizedActiveWeights(
  conditions: {
    _id: Id<"evaluationConditions">;
    isActive: boolean;
    weightPercent?: number;
  }[]
) {
  const active = conditions.filter((condition) => condition.isActive);
  if (!active.length) {
    return new Map<Id<"evaluationConditions">, number>();
  }
  const raw = active.map((condition) => ({
    id: condition._id,
    value: Math.max(0, condition.weightPercent ?? 0),
  }));
  const total = raw.reduce((sum, item) => sum + item.value, 0);
  return new Map(
    raw.map((item) => [
      item.id,
      total > 0 ? (item.value / total) * 100 : 100 / active.length,
    ])
  );
}

function normalizedValues(
  ids: Id<"evaluationConditions">[],
  weights: Map<Id<"evaluationConditions">, number>
) {
  if (!ids.length) return new Map<Id<"evaluationConditions">, number>();
  const total = ids.reduce((sum, id) => sum + Math.max(0, weights.get(id) ?? 0), 0);
  return new Map(
    ids.map((id) => [
      id,
      total > 0
        ? (Math.max(0, weights.get(id) ?? 0) / total) * 100
        : 100 / ids.length,
    ])
  );
}

export const list = query({
  args: { token: v.string() },
  handler: async (ctx, args) => {
    await requireAdminPage(ctx, args.token, "admin-departements");
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
      const sortedConditions = conditions.sort(
        (a, b) => a.sortOrder - b.sortOrder
      );
      const conditionWeights = normalizedActiveWeights(sortedConditions);
      result.push({
        ...dept,
        evaluationWeightPercent: dept.evaluationWeightPercent ?? 20,
        realisationWeightPercent: dept.realisationWeightPercent ?? 80,
        companyRealisationWeightPercent:
          dept.companyRealisationWeightPercent ?? 0,
        workplace: workplace
          ? { _id: workplace._id, name: workplace.name }
          : null,
        conditions: sortedConditions.map((condition) => ({
          ...condition,
          weightPercent: condition.isActive
            ? conditionWeights.get(condition._id) ?? 0
            : condition.weightPercent ?? 0,
        })),
        employeeCount,
      });
    }
    return result.sort((a, b) => a.name.localeCompare(b.name));
  },
});

/** Department options are shared by every workplace. */
export const listOptions = query({
  args: { token: v.string() },
  handler: async (ctx, args) => {
    await requireUser(ctx, args.token);
    const rows = await ctx.db.query("departments").collect();

    return rows
      .map((d) => ({
        _id: d._id,
        name: d.name,
        workplaceId: null,
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
    const rows = await ctx.db.query("departments").collect();

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
      const sortedConditions = conditions.sort(
        (a, b) => a.sortOrder - b.sortOrder
      );
      const conditionWeights = normalizedActiveWeights(sortedConditions);
      result.push({
        ...dept,
        evaluationWeightPercent: dept.evaluationWeightPercent ?? 20,
        realisationWeightPercent: dept.realisationWeightPercent ?? 80,
        companyRealisationWeightPercent:
          dept.companyRealisationWeightPercent ?? 0,
        employeeCount,
        conditions: sortedConditions.map((condition) => ({
          ...condition,
          weightPercent: condition.isActive
            ? conditionWeights.get(condition._id) ?? 0
            : condition.weightPercent ?? 0,
        })),
      });
    }
    return result.sort((a, b) => a.name.localeCompare(b.name));
  },
});

export const create = mutation({
  args: {
    token: v.string(),
    name: v.string(),
    description: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    await requireAdminPage(ctx, args.token, "admin-departements");
    const name = args.name.trim();
    if (!name) throw new Error("Le nom du département est obligatoire");

    const existing = await ctx.db.query("departments").collect();
    if (existing.some((department) => department.name.toLowerCase() === name.toLowerCase())) {
      throw new Error("Ce département existe déjà");
    }

    const id = await ctx.db.insert("departments", {
      name,
      description: args.description?.trim() ?? "",
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
  },
  handler: async (ctx, args) => {
    await requireAdminPage(ctx, args.token, "admin-departements");
    const dept = await ctx.db.get(args.departmentId);
    if (!dept) throw new Error("Département introuvable");

    const name = args.name.trim();
    if (!name) throw new Error("Le nom du département est obligatoire");

    const departments = await ctx.db.query("departments").collect();
    if (
      departments.some(
        (department) =>
          department._id !== args.departmentId &&
          department.name.toLowerCase() === name.toLowerCase()
      )
    ) {
      throw new Error("Ce nom de département est déjà utilisé");
    }

    await ctx.db.patch(args.departmentId, {
      name,
      description: args.description?.trim() ?? "",
      workplaceId: undefined,
    });

    const users = await ctx.db
      .query("users")
      .withIndex("by_department", (q) => q.eq("departmentId", args.departmentId))
      .collect();
    for (const user of users) {
      await ctx.db.patch(user._id, { department: name });
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
    await requireAdminPage(ctx, args.token, "admin-departements");
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
    libraryConditionId: v.id("evaluationConditionLibrary"),
  },
  handler: async (ctx, args) => {
    await requireAdminPage(ctx, args.token, "admin-departements");
    const dept = await ctx.db.get(args.departmentId);
    if (!dept) throw new Error("Département introuvable");
    const libraryCondition = await ctx.db.get(args.libraryConditionId);
    if (!libraryCondition || !libraryCondition.isActive) {
      throw new Error("Condition d'évaluation introuvable ou inactive");
    }

    const existing = await ctx.db
      .query("evaluationConditions")
      .withIndex("by_department", (q) => q.eq("departmentId", args.departmentId))
      .collect();
    if (
      existing.some(
        (condition) => condition.libraryConditionId === args.libraryConditionId
      )
    ) {
      throw new Error("Cette condition est déjà ajoutée au département");
    }
    const active = existing.filter((condition) => condition.isActive);
    const currentWeights = normalizedActiveWeights(existing);
    for (const condition of active) {
      await ctx.db.patch(condition._id, {
        weightPercent: currentWeights.get(condition._id) ?? 0,
      });
    }

    const id = await ctx.db.insert("evaluationConditions", {
      departmentId: args.departmentId,
      libraryConditionId: args.libraryConditionId,
      label: libraryCondition.label,
      description: libraryCondition.description ?? "",
      sortOrder: existing.length,
      isActive: true,
      weightPercent: active.length ? 0 : 100,
    });
    return await ctx.db.get(id);
  },
});

export const listConditionLibrary = query({
  args: { token: v.string() },
  handler: async (ctx, args) => {
    await requireAdminPage(ctx, args.token, "admin-departements");
    const rows = await ctx.db.query("evaluationConditionLibrary").collect();
    return rows
      .filter((condition) => condition.isActive)
      .sort((a, b) => a.label.localeCompare(b.label));
  },
});

export const prepareConditionLibrary = mutation({
  args: { token: v.string() },
  handler: async (ctx, args) => {
    await requireAdminPage(ctx, args.token, "admin-departements");
    const [libraryRows, departmentConditions] = await Promise.all([
      ctx.db.query("evaluationConditionLibrary").collect(),
      ctx.db.query("evaluationConditions").collect(),
    ]);
    const byNormalizedLabel = new Map(
      libraryRows.map((condition) => [
        condition.label.trim().toLocaleLowerCase(),
        condition,
      ])
    );
    let imported = 0;
    for (const condition of departmentConditions) {
      const key = condition.label.trim().toLocaleLowerCase();
      if (!key) continue;
      let libraryCondition = byNormalizedLabel.get(key);
      if (!libraryCondition) {
        const id = await ctx.db.insert("evaluationConditionLibrary", {
          label: condition.label.trim(),
          description: condition.description,
          isActive: true,
          createdAt: Date.now(),
        });
        libraryCondition = await ctx.db.get(id) ?? undefined;
        if (libraryCondition) {
          byNormalizedLabel.set(key, libraryCondition);
          imported += 1;
        }
      }
      if (
        libraryCondition &&
        condition.libraryConditionId !== libraryCondition._id
      ) {
        await ctx.db.patch(condition._id, {
          libraryConditionId: libraryCondition._id,
        });
      }
    }
    return { imported };
  },
});

export const createLibraryCondition = mutation({
  args: {
    token: v.string(),
    label: v.string(),
    description: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    await requireAdminPage(ctx, args.token, "admin-departements");
    const label = args.label.trim();
    if (!label) throw new Error("Le libellé de la condition est obligatoire");

    const existing = await ctx.db
      .query("evaluationConditionLibrary")
      .withIndex("by_label", (q) => q.eq("label", label))
      .unique();
    if (existing?.isActive) throw new Error("Cette condition existe déjà");

    if (existing) {
      await ctx.db.patch(existing._id, {
        description: args.description?.trim() || undefined,
        isActive: true,
      });
      return await ctx.db.get(existing._id);
    }

    const id = await ctx.db.insert("evaluationConditionLibrary", {
      label,
      description: args.description?.trim() || undefined,
      isActive: true,
      createdAt: Date.now(),
    });
    return await ctx.db.get(id);
  },
});

export const updateLibraryCondition = mutation({
  args: {
    token: v.string(),
    conditionId: v.id("evaluationConditionLibrary"),
    label: v.string(),
    description: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    await requireAdminPage(ctx, args.token, "admin-departements");
    const row = await ctx.db.get(args.conditionId);
    if (!row || !row.isActive) throw new Error("Condition introuvable");

    const label = args.label.trim();
    if (!label) throw new Error("Le nom de la condition est obligatoire");
    const duplicate = await ctx.db
      .query("evaluationConditionLibrary")
      .withIndex("by_label", (q) => q.eq("label", label))
      .unique();
    if (duplicate && duplicate._id !== row._id) {
      throw new Error("Cette condition existe déjà");
    }

    const description = args.description?.trim() || undefined;
    await ctx.db.patch(row._id, { label, description });

    const assignments = await ctx.db.query("evaluationConditions").collect();
    for (const assignment of assignments) {
      if (assignment.libraryConditionId === row._id) {
        await ctx.db.patch(assignment._id, {
          label,
          description: description ?? "",
        });
      }
    }
    return await ctx.db.get(row._id);
  },
});

export const deleteLibraryCondition = mutation({
  args: {
    token: v.string(),
    conditionId: v.id("evaluationConditionLibrary"),
  },
  handler: async (ctx, args) => {
    await requireAdminPage(ctx, args.token, "admin-departements");
    const row = await ctx.db.get(args.conditionId);
    if (!row || !row.isActive) throw new Error("Condition introuvable");

    await ctx.db.patch(row._id, { isActive: false });
    return { ok: true };
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
    await requireAdminPage(ctx, args.token, "admin-departements");
    const row = await ctx.db.get(args.conditionId);
    if (!row) throw new Error("Condition introuvable");

    const label = args.label.trim();
    if (!label) throw new Error("Le libellé est obligatoire");

    const conditions = await ctx.db
      .query("evaluationConditions")
      .withIndex("by_department", (q) =>
        q.eq("departmentId", row.departmentId)
      )
      .collect();
    const changesActiveState =
      args.isActive !== undefined && args.isActive !== row.isActive;
    if (changesActiveState) {
      const currentWeights = normalizedActiveWeights(conditions);
      const nextActiveIds = conditions
        .filter((condition) =>
          condition._id === row._id ? args.isActive : condition.isActive
        )
        .map((condition) => condition._id);
      const nextWeights = normalizedValues(
        nextActiveIds,
        new Map(
          nextActiveIds.map((id) => [
            id,
            id === row._id && args.isActive
              ? 0
              : currentWeights.get(id) ?? 0,
          ])
        )
      );
      for (const condition of conditions) {
        if (nextWeights.has(condition._id)) {
          await ctx.db.patch(condition._id, {
            weightPercent: nextWeights.get(condition._id),
          });
        }
      }
    }

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
    await requireAdminPage(ctx, args.token, "admin-departements");
    const row = await ctx.db.get(args.conditionId);
    if (!row) throw new Error("Condition introuvable");
    const conditions = await ctx.db
      .query("evaluationConditions")
      .withIndex("by_department", (q) =>
        q.eq("departmentId", row.departmentId)
      )
      .collect();
    const currentWeights = normalizedActiveWeights(conditions);
    const remainingActive = conditions.filter(
      (condition) => condition.isActive && condition._id !== row._id
    );
    const nextWeights = normalizedValues(
      remainingActive.map((condition) => condition._id),
      currentWeights
    );
    for (const condition of remainingActive) {
      await ctx.db.patch(condition._id, {
        weightPercent: nextWeights.get(condition._id),
      });
    }
    await ctx.db.delete(args.conditionId);
    return { ok: true };
  },
});

export const saveEvaluationSettings = mutation({
  args: {
    token: v.string(),
    departmentId: v.id("departments"),
    evaluationWeightPercent: v.number(),
    realisationWeightPercent: v.number(),
    companyRealisationWeightPercent: v.number(),
    conditionWeights: v.array(
      v.object({
        conditionId: v.id("evaluationConditions"),
        weightPercent: v.number(),
      })
    ),
  },
  handler: async (ctx, args) => {
    await requireAdminPage(ctx, args.token, "admin-departements");
    const department = await ctx.db.get(args.departmentId);
    if (!department) throw new Error("Département introuvable");

    const primeWeights = [
      args.evaluationWeightPercent,
      args.realisationWeightPercent,
      args.companyRealisationWeightPercent,
    ];
    if (
      primeWeights.some(
        (weight) => !Number.isFinite(weight) || weight < 0 || weight > 100
      ) ||
      Math.abs(primeWeights.reduce((sum, weight) => sum + weight, 0) - 100) >
        0.01
    ) {
      throw new Error("Les pourcentages de prime doivent totaliser 100 %");
    }

    const activeConditions = (
      await ctx.db
        .query("evaluationConditions")
        .withIndex("by_department_active", (q) =>
          q.eq("departmentId", args.departmentId).eq("isActive", true)
        )
        .collect()
    ).sort((a, b) => a.sortOrder - b.sortOrder);
    if (
      args.conditionWeights.length !== activeConditions.length ||
      new Set(args.conditionWeights.map((entry) => entry.conditionId)).size !==
        args.conditionWeights.length ||
      args.conditionWeights.some(
        (entry) =>
          !activeConditions.some(
            (condition) => condition._id === entry.conditionId
          ) ||
          !Number.isFinite(entry.weightPercent) ||
          entry.weightPercent < 0 ||
          entry.weightPercent > 100
      )
    ) {
      throw new Error("Les pourcentages des conditions sont invalides");
    }
    if (
      activeConditions.length > 0 &&
      Math.abs(
        args.conditionWeights.reduce(
          (sum, entry) => sum + entry.weightPercent,
          0
        ) - 100
      ) > 0.01
    ) {
      throw new Error("Les pourcentages des conditions doivent totaliser 100 %");
    }

    await ctx.db.patch(args.departmentId, {
      evaluationWeightPercent: args.evaluationWeightPercent,
      realisationWeightPercent: args.realisationWeightPercent,
      companyRealisationWeightPercent: args.companyRealisationWeightPercent,
    });
    for (const entry of args.conditionWeights) {
      await ctx.db.patch(entry.conditionId, {
        weightPercent: entry.weightPercent,
      });
    }
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
    const active = rows
      .filter((condition) => condition.isActive)
      .sort((a, b) => a.sortOrder - b.sortOrder);
    const weights = normalizedActiveWeights(active);
    return active.map((condition) => ({
      ...condition,
      weightPercent: weights.get(condition._id) ?? 0,
    }));
  },
});

/**
 * Legacy workplace→department migration retained for compatibility.
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
          evaluationWeightPercent: dept.evaluationWeightPercent,
          realisationWeightPercent: dept.realisationWeightPercent,
          companyRealisationWeightPercent:
            dept.companyRealisationWeightPercent,
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
            weightPercent: c.weightPercent,
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
