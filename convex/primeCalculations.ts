import { mutation, query, MutationCtx, QueryCtx } from "./_generated/server";
import { v } from "convex/values";
import { Id } from "./_generated/dataModel";
import {
  computePercentagePrime,
  getSettings,
  notify,
  publicUser,
  requireAdmin,
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

export const percentageEmployeesForMonth = query({
  args: {
    token: v.string(),
    month: v.number(),
    year: v.number(),
  },
  handler: async (ctx, args) => {
    await requireAdmin(ctx, args.token);
    const settings = await getSettings(ctx);
    const users = await ctx.db.query("users").collect();
    const employees = users.filter(
      (u) =>
        u.role === "employee" &&
        u.isActive &&
        !u.resignedAt &&
        (u.bonusType ?? "FIXED") === "PERCENTAGE"
    );

    const result = [];
    for (const emp of employees) {
      const calc = await ctx.db
        .query("primeCalculations")
        .withIndex("by_employee_period", (q) =>
          q
            .eq("employeeId", emp._id)
            .eq("year", args.year)
            .eq("month", args.month)
        )
        .unique();

      const evaluationPercent = await evaluationPercentForMonth(
        ctx,
        emp._id,
        args.year,
        args.month
      );

      result.push({
        employee: publicUser(emp),
        calculation: calc
          ? {
              ...calc,
            }
          : null,
        evaluationPercent,
        weights: {
          objective: settings.primeObjectiveWeightPercent,
          recovery: settings.primeRecoveryWeightPercent,
          evaluation: settings.primeEvaluationWeightPercent,
        },
      });
    }

    return result.sort((a, b) =>
      a.employee.name.localeCompare(b.employee.name)
    );
  },
});

export const saveDraft = mutation({
  args: {
    token: v.string(),
    employeeId: v.id("users"),
    month: v.number(),
    year: v.number(),
    objective: v.number(),
    realisation: v.number(),
    recouvrement: v.number(),
  },
  handler: async (ctx, args) => {
    await requireAdmin(ctx, args.token);
    const employee = await ctx.db.get(args.employeeId);
    if (!employee || employee.role !== "employee") {
      throw new Error("Employé introuvable");
    }
    if ((employee.bonusType ?? "FIXED") !== "PERCENTAGE") {
      throw new Error("Cet employé n'a pas une prime en pourcentage");
    }
    if ((employee.bonusPercent ?? 0) <= 0) {
      throw new Error("Pourcentage de prime non défini pour cet employé");
    }

    const existing = await ctx.db
      .query("primeCalculations")
      .withIndex("by_employee_period", (q) =>
        q
          .eq("employeeId", args.employeeId)
          .eq("year", args.year)
          .eq("month", args.month)
      )
      .unique();

    if (existing?.status === "CONFIRME") {
      throw new Error("Prime déjà confirmée — impossible de modifier");
    }

    const settings = await getSettings(ctx);
    const evaluationPercent = await evaluationPercentForMonth(
      ctx,
      args.employeeId,
      args.year,
      args.month
    );

    const computed = computePercentagePrime({
      realisation: args.realisation,
      objective: args.objective,
      recouvrement: args.recouvrement,
      employeeBonusPercent: employee.bonusPercent ?? 0,
      evaluationPercent,
      objectiveWeightPercent: settings.primeObjectiveWeightPercent,
      recoveryWeightPercent: settings.primeRecoveryWeightPercent,
      evaluationWeightPercent: settings.primeEvaluationWeightPercent,
    });

    const now = Date.now();
    const payload = {
      employeeId: args.employeeId,
      month: args.month,
      year: args.year,
      objective: Math.max(0, args.objective),
      realisation: Math.max(0, args.realisation),
      recouvrement: Math.max(0, args.recouvrement),
      ...computed,
      status: "BROUILLON" as const,
      updatedAt: now,
    };

    if (existing) {
      await ctx.db.patch(existing._id, payload);
      return await ctx.db.get(existing._id);
    }

    const id = await ctx.db.insert("primeCalculations", {
      ...payload,
      createdAt: now,
    });
    return await ctx.db.get(id);
  },
});

export const confirm = mutation({
  args: {
    token: v.string(),
    calculationId: v.id("primeCalculations"),
  },
  handler: async (ctx, args) => {
    const admin = await requireAdmin(ctx, args.token);
    const row = await ctx.db.get(args.calculationId);
    if (!row) throw new Error("Calcul introuvable");
    if (row.status === "CONFIRME") {
      throw new Error("Déjà confirmé");
    }
    if (row.totalAmount <= 0) {
      throw new Error("Montant de prime invalide");
    }

    // Refresh evaluation % in case manager confirmed after draft
    const employee = await ctx.db.get(row.employeeId);
    if (!employee) throw new Error("Employé introuvable");
    const settings = await getSettings(ctx);
    const evaluationPercent = await evaluationPercentForMonth(
      ctx,
      row.employeeId,
      row.year,
      row.month
    );
    const computed = computePercentagePrime({
      realisation: row.realisation,
      objective: row.objective,
      recouvrement: row.recouvrement,
      employeeBonusPercent: employee.bonusPercent ?? row.employeeBonusPercent,
      evaluationPercent,
      objectiveWeightPercent: settings.primeObjectiveWeightPercent,
      recoveryWeightPercent: settings.primeRecoveryWeightPercent,
      evaluationWeightPercent: settings.primeEvaluationWeightPercent,
    });

    const title = `Prime commerciale ${row.month}/${row.year}`;
    const reason = [
      `Prime base ${computed.primeBase.toLocaleString("fr-DZ")} DZD (${row.employeeBonusPercent}% × réalisation)`,
      `Objectif ${(computed.objectiveRatio * 100).toFixed(0)}% → ${computed.objectiveAmount.toLocaleString("fr-DZ")}`,
      `Recouvrement ${(computed.recoveryRatio * 100).toFixed(0)}% → ${computed.recoveryAmount.toLocaleString("fr-DZ")}`,
      `Évaluation ${computed.evaluationPercent}% → ${computed.evaluationAmount.toLocaleString("fr-DZ")}`,
    ].join(" · ");

    let bonusId = row.bonusId;
    if (bonusId) {
      const bonus = await ctx.db.get(bonusId);
      if (bonus) {
        await ctx.db.patch(bonusId, {
          amount: computed.totalAmount,
          title,
          reason,
          attributedAt: Date.now(),
          month: row.month,
          year: row.year,
        });
      } else {
        bonusId = undefined;
      }
    }
    if (!bonusId) {
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

    await ctx.db.patch(args.calculationId, {
      ...computed,
      status: "CONFIRME",
      bonusId,
      confirmedAt: Date.now(),
      confirmedBy: admin._id,
      updatedAt: Date.now(),
    });

    await notify(
      ctx,
      row.employeeId,
      "Prime commerciale confirmée",
      `${computed.totalAmount.toLocaleString("fr-DZ")} DZD ajoutés à votre solde pour ${row.month}/${row.year}.`
    );

    return await ctx.db.get(args.calculationId);
  },
});

export const confirmBatch = mutation({
  args: {
    token: v.string(),
    entries: v.array(
      v.object({
        calculationId: v.id("primeCalculations"),
        /** Optional admin override of calculated total */
        totalAmount: v.optional(v.number()),
      })
    ),
  },
  handler: async (ctx, args) => {
    const admin = await requireAdmin(ctx, args.token);
    let confirmed = 0;
    for (const entry of args.entries) {
      const row = await ctx.db.get(entry.calculationId);
      if (!row || row.status === "CONFIRME") continue;

      const employee = await ctx.db.get(row.employeeId);
      if (!employee) continue;
      const settings = await getSettings(ctx);
      const evaluationPercent = await evaluationPercentForMonth(
        ctx,
        row.employeeId,
        row.year,
        row.month
      );
      const computed = computePercentagePrime({
        realisation: row.realisation,
        objective: row.objective,
        recouvrement: row.recouvrement,
        employeeBonusPercent: employee.bonusPercent ?? row.employeeBonusPercent,
        evaluationPercent,
        objectiveWeightPercent: settings.primeObjectiveWeightPercent,
        recoveryWeightPercent: settings.primeRecoveryWeightPercent,
        evaluationWeightPercent: settings.primeEvaluationWeightPercent,
      });

      const totalAmount =
        entry.totalAmount !== undefined
          ? Math.max(0, Math.round(entry.totalAmount))
          : computed.totalAmount;
      if (totalAmount <= 0) continue;

      const title = `Prime commerciale ${row.month}/${row.year}`;
      const reason = `Obj ${(computed.objectiveRatio * 100).toFixed(0)}% + Rec ${(computed.recoveryRatio * 100).toFixed(0)}% + Éval ${computed.evaluationPercent}%`;

      let bonusId = row.bonusId;
      if (bonusId) {
        const bonus = await ctx.db.get(bonusId);
        if (bonus) {
          await ctx.db.patch(bonusId, {
            amount: totalAmount,
            title,
            reason,
            attributedAt: Date.now(),
            month: row.month,
            year: row.year,
          });
        } else {
          bonusId = undefined;
        }
      }
      if (!bonusId) {
        bonusId = await ctx.db.insert("bonuses", {
          employeeId: row.employeeId,
          amount: totalAmount,
          title,
          reason,
          attributedAt: Date.now(),
          month: row.month,
          year: row.year,
        });
      }

      await ctx.db.patch(entry.calculationId, {
        ...computed,
        totalAmount,
        status: "CONFIRME",
        bonusId,
        confirmedAt: Date.now(),
        confirmedBy: admin._id,
        updatedAt: Date.now(),
      });

      await notify(
        ctx,
        row.employeeId,
        "Prime commerciale confirmée",
        `${totalAmount.toLocaleString("fr-DZ")} DZD ajoutés à votre solde pour ${row.month}/${row.year}.`
      );
      confirmed += 1;
    }
    return { confirmed };
  },
});
