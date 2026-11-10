import { mutation, query, MutationCtx } from "./_generated/server";
import { v } from "convex/values";
import { Doc, Id } from "./_generated/dataModel";
import {
  evaluationPercentage,
  notify,
  publicUser,
  requireAdminPage,
  requireManagerOf,
  requireUser,
} from "./lib";

type ScoreRow = {
  conditionId: Id<"evaluationConditions">;
  label: string;
  points: number;
  weightPercent: number;
};

function isoDateIsValid(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

function isMonday(value: string) {
  return new Date(`${value}T00:00:00Z`).getUTCDay() === 1;
}

function addDays(value: string, days: number) {
  const date = new Date(`${value}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function dateRangeForMonth(year: number, month: number) {
  const start = `${year}-${String(month).padStart(2, "0")}-01`;
  const nextMonth =
    month === 12
      ? `${year + 1}-01-01`
      : `${year}-${String(month + 1).padStart(2, "0")}-01`;
  const end = addDays(nextMonth, -1);
  return { start, end };
}

function reportStatus(
  row: { status?: "EN_ATTENTE" | "CONFIRME" }
): "EN_ATTENTE" | "CONFIRME" {
  return row.status ?? "CONFIRME";
}

function employeeFacingReport(row: Doc<"monthlyReports">) {
  return {
    _id: row._id,
    employeeId: row.employeeId,
    adminId: row.adminId,
    month: row.month,
    year: row.year,
    publishedAt: row.confirmedAt ?? row.publishedAt,
    employeeReport: row.employeeReport ?? row.content ?? "",
    scores: row.scores ?? [],
    percentage: row.percentage ?? 0,
    baseBonus: row.baseBonus ?? 0,
    computedBonus: row.computedBonus ?? 0,
    status: reportStatus(row),
  };
}

function fullReport(row: Doc<"monthlyReports">) {
  return {
    ...employeeFacingReport(row),
    weeklyEvaluationCount: row.weeklyEvaluationCount,
    adminReport: row.adminReport ?? "",
    content: row.content ?? row.employeeReport ?? "",
    bonusId: row.bonusId ?? null,
    submittedAt: row.submittedAt ?? row.publishedAt,
    confirmedAt: row.confirmedAt ?? null,
    confirmedBy: row.confirmedBy ?? null,
  };
}

async function buildScores(
  ctx: MutationCtx,
  employeeDepartmentId: Id<"departments"> | undefined,
  scoreInputs: { conditionId: Id<"evaluationConditions">; points: number }[]
): Promise<ScoreRow[]> {
  if (!scoreInputs.length) {
    throw new Error("Évaluez au moins une condition (notes de 1 à 5)");
  }
  for (const s of scoreInputs) {
    if (s.points < 1 || s.points > 5 || !Number.isFinite(s.points)) {
      throw new Error("Chaque note doit être comprise entre 1 et 5");
    }
  }
  const departmentConditions = employeeDepartmentId
    ? await ctx.db
        .query("evaluationConditions")
        .withIndex("by_department_active", (q) =>
          q.eq("departmentId", employeeDepartmentId).eq("isActive", true)
        )
        .collect()
    : [];
  const activeWeightTotal = departmentConditions.reduce(
    (sum, condition) => sum + Math.max(0, condition.weightPercent ?? 0),
    0
  );
  const conditionWeightById = new Map(
    departmentConditions.map((condition) => [
      condition._id,
      activeWeightTotal > 0
        ? (Math.max(0, condition.weightPercent ?? 0) / activeWeightTotal) *
          100
        : 100 / Math.max(1, departmentConditions.length),
    ])
  );
  const scored: ScoreRow[] = [];
  for (const s of scoreInputs) {
    const condition = await ctx.db.get(s.conditionId);
    if (!condition || !condition.isActive) {
      throw new Error("Condition d'évaluation invalide");
    }
    if (
      employeeDepartmentId &&
      condition.departmentId !== employeeDepartmentId
    ) {
      throw new Error(
        "Les conditions doivent appartenir au département de l'employé"
      );
    }
    scored.push({
      conditionId: s.conditionId,
      label: condition.label,
      points: Math.round(s.points * 10) / 10,
      weightPercent: conditionWeightById.get(condition._id) ?? 1,
    });
  }
  return scored;
}

export const myReports = query({
  args: { token: v.string() },
  handler: async (ctx, args) => {
    const user = await requireUser(ctx, args.token);
    const rows = await ctx.db
      .query("monthlyReports")
      .withIndex("by_employee", (q) => q.eq("employeeId", user._id))
      .collect();
    return rows
      .filter((r) => reportStatus(r) === "CONFIRME")
      .map(employeeFacingReport)
      .sort((a, b) =>
        a.year === b.year ? b.month - a.month : b.year - a.year
      );
  },
});

function teamMemberPublic(
  user: Parameters<typeof publicUser>[0],
  hidePrime: boolean
) {
  const base = publicUser(user);
  if (!hidePrime) return base;
  return { ...base, baseBonus: 0 };
}

export const myTeam = query({
  args: { token: v.string() },
  handler: async (ctx, args) => {
    const user = await requireUser(ctx, args.token);
    if (user.role === "admin") {
      const employees = (await ctx.db.query("users").collect())
        .filter(
          (u) => u.role === "employee" && u.isActive && !u.resignedAt
        )
        .sort((a, b) => a.name.localeCompare(b.name));
      return employees.map(publicUser);
    }
    const team = await ctx.db
      .query("users")
      .withIndex("by_manager", (q) => q.eq("managerId", user._id))
      .collect();
    return team
      .filter((u) => u.isActive && !u.resignedAt)
      .map((u) => teamMemberPublic(u, true))
      .sort((a, b) => a.name.localeCompare(b.name));
  },
});

export const conditionsForEmployee = query({
  args: {
    token: v.string(),
    employeeId: v.id("users"),
  },
  handler: async (ctx, args) => {
    await requireManagerOf(ctx, args.token, args.employeeId);
    const employee = await ctx.db.get(args.employeeId);
    if (!employee?.departmentId) return [];
    const rows = await ctx.db
      .query("evaluationConditions")
      .withIndex("by_department", (q) =>
        q.eq("departmentId", employee.departmentId!)
      )
      .collect();
    const active = rows
      .filter((c) => c.isActive)
      .sort((a, b) => a.sortOrder - b.sortOrder);
    const totalWeight = active.reduce(
      (sum, condition) => sum + Math.max(0, condition.weightPercent ?? 0),
      0
    );
    return active.map((condition) => ({
      ...condition,
      weightPercent:
        totalWeight > 0
          ? (Math.max(0, condition.weightPercent ?? 0) / totalWeight) * 100
          : 100 / Math.max(1, active.length),
    }));
  },
});

export const managerWeeklyEvaluation = query({
  args: {
    token: v.string(),
    employeeId: v.id("users"),
    weekStart: v.string(),
  },
  handler: async (ctx, args) => {
    await requireManagerOf(ctx, args.token, args.employeeId);
    if (!isoDateIsValid(args.weekStart) || !isMonday(args.weekStart)) {
      throw new Error("La semaine doit commencer un lundi");
    }
    const row = await ctx.db
      .query("weeklyEvaluations")
      .withIndex("by_employee_week", (q) =>
        q.eq("employeeId", args.employeeId).eq("weekStart", args.weekStart)
      )
      .unique();
    return row
      ? {
          weekStart: row.weekStart,
          scores: row.scores,
          percentage: row.percentage,
          adminMessage: row.adminMessage ?? "",
          status: row.status ?? "CONFIRME",
        }
      : null;
  },
});

export const monthlyWeeklyAverage = query({
  args: {
    token: v.string(),
    employeeId: v.id("users"),
    month: v.number(),
    year: v.number(),
  },
  handler: async (ctx, args) => {
    await requireManagerOf(ctx, args.token, args.employeeId);
    if (
      !Number.isInteger(args.month) ||
      args.month < 1 ||
      args.month > 12 ||
      !Number.isInteger(args.year)
    ) {
      throw new Error("Période invalide");
    }

    const { start, end } = dateRangeForMonth(args.year, args.month);
    const rows = await ctx.db
      .query("weeklyEvaluations")
      .withIndex("by_employee", (q) => q.eq("employeeId", args.employeeId))
      .collect();
    const monthRows = rows.filter(
      (row) =>
        (row.status === undefined || row.status === "CONFIRME") &&
        row.weekStart <= end &&
        addDays(row.weekStart, 6) >= start
    );
    const employee = await ctx.db.get(args.employeeId);
    const activeConditionIds = new Set(
      employee?.departmentId
        ? (
            await ctx.db
              .query("evaluationConditions")
              .withIndex("by_department_active", (q) =>
                q
                  .eq("departmentId", employee.departmentId!)
                  .eq("isActive", true)
              )
              .collect()
          ).map((condition) => condition._id)
        : []
    );
    const totals = new Map<
      string,
      { conditionId: Id<"evaluationConditions">; label: string; sum: number; count: number; weightPercent: number }
    >();
    for (const row of monthRows) {
      for (const score of row.scores) {
        if (!activeConditionIds.has(score.conditionId)) continue;
        const key = score.conditionId;
        const total = totals.get(key) ?? {
          conditionId: score.conditionId,
          label: score.label,
          sum: 0,
          count: 0,
          weightPercent: score.weightPercent ?? 1,
        };
        total.sum += score.points;
        total.count += 1;
        totals.set(key, total);
      }
    }
    const scores = [...totals.values()].map((item) => ({
      conditionId: item.conditionId,
      label: item.label,
      points: Math.round((item.sum / item.count) * 10) / 10,
      weightPercent: item.weightPercent,
    }));
    return {
      weekCount: new Set(monthRows.map((row) => row.weekStart)).size,
      percentage: evaluationPercentage(scores),
      scores,
    };
  },
});

export const weeklyEvaluationsForAdmin = query({
  args: {
    token: v.string(),
    month: v.number(),
    year: v.number(),
    employeeId: v.optional(v.id("users")),
  },
  handler: async (ctx, args) => {
    await requireAdminPage(ctx, args.token, "admin-rapports");
    if (
      !Number.isInteger(args.month) ||
      args.month < 1 ||
      args.month > 12 ||
      !Number.isInteger(args.year)
    ) {
      throw new Error("Période invalide");
    }
    const { start, end } = dateRangeForMonth(args.year, args.month);
    const firstWeekStart = addDays(
      start,
      -((new Date(`${start}T00:00:00Z`).getUTCDay() + 6) % 7)
    );
    const rows = await ctx.db
      .query("weeklyEvaluations")
      .withIndex("by_week", (q) =>
        q.gte("weekStart", firstWeekStart).lte("weekStart", end)
      )
      .collect();
    const result = [];
    for (const row of rows) {
      if (
        (args.employeeId && row.employeeId !== args.employeeId) ||
        row.weekStart > end ||
        addDays(row.weekStart, 6) < start
      ) {
        continue;
      }
      const employee = await ctx.db.get(row.employeeId);
      const manager = await ctx.db.get(row.managerId);
      if (!employee) continue;
      result.push({
        ...row,
        status: row.status ?? "CONFIRME",
        adminMessage: row.adminMessage ?? "",
        weekEnd: addDays(row.weekStart, 6),
        employeeName: employee.name,
        managerName: manager?.name ?? "—",
      });
    }
    return result.sort((a, b) => b.weekStart.localeCompare(a.weekStart));
  },
});

export const listAll = query({
  args: { token: v.string() },
  handler: async (ctx, args) => {
    await requireAdminPage(ctx, args.token, "admin-rapports");
    const rows = await ctx.db.query("monthlyReports").collect();
    const result = [];
    const conditionWeightsByDepartment = new Map<
      Id<"departments">,
      Record<string, number>
    >();
    for (const row of rows) {
      const employee = await ctx.db.get(row.employeeId);
      if (!employee) continue;
      const author = await ctx.db.get(row.adminId);
      let conditionWeights: Record<string, number> = {};
      if (employee.departmentId) {
        const cached = conditionWeightsByDepartment.get(employee.departmentId);
        if (cached) {
          conditionWeights = cached;
        } else {
          const conditions = await ctx.db
            .query("evaluationConditions")
            .withIndex("by_department_active", (q) =>
              q
                .eq("departmentId", employee.departmentId!)
                .eq("isActive", true)
            )
            .collect();
          const totalWeight = conditions.reduce(
            (sum, condition) =>
              sum + Math.max(0, condition.weightPercent ?? 0),
            0
          );
          conditionWeights = Object.fromEntries(
            conditions.map((condition) => [
              condition._id,
              totalWeight > 0
                ? (Math.max(0, condition.weightPercent ?? 0) / totalWeight) *
                  100
                : 100 / Math.max(1, conditions.length),
            ])
          );
          conditionWeightsByDepartment.set(
            employee.departmentId,
            conditionWeights
          );
        }
      }
      result.push({
        ...fullReport(row),
        employee: publicUser(employee),
        authorName: author?.name ?? "—",
        conditionWeights,
      });
    }
    return result.sort((a, b) => {
      const aPending = reportStatus(a) === "EN_ATTENTE" ? 0 : 1;
      const bPending = reportStatus(b) === "EN_ATTENTE" ? 0 : 1;
      if (aPending !== bPending) return aPending - bPending;
      return b.publishedAt - a.publishedAt;
    });
  },
});

export const listTeamReports = query({
  args: { token: v.string() },
  handler: async (ctx, args) => {
    const user = await requireUser(ctx, args.token);
    const isAdmin = user.role === "admin";
    const team = isAdmin
      ? (await ctx.db.query("users").collect()).filter(
          (u) => u.role === "employee"
        )
      : await ctx.db
          .query("users")
          .withIndex("by_manager", (q) => q.eq("managerId", user._id))
          .collect();

    const teamIds = new Set(team.map((u) => u._id));
    const rows = await ctx.db.query("monthlyReports").collect();
    const result = [];
    for (const row of rows) {
      if (!teamIds.has(row.employeeId)) continue;
      const employee = await ctx.db.get(row.employeeId);
      if (!employee) continue;
      const report = fullReport(row);
      result.push({
        ...report,
        baseBonus: isAdmin ? report.baseBonus : 0,
        computedBonus: isAdmin ? report.computedBonus : 0,
        employee: teamMemberPublic(employee, !isAdmin),
      });
    }
    return result.sort((a, b) => b.publishedAt - a.publishedAt);
  },
});

export const saveWeeklyEvaluation = mutation({
  args: {
    token: v.string(),
    employeeId: v.id("users"),
    weekStart: v.string(),
    adminMessage: v.string(),
    scores: v.array(
      v.object({
        conditionId: v.id("evaluationConditions"),
        points: v.number(),
      })
    ),
  },
  handler: async (ctx, args) => {
    const manager = await requireManagerOf(ctx, args.token, args.employeeId);
    if (!isoDateIsValid(args.weekStart) || !isMonday(args.weekStart)) {
      throw new Error("La semaine doit commencer un lundi");
    }
    const employee = await ctx.db.get(args.employeeId);
    if (!employee || employee.role !== "employee" || employee.resignedAt) {
      throw new Error("Employé introuvable");
    }
    const activeConditions = employee.departmentId
      ? await ctx.db
          .query("evaluationConditions")
          .withIndex("by_department_active", (q) =>
            q.eq("departmentId", employee.departmentId!).eq("isActive", true)
          )
          .collect()
      : [];
    const submittedConditionIds = new Set(
      args.scores.map((score) => score.conditionId)
    );
    if (
      args.scores.length !== activeConditions.length ||
      submittedConditionIds.size !== activeConditions.length ||
      activeConditions.some(
        (condition) => !submittedConditionIds.has(condition._id)
      )
    ) {
      throw new Error(
        "Évaluez toutes les conditions actives avant d'enregistrer la semaine."
      );
    }
    const scores = await buildScores(ctx, employee.departmentId, args.scores);
    const existing = await ctx.db
      .query("weeklyEvaluations")
      .withIndex("by_employee_week", (q) =>
        q.eq("employeeId", args.employeeId).eq("weekStart", args.weekStart)
      )
      .unique();
    if (
      existing &&
      (existing.status === undefined || existing.status === "CONFIRME")
    ) {
      throw new Error(
        "Cette évaluation semaine est déjà confirmée et ne peut plus être modifiée."
      );
    }
    const adminMessage = args.adminMessage.trim();
    if (!adminMessage) {
      throw new Error("Le message destiné à l'admin est obligatoire.");
    }
    const now = Date.now();
    const payload = {
      managerId: manager._id,
      adminMessage,
      scores,
      percentage: evaluationPercentage(scores),
      status: "EN_ATTENTE" as const,
      updatedAt: now,
    };
    if (existing) {
      await ctx.db.patch(existing._id, payload);
      return await ctx.db.get(existing._id);
    }
    const id = await ctx.db.insert("weeklyEvaluations", {
      employeeId: args.employeeId,
      weekStart: args.weekStart,
      ...payload,
      createdAt: now,
      submittedAt: now,
    });
    const admins = (await ctx.db.query("users").collect()).filter(
      (user) => user.role === "admin" && user.isActive
    );
    for (const admin of admins) {
      await notify(
        ctx,
        admin._id,
        "Évaluation semaine à confirmer",
        `${manager.name} a soumis l'évaluation semaine de ${employee.name} (${args.weekStart}).`
      );
    }
    return await ctx.db.get(id);
  },
});

export const confirmWeeklyEvaluation = mutation({
  args: {
    token: v.string(),
    evaluationId: v.id("weeklyEvaluations"),
    scores: v.array(
      v.object({
        conditionId: v.id("evaluationConditions"),
        points: v.number(),
      })
    ),
  },
  handler: async (ctx, args) => {
    const admin = await requireAdminPage(ctx, args.token, "admin-rapports");
    const evaluation = await ctx.db.get(args.evaluationId);
    if (!evaluation) throw new Error("Évaluation semaine introuvable.");
    if (evaluation.status !== "EN_ATTENTE") {
      throw new Error("Cette évaluation semaine a déjà été confirmée.");
    }

    const employee = await ctx.db.get(evaluation.employeeId);
    if (!employee) throw new Error("Employé introuvable.");

    const activeConditions = employee.departmentId
      ? await ctx.db
          .query("evaluationConditions")
          .withIndex("by_department_active", (q) =>
            q.eq("departmentId", employee.departmentId!).eq("isActive", true)
          )
          .collect()
      : [];
    const submittedConditionIds = new Set(
      args.scores.map((score) => score.conditionId)
    );
    if (
      args.scores.length !== activeConditions.length ||
      submittedConditionIds.size !== activeConditions.length ||
      activeConditions.some(
        (condition) => !submittedConditionIds.has(condition._id)
      )
    ) {
      throw new Error("Toutes les conditions actives doivent être notées.");
    }
    const scores = await buildScores(ctx, employee.departmentId, args.scores);
    const now = Date.now();
    await ctx.db.patch(evaluation._id, {
      scores,
      percentage: evaluationPercentage(scores),
      status: "CONFIRME",
      confirmedAt: now,
      confirmedBy: admin._id,
      updatedAt: now,
    });
    return await ctx.db.get(evaluation._id);
  },
});

/** Manager (or admin draft): submit for admin confirmation — not visible to employee yet. */
export const publish = mutation({
  args: {
    token: v.string(),
    employeeId: v.id("users"),
    month: v.number(),
    year: v.number(),
    content: v.optional(v.string()),
    adminReport: v.optional(v.string()),
    employeeReport: v.optional(v.string()),
    scores: v.optional(
      v.array(
        v.object({
          conditionId: v.id("evaluationConditions"),
          points: v.number(),
        })
      )
    ),
  },
  handler: async (ctx, args) => {
    const author = await requireManagerOf(ctx, args.token, args.employeeId);
    if (
      !Number.isInteger(args.month) ||
      args.month < 1 ||
      args.month > 12 ||
      !Number.isInteger(args.year)
    ) {
      throw new Error("Période invalide");
    }
    const employee = await ctx.db.get(args.employeeId);
    if (!employee || employee.role !== "employee") {
      throw new Error("Employé introuvable");
    }
    if (employee.resignedAt) {
      throw new Error("Cet employé a démissionné");
    }
    const { start, end } = dateRangeForMonth(args.year, args.month);
    const weeklyRows = await ctx.db
      .query("weeklyEvaluations")
      .withIndex("by_employee", (q) => q.eq("employeeId", args.employeeId))
      .collect();
    const weeklyEvaluationCount = weeklyRows.filter(
      (row) =>
        (row.status === undefined || row.status === "CONFIRME") &&
        row.weekStart <= end &&
        addDays(row.weekStart, 6) >= start
    ).length;
    if (weeklyEvaluationCount === 0) {
      throw new Error(
        "Enregistrez au moins une évaluation hebdomadaire avant le rapport mensuel."
      );
    }

    const adminReport = (args.adminReport ?? "").trim();
    const employeeReport = (
      args.employeeReport ??
      args.content ??
      ""
    ).trim();

    if (!adminReport) {
      throw new Error("Le rapport destiné à l'admin est obligatoire");
    }
    if (!employeeReport) {
      throw new Error("Le rapport destiné à l'employé est obligatoire");
    }

    const scored = await buildScores(
      ctx,
      employee.departmentId,
      args.scores ?? []
    );
    const percentage = evaluationPercentage(scored);
    const baseBonus = employee.baseBonus ?? 0;

    const existing = await ctx.db
      .query("monthlyReports")
      .withIndex("by_employee_period", (q) =>
        q
          .eq("employeeId", args.employeeId)
          .eq("year", args.year)
          .eq("month", args.month)
      )
      .unique();

    if (existing && reportStatus(existing) === "CONFIRME") {
      throw new Error(
        "Cette évaluation est déjà confirmée. Contactez l'admin pour la modifier."
      );
    }

    const now = Date.now();
    const payload = {
      adminId: author._id,
      adminReport,
      employeeReport,
      content: employeeReport,
      scores: scored,
      percentage,
      weeklyEvaluationCount,
      baseBonus,
      computedBonus: 0,
      status: "EN_ATTENTE" as const,
      submittedAt: now,
      publishedAt: now,
      confirmedAt: undefined,
      confirmedBy: undefined,
    };

    let reportId = existing?._id;
    if (existing) {
      await ctx.db.patch(existing._id, payload);
    } else {
      reportId = await ctx.db.insert("monthlyReports", {
        employeeId: args.employeeId,
        month: args.month,
        year: args.year,
        ...payload,
      });
    }

    const admins = (await ctx.db.query("users").collect()).filter(
      (u) => u.role === "admin" && u.isActive
    );
    for (const admin of admins) {
      await notify(
        ctx,
        admin._id,
        "Évaluation à confirmer",
        `${author.name} a soumis l'évaluation de ${employee.name} (${args.month}/${args.year}) — ${percentage}%. À modifier / confirmer.`
      );
    }

    return await ctx.db.get(reportId!);
  },
});

/** Admin: edit and confirm an evaluation report. */
export const confirm = mutation({
  args: {
    token: v.string(),
    reportId: v.id("monthlyReports"),
    adminReport: v.optional(v.string()),
    employeeReport: v.optional(v.string()),
    scores: v.optional(
      v.array(
        v.object({
          conditionId: v.id("evaluationConditions"),
          points: v.number(),
        })
      )
    ),
  },
  handler: async (ctx, args) => {
    const admin = await requireAdminPage(ctx, args.token, "admin-rapports");
    const report = await ctx.db.get(args.reportId);
    if (!report) throw new Error("Évaluation introuvable");

    const employee = await ctx.db.get(report.employeeId);
    if (!employee) throw new Error("Employé introuvable");

    const scored = await buildScores(
      ctx,
      employee.departmentId,
      args.scores ??
        (report.scores ?? []).map(({ conditionId, points }) => ({
          conditionId,
          points,
        }))
    );
    if (!scored.length) {
      throw new Error("Évaluez au moins une condition (notes de 1 à 5)");
    }

    const adminReport = (args.adminReport ?? report.adminReport ?? "").trim();
    const employeeReport = (
      args.employeeReport ??
      report.employeeReport ??
      report.content ??
      ""
    ).trim();
    if (!adminReport || !employeeReport) {
      throw new Error("Les deux rapports sont obligatoires");
    }

    const percentage = evaluationPercentage(scored);
    const now = Date.now();

    await ctx.db.patch(args.reportId, {
      adminReport,
      employeeReport,
      content: employeeReport,
      scores: scored,
      percentage,
      computedBonus: 0,
      status: "CONFIRME",
      confirmedAt: now,
      confirmedBy: admin._id,
      publishedAt: now,
    });

    await notify(
      ctx,
      report.employeeId,
      "Évaluation mensuelle confirmée",
      `Votre évaluation ${report.month}/${report.year} : ${percentage}%.`
    );

    return await ctx.db.get(args.reportId);
  },
});

export const reject = mutation({
  args: {
    token: v.string(),
    reportId: v.id("monthlyReports"),
  },
  handler: async (ctx, args) => {
    await requireAdminPage(ctx, args.token, "admin-rapports");
    const report = await ctx.db.get(args.reportId);
    if (!report) throw new Error("Évaluation introuvable");
    if (reportStatus(report) === "CONFIRME") {
      throw new Error("Impossible de supprimer une évaluation déjà confirmée");
    }
    if (report.bonusId) {
      const bonus = await ctx.db.get(report.bonusId);
      if (bonus) await ctx.db.delete(report.bonusId);
    }
    await ctx.db.delete(args.reportId);
    return { ok: true };
  },
});
