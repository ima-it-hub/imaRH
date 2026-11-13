"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { api } from "../../../../../convex/_generated/api";
import type { Id } from "../../../../../convex/_generated/dataModel";
import { PageShell } from "@/components/PageShell";
import { RequireAuth } from "@/components/RequireAuth";
import {
  Badge,
  Card,
  Field,
  PrimaryButton,
  inputClass,
} from "@/components/ui";
import { useAuth } from "@/lib/auth";
import { moneyDZD } from "@/lib/format";

export default function AdminPrimesPage() {
  const { token } = useAuth();
  const employees = useQuery(
    api.users.listEmployees,
    token ? { token } : "skip"
  );
  const bonuses = useQuery(api.finances.listBonuses, token ? { token } : "skip");
  const now = new Date();
  const [month, setMonth] = useState(now.getMonth() + 1);
  const [year, setYear] = useState(now.getFullYear());
  const [busy, setBusy] = useState(false);
  const [bonusEmployeeId, setBonusEmployeeId] = useState("");
  const [bonusAmount, setBonusAmount] = useState("");
  const [bonusTitle, setBonusTitle] = useState("Prime exceptionnelle");
  const [bonusReason, setBonusReason] = useState("");
  const [amountDrafts, setAmountDrafts] = useState<Record<string, string>>({});
  const [bonusDialogOpen, setBonusDialogOpen] = useState(false);
  const [msg, setMsg] = useState("");
  const [error, setError] = useState("");

  const primeRows = useQuery(
    api.primeCalculations.employeesForMonth,
    token ? { token, month, year } : "skip"
  );
  const confirmPrimes = useMutation(api.primeCalculations.confirmBatch);
  const syncInheritedDrafts = useMutation(
    api.primeCalculations.syncInheritedDrafts
  );
  const grantBonus = useMutation(api.finances.grantBonus);

  useEffect(() => {
    if (!token) return;
    let active = true;
    void syncInheritedDrafts({ token, month, year }).catch((err: unknown) => {
      if (active) {
        setError(
          err instanceof Error
            ? err.message
            : "Impossible de préparer les primes héritées du manager."
        );
      }
    });
    return () => {
      active = false;
    };
  }, [month, syncInheritedDrafts, token, year]);

  const pendingRows = useMemo(
    () =>
      (primeRows ?? []).filter(
        (row) =>
          row.primeEligible &&
          row.employee.role === "employee" &&
          row.calculation?.calculationVersion === 2
      ),
    [primeRows]
  );
  const pendingTotal = pendingRows.reduce(
    (sum, row) =>
      sum +
      (Number(
        amountDrafts[row.calculation!._id] ??
          String(row.calculation?.totalAmount ?? 0)
      ) || 0),
    0
  );
  const rowsToConfirm = pendingRows.filter(
    (row) =>
      row.calculation?.status === "BROUILLON" ||
      (amountDrafts[row.calculation!._id] !== undefined &&
        Number(amountDrafts[row.calculation!._id]) !==
          row.calculation?.totalAmount)
  );

  async function onConfirmPrimes() {
    if (!token || rowsToConfirm.length === 0) return;
    const invalidAmount = rowsToConfirm.find((row) => {
      const value = amountDrafts[row.calculation!._id];
      return (
        value !== undefined &&
        (value.trim() === "" ||
          !Number.isFinite(Number(value)) ||
          Number(value) < 0)
      );
    });
    if (invalidAmount) {
      setError(
        `Saisissez un montant valide pour ${invalidAmount.employee.name}.`
      );
      return;
    }
    setBusy(true);
    setError("");
    setMsg("");
    try {
      const result = await confirmPrimes({
        token,
        calculationIds: rowsToConfirm.map((row) => row.calculation!._id),
        amountAdjustments: rowsToConfirm.flatMap((row) => {
          const value = amountDrafts[row.calculation!._id];
          return value === undefined
            ? []
            : [
                {
                  calculationId: row.calculation!._id,
                  amount: Number(value),
                },
              ];
        }),
      });
      setAmountDrafts({});
      setMsg(
        `${result.confirmed} prime(s) confirmée(s) ou mise(s) à jour pour ${month}/${year}.`
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erreur");
    } finally {
      setBusy(false);
    }
  }

  async function onBonus(e: FormEvent) {
    e.preventDefault();
    if (!token || !bonusEmployeeId) return;
    setError("");
    setMsg("");
    try {
      await grantBonus({
        token,
        employeeId: bonusEmployeeId as Id<"users">,
        amount: Number(bonusAmount),
        title: bonusTitle,
        reason: bonusReason,
      });
      setMsg("Prime exceptionnelle attribuée");
      setBonusAmount("");
      setBonusReason("");
      setBonusEmployeeId("");
      setBonusTitle("Prime exceptionnelle");
      setBonusDialogOpen(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erreur");
    }
  }

  return (
    <RequireAuth page="admin-primes">
      <PageShell
        title="Primes"
        description="Vérifiez et confirmez les primes calculées selon la base, la réalisation, le recouvrement et l’évaluation de chaque employé."
      >
        {msg ? <p className="mb-4 text-sm text-emerald-600">{msg}</p> : null}
        {error ? <p className="mb-4 text-sm text-red-600">{error}</p> : null}

        <div className="mb-4 flex flex-wrap items-end gap-3">
          <Field label="Mois">
            <select
              className={inputClass}
              value={month}
              onChange={(e) => {
                setAmountDrafts({});
                setMonth(Number(e.target.value));
              }}
            >
              {Array.from({ length: 12 }, (_, i) => (
                <option key={i + 1} value={i + 1}>
                  {new Date(2000, i, 1).toLocaleString("fr-DZ", {
                    month: "long",
                  })}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Année">
            <input
              type="number"
              className={inputClass + " w-28"}
              value={year}
              onChange={(e) => {
                setAmountDrafts({});
                setYear(Number(e.target.value));
              }}
            />
          </Field>
          <PrimaryButton
            type="button"
            className="ml-auto"
            onClick={() => setBonusDialogOpen(true)}
          >
            Attribuer une prime exceptionnelle
          </PrimaryButton>
        </div>

        <Card className="mb-6">
          <div>
            <h2 className="font-semibold text-zinc-900">
              Calculs à confirmer
            </h2>
            <p className="mt-1 text-sm text-zinc-500">
              Les employés deviennent éligibles après trois mois
              d&apos;ancienneté, calculés à la fin du mois de prime.
            </p>
            {/* <p className="mt-1 text-sm text-zinc-500">
              Les primes héritées utilisent les objectifs et résultats du lieu
              de travail lorsqu&apos;ils sont enregistrés; sinon, elles
              reprennent ceux du manager. Le recouvrement du lieu s&apos;applique
              uniquement au département « resposible showroom ». Ces calculs
              sont préparés automatiquement. Les calculs confirmés restent ici
              pour être modifiés puis confirmés à nouveau. Vous pouvez ajuster
              directement le montant de la prime calculée; la modification est
              appliquée lors de la confirmation.
            </p> */}
          </div>

          <div className="mt-5 overflow-x-auto">
            <table className="w-full min-w-[1120px] text-sm">
              <thead className="text-xs uppercase text-zinc-500">
                <tr>
                  <th className="pb-3 pr-3 text-left">Employé</th>
                  <th className="pb-3 pr-3 text-left">Données</th>
                  <th className="pb-3 pr-3 text-right">Prime de base</th>
                  <th className="pb-3 pr-3 text-right">Personnel</th>
                  <th className="pb-3 pr-3 text-right">Entreprise</th>
                  <th className="pb-3 pr-3 text-right">Recouvrement</th>
                  <th className="pb-3 pr-3 text-right">Évaluation</th>
                  <th className="pb-3 pr-3 text-right">Prime calculée</th>
                  <th className="pb-3 text-right">Statut</th>
                </tr>
              </thead>
              <tbody>
                {pendingRows.map((row) => {
                  const calc = row.calculation!;
                  const companyRealisationWeight =
                    calc.companyRealisationWeightPercent ?? 0;
                  return (
                    <tr
                      key={calc._id}
                      className="border-t border-zinc-100"
                    >
                      <td className="py-3 pr-3 font-medium text-zinc-900">
                        <div className="min-w-[120px]">
                        {row.employee.name}
                        </div>
                      </td>
                      <td className="min-w-[150px] py-3 pr-3">
                        {calc.hasOwnMetrics ? (
                          <Badge className="bg-sky-100 text-sky-800">
                            Individuelles
                          </Badge>
                        ) : calc.sourceWorkplaceId ? (
                          <Badge className="bg-emerald-100 text-emerald-800">
                            Lieu :{" "}
                            {row.primeSourceWorkplaceNames.length
                              ? row.primeSourceWorkplaceNames.join(", ")
                              : row.workplaceName || "—"}
                          </Badge>
                        ) : (
                          <Badge className="bg-zinc-100 text-zinc-700">
                            Manager : {row.managerName || "—"}
                          </Badge>
                        )}
                      </td>
                      <td className="min-w-[115px] whitespace-nowrap py-3 pr-3 text-right">
                        {moneyDZD(calc.primeBase)}
                      </td>
                      <td className="min-w-[165px] whitespace-nowrap py-3 pr-3 text-right">
                        {(calc.objectiveRatio * 100).toFixed(1)}% ×{" "}
                        {calc.objectiveWeightPercent}% ·{" "}
                        {moneyDZD(calc.objectiveAmount)}
                      </td>
                      <td className="min-w-[165px] whitespace-nowrap py-3 pr-3 text-right">
                        {companyRealisationWeight > 0
                          ? `${(((calc.companyRealisationRatio ?? 0) * 100).toFixed(1))}% × ${companyRealisationWeight}% · ${moneyDZD(calc.companyRealisationAmount ?? 0)}`
                          : "—"}
                      </td>
                      <td className="min-w-[125px] whitespace-nowrap py-3 pr-3 text-right">
                        {row.hasRecoverySource &&
                        (calc.hasOwnMetrics ||
                          (calc.sourceWorkplaceId &&
                            row.usesWorkplaceRecovery))
                          ? `${(calc.recoveryRatio * 100).toFixed(1)}% · ${moneyDZD(calc.recoveryAmount)}`
                          : "—"}
                      </td>
                      <td className="min-w-[115px] whitespace-nowrap py-3 pr-3 text-right">
                        {calc.evaluationPercent}% ·{" "}
                        {moneyDZD(calc.evaluationAmount)}
                      </td>
                      <td className="min-w-[135px] py-3 pr-3 text-right font-semibold">
                        <input
                          type="number"
                          min={0}
                          step={1}
                          aria-label={`Montant de la prime de ${row.employee.name}`}
                          className="w-32 rounded-lg border border-zinc-200 px-2 py-1.5 text-right font-semibold"
                          value={
                            amountDrafts[calc._id] ?? String(calc.totalAmount)
                          }
                          onChange={(event) =>
                            setAmountDrafts((previous) => ({
                              ...previous,
                              [calc._id]: event.target.value,
                            }))
                          }
                        />
                      </td>
                      <td className="min-w-[95px] py-3 text-right">
                        <Badge
                          className={
                            calc.status === "CONFIRME"
                              ? "bg-emerald-100 text-emerald-800"
                              : "bg-amber-100 text-amber-800"
                          }
                        >
                          {calc.status === "CONFIRME" &&
                          !rowsToConfirm.some(
                            (pendingRow) =>
                              pendingRow.calculation?._id === calc._id
                          )
                            ? "Confirmée"
                            : calc.status === "CONFIRME"
                              ? "Modification à confirmer"
                              : "À confirmer"}
                        </Badge>
                      </td>
                    </tr>
                  );
                })}
                {!pendingRows.length ? (
                  <tr>
                    <td colSpan={9} className="py-6 text-sm text-zinc-500">
                      Aucune prime en attente. Enregistrez les données du lieu
                      de travail ou du manager dans Calcul des primes; les
                      employés concernés seront ajoutés automatiquement.
                    </td>
                  </tr>
                ) : null}
              </tbody>
            </table>
          </div>

          <div className="mt-4 flex flex-wrap items-center justify-between gap-3 border-t border-zinc-100 pt-4">
            <p className="text-sm text-zinc-600">
              {pendingRows.length} prime(s) · {rowsToConfirm.length} à confirmer ·{" "}
              {moneyDZD(pendingTotal)}
            </p>
            <PrimaryButton
              type="button"
              disabled={busy || rowsToConfirm.length === 0}
              onClick={() => void onConfirmPrimes()}
            >
              {busy
                ? "Confirmation…"
                : `Confirmer les modifications (${rowsToConfirm.length})`}
            </PrimaryButton>
          </div>
        </Card>

        {bonusDialogOpen ? (
          <div
            className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
            onMouseDown={(event) => {
              if (event.target === event.currentTarget) {
                setBonusDialogOpen(false);
              }
            }}
          >
            <div
              role="dialog"
              aria-modal="true"
              aria-labelledby="bonus-dialog-title"
            >
              <Card className="w-full max-w-2xl">
                <div className="flex items-start justify-between gap-4">
                  <h2
                    id="bonus-dialog-title"
                    className="font-semibold text-zinc-900"
                  >
                    Attribuer une prime exceptionnelle
                  </h2>
                  <button
                    type="button"
                    aria-label="Fermer"
                    className="rounded-lg px-2 py-1 text-zinc-500 hover:bg-zinc-100"
                    onClick={() => setBonusDialogOpen(false)}
                  >
                    ×
                  </button>
                </div>
                <form
                  onSubmit={onBonus}
                  className="mt-4 grid gap-3 md:grid-cols-2"
                >
                  <Field label="Employé">
                    <select
                      required
                      className={inputClass}
                      value={bonusEmployeeId}
                      onChange={(e) => setBonusEmployeeId(e.target.value)}
                    >
                      <option value="">Choisir…</option>
                      {(employees ?? [])
                        .filter((employee) => employee.isActive)
                        .map((employee) => (
                          <option key={employee._id} value={employee._id}>
                            {employee.name}
                          </option>
                        ))}
                    </select>
                  </Field>
                  <Field label="Titre">
                    <input
                      required
                      className={inputClass}
                      value={bonusTitle}
                      onChange={(e) => setBonusTitle(e.target.value)}
                    />
                  </Field>
                  <Field label="Montant">
                    <input
                      required
                      type="number"
                      min={0}
                      className={inputClass}
                      value={bonusAmount}
                      onChange={(e) => setBonusAmount(e.target.value)}
                    />
                  </Field>
                  <Field label="Motif">
                    <textarea
                      required
                      className={inputClass}
                      rows={1}
                      value={bonusReason}
                      onChange={(e) => setBonusReason(e.target.value)}
                    />
                  </Field>
                  <div className="flex justify-end gap-2 md:col-span-2">
                    <button
                      type="button"
                      className="rounded-xl border border-zinc-200 px-4 py-2 text-sm font-semibold text-zinc-700 hover:bg-zinc-50"
                      onClick={() => setBonusDialogOpen(false)}
                    >
                      Annuler
                    </button>
                    <PrimaryButton type="submit">
                      Attribuer la prime
                    </PrimaryButton>
                  </div>
                </form>
              </Card>
            </div>
          </div>
        ) : null}

        <h3 className="mb-3 font-semibold text-zinc-900">Primes attribuées</h3>
        <Card>
          <div className="space-y-3">
            {(bonuses ?? []).map((bonus) => (
              <div
                key={bonus._id}
                className="flex items-center justify-between gap-3 border-b border-zinc-100 pb-3 last:border-0"
              >
                <div>
                  <p className="font-medium">
                    {bonus.employee.name} · {bonus.title}
                  </p>
                  <p className="text-sm text-zinc-500">{bonus.reason}</p>
                </div>
                <p className="font-semibold text-[#0088E8]">
                  {moneyDZD(bonus.amount)}
                </p>
              </div>
            ))}
            {!bonuses?.length ? (
              <p className="text-sm text-zinc-500">Aucune prime.</p>
            ) : null}
          </div>
        </Card>
      </PageShell>
    </RequireAuth>
  );
}
