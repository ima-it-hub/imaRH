"use client";

import { useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { api } from "../../../../../convex/_generated/api";
import type { Id } from "../../../../../convex/_generated/dataModel";
import { PageShell } from "@/components/PageShell";
import { RequireAuth } from "@/components/RequireAuth";
import { Badge, Card, PrimaryButton, inputClass } from "@/components/ui";
import { useAuth } from "@/lib/auth";
import {
  formatTime,
  moneyDZD,
  statusBadgeClass,
  todayISOLocal,
} from "@/lib/format";

type MonthlyMetricDraft = {
  morningLateMinutes: string;
  breakLateMinutes: string;
  missingScans: string;
};

export default function AdminPointagesPage() {
  const { token } = useAuth();
  const [date, setDate] = useState(todayISOLocal());
  const rows = useQuery(
    api.attendance.listByDate,
    token ? { token, date } : "skip"
  );
  const [monthPeriod, setMonthPeriod] = useState(() =>
    todayISOLocal().slice(0, 7)
  );
  const [deductionDrafts, setDeductionDrafts] = useState<
    Record<string, string>
  >({});
  const [monthlyMetricDrafts, setMonthlyMetricDrafts] = useState<
    Record<
      string,
      {
        morningLateMinutes: string;
        breakLateMinutes: string;
        missingScans: string;
      }
    >
  >({});
  const [savingDeductionId, setSavingDeductionId] = useState<string | null>(
    null
  );
  const [deductionMsg, setDeductionMsg] = useState("");
  const [deductionError, setDeductionError] = useState("");
  const [periodYear, periodMonth] = monthPeriod.split("-").map(Number);
  const monthlyDeductions = useQuery(
    api.attendance.monthlyLateDeductionsForAdmin,
    token && periodYear && periodMonth
      ? { token, year: periodYear, month: periodMonth }
      : "skip"
  );
  const approveMonthlyDeduction = useMutation(
    api.attendance.approveMonthlyLateDeduction
  );
  const adjust = useMutation(api.attendance.adjustLateMinutes);
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [msg, setMsg] = useState("");

  function updateMonthlyMetrics(
    draftKey: string,
    metrics: MonthlyMetricDraft
  ) {
    setMonthlyMetricDrafts((drafts) => ({ ...drafts, [draftKey]: metrics }));
    setDeductionDrafts((drafts) => {
      const next = { ...drafts };
      delete next[draftKey];
      return next;
    });
  }

  async function save(attendanceId: Id<"attendances">, currentLate: number) {
    if (!token) return;
    const value = Number(drafts[attendanceId] ?? String(currentLate));
    await adjust({ token, attendanceId, lateMinutes: value });
    setMsg("Retard mis à jour — montant calculé recalculé");
  }

  async function saveMonthlyDeduction(
    employeeId: Id<"users">,
    currentAmount: number,
    currentMorningLateMinutes: number,
    currentBreakLateMinutes: number,
    currentMissingScans: number
  ) {
    if (!token || !periodYear || !periodMonth) return;
    const draftKey = `${monthPeriod}:${employeeId}`;
    const amount = Number(deductionDrafts[draftKey] ?? String(currentAmount));
    const metrics = monthlyMetricDrafts[draftKey];
    const morningLateMinutes = Number(
      metrics?.morningLateMinutes ?? currentMorningLateMinutes
    );
    const breakLateMinutes = Number(
      metrics?.breakLateMinutes ?? currentBreakLateMinutes
    );
    const missingScans = Number(
      metrics?.missingScans ?? currentMissingScans
    );
    if (
      !Number.isInteger(morningLateMinutes) ||
      morningLateMinutes < 0 ||
      !Number.isInteger(breakLateMinutes) ||
      breakLateMinutes < 0 ||
      !Number.isInteger(missingScans) ||
      missingScans < 0 ||
      !Number.isFinite(amount) ||
      amount < 0
    ) {
      setDeductionError("Saisissez des totaux et un montant valides.");
      return;
    }
    setSavingDeductionId(employeeId);
    setDeductionMsg("");
    setDeductionError("");
    try {
      await approveMonthlyDeduction({
        token,
        employeeId,
        year: periodYear,
        month: periodMonth,
        amount,
        morningLateMinutes,
        breakLateMinutes,
        missingScans,
      });
      setDeductionDrafts((drafts) => ({
        ...drafts,
        [`${monthPeriod}:${employeeId}`]: String(amount),
      }));
      setDeductionMsg("Retenue mensuelle validée et ajoutée au solde.");
    } catch (err) {
      setDeductionError(err instanceof Error ? err.message : "Erreur");
    } finally {
      setSavingDeductionId(null);
    }
  }

  const calculatedDeductionTotal = (monthlyDeductions ?? []).reduce(
    (sum, row) => sum + row.calculatedAmount,
    0
  );
  const approvedDeductionTotal = (monthlyDeductions ?? []).reduce(
    (sum, row) => sum + (row.approvedAmount ?? 0),
    0
  );

  return (
    <RequireAuth page="admin-pointages">
      <PageShell
        title="Pointages & Retards"
        description="Les scans hors horaires sont ignorés. Les retards sont calculés séparément pour l'entrée et le retour de pause."
      >
        <div className="mb-4 flex flex-wrap items-center gap-3">
          <input
            type="date"
            className={inputClass + " max-w-xs"}
            value={date}
            onChange={(e) => setDate(e.target.value)}
          />
          {msg ? <p className="text-sm text-emerald-600">{msg}</p> : null}
        </div>

        <Card className="mb-6">
          <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
            <div>
              <h2 className="font-semibold text-zinc-900">
                Retenues mensuelles à valider
              </h2>
              <p className="mt-1 text-sm text-zinc-500">
                Vérifiez ou modifiez les retards du matin, les retards après
                pause et les scans manquants avant de valider la retenue.
              </p>
            </div>
            <label className="text-sm">
              <span className="mb-1 block text-zinc-500">Mois</span>
              <input
                type="month"
                className={inputClass + " max-w-xs"}
                value={monthPeriod}
                onChange={(e) => setMonthPeriod(e.target.value)}
              />
            </label>
          </div>

          <div className="mb-4 flex flex-wrap gap-6 text-sm">
            <p className="text-zinc-600">
              Total calculé :{" "}
              <strong>{moneyDZD(calculatedDeductionTotal)}</strong>
            </p>
            <p className="text-zinc-600">
              Total déjà validé :{" "}
              <strong>{moneyDZD(approvedDeductionTotal)}</strong>
            </p>
          </div>

          {deductionMsg ? (
            <p className="mb-3 text-sm text-emerald-600">{deductionMsg}</p>
          ) : null}
          {deductionError ? (
            <p className="mb-3 text-sm text-red-600">{deductionError}</p>
          ) : null}

          <div className="overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead className="text-xs uppercase text-zinc-500">
                <tr>
                  <th className="pb-3 pr-3 text-left">Employé</th>
                  <th className="pb-3 pr-3 text-right">Matin (min)</th>
                  <th className="pb-3 pr-3 text-right">Après pause (min)</th>
                  <th className="pb-3 pr-3 text-right">Scans manquants</th>
                  <th className="pb-3 pr-3 text-right">Calculé</th>
                  <th className="pb-3 pr-3 text-left">Montant à valider</th>
                  <th className="pb-3 pr-3 text-left">État</th>
                  <th className="pb-3 text-right">Action</th>
                </tr>
              </thead>
              <tbody>
                {(monthlyDeductions ?? []).map((row) => {
                  const draftKey = `${monthPeriod}:${row.employeeId}`;
                  const metrics = monthlyMetricDrafts[draftKey];
                  const editedAmount = metrics
                    ? Math.round(
                        (Number(metrics.morningLateMinutes) +
                          Number(metrics.breakLateMinutes)) *
                          row.lateMinuteRate +
                          Math.floor(Number(metrics.missingScans) / 4) *
                            row.halfDayAmount
                      )
                    : row.amount;
                  const amount = Number(
                    deductionDrafts[draftKey] ?? String(editedAmount)
                  );
                  return (
                    <tr
                      key={row.employeeId}
                      className="border-t border-zinc-100"
                    >
                      <td className="py-3 pr-3 font-medium">
                        {row.employeeName}
                      </td>
                      <td className="py-3 pr-3 text-right">
                        <input
                          aria-label={`Retard du matin de ${row.employeeName} en minutes`}
                          type="number"
                          min={0}
                          step={1}
                          className="w-20 rounded-lg border border-zinc-200 px-2 py-1.5"
                          value={
                            metrics?.morningLateMinutes ??
                            String(row.morningLateMinutes)
                          }
                          onChange={(e) =>
                            updateMonthlyMetrics(draftKey, {
                                morningLateMinutes: e.target.value,
                                breakLateMinutes:
                                  metrics?.breakLateMinutes ??
                                  String(row.breakLateMinutes),
                                missingScans:
                                  metrics?.missingScans ??
                                  String(row.missingScans),
                            })
                          }
                        />
                      </td>
                      <td className="py-3 pr-3 text-right">
                        <input
                          aria-label={`Retard après pause de ${row.employeeName} en minutes`}
                          type="number"
                          min={0}
                          step={1}
                          className="w-20 rounded-lg border border-zinc-200 px-2 py-1.5"
                          value={
                            metrics?.breakLateMinutes ??
                            String(row.breakLateMinutes)
                          }
                          onChange={(e) =>
                            updateMonthlyMetrics(draftKey, {
                                morningLateMinutes:
                                  metrics?.morningLateMinutes ??
                                  String(row.morningLateMinutes),
                                breakLateMinutes: e.target.value,
                                missingScans:
                                  metrics?.missingScans ??
                                  String(row.missingScans),
                            })
                          }
                        />
                      </td>
                      <td className="py-3 pr-3 text-right">
                        <input
                          aria-label={`Scans manquants de ${row.employeeName}`}
                          type="number"
                          min={0}
                          step={1}
                          className="w-20 rounded-lg border border-zinc-200 px-2 py-1.5"
                          value={
                            metrics?.missingScans ?? String(row.missingScans)
                          }
                          onChange={(e) =>
                            updateMonthlyMetrics(draftKey, {
                                morningLateMinutes:
                                  metrics?.morningLateMinutes ??
                                  String(row.morningLateMinutes),
                                breakLateMinutes:
                                  metrics?.breakLateMinutes ??
                                  String(row.breakLateMinutes),
                                missingScans: e.target.value,
                            })
                          }
                        />
                      </td>
                      <td className="py-3 pr-3 text-right">
                        {moneyDZD(metrics ? editedAmount : row.calculatedAmount)}
                      </td>
                      <td className="py-3 pr-3">
                        <input
                          type="number"
                          min={0}
                          className="w-36 rounded-lg border border-zinc-200 px-2 py-1.5"
                          value={
                            deductionDrafts[draftKey] ??
                            String(editedAmount)
                          }
                          onChange={(e) =>
                            setDeductionDrafts((drafts) => ({
                              ...drafts,
                              [draftKey]: e.target.value,
                            }))
                          }
                        />
                      </td>
                      <td className="py-3 pr-3">
                        <Badge
                          className={
                            row.approvedAmount == null
                              ? "bg-amber-100 text-amber-800"
                              : "bg-emerald-100 text-emerald-800"
                          }
                        >
                          {row.approvedAmount == null ? "En attente" : "Validé"}
                        </Badge>
                      </td>
                      <td className="py-3 text-right">
                        <PrimaryButton
                          type="button"
                          disabled={
                            savingDeductionId !== null ||
                            !Number.isFinite(amount) ||
                            amount < 0
                          }
                          className="px-3 py-1.5 text-xs"
                          onClick={() =>
                            void saveMonthlyDeduction(
                              row.employeeId,
                              row.amount,
                              row.morningLateMinutes,
                              row.breakLateMinutes,
                              row.missingScans
                            )
                          }
                        >
                          {savingDeductionId === row.employeeId
                            ? "Validation…"
                            : row.approvedAmount == null
                              ? "Valider"
                              : "Enregistrer"}
                        </PrimaryButton>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            {!monthlyDeductions?.length ? (
              <p className="py-5 text-sm text-zinc-500">
                Aucune retenue calculée pour ce mois.
              </p>
            ) : null}
          </div>
        </Card>

        <Card>
          <div className="overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead className="text-xs uppercase text-zinc-500">
                <tr>
                  <th className="pb-3 text-left">Employé</th>
                  <th className="pb-3 text-left">Scans</th>
                  <th className="pb-3 text-left">Travaillé</th>
                  <th className="pb-3 text-left">Requis</th>
                  <th className="pb-3 text-left">Retard</th>
                  <th className="pb-3 text-left">Montant calculé</th>
                  <th className="pb-3 text-left">Statut</th>
                  <th className="pb-3 text-left">Ajuster</th>
                </tr>
              </thead>
              <tbody>
                {(rows ?? []).map((row) => (
                  <tr key={row._id} className="border-t border-zinc-100">
                    <td className="py-3 pr-3">
                      <p className="font-medium">{row.employee.name}</p>
                      <p className="text-xs text-zinc-500">
                        {formatTime(row.clockInAt)}
                        {row.clockOutAt ? ` → ${formatTime(row.clockOutAt)}` : " · en cours"}
                      </p>
                    </td>
                    <td className="py-3">{row.scans?.length ?? 0}</td>
                    <td className="py-3">{row.workedMinutes ?? 0} min</td>
                    <td className="py-3">{row.requiredMinutes ?? 480} min</td>
                    <td className="py-3">
                      {row.lateMinutes} min
                      {row.lateAdjustedByAdmin ? (
                        <span className="ml-1 text-xs text-zinc-400">(admin)</span>
                      ) : null}
                    </td>
                    <td className="py-3 font-medium text-red-600">
                      {row.delayAmount
                        ? `-${moneyDZD(row.delayAmount)}`
                        : moneyDZD(0)}
                    </td>
                    <td className="py-3">
                      <Badge className={statusBadgeClass(row.status)}>
                        {row.status}
                      </Badge>
                    </td>
                    <td className="py-3">
                      <div className="flex items-center gap-2">
                        <input
                          type="number"
                          min={0}
                          className="w-20 rounded-lg border border-zinc-200 px-2 py-1"
                          defaultValue={row.lateMinutes}
                          onChange={(e) =>
                            setDrafts((prev) => ({
                              ...prev,
                              [row._id]: e.target.value,
                            }))
                          }
                        />
                        <PrimaryButton
                          type="button"
                          className="px-3 py-1.5 text-xs"
                          onClick={() => save(row._id, row.lateMinutes)}
                        >
                          OK
                        </PrimaryButton>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {!rows?.length ? (
              <p className="py-6 text-sm text-zinc-500">
                Aucun pointage pour cette date.
              </p>
            ) : null}
          </div>
        </Card>
      </PageShell>
    </RequireAuth>
  );
}
