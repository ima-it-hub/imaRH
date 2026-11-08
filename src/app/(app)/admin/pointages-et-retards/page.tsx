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

  async function save(attendanceId: Id<"attendances">, currentLate: number) {
    if (!token) return;
    const value = Number(drafts[attendanceId] ?? String(currentLate));
    await adjust({ token, attendanceId, lateMinutes: value });
    setMsg("Retard mis à jour — montant calculé recalculé");
  }

  async function saveMonthlyDeduction(
    employeeId: Id<"users">,
    currentAmount: number
  ) {
    if (!token || !periodYear || !periodMonth) return;
    const amount = Number(
      deductionDrafts[`${monthPeriod}:${employeeId}`] ??
        String(currentAmount)
    );
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
    <RequireAuth role="admin">
      <PageShell
        title="Pointages & Retards"
        description="Temps travaillé vs durée obligatoire. Vous pouvez corriger les minutes de retard (la retenue sur le solde se recalcule)."
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
                Le retard ne réduit le solde qu&apos;après validation. Vous
                pouvez modifier le montant avant de le valider.
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
                  <th className="pb-3 pr-3 text-right">Retard</th>
                  <th className="pb-3 pr-3 text-right">Calculé</th>
                  <th className="pb-3 pr-3 text-left">Montant à valider</th>
                  <th className="pb-3 pr-3 text-left">État</th>
                  <th className="pb-3 text-right">Action</th>
                </tr>
              </thead>
              <tbody>
                {(monthlyDeductions ?? []).map((row) => {
                  const draftKey = `${monthPeriod}:${row.employeeId}`;
                  const amount = Number(
                    deductionDrafts[draftKey] ?? String(row.amount)
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
                        {row.lateMinutes} min
                      </td>
                      <td className="py-3 pr-3 text-right">
                        {moneyDZD(row.calculatedAmount)}
                      </td>
                      <td className="py-3 pr-3">
                        <input
                          type="number"
                          min={0}
                          className="w-36 rounded-lg border border-zinc-200 px-2 py-1.5"
                          value={
                            deductionDrafts[draftKey] ??
                            String(row.amount)
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
                              row.amount
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
