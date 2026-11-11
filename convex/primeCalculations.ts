import { mutation, query, MutationCtx, QueryCtx } from "./_generated/server";
import { v } from "convex/values";
import { Doc, Id } from "./_generated/dataModel";
import {
  computeBasePrime,
  departmentPrimeWeights,
  notify,
  publicUser,
  requireAdminAnyPage,
  requireAdminPage,
} from "./lib";

async function evaluationPercentForMonth(
  ctx: QueryCtx | MutationCtx,
  employeeId: Id<"users">,
  year: number,
  month: number
) {
  const report = await ctx.db
    .query("monthlyReports")
    .withIndex("by_employee_period", (q) =>
      q.eq("employeeId", employeeId).eq("year", year).eq("month", month)
    )
    .unique();
  return report?.percentage ?? 0;
}

async function primeWeightsForEmployee(
  ctx: QueryCtx | MutationCtx,
  employee: Doc<"users">
) {
  const department = employee.departmentId
    ? await ctx.db.get(employee.departmentId)
    : null;
  return departmentPrimeWeights(department);
}

async function companyRealisationRatioForMonth(
  ctx: QueryCtx | MutationCtx,
  year: number,
  month: number
): Promise<number | null> {
  const [workplaces, metrics, syncs] = await Promise.all([
    ctx.db.query("workplaces").collect(),
    ctx.db
      .query("workplacePrimeMetrics")
      .withIndex("by_period", (q) => q.eq("year", year).eq("month", month))
      .collect(),
    ctx.db
      .query("silwanRealisationSyncs")
      .withIndex("by_period", (q) => q.eq("year", year).eq("month", month))
      .collect(),
  ]);
  const centralWorkplace = workplaces.find(
    (workplace) =>
      workplace.name.trim().toLocaleUpperCase("fr-DZ") === "BEN ZARGA"
  );
  if (!centralWorkplace) return null;

  const metric = metrics.find(
    (entry) => entry.workplaceId === centralWorkplace._id
  );
  if (!metric || metric.objective <= 0) return null;
  const sync = syncs.find(
    (entry) =>
      entry.ownerType === "workplace" &&
      entry.workplaceId === centralWorkplace._id
  );
  const realisation =
    sync && sync.updatedAt > metric.updatedAt
      ? sync.realisation
      : metric.realisation;
  return Math.max(0, realisation) / metric.objective;
}

function requiredCompanyRealisationRatio(
  ratio: number | null,
  companyRealisationWeightPercent: number
) {
  if (ratio === null && companyRealisationWeightPercent > 0) {
    throw new Error(
      "Saisissez un objectif de réalisation mensuel pour le lieu BEN ZARGA avant de calculer la prime entreprise"
    );
  }
  return ratio ?? 0;
}

function isShowroomResponsible(department?: string) {
  const normalized = (department ?? "").trim().toLowerCase().replace(/\s+/g, " ");
  return (
    normalized === "resposible showroom" ||
    normalized === "responsible showroom"
  );
}

function previousPeriod(year: number, month: number) {
  return month === 1
    ? { year: year - 1, month: 12 }
    : { year, month: month - 1 };
}

function carryForwardRecoveryObjective(
  realisation: number | undefined,
  recoveryObjective: number | undefined,
  recouvrement: number | undefined
) {
  if (realisation === undefined) return null;
  const recoveryDifference =
    recoveryObjective !== undefined && recouvrement !== undefined
      ? recoveryObjective - recouvrement
      : 0;
  return Math.max(0, realisation + recoveryDifference);
}

async function upsertInheritedDraft(
  ctx: MutationCtx,
  employee: Doc<"users">,
  args: { year: number; month: number },
  existing: Doc<"primeCalculations"> | undefined,
  source: {
    objective: number;
    realisation: number;
    recoveryObjective?: number;
    recouvrement?: number;
    sourceManagerId?: Id<"users">;
    sourceWorkplaceId?: Id<"workplaces">;
    applyRecoveryAdjustment: boolean;
  },
  companyRealisationRatio: number | null,
  now: number
) {
  const evaluationPercent = await evaluationPercentForMonth(
    ctx,
    employee._id,
    args.year,
    args.month
  );
  const primeWeights = await primeWeightsForEmployee(ctx, employee);
  const effectiveCompanyRealisationRatio = requiredCompanyRealisationRatio(
    companyRealisationRatio,
    primeWeights.companyRealisationWeightPercent
  );
  const computed = computeBasePrime({
    basePrime: employee.baseBonus ?? 0,
    objective: source.objective,
    realisation: source.realisation,
    companyRealisationRatio: effectiveCompanyRealisationRatio,
    recoveryObjective: source.recoveryObjective ?? 0,
    recouvrement: source.recouvrement ?? 0,
    evaluationPercent,
    applyRecoveryAdjustment: source.applyRecoveryAdjustment,
    ...primeWeights,
  });
  const payload = {
    employeeId: employee._id,
    month: args.month,
    year: args.year,
    objective: source.objective,
    realisation: source.realisation,
    recoveryObjective: source.recoveryObjective,
    recouvrement: source.recouvrement ?? 0,
    hasOwnMetrics: false,
    sourceManagerId: source.sourceManagerId,
    sourceWorkplaceId: source.sourceWorkplaceId,
    ...computed,
    adminAdjustedAmount: undefined,
    calculationVersion: 2,
    status: "BROUILLON" as const,
    updatedAt: now,
  };

  if (existing) {
    await ctx.db.patch(existing._id, payload);
    return { ...existing, ...payload };
  }
  const id = await ctx.db.insert("primeCalculations", {
    ...payload,
    createdAt: now,
  });
  const inserted = await ctx.db.get(id);
  if (!inserted) throw new Error("Impossible d'enregistrer la prime héritée");
  return inserted;
}

export const employeesForMonth = query({
  args: {
    token: v.string(),
    month: v.number(),
    year: v.number(),
  },
  handler: async (ctx, args) => {
    await requireAdminAnyPage(ctx, args.token, [
      "admin-primes",
      "admin-calcul-primes",
    ]);
    const users = await ctx.db.query("users").collect();
    const employees = users.filter(
      (user) =>
        user.role === "employee" && user.isActive && !user.resignedAt
    );
    const metricManagerIds = new Set(
      employees
        .map((employee) => employee.managerId)
        .filter((managerId): managerId is Id<"users"> => managerId !== undefined)
    );
    const metricOwners = users.filter(
      (user) =>
        user.isActive &&
        !user.resignedAt &&
        (user.role === "employee" || metricManagerIds.has(user._id))
    );
    const calculations = await ctx.db
      .query("primeCalculations")
      .withIndex("by_period", (q) =>
        q.eq("year", args.year).eq("month", args.month)
      )
      .collect();
    const silwanSyncs = await ctx.db
      .query("silwanRealisationSyncs")
      .withIndex("by_period", (q) =>
        q.eq("year", args.year).eq("month", args.month)
      )
      .collect();
    const objectivePlans = await ctx.db
      .query("realisationObjectivePlans")
      .withIndex("by_period", (q) =>
        q.eq("year", args.year).eq("month", args.month)
      )
      .collect();
    const previous = previousPeriod(args.year, args.month);
    const [previousCalculations, previousWorkplaceMetrics] = await Promise.all([
      ctx.db
        .query("primeCalculations")
        .withIndex("by_period", (q) =>
          q.eq("year", previous.year).eq("month", previous.month)
        )
        .collect(),
      ctx.db
        .query("workplacePrimeMetrics")
        .withIndex("by_period", (q) =>
          q.eq("year", previous.year).eq("month", previous.month)
        )
        .collect(),
    ]);
    const calculationByEmployee = new Map(
      calculations.map((calculation) => [
        calculation.employeeId,
        calculation,
      ])
    );
    const silwanByEmployee = new Map(
      silwanSyncs
        .filter((sync) => sync.ownerType === "employee" && sync.employeeId)
        .map((sync) => [sync.employeeId!, sync])
    );
    const objectiveByEmployee = new Map(
      objectivePlans
        .filter((plan) => plan.ownerType === "employee" && plan.employeeId)
        .map((plan) => [plan.employeeId!, plan.objective])
    );
    const previousCalculationByEmployee = new Map(
      previousCalculations.map((calculation) => [
        calculation.employeeId,
        calculation,
      ])
    );
    const previousMetricByWorkplace = new Map(
      previousWorkplaceMetrics.map((metric) => [
        metric.workplaceId,
        metric,
      ])
    );

    const result = [];
    for (const employee of metricOwners) {
      const manager = employee.managerId
        ? await ctx.db.get(employee.managerId)
        : null;
      const workplace = employee.workplaceId
        ? await ctx.db.get(employee.workplaceId)
        : null;
      const managerCalculation = employee.managerId
        ? calculationByEmployee.get(employee.managerId)
        : null;
      const previousEmployeeCalculation = previousCalculationByEmployee.get(
        employee._id
      );
      const currentCalculation = calculationByEmployee.get(employee._id);
      const silwanSync = silwanByEmployee.get(employee._id);
      const previousWorkplaceMetric = employee.workplaceId
        ? previousMetricByWorkplace.get(employee.workplaceId)
        : undefined;
      const previousManagerCalculation = employee.managerId
        ? previousCalculationByEmployee.get(employee.managerId)
        : undefined;
      const previousEmployeeRecovery = previousEmployeeCalculation?.calculationVersion === 2
        ? carryForwardRecoveryObjective(
            previousEmployeeCalculation.realisation,
            previousEmployeeCalculation.recoveryObjective,
            previousEmployeeCalculation.recouvrement
          )
        : null;
      const previousWorkplaceRecovery = previousWorkplaceMetric
        ? carryForwardRecoveryObjective(
            previousWorkplaceMetric.realisation,
            previousWorkplaceMetric.recoveryObjective,
            previousWorkplaceMetric.recouvrement
          )
        : null;
      const previousManagerRecovery =
        previousManagerCalculation?.calculationVersion === 2 &&
        previousManagerCalculation.hasOwnMetrics === true
          ? carryForwardRecoveryObjective(
              previousManagerCalculation.realisation,
              previousManagerCalculation.recoveryObjective,
              previousManagerCalculation.recouvrement
            )
          : null;
      const previousRecoveryDefaults = previousEmployeeCalculation?.hasOwnMetrics
        ? [
            previousEmployeeRecovery,
            previousWorkplaceRecovery,
            previousManagerRecovery,
          ]
        : previousEmployeeCalculation?.sourceWorkplaceId
          ? [
              previousEmployeeRecovery,
              previousWorkplaceRecovery,
              previousManagerRecovery,
            ]
          : [
              previousWorkplaceRecovery,
              previousManagerRecovery,
              previousEmployeeRecovery,
            ];
      const previousMonthObjective =
        previousEmployeeCalculation?.calculationVersion === 2
            ? previousEmployeeCalculation.objective
            : previousWorkplaceMetric?.objective ??
              (previousManagerCalculation?.calculationVersion === 2 &&
              previousManagerCalculation.hasOwnMetrics === true
                ? previousManagerCalculation.objective
                : null);

      result.push({
        employee: publicUser(employee),
        managerName: manager?.name ?? "",
        workplaceName: workplace?.name ?? employee.workplace ?? "",
        usesWorkplaceRecovery: isShowroomResponsible(employee.department),
        previousMonthRecoveryObjective:
          previousRecoveryDefaults.find((value) => value !== null) ?? null,
        previousMonthObjective,
        annualObjective: objectiveByEmployee.get(employee._id) ?? null,
        calculation: currentCalculation ?? null,
        silwanRealisation:
          silwanSync &&
          (!currentCalculation ||
            silwanSync.updatedAt > currentCalculation.updatedAt)
            ? silwanSync.realisation
            : null,
        silwanRecouvrement:
          silwanSync &&
          (!currentCalculation ||
            silwanSync.updatedAt > currentCalculation.updatedAt)
            ? silwanSync.recouvrement ?? null
            : null,
        evaluationPercent: await evaluationPercentForMonth(
          ctx,
          employee._id,
          args.year,
          args.month
        ),
        managerHasOwnMetrics: managerCalculation?.hasOwnMetrics === true,
        managerObjective: managerCalculation?.objective ?? null,
        managerRealisation: managerCalculation?.realisation ?? null,
      });
    }

    return result.sort((a, b) =>
      a.employee.name.localeCompare(b.employee.name)
    );
  },
});

export const workplaceMetricsForMonth = query({
  args: {
    token: v.string(),
    month: v.number(),
    year: v.number(),
  },
  handler: async (ctx, args) => {
    await requireAdminPage(ctx, args.token, "admin-calcul-primes");
    const [workplaces, metrics, silwanSyncs, objectivePlans] = await Promise.all([
      ctx.db.query("workplaces").collect(),
      ctx.db
        .query("workplacePrimeMetrics")
        .withIndex("by_period", (q) =>
          q.eq("year", args.year).eq("month", args.month)
        )
        .collect(),
      ctx.db
        .query("silwanRealisationSyncs")
        .withIndex("by_period", (q) =>
          q.eq("year", args.year).eq("month", args.month)
        )
        .collect(),
      ctx.db
        .query("realisationObjectivePlans")
        .withIndex("by_period", (q) =>
          q.eq("year", args.year).eq("month", args.month)
        )
        .collect(),
    ]);
    const previous = previousPeriod(args.year, args.month);
    const previousMetrics = await ctx.db
      .query("workplacePrimeMetrics")
      .withIndex("by_period", (q) =>
        q.eq("year", previous.year).eq("month", previous.month)
      )
      .collect();
    const metricByWorkplace = new Map(
      metrics.map((metric) => [metric.workplaceId, metric])
    );
    const silwanByWorkplace = new Map(
      silwanSyncs
        .filter((sync) => sync.ownerType === "workplace" && sync.workplaceId)
        .map((sync) => [sync.workplaceId!, sync])
    );
    const objectiveByWorkplace = new Map(
      objectivePlans
        .filter((plan) => plan.ownerType === "workplace" && plan.workplaceId)
        .map((plan) => [plan.workplaceId!, plan.objective])
    );
    const previousMetricByWorkplace = new Map(
      previousMetrics.map((metric) => [metric.workplaceId, metric])
    );
    return workplaces
      .map((workplace) => {
        const metric = metricByWorkplace.get(workplace._id);
        const silwanSync = silwanByWorkplace.get(workplace._id);
        return {
          workplace,
          metrics: metric ?? null,
          annualObjective: objectiveByWorkplace.get(workplace._id) ?? null,
          silwanRealisation:
            silwanSync && (!metric || silwanSync.updatedAt > metric.updatedAt)
              ? silwanSync.realisation
              : null,
          silwanRecouvrement:
            silwanSync && (!metric || silwanSync.updatedAt > metric.updatedAt)
              ? silwanSync.recouvrement ?? null
              : null,
          previousMonthObjective:
            previousMetricByWorkplace.get(workplace._id)?.objective ?? null,
          previousMonthRecoveryObjective: (() => {
            const previousMetric = previousMetricByWorkplace.get(workplace._id);
            return previousMetric
              ? carryForwardRecoveryObjective(
                  previousMetric.realisation,
                  previousMetric.recoveryObjective,
                  previousMetric.recouvrement
                )
              : null;
          })(),
        };
      })
      .sort((a, b) => a.workplace.name.localeCompare(b.workplace.name));
  },
});

export const saveAnnualRealisationObjectives = mutation({
  args: {
    token: v.string(),
    year: v.number(),
    ownerType: v.union(v.literal("employee"), v.literal("workplace")),
    employeeId: v.optional(v.id("users")),
    workplaceId: v.optional(v.id("workplaces")),
    monthlyObjectives: v.array(
      v.object({
        month: v.number(),
        objective: v.number(),
      })
    ),
  },
  handler: async (ctx, args) => {
    const admin = await requireAdminPage(
      ctx,
      args.token,
      "admin-calcul-primes"
    );
    if (!Number.isInteger(args.year) || args.year < 2000) {
      throw new Error("Année invalide.");
    }
    if (
      args.ownerType === "employee"
        ? !args.employeeId || args.workplaceId !== undefined
        : !args.workplaceId || args.employeeId !== undefined
    ) {
      throw new Error("Sélectionnez un seul employé ou lieu de travail.");
    }
    if (
      args.monthlyObjectives.length !== 12 ||
      new Set(args.monthlyObjectives.map((entry) => entry.month)).size !== 12 ||
      args.monthlyObjectives.some(
        (entry) =>
          !Number.isInteger(entry.month) ||
          entry.month < 1 ||
          entry.month > 12 ||
          !Number.isFinite(entry.objective) ||
          entry.objective <= 0
      )
    ) {
      throw new Error(
        "Fournissez un objectif positif pour chacun des 12 mois."
      );
    }

    if (args.ownerType === "employee") {
      const employee = await ctx.db.get(args.employeeId!);
      if (
        !employee ||
        employee.role !== "employee" ||
        !employee.isActive ||
        employee.resignedAt
      ) {
        throw new Error("Employé introuvable ou inactif.");
      }
    } else {
      const workplace = await ctx.db.get(args.workplaceId!);
      if (!workplace) throw new Error("Lieu de travail introuvable.");
    }

    const existing = args.ownerType === "employee"
      ? await ctx.db
          .query("realisationObjectivePlans")
          .withIndex("by_employee_period", (q) =>
            q.eq("employeeId", args.employeeId).eq("year", args.year)
          )
          .collect()
      : await ctx.db
          .query("realisationObjectivePlans")
          .withIndex("by_workplace_period", (q) =>
            q.eq("workplaceId", args.workplaceId).eq("year", args.year)
          )
          .collect();
    const byMonth = new Map(existing.map((plan) => [plan.month, plan]));
    const now = Date.now();
    for (const entry of args.monthlyObjectives) {
      const owner =
        args.ownerType === "employee"
          ? { employeeId: args.employeeId }
          : { workplaceId: args.workplaceId };
      const payload = {
        ...owner,
        ownerType: args.ownerType,
        year: args.year,
        month: entry.month,
        objective: Math.round(entry.objective * 100) / 100,
        updatedAt: now,
        updatedBy: admin._id,
      };
      const current = byMonth.get(entry.month);
      if (current) {
        await ctx.db.patch(current._id, payload);
      } else {
        await ctx.db.insert("realisationObjectivePlans", payload);
      }
    }
    return { saved: args.monthlyObjectives.length };
  },
});

export const saveSilwanRealisations = mutation({
  args: {
    token: v.string(),
    month: v.number(),
    year: v.number(),
    employeeEntries: v.array(
      v.object({
        employeeId: v.id("users"),
        associatedAgentCode: v.string(),
        realisation: v.number(),
        recouvrement: v.number(),
      })
    ),
    workplaceEntries: v.array(
      v.object({
        workplaceId: v.id("workplaces"),
        associatedAgentCode: v.optional(v.string()),
        allDocuments: v.optional(v.boolean()),
        realisation: v.number(),
        recouvrement: v.number(),
      })
    ),
  },
  handler: async (ctx, args) => {
    const admin = await requireAdminPage(ctx, args.token, "admin-calcul-primes");
    if (
      !Number.isInteger(args.month) ||
      args.month < 1 ||
      args.month > 12 ||
      !Number.isInteger(args.year)
    ) {
      throw new Error("Période de réalisation invalide");
    }

    const entries = [
      ...args.employeeEntries.map((entry) => ({
        ownerType: "employee" as const,
        employeeId: entry.employeeId,
        associatedAgentCode: entry.associatedAgentCode.trim(),
        allDocuments: false,
        realisation: entry.realisation,
        recouvrement: entry.recouvrement,
      })),
      ...args.workplaceEntries.map((entry) => ({
        ownerType: "workplace" as const,
        workplaceId: entry.workplaceId,
        associatedAgentCode: entry.associatedAgentCode?.trim() || undefined,
        allDocuments: entry.allDocuments === true,
        realisation: entry.realisation,
        recouvrement: entry.recouvrement,
      })),
    ];
    const uniqueKeys = new Set(
      entries.map((entry) =>
        entry.ownerType === "employee"
          ? `employee:${entry.employeeId}`
          : `workplace:${entry.workplaceId}`
      )
    );
    if (uniqueKeys.size !== entries.length) {
      throw new Error("Une réalisation est fournie plusieurs fois");
    }

    const now = Date.now();
    for (const entry of entries) {
      if (
        (entry.ownerType === "employee" && !entry.associatedAgentCode) ||
        (entry.ownerType === "workplace" &&
          !entry.allDocuments &&
          !entry.associatedAgentCode) ||
        !Number.isFinite(entry.realisation) ||
        entry.realisation < 0 ||
        !Number.isFinite(entry.recouvrement)
      ) {
        throw new Error("Code ou montant de réalisation invalide");
      }

      let existing: Doc<"silwanRealisationSyncs"> | null;
      if (entry.ownerType === "employee") {
        if (!entry.associatedAgentCode) {
          throw new Error("Code AssociatedAgent employé invalide");
        }
        const employee = await ctx.db.get(entry.employeeId);
        if (
          !employee ||
          employee.role !== "employee" ||
          !employee.isActive ||
          employee.resignedAt
        ) {
          throw new Error("Employé introuvable ou inactif");
        }
        if (
          employee.associatedAgentCode?.trim() !== entry.associatedAgentCode
        ) {
          throw new Error(
            "Le code AssociatedAgent a changé. Rechargez la page."
          );
        }
        existing = await ctx.db
          .query("silwanRealisationSyncs")
          .withIndex("by_employee_period", (q) =>
            q
              .eq("employeeId", entry.employeeId)
              .eq("year", args.year)
              .eq("month", args.month)
          )
          .unique();
      } else {
        const workplace = await ctx.db.get(entry.workplaceId);
        const isCentralWorkplace =
          workplace?.name.trim().toLocaleUpperCase("fr-DZ") === "BEN ZARGA";
        if (!workplace) {
          throw new Error("Lieu de travail introuvable");
        }
        if (
          entry.allDocuments
            ? !isCentralWorkplace || Boolean(entry.associatedAgentCode)
            : !entry.associatedAgentCode ||
              workplace.associatedAgentCode?.trim() !== entry.associatedAgentCode
        ) {
          throw new Error(
            "Le code AssociatedAgent a changé. Rechargez la page."
          );
        }
        existing = await ctx.db
          .query("silwanRealisationSyncs")
          .withIndex("by_workplace_period", (q) =>
            q
              .eq("workplaceId", entry.workplaceId)
              .eq("year", args.year)
              .eq("month", args.month)
          )
          .unique();
      }
      const allDocuments =
        entry.ownerType === "workplace" && entry.allDocuments;
      const entryPayload =
        entry.ownerType === "employee"
          ? {
              ownerType: entry.ownerType,
              employeeId: entry.employeeId,
              associatedAgentCode: entry.associatedAgentCode,
            }
          : {
              ownerType: entry.ownerType,
              workplaceId: entry.workplaceId,
              associatedAgentCode: entry.associatedAgentCode,
            };
      const payload = {
        ...entryPayload,
        month: args.month,
        year: args.year,
        realisation: Math.round(entry.realisation * 100) / 100,
        recouvrement: Math.round(entry.recouvrement * 100) / 100,
        sourceType: allDocuments
          ? ("central_total" as const)
          : ("associated_agent" as const),
        updatedAt: now,
        updatedBy: admin._id,
      };
      if (existing) {
        await ctx.db.patch(existing._id, payload);
      } else {
        await ctx.db.insert("silwanRealisationSyncs", payload);
      }
    }

    return { saved: entries.length };
  },
});

export const syncInheritedDrafts = mutation({
  args: {
    token: v.string(),
    month: v.number(),
    year: v.number(),
  },
  handler: async (ctx, args) => {
    await requireAdminPage(ctx, args.token, "admin-primes");
    const employees = (await ctx.db.query("users").collect()).filter(
      (user) =>
        user.role === "employee" &&
        user.isActive &&
        !user.resignedAt &&
        (user.baseBonus ?? 0) > 0
    );
    const calculations = await ctx.db
      .query("primeCalculations")
      .withIndex("by_period", (q) =>
        q.eq("year", args.year).eq("month", args.month)
      )
      .collect();
    const calculationByEmployee = new Map(
      calculations.map((calculation) => [
        calculation.employeeId,
        calculation,
      ])
    );
    const workplaceMetrics = await ctx.db
      .query("workplacePrimeMetrics")
      .withIndex("by_period", (q) =>
        q.eq("year", args.year).eq("month", args.month)
      )
      .collect();
    const metricsByWorkplace = new Map(
      workplaceMetrics.map((metric) => [metric.workplaceId, metric])
    );
    const companyRealisationRatio = await companyRealisationRatioForMonth(
      ctx,
      args.year,
      args.month
    );
    let prepared = 0;
    const now = Date.now();

    for (const employee of employees) {
      const existing = calculationByEmployee.get(employee._id);
      if (
        existing?.status === "CONFIRME" ||
        existing?.hasOwnMetrics === true
      ) {
        continue;
      }

      const workplaceMetric = employee.workplaceId
        ? metricsByWorkplace.get(employee.workplaceId)
        : undefined;
      let source:
        | {
            objective: number;
            realisation: number;
            recoveryObjective?: number;
            recouvrement?: number;
            sourceWorkplaceId?: Id<"workplaces">;
            sourceManagerId?: Id<"users">;
            applyRecoveryAdjustment: boolean;
          }
        | undefined;

      if (workplaceMetric) {
        const showroomResponsible = isShowroomResponsible(employee.department);
        if (
          !showroomResponsible ||
          (workplaceMetric.recoveryObjective !== undefined &&
            workplaceMetric.recouvrement !== undefined)
        ) {
          source = {
            objective: workplaceMetric.objective,
            realisation: workplaceMetric.realisation,
            recoveryObjective: showroomResponsible
              ? workplaceMetric.recoveryObjective
              : undefined,
            recouvrement: showroomResponsible
              ? workplaceMetric.recouvrement
              : undefined,
            sourceWorkplaceId: workplaceMetric.workplaceId,
            applyRecoveryAdjustment: showroomResponsible,
          };
        }
      } else {
        const managerCalculation = employee.managerId
          ? calculationByEmployee.get(employee.managerId)
          : undefined;
        if (
          managerCalculation?.calculationVersion === 2 &&
          managerCalculation.hasOwnMetrics === true
        ) {
          source = {
            objective: managerCalculation.objective,
            realisation: managerCalculation.realisation,
            sourceManagerId: employee.managerId,
            applyRecoveryAdjustment: false,
          };
        }
      }

      if (!source) {
        if (existing && existing.status === "BROUILLON") {
          await ctx.db.delete(existing._id);
          calculationByEmployee.delete(employee._id);
        }
        continue;
      }

      const updated = await upsertInheritedDraft(
        ctx,
        employee,
        args,
        existing,
        source,
        companyRealisationRatio,
        now
      );
      calculationByEmployee.set(employee._id, updated);
      prepared += 1;
    }

    return { prepared };
  },
});

export const saveDrafts = mutation({
  args: {
    token: v.string(),
    month: v.number(),
    year: v.number(),
    selectedEmployeeIds: v.array(v.id("users")),
    entries: v.array(
      v.object({
        employeeId: v.id("users"),
        objective: v.number(),
        realisation: v.number(),
        recoveryObjective: v.number(),
        recouvrement: v.number(),
      })
    ),
    workplaceEntries: v.array(
      v.object({
        workplaceId: v.id("workplaces"),
        objective: v.union(v.number(), v.null()),
        realisation: v.union(v.number(), v.null()),
        recoveryObjective: v.union(v.number(), v.null()),
        recouvrement: v.union(v.number(), v.null()),
      })
    ),
  },
  handler: async (ctx, args) => {
    const admin = await requireAdminPage(ctx, args.token, "admin-calcul-primes");

    const selectedIds = new Set(args.selectedEmployeeIds);
    if (selectedIds.size !== args.selectedEmployeeIds.length) {
      throw new Error("Un employé est sélectionné plusieurs fois");
    }
    if (
      args.entries.length !== selectedIds.size ||
      new Set(args.entries.map((entry) => entry.employeeId)).size !==
        args.entries.length ||
      args.entries.some((entry) => !selectedIds.has(entry.employeeId))
    ) {
      throw new Error("Les données saisies ne correspondent pas aux sélections");
    }

    const users = await ctx.db.query("users").collect();
    const employees = users.filter(
      (user) => user.role === "employee" && user.isActive && !user.resignedAt
    );
    const metricManagerIds = new Set(
      employees
        .map((employee) => employee.managerId)
        .filter((managerId): managerId is Id<"users"> => managerId !== undefined)
    );
    const metricOwners = users.filter(
      (user) =>
        user.isActive &&
        !user.resignedAt &&
        (user.role === "employee" || metricManagerIds.has(user._id))
    );
    const employeeById = new Map(
      metricOwners.map((employee) => [employee._id, employee])
    );
    const existingCalculations = await ctx.db
      .query("primeCalculations")
      .withIndex("by_period", (q) =>
        q.eq("year", args.year).eq("month", args.month)
      )
      .collect();
    const calculationByEmployee = new Map(
      existingCalculations.map((calculation) => [
        calculation.employeeId,
        calculation,
      ])
    );
    const now = Date.now();
    const workplaces = await ctx.db.query("workplaces").collect();
    const workplaceIds = new Set(workplaces.map((workplace) => workplace._id));
    if (
      new Set(args.workplaceEntries.map((entry) => entry.workplaceId)).size !==
      args.workplaceEntries.length
    ) {
      throw new Error("Un lieu de travail est saisi plusieurs fois");
    }

    const existingWorkplaceMetrics = await ctx.db
      .query("workplacePrimeMetrics")
      .withIndex("by_period", (q) =>
        q.eq("year", args.year).eq("month", args.month)
      )
      .collect();
    const annualObjectivePlans = await ctx.db
      .query("realisationObjectivePlans")
      .withIndex("by_period", (q) =>
        q.eq("year", args.year).eq("month", args.month)
      )
      .collect();
    const workplaceObjectivePlanById = new Map(
      annualObjectivePlans
        .filter((plan) => plan.ownerType === "workplace" && plan.workplaceId)
        .map((plan) => [plan.workplaceId!, plan])
    );
    const employeeObjectivePlanById = new Map(
      annualObjectivePlans
        .filter((plan) => plan.ownerType === "employee" && plan.employeeId)
        .map((plan) => [plan.employeeId!, plan])
    );
    const metricsByWorkplace = new Map(
      existingWorkplaceMetrics.map((metric) => [
        metric.workplaceId,
        metric,
      ])
    );
    const changedWorkplaceIds = new Set<Id<"workplaces">>();
    for (const entry of args.workplaceEntries) {
      if (!workplaceIds.has(entry.workplaceId)) {
        throw new Error("Lieu de travail introuvable");
      }
      const existing = metricsByWorkplace.get(entry.workplaceId);
      const objectivePlan = workplaceObjectivePlanById.get(entry.workplaceId);
      if (entry.objective === null && entry.realisation === null) {
        if (entry.recoveryObjective !== null || entry.recouvrement !== null) {
          throw new Error(
            "Saisissez d'abord l'objectif et la réalisation du lieu de travail"
          );
        }
        if (existing) {
          await ctx.db.delete(existing._id);
          metricsByWorkplace.delete(entry.workplaceId);
          changedWorkplaceIds.add(entry.workplaceId);
        }
        if (objectivePlan) await ctx.db.delete(objectivePlan._id);
        continue;
      }
      if (
        entry.objective === null ||
        entry.realisation === null ||
        !Number.isFinite(entry.objective) ||
        entry.objective <= 0 ||
        !Number.isFinite(entry.realisation) ||
        entry.realisation < 0
      ) {
        throw new Error(
          "Chaque lieu saisi doit avoir un objectif positif et une réalisation valide"
        );
      }
      const hasRecoveryObjective = entry.recoveryObjective !== null;
      const hasRecovery = entry.recouvrement !== null;
      if (
        hasRecoveryObjective !== hasRecovery ||
        (hasRecoveryObjective &&
          (!Number.isFinite(entry.recoveryObjective) ||
            entry.recoveryObjective! <= 0 ||
            !Number.isFinite(entry.recouvrement)))
      ) {
        throw new Error(
          "Saisissez un objectif de recouvrement positif et son montant réalisé, ou laissez les deux vides"
        );
      }

      const payload = {
        workplaceId: entry.workplaceId,
        month: args.month,
        year: args.year,
        objective: entry.objective,
        realisation: entry.realisation,
        recoveryObjective: entry.recoveryObjective ?? undefined,
        recouvrement: entry.recouvrement ?? undefined,
        updatedAt: now,
        updatedBy: admin._id,
      };
      if (
        !existing ||
        existing.objective !== payload.objective ||
        existing.realisation !== payload.realisation ||
        existing.recoveryObjective !== payload.recoveryObjective ||
        existing.recouvrement !== payload.recouvrement
      ) {
        changedWorkplaceIds.add(entry.workplaceId);
      }
      if (existing) {
        await ctx.db.patch(existing._id, payload);
        metricsByWorkplace.set(entry.workplaceId, {
          ...existing,
          ...payload,
        });
      } else {
        const id = await ctx.db.insert("workplacePrimeMetrics", payload);
        const inserted = await ctx.db.get(id);
        if (inserted) metricsByWorkplace.set(entry.workplaceId, inserted);
      }
      if (objectivePlan) {
        await ctx.db.patch(objectivePlan._id, {
          objective: entry.objective,
          updatedAt: now,
          updatedBy: admin._id,
        });
      }
    }

    const companyRealisationRatio = await companyRealisationRatioForMonth(
      ctx,
      args.year,
      args.month
    );
    const changedMetricOwnerIds = new Set<Id<"users">>();
    for (const entry of args.entries) {
      const employee = employeeById.get(entry.employeeId);
      if (!employee) throw new Error("Employé introuvable ou inactif");
      if (employee.role === "employee" && (employee.baseBonus ?? 0) <= 0) {
        throw new Error(
          `Définissez une prime de base positive pour ${employee.name}`
        );
      }
      if (
        entry.objective <= 0 ||
        (employee.role === "employee" && entry.recoveryObjective <= 0)
      ) {
        throw new Error(
          `Les objectifs de réalisation et de recouvrement doivent être supérieurs à zéro pour ${employee.name}`
        );
      }
      if (
        entry.realisation < 0 ||
        entry.recoveryObjective < 0 ||
        !Number.isFinite(entry.objective) ||
        !Number.isFinite(entry.realisation) ||
        !Number.isFinite(entry.recoveryObjective) ||
        !Number.isFinite(entry.recouvrement)
      ) {
        throw new Error(`Valeurs de prime invalides pour ${employee.name}`);
      }

      const existing = calculationByEmployee.get(entry.employeeId);
      const objectivePlan = employeeObjectivePlanById.get(entry.employeeId);
      if (
        !existing ||
        existing.objective !== entry.objective ||
        existing.realisation !== entry.realisation ||
        existing.recoveryObjective !== entry.recoveryObjective ||
        existing.recouvrement !== entry.recouvrement ||
        existing.hasOwnMetrics !== true
      ) {
        changedMetricOwnerIds.add(entry.employeeId);
      }

      const evaluationPercent = await evaluationPercentForMonth(
        ctx,
        employee._id,
        args.year,
        args.month
      );
      const primeWeights = await primeWeightsForEmployee(ctx, employee);
      const effectiveCompanyRealisationRatio = requiredCompanyRealisationRatio(
        companyRealisationRatio,
        primeWeights.companyRealisationWeightPercent
      );
      const computed = computeBasePrime({
        basePrime: employee.role === "employee" ? employee.baseBonus ?? 0 : 0,
        objective: entry.objective,
        realisation: entry.realisation,
        companyRealisationRatio: effectiveCompanyRealisationRatio,
        recoveryObjective: entry.recoveryObjective,
        recouvrement: entry.recouvrement,
        evaluationPercent,
        applyRecoveryAdjustment: employee.role === "employee",
        ...primeWeights,
      });
      const inputsUnchanged =
        existing?.status === "CONFIRME" &&
        existing.hasOwnMetrics === true &&
        existing.objective === entry.objective &&
        existing.realisation === entry.realisation &&
        existing.recoveryObjective === entry.recoveryObjective &&
        existing.recouvrement === entry.recouvrement &&
        existing.evaluationPercent === computed.evaluationPercent &&
        existing.companyRealisationRatio ===
          computed.companyRealisationRatio &&
        existing.objectiveWeightPercent ===
          computed.objectiveWeightPercent &&
        existing.evaluationWeightPercent ===
          computed.evaluationWeightPercent &&
        existing.companyRealisationWeightPercent ===
          computed.companyRealisationWeightPercent;
      const payload = {
        employeeId: employee._id,
        month: args.month,
        year: args.year,
        objective: entry.objective,
        realisation: entry.realisation,
        recoveryObjective: entry.recoveryObjective,
        recouvrement: entry.recouvrement,
        hasOwnMetrics: true,
        sourceManagerId: undefined,
        sourceWorkplaceId: undefined,
        ...computed,
        adminAdjustedAmount:
          inputsUnchanged && existing?.adminAdjustedAmount !== undefined
            ? existing.adminAdjustedAmount
            : undefined,
        totalAmount:
          inputsUnchanged && existing?.adminAdjustedAmount !== undefined
            ? existing.adminAdjustedAmount
            : computed.totalAmount,
        calculationVersion: 2,
        status: inputsUnchanged ? ("CONFIRME" as const) : ("BROUILLON" as const),
        updatedAt: now,
      };

      if (existing) {
        await ctx.db.patch(existing._id, payload);
        calculationByEmployee.set(entry.employeeId, {
          ...existing,
          ...payload,
        });
      } else {
        const id = await ctx.db.insert("primeCalculations", {
          ...payload,
          createdAt: now,
        });
        const inserted = await ctx.db.get(id);
        if (inserted) calculationByEmployee.set(entry.employeeId, inserted);
      }
      if (objectivePlan) {
        await ctx.db.patch(objectivePlan._id, {
          objective: entry.objective,
          updatedAt: now,
          updatedBy: admin._id,
        });
      }
    }

    for (const employee of metricOwners) {
      if (selectedIds.has(employee._id)) continue;
      const existing = calculationByEmployee.get(employee._id);
      if (existing?.hasOwnMetrics === true) {
        changedMetricOwnerIds.add(employee._id);
        const demoted = {
          ...existing,
          hasOwnMetrics: false,
          adminAdjustedAmount: undefined,
          totalAmount: existing.totalAmount,
          status: "BROUILLON" as const,
          sourceManagerId: undefined,
          sourceWorkplaceId: undefined,
          updatedAt: now,
        };
        await ctx.db.patch(existing._id, {
          hasOwnMetrics: false,
          adminAdjustedAmount: undefined,
          status: "BROUILLON",
          sourceManagerId: undefined,
          sourceWorkplaceId: undefined,
          updatedAt: now,
        });
        calculationByEmployee.set(employee._id, demoted);
      }
    }

    for (const employee of employees) {
      if (selectedIds.has(employee._id)) continue;

      const existing = calculationByEmployee.get(employee._id);
      const primeWeights = await primeWeightsForEmployee(ctx, employee);
      const confirmedSourceChanged =
        existing?.status === "CONFIRME" &&
        existing.hasOwnMetrics === false &&
        ((existing.sourceWorkplaceId !== undefined &&
          changedWorkplaceIds.has(existing.sourceWorkplaceId)) ||
          (existing.sourceManagerId !== undefined &&
            changedMetricOwnerIds.has(existing.sourceManagerId)) ||
          existing.objectiveWeightPercent !==
            primeWeights.realisationWeightPercent ||
          existing.evaluationWeightPercent !==
            primeWeights.evaluationWeightPercent ||
          existing.companyRealisationWeightPercent !==
            primeWeights.companyRealisationWeightPercent ||
          existing.companyRealisationRatio !==
            requiredCompanyRealisationRatio(
              companyRealisationRatio,
              primeWeights.companyRealisationWeightPercent
            ));
      if (existing?.status === "CONFIRME" && !confirmedSourceChanged) continue;
      if ((employee.baseBonus ?? 0) <= 0) {
        if (existing) {
          await ctx.db.delete(existing._id);
          calculationByEmployee.delete(employee._id);
        }
        continue;
      }

      const workplaceMetric = employee.workplaceId
        ? metricsByWorkplace.get(employee.workplaceId)
        : undefined;
      let source:
        | {
            objective: number;
            realisation: number;
            recoveryObjective?: number;
            recouvrement?: number;
            sourceWorkplaceId?: Id<"workplaces">;
            sourceManagerId?: Id<"users">;
            applyRecoveryAdjustment: boolean;
          }
        | undefined;

      if (workplaceMetric) {
        const showroomResponsible = isShowroomResponsible(employee.department);
        if (
          !showroomResponsible ||
          (workplaceMetric.recoveryObjective !== undefined &&
            workplaceMetric.recouvrement !== undefined)
        ) {
          source = {
            objective: workplaceMetric.objective,
            realisation: workplaceMetric.realisation,
            recoveryObjective: showroomResponsible
              ? workplaceMetric.recoveryObjective
              : undefined,
            recouvrement: showroomResponsible
              ? workplaceMetric.recouvrement
              : undefined,
            sourceWorkplaceId: workplaceMetric.workplaceId,
            applyRecoveryAdjustment: showroomResponsible,
          };
        }
      } else {
        const managerCalculation = employee.managerId
          ? calculationByEmployee.get(employee.managerId)
          : undefined;
        if (
          managerCalculation?.calculationVersion === 2 &&
          managerCalculation.hasOwnMetrics === true
        ) {
          source = {
            objective: managerCalculation.objective,
            realisation: managerCalculation.realisation,
            sourceManagerId: employee.managerId,
            applyRecoveryAdjustment: false,
          };
        }
      }

      if (!source) {
        if (existing && existing.status === "BROUILLON") {
          await ctx.db.delete(existing._id);
          calculationByEmployee.delete(employee._id);
        }
        continue;
      }

      const updated = await upsertInheritedDraft(
        ctx,
        employee,
        args,
        existing,
        source,
        companyRealisationRatio,
        now
      );
      calculationByEmployee.set(employee._id, updated);
    }

    const blocked = employees.filter((employee) => {
      if (selectedIds.has(employee._id)) return false;
      const calculation = calculationByEmployee.get(employee._id);
      return calculation?.calculationVersion !== 2;
    }).length;

    return {
      selected: selectedIds.size,
      inherited: employees.filter((employee) => {
        const calculation = calculationByEmployee.get(employee._id);
        return (
          !selectedIds.has(employee._id) &&
          calculation?.calculationVersion === 2 &&
          calculation.hasOwnMetrics === false
        );
      }).length,
      blocked,
    };
  },
});

export const confirmBatch = mutation({
  args: {
    token: v.string(),
    calculationIds: v.array(v.id("primeCalculations")),
    amountAdjustments: v.optional(
      v.array(
        v.object({
          calculationId: v.id("primeCalculations"),
          amount: v.number(),
        })
      )
    ),
  },
  handler: async (ctx, args) => {
    const admin = await requireAdminPage(ctx, args.token, "admin-primes");
    const calculationIds = new Set(args.calculationIds);
    const adjustmentByCalculation = new Map(
      (args.amountAdjustments ?? []).map((adjustment) => [
        adjustment.calculationId,
        adjustment.amount,
      ])
    );
    if (
      adjustmentByCalculation.size !== (args.amountAdjustments ?? []).length ||
      [...adjustmentByCalculation.keys()].some(
        (id) => !calculationIds.has(id)
      )
    ) {
      throw new Error("Les montants modifiés ne correspondent pas aux primes");
    }
    for (const amount of adjustmentByCalculation.values()) {
      if (!Number.isFinite(amount) || amount < 0) {
        throw new Error("Le montant d'une prime doit être positif ou nul");
      }
    }
    let confirmed = 0;
    const companyRatioByPeriod = new Map<string, number | null>();

    for (const calculationId of args.calculationIds) {
      const row = await ctx.db.get(calculationId);
      const adjustedAmount = adjustmentByCalculation.get(calculationId);
      if (
        !row ||
        (row.status === "CONFIRME" &&
          (adjustedAmount === undefined ||
            adjustedAmount === row.totalAmount))
      ) {
        continue;
      }
      if (row.calculationVersion !== 2) {
        throw new Error("Recalculez cette prime avec la nouvelle formule");
      }

      const employee = await ctx.db.get(row.employeeId);
      if (!employee || employee.role !== "employee" || employee.resignedAt) {
        continue;
      }
      if ((employee.baseBonus ?? 0) <= 0) {
        throw new Error(
          `Définissez une prime de base positive pour ${employee.name}`
        );
      }
      const applyRecoveryAdjustment =
        row.hasOwnMetrics === true ||
        (row.sourceWorkplaceId !== undefined &&
          isShowroomResponsible(employee.department));
      if (
        applyRecoveryAdjustment &&
        (!row.recoveryObjective || row.recoveryObjective <= 0)
      ) {
        throw new Error(
          `Objectif de recouvrement manquant pour ${employee.name}`
        );
      }

      const evaluationPercent = await evaluationPercentForMonth(
        ctx,
        employee._id,
        row.year,
        row.month
      );
      const periodKey = `${row.year}-${row.month}`;
      if (!companyRatioByPeriod.has(periodKey)) {
        companyRatioByPeriod.set(
          periodKey,
          await companyRealisationRatioForMonth(ctx, row.year, row.month)
        );
      }
      const primeWeights = await primeWeightsForEmployee(ctx, employee);
      const companyRealisationRatio = requiredCompanyRealisationRatio(
        companyRatioByPeriod.get(periodKey) ?? null,
        primeWeights.companyRealisationWeightPercent
      );
      const computed = computeBasePrime({
        basePrime: employee.baseBonus ?? 0,
        objective: row.objective,
        realisation: row.realisation,
        companyRealisationRatio,
        recoveryObjective: row.recoveryObjective ?? 0,
        recouvrement: row.recouvrement,
        evaluationPercent,
        applyRecoveryAdjustment,
        ...primeWeights,
      });
      const finalComputed = {
        ...computed,
        totalAmount:
          adjustedAmount ?? row.adminAdjustedAmount ?? computed.totalAmount,
      };

      const sourceManager = row.sourceManagerId
        ? await ctx.db.get(row.sourceManagerId)
        : null;
      const sourceWorkplace = row.sourceWorkplaceId
        ? await ctx.db.get(row.sourceWorkplaceId)
        : null;
      const title = `Prime mensuelle ${row.month}/${row.year}`;
      const reason = [
        `Base ${computed.primeBase.toLocaleString("fr-DZ")} DZD`,
        `Réalisation ${(computed.objectiveRatio * 100).toFixed(1)}% → ${computed.objectiveAmount.toLocaleString("fr-DZ")}`,
        ...(computed.companyRealisationWeightPercent > 0
          ? [
              `Réalisation entreprise ${(computed.companyRealisationRatio * 100).toFixed(1)}% → ${computed.companyRealisationAmount.toLocaleString("fr-DZ")}`,
            ]
          : []),
        ...(applyRecoveryAdjustment
          ? [
              `Recouvrement ${(computed.recoveryRatio * 100).toFixed(1)}% → ${computed.recoveryAmount.toLocaleString("fr-DZ")}`,
            ]
          : row.sourceWorkplaceId
            ? [
                `Objectif et réalisation du lieu ${sourceWorkplace?.name ?? ""}`,
              ]
            : [
                `Objectif et réalisation du manager ${sourceManager?.name ?? ""}`,
              ]),
        `Évaluation ${computed.evaluationPercent}% → ${computed.evaluationAmount.toLocaleString("fr-DZ")}`,
        ...(finalComputed.totalAmount !== computed.totalAmount
          ? [
              `Montant ajusté par l'admin : ${finalComputed.totalAmount.toLocaleString("fr-DZ")} DZD`,
            ]
          : []),
      ].join(" · ");

      let bonusId = row.bonusId;
      if (finalComputed.totalAmount > 0) {
        if (bonusId && (await ctx.db.get(bonusId))) {
          await ctx.db.patch(bonusId, {
            amount: finalComputed.totalAmount,
            title,
            reason,
            attributedAt: Date.now(),
            month: row.month,
            year: row.year,
          });
        } else {
          bonusId = await ctx.db.insert("bonuses", {
            employeeId: row.employeeId,
            amount: finalComputed.totalAmount,
            title,
            reason,
            attributedAt: Date.now(),
            month: row.month,
            year: row.year,
          });
        }
      } else if (bonusId && (await ctx.db.get(bonusId))) {
        await ctx.db.delete(bonusId);
        bonusId = undefined;
      }

      await ctx.db.patch(calculationId, {
        ...finalComputed,
        adminAdjustedAmount:
          adjustedAmount ?? row.adminAdjustedAmount ?? undefined,
        calculationVersion: 2,
        status: "CONFIRME",
        bonusId: finalComputed.totalAmount > 0 ? bonusId : undefined,
        confirmedAt: Date.now(),
        confirmedBy: admin._id,
        updatedAt: Date.now(),
      });

      await notify(
        ctx,
        row.employeeId,
        "Prime mensuelle confirmée",
        `${finalComputed.totalAmount.toLocaleString("fr-DZ")} DZD ajoutés à votre solde pour ${row.month}/${row.year}.`
      );
      confirmed += 1;
    }
    return { confirmed };
  },
});
