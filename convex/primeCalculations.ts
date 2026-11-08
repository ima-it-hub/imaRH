import { mutation, query, MutationCtx, QueryCtx } from "./_generated/server";
import { v } from "convex/values";
import { Doc, Id } from "./_generated/dataModel";
import { computeBasePrime, notify, publicUser, requireAdmin } from "./lib";

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
  now: number
) {
  const evaluationPercent = await evaluationPercentForMonth(
    ctx,
    employee._id,
    args.year,
    args.month
  );
  const computed = computeBasePrime({
    basePrime: employee.baseBonus ?? 0,
    objective: source.objective,
    realisation: source.realisation,
    recoveryObjective: source.recoveryObjective ?? 0,
    recouvrement: source.recouvrement ?? 0,
    evaluationPercent,
    applyRecoveryAdjustment: source.applyRecoveryAdjustment,
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
    calculationVersion: 2,
    status: "BROUILLON" as const,
    bonusId: undefined,
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
    await requireAdmin(ctx, args.token);
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
        calculation: calculationByEmployee.get(employee._id) ?? null,
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
    await requireAdmin(ctx, args.token);
    const [workplaces, metrics] = await Promise.all([
      ctx.db.query("workplaces").collect(),
      ctx.db
        .query("workplacePrimeMetrics")
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
    const previousMetricByWorkplace = new Map(
      previousMetrics.map((metric) => [metric.workplaceId, metric])
    );
    return workplaces
      .map((workplace) => ({
        workplace,
        metrics: metricByWorkplace.get(workplace._id) ?? null,
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
      }))
      .sort((a, b) => a.workplace.name.localeCompare(b.workplace.name));
  },
});

export const syncInheritedDrafts = mutation({
  args: {
    token: v.string(),
    month: v.number(),
    year: v.number(),
  },
  handler: async (ctx, args) => {
    await requireAdmin(ctx, args.token);
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
    const admin = await requireAdmin(ctx, args.token);

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
    const metricsByWorkplace = new Map(
      existingWorkplaceMetrics.map((metric) => [
        metric.workplaceId,
        metric,
      ])
    );
    for (const entry of args.workplaceEntries) {
      if (!workplaceIds.has(entry.workplaceId)) {
        throw new Error("Lieu de travail introuvable");
      }
      const existing = metricsByWorkplace.get(entry.workplaceId);
      if (entry.objective === null && entry.realisation === null) {
        if (entry.recoveryObjective !== null || entry.recouvrement !== null) {
          throw new Error(
            "Saisissez d'abord l'objectif et la réalisation du lieu de travail"
          );
        }
        if (existing) {
          await ctx.db.delete(existing._id);
          metricsByWorkplace.delete(entry.workplaceId);
        }
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
            !Number.isFinite(entry.recouvrement) ||
            entry.recouvrement! < 0))
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
    }

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
        entry.recouvrement < 0 ||
        !Number.isFinite(entry.objective) ||
        !Number.isFinite(entry.realisation) ||
        !Number.isFinite(entry.recoveryObjective) ||
        !Number.isFinite(entry.recouvrement)
      ) {
        throw new Error(`Valeurs de prime invalides pour ${employee.name}`);
      }

      const existing = calculationByEmployee.get(entry.employeeId);
      if (existing?.status === "CONFIRME") {
        throw new Error(`La prime de ${employee.name} est déjà confirmée`);
      }

      const evaluationPercent = await evaluationPercentForMonth(
        ctx,
        employee._id,
        args.year,
        args.month
      );
      const computed = computeBasePrime({
        basePrime: employee.role === "employee" ? employee.baseBonus ?? 0 : 0,
        objective: entry.objective,
        realisation: entry.realisation,
        recoveryObjective: entry.recoveryObjective,
        recouvrement: entry.recouvrement,
        evaluationPercent,
        applyRecoveryAdjustment: employee.role === "employee",
      });
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
        calculationVersion: 2,
        status: "BROUILLON" as const,
        bonusId: undefined,
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
    }

    for (const employee of metricOwners) {
      if (selectedIds.has(employee._id)) continue;
      const existing = calculationByEmployee.get(employee._id);
      if (
        existing?.status === "BROUILLON" &&
        existing.hasOwnMetrics === true
      ) {
        const demoted = {
          ...existing,
          hasOwnMetrics: false,
          sourceManagerId: undefined,
          sourceWorkplaceId: undefined,
          updatedAt: now,
        };
        await ctx.db.patch(existing._id, {
          hasOwnMetrics: false,
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
      if (existing?.status === "CONFIRME") continue;
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
  },
  handler: async (ctx, args) => {
    const admin = await requireAdmin(ctx, args.token);
    let confirmed = 0;

    for (const calculationId of args.calculationIds) {
      const row = await ctx.db.get(calculationId);
      if (!row || row.status === "CONFIRME") continue;
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
      const computed = computeBasePrime({
        basePrime: employee.baseBonus ?? 0,
        objective: row.objective,
        realisation: row.realisation,
        recoveryObjective: row.recoveryObjective ?? 0,
        recouvrement: row.recouvrement,
        evaluationPercent,
        applyRecoveryAdjustment,
      });

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
      ].join(" · ");

      let bonusId = row.bonusId;
      if (computed.totalAmount > 0) {
        if (bonusId && (await ctx.db.get(bonusId))) {
          await ctx.db.patch(bonusId, {
            amount: computed.totalAmount,
            title,
            reason,
            attributedAt: Date.now(),
            month: row.month,
            year: row.year,
          });
        } else {
          bonusId = await ctx.db.insert("bonuses", {
            employeeId: row.employeeId,
            amount: computed.totalAmount,
            title,
            reason,
            attributedAt: Date.now(),
            month: row.month,
            year: row.year,
          });
        }
      }

      await ctx.db.patch(calculationId, {
        ...computed,
        calculationVersion: 2,
        status: "CONFIRME",
        bonusId: computed.totalAmount > 0 ? bonusId : undefined,
        confirmedAt: Date.now(),
        confirmedBy: admin._id,
        updatedAt: Date.now(),
      });

      await notify(
        ctx,
        row.employeeId,
        "Prime mensuelle confirmée",
        `${computed.totalAmount.toLocaleString("fr-DZ")} DZD ajoutés à votre solde pour ${row.month}/${row.year}.`
      );
      confirmed += 1;
    }
    return { confirmed };
  },
});
