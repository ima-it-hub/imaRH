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
          row.employee.role === "employee" &&
          row.calculation?.calculationVersion === 2
      ),
    [primeRows]
  );
  const pendingTotal = pendingRows.reduce(
    (sum, row) => sum + (row.calculation?.totalAmount ?? 0),
    0
  );
  const rowsToConfirm = pendingRows.filter(
    (row) => row.calculation?.status === "BROUILLON"
  );

  async function onConfirmPrimes() {
    if (!token || rowsToConfirm.length === 0) return;
    setBusy(true);
    setError("");
    setMsg("");
    try {
      const result = await confirmPrimes({
        token,
        calculationIds: rowsToConfirm.map(
          (row) => row.calculation!._id
        ),
      });
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
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erreur");
    }
  }

  return (
    <RequireAuth role="admin">
      <PageShell
        title="Primes"
        description="Vérifiez et confirmez les primes calculées selon la base, la réalisation, le recouvrement et l’évaluation de chaque employé."
      >
        {msg ? <p className="mb-4 text-sm text-emerald-600">{msg}</p> : null}
        {error ? <p className="mb-4 text-sm text-red-600">{error}</p> : null}

        <div className="mb-4 flex flex-wrap gap-3">
          <Field label="Mois">
            <select
              className={inputClass}
              value={month}
              onChange={(e) => setMonth(Number(e.target.value))}
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
              onChange={(e) => setYear(Number(e.target.value))}
            />
          </Field>
        </div>

        <Card className="mb-6">
          <div>
            <h2 className="font-semibold text-zinc-900">
              Calculs à confirmer
            </h2>
            <p className="mt-1 text-sm text-zinc-500">
              Les primes héritées utilisent les objectifs et résultats du lieu
              de travail lorsqu&apos;ils sont enregistrés; sinon, elles
              reprennent ceux du manager. Le recouvrement du lieu s&apos;applique
              uniquement au département « resposible showroom ». Ces calculs
              sont préparés automatiquement. Les calculs confirmés restent ici
              pour être modifiés puis confirmés à nouveau.
            </p>
          </div>

          <div className="mt-5 overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead className="text-xs uppercase text-zinc-500">
                <tr>
                  <th className="pb-3 pr-3 text-left">Employé</th>
                  <th className="pb-3 pr-3 text-left">Données</th>
                  <th className="pb-3 pr-3 text-right">Prime de base</th>
                  <th className="pb-3 pr-3 text-right">Réalisation</th>
                  <th className="pb-3 pr-3 text-right">Recouvrement</th>
                  <th className="pb-3 pr-3 text-right">Évaluation</th>
                  <th className="pb-3 pr-3 text-right">Prime calculée</th>
                  <th className="pb-3 text-right">Statut</th>
                </tr>
              </thead>
              <tbody>
                {pendingRows.map((row) => {
                  const calc = row.calculation!;
                  return (
                    <tr
                      key={calc._id}
                      className="border-t border-zinc-100"
                    >
                      <td className="py-3 pr-3 font-medium text-zinc-900">
                        {row.employee.name}
                      </td>
                      <td className="py-3 pr-3">
                        {calc.hasOwnMetrics ? (
                          <Badge className="bg-sky-100 text-sky-800">
                            Individuelles
                          </Badge>
                        ) : calc.sourceWorkplaceId ? (
                          <Badge className="bg-emerald-100 text-emerald-800">
                            Lieu : {row.workplaceName || "—"}
                          </Badge>
                        ) : (
                          <Badge className="bg-zinc-100 text-zinc-700">
                            Manager : {row.managerName || "—"}
                          </Badge>
                        )}
                      </td>
                      <td className="py-3 pr-3 text-right">
                        {moneyDZD(calc.primeBase)}
                      </td>
                      <td className="py-3 pr-3 text-right">
                        {(calc.objectiveRatio * 100).toFixed(1)}% ·{" "}
                        {moneyDZD(calc.objectiveAmount)}
                      </td>
                      <td className="py-3 pr-3 text-right">
                        {calc.hasOwnMetrics ||
                        (calc.sourceWorkplaceId && row.usesWorkplaceRecovery)
                          ? `${(calc.recoveryRatio * 100).toFixed(1)}% · ${moneyDZD(calc.recoveryAmount)}`
                          : "—"}
                      </td>
                      <td className="py-3 pr-3 text-right">
                        {calc.evaluationPercent}% ·{" "}
                        {moneyDZD(calc.evaluationAmount)}
                      </td>
                      <td className="py-3 pr-3 text-right font-semibold">
                        {moneyDZD(calc.totalAmount)}
                      </td>
                      <td className="py-3 text-right">
                        <Badge
                          className={
                            calc.status === "CONFIRME"
                              ? "bg-emerald-100 text-emerald-800"
                              : "bg-amber-100 text-amber-800"
                          }
                        >
                          {calc.status === "CONFIRME"
                            ? "Confirmée"
                            : "À confirmer"}
                        </Badge>
                      </td>
                    </tr>
                  );
                })}
                {!pendingRows.length ? (
                  <tr>
                    <td colSpan={8} className="py-6 text-sm text-zinc-500">
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
                : `Confirmer les modifications (${month}/${year})`}
            </PrimaryButton>
          </div>
        </Card>

        <Card className="mb-6">
          <h2 className="font-semibold text-zinc-900">
            Attribuer une prime exceptionnelle
          </h2>
          <form onSubmit={onBonus} className="mt-4 grid gap-3 md:grid-cols-2">
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
            <div className="md:col-span-2">
              <PrimaryButton type="submit">Attribuer la prime</PrimaryButton>
            </div>
          </form>
        </Card>

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
