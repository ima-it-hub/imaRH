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
  SecondaryButton,
  inputClass,
} from "@/components/ui";
import { useAuth } from "@/lib/auth";
import { moneyDZD } from "@/lib/format";

type PrimeDraft = {
  baseBonus: string;
  computedBonus: string;
};

export default function AdminPrimesPage() {
  const { token } = useAuth();
  const employees = useQuery(
    api.users.listEmployees,
    token ? { token } : "skip"
  );
  const bonuses = useQuery(api.finances.listBonuses, token ? { token } : "skip");
  const setBaseBonus = useMutation(api.users.setBaseBonus);
  const confirmPrimesBatch = useMutation(api.reports.confirmPrimesBatch);
  const confirmCommercialBatch = useMutation(
    api.primeCalculations.confirmBatch
  );
  const grantBonus = useMutation(api.finances.grantBonus);

  const now = new Date();
  const [month, setMonth] = useState(now.getMonth() + 1);
  const [year, setYear] = useState(now.getFullYear());
  const [primeDrafts, setPrimeDrafts] = useState<Record<string, PrimeDraft>>(
    {}
  );
  const [commercialDrafts, setCommercialDrafts] = useState<
    Record<string, string>
  >({});
  const [busy, setBusy] = useState(false);
  const [bonusEmployeeId, setBonusEmployeeId] = useState("");
  const [bonusAmount, setBonusAmount] = useState("");
  const [bonusTitle, setBonusTitle] = useState("Prime exceptionnelle");
  const [bonusReason, setBonusReason] = useState("");
  const [msg, setMsg] = useState("");
  const [error, setError] = useState("");

  const monthRows = useQuery(
    api.finances.salariesForMonth,
    token ? { token, month, year } : "skip"
  );
  const commercialRows = useQuery(
    api.primeCalculations.percentageEmployeesForMonth,
    token ? { token, month, year } : "skip"
  );

  const evaluationRows = useMemo(() => {
    return (monthRows ?? []).filter(
      (row) => (row.employee.bonusType ?? "FIXED") !== "PERCENTAGE"
    );
  }, [monthRows]);

  useEffect(() => {
    setPrimeDrafts({});
    setCommercialDrafts({});
  }, [month, year]);

  useEffect(() => {
    if (!evaluationRows.length) return;
    setPrimeDrafts((prev) => {
      const next: Record<string, PrimeDraft> = { ...prev };
      for (const row of evaluationRows) {
        if (next[row.employee._id]) continue;
        const base =
          row.evaluation.baseBonus ?? row.employee.baseBonus ?? 0;
        const pct = row.evaluation.percentage || 0;
        const computed =
          row.evaluation.status === "CONFIRME"
            ? row.evaluation.computedBonus || 0
            : pct > 0
              ? Math.round((base * pct) / 100)
              : 0;
        next[row.employee._id] = {
          baseBonus: String(base),
          computedBonus: String(computed),
        };
      }
      return next;
    });
  }, [evaluationRows]);

  useEffect(() => {
    if (!commercialRows) return;
    setCommercialDrafts((prev) => {
      const next: Record<string, string> = { ...prev };
      for (const row of commercialRows) {
        const id = row.employee._id;
        if (next[id] !== undefined) continue;
        if (row.calculation) {
          next[id] = String(row.calculation.totalAmount ?? 0);
        }
      }
      return next;
    });
  }, [commercialRows]);

  const pendingEvalPrimes = useMemo(() => {
    return evaluationRows.filter(
      (row) => row.evaluation.status === "EN_ATTENTE" && row.evaluation.reportId
    );
  }, [evaluationRows]);

  const pendingCommercial = useMemo(() => {
    return (commercialRows ?? []).filter((row) => {
      if (row.calculation?.status !== "BROUILLON") return false;
      const draftAmount = Number(commercialDrafts[row.employee._id]);
      const amount =
        Number.isFinite(draftAmount) && commercialDrafts[row.employee._id] !== undefined
          ? draftAmount
          : row.calculation?.totalAmount ?? 0;
      return amount > 0;
    });
  }, [commercialRows, commercialDrafts]);

  const totalPendingPrimes = useMemo(() => {
    const evalTotal = pendingEvalPrimes.reduce((sum, row) => {
      const draft = primeDrafts[row.employee._id];
      return sum + (Number(draft?.computedBonus) || 0);
    }, 0);
    const commercialTotal = pendingCommercial.reduce((sum, row) => {
      const draft = commercialDrafts[row.employee._id];
      return (
        sum +
        (Number(draft) || row.calculation?.totalAmount || 0)
      );
    }, 0);
    return evalTotal + commercialTotal;
  }, [
    pendingEvalPrimes,
    pendingCommercial,
    primeDrafts,
    commercialDrafts,
  ]);

  const pendingCount = pendingEvalPrimes.length + pendingCommercial.length;

  const confirmedEval = useMemo(() => {
    return evaluationRows.filter((row) => row.evaluation.status === "CONFIRME");
  }, [evaluationRows]);

  const confirmedCommercial = useMemo(() => {
    return (commercialRows ?? []).filter(
      (row) => row.calculation?.status === "CONFIRME"
    );
  }, [commercialRows]);

  const definedPrimeTotal = useMemo(() => {
    const evalTotal = confirmedEval.reduce(
      (sum, row) => sum + (row.evaluation.computedBonus || 0),
      0
    );
    const commercialTotal = confirmedCommercial.reduce(
      (sum, row) => sum + (row.calculation?.totalAmount ?? 0),
      0
    );
    return evalTotal + commercialTotal;
  }, [confirmedEval, confirmedCommercial]);

  function updatePrimeBase(
    employeeId: string,
    value: string,
    percentage: number
  ) {
    const base = Number(value) || 0;
    const computed =
      percentage > 0 ? Math.round((base * percentage) / 100) : 0;
    setPrimeDrafts((prev) => ({
      ...prev,
      [employeeId]: {
        baseBonus: value,
        computedBonus: String(computed),
      },
    }));
  }

  function updatePrimeComputed(employeeId: string, value: string) {
    setPrimeDrafts((prev) => ({
      ...prev,
      [employeeId]: {
        baseBonus: prev[employeeId]?.baseBonus ?? "0",
        computedBonus: value,
      },
    }));
  }

  async function onSavePrimeBases() {
    if (!token || !evaluationRows.length) return;
    setBusy(true);
    setError("");
    setMsg("");
    try {
      let saved = 0;
      for (const row of evaluationRows) {
        const draft = primeDrafts[row.employee._id];
        if (!draft) continue;
        await setBaseBonus({
          token,
          userId: row.employee._id as Id<"users">,
          baseBonus: Number(draft.baseBonus) || 0,
        });
        saved += 1;
      }
      setMsg(`${saved} prime(s) de base enregistrée(s)`);
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
    try {
      await grantBonus({
        token,
        employeeId: bonusEmployeeId as Id<"users">,
        amount: Number(bonusAmount),
        title: bonusTitle,
        reason: bonusReason,
      });
      setMsg("Prime attribuée");
      setBonusAmount("");
      setBonusReason("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erreur");
    }
  }

  async function onConfirmPrimes() {
    if (!token || pendingCount === 0) return;
    setBusy(true);
    setError("");
    setMsg("");
    try {
      let evalConfirmed = 0;
      let commercialConfirmed = 0;

      if (pendingEvalPrimes.length > 0) {
        const entries = pendingEvalPrimes.map((row) => {
          const draft = primeDrafts[row.employee._id];
          return {
            reportId: row.evaluation.reportId as Id<"monthlyReports">,
            baseBonus: Number(draft?.baseBonus) || 0,
            computedBonus: Number(draft?.computedBonus) || 0,
          };
        });
        const result = await confirmPrimesBatch({
          token,
          month,
          year,
          entries,
        });
        evalConfirmed = result.confirmed;
      }

      if (pendingCommercial.length > 0) {
        const entries = pendingCommercial.map((row) => ({
          calculationId: row.calculation!._id,
          totalAmount:
            Number(commercialDrafts[row.employee._id]) ||
            row.calculation?.totalAmount ||
            0,
        }));
        const result = await confirmCommercialBatch({
          token,
          entries,
        });
        commercialConfirmed = result.confirmed;
      }

      const parts = [];
      if (evalConfirmed > 0) {
        parts.push(`${evalConfirmed} évaluation`);
      }
      if (commercialConfirmed > 0) {
        parts.push(`${commercialConfirmed} commerciale`);
      }
      setMsg(
        parts.length
          ? `Primes confirmées : ${parts.join(" · ")} (${month}/${year}) — créditées au solde employé`
          : "Aucune prime confirmée"
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erreur");
    } finally {
      setBusy(false);
    }
  }

  return (
    <RequireAuth role="admin">
      <PageShell
        title="Primes"
        description="Confirmez les primes d'évaluation et les primes commerciales du mois. Une fois confirmées, elles apparaissent dans le solde de l'employé."
      >
        {msg ? (
          <p className="mb-4 text-sm text-emerald-600">{msg}</p>
        ) : null}
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
              Primes du mois
            </h2>
            <p className="mt-1 text-sm text-zinc-500">
              Évaluation et commerciale. Vous pouvez modifier la prime calculée
              avant confirmation.
            </p>
          </div>

          <div className="mt-5 overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead className="text-xs uppercase text-zinc-500">
                <tr>
                  <th className="pb-3 pr-3 text-left">Employé</th>
                  <th className="pb-3 pr-3 text-left">Type</th>
                  <th className="pb-3 pr-3 text-left">Prime de base</th>
                  <th className="pb-3 pr-3 text-left">Détail</th>
                  <th className="pb-3 pr-3 text-left">Prime calculée</th>
                  <th className="pb-3 text-left">Statut</th>
                </tr>
              </thead>
              <tbody>
                {evaluationRows.map((row) => {
                  const draft = primeDrafts[row.employee._id] ?? {
                    baseBonus: "0",
                    computedBonus: "0",
                  };
                  const pct = row.evaluation.percentage || 0;
                  const pending = row.evaluation.status === "EN_ATTENTE";
                  const confirmed = row.evaluation.status === "CONFIRME";
                  return (
                    <tr
                      key={`eval-${row.employee._id}`}
                      className={`border-t border-zinc-100 ${
                        pending ? "bg-amber-50/40" : ""
                      }`}
                    >
                      <td className="py-3 pr-3">
                        <p className="font-medium text-zinc-900">
                          {row.employee.name}
                        </p>
                        <p className="text-xs text-zinc-500">
                          {row.employee.department || "—"}
                        </p>
                      </td>
                      <td className="py-3 pr-3">
                        <Badge className="bg-zinc-100 text-zinc-700">
                          Évaluation
                        </Badge>
                      </td>
                      <td className="py-3 pr-3">
                        <input
                          type="number"
                          min={0}
                          disabled={confirmed}
                          className="w-28 rounded-lg border border-zinc-200 px-2 py-1.5 disabled:bg-zinc-50"
                          value={draft.baseBonus}
                          onChange={(e) =>
                            updatePrimeBase(
                              row.employee._id,
                              e.target.value,
                              pct
                            )
                          }
                        />
                      </td>
                      <td className="py-3 pr-3 text-zinc-700">
                        {pct ? `Éval. ${pct}%` : "—"}
                      </td>
                      <td className="py-3 pr-3">
                        {pct || pending || confirmed ? (
                          <input
                            type="number"
                            min={0}
                            disabled={confirmed}
                            className="w-28 rounded-lg border border-zinc-200 px-2 py-1.5 disabled:bg-zinc-50"
                            value={draft.computedBonus}
                            onChange={(e) =>
                              updatePrimeComputed(
                                row.employee._id,
                                e.target.value
                              )
                            }
                          />
                        ) : (
                          <span className="text-zinc-400">—</span>
                        )}
                      </td>
                      <td className="py-3">
                        {pending ? (
                          <Badge className="bg-amber-100 text-amber-800">
                            En attente
                          </Badge>
                        ) : confirmed ? (
                          <Badge className="bg-emerald-50 text-emerald-700">
                            Confirmée
                          </Badge>
                        ) : (
                          <span className="text-zinc-400">—</span>
                        )}
                      </td>
                    </tr>
                  );
                })}

                {(commercialRows ?? []).map((row) => {
                  const calc = row.calculation;
                  const pending = calc?.status === "BROUILLON";
                  const confirmed = calc?.status === "CONFIRME";
                  const draftAmount =
                    commercialDrafts[row.employee._id] ??
                    String(calc?.totalAmount ?? "");
                  return (
                    <tr
                      key={`com-${row.employee._id}`}
                      className={`border-t border-zinc-100 ${
                        pending ? "bg-sky-50/50" : ""
                      }`}
                    >
                      <td className="py-3 pr-3">
                        <p className="font-medium text-zinc-900">
                          {row.employee.name}
                        </p>
                        <p className="text-xs text-zinc-500">
                          {row.employee.department || "—"} ·{" "}
                          {row.employee.bonusPercent ?? 0}%
                        </p>
                      </td>
                      <td className="py-3 pr-3">
                        <Badge className="bg-sky-100 text-sky-800">
                          Commerciale
                        </Badge>
                      </td>
                      <td className="py-3 pr-3 text-zinc-700">
                        {calc ? moneyDZD(calc.primeBase) : "—"}
                      </td>
                      <td className="py-3 pr-3 text-xs text-zinc-600">
                        {calc ? (
                          <>
                            Obj {(calc.objectiveRatio * 100).toFixed(0)}% · Rec{" "}
                            {(calc.recoveryRatio * 100).toFixed(0)}% · Éval{" "}
                            {calc.evaluationPercent}%
                          </>
                        ) : (
                          <span className="text-zinc-400">
                            À calculer sur Calcul des primes
                          </span>
                        )}
                      </td>
                      <td className="py-3 pr-3">
                        {calc ? (
                          <input
                            type="number"
                            min={0}
                            disabled={confirmed}
                            className="w-28 rounded-lg border border-zinc-200 px-2 py-1.5 disabled:bg-zinc-50"
                            value={draftAmount}
                            onChange={(e) =>
                              setCommercialDrafts((prev) => ({
                                ...prev,
                                [row.employee._id]: e.target.value,
                              }))
                            }
                          />
                        ) : (
                          <span className="text-zinc-400">—</span>
                        )}
                      </td>
                      <td className="py-3">
                        {pending ? (
                          <Badge className="bg-amber-100 text-amber-800">
                            En attente
                          </Badge>
                        ) : confirmed ? (
                          <Badge className="bg-emerald-50 text-emerald-700">
                            Confirmée
                          </Badge>
                        ) : (
                          <span className="text-zinc-400">—</span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            {!evaluationRows.length && !commercialRows?.length ? (
              <p className="py-6 text-sm text-zinc-500">
                Aucun employé à afficher.
              </p>
            ) : null}
          </div>

          <div className="mt-4 flex flex-col gap-3 border-t border-zinc-100 pt-4 sm:flex-row sm:items-center sm:justify-between">
            <p className="text-sm text-zinc-600">
              {pendingCount > 0
                ? `${pendingCount} prime(s) en attente · estimé ${moneyDZD(totalPendingPrimes)}`
                : "Aucune prime en attente pour ce mois"}
            </p>
            <div className="flex flex-wrap gap-2">
              <SecondaryButton
                type="button"
                disabled={busy || !evaluationRows.length}
                onClick={() => void onSavePrimeBases()}
              >
                Enregistrer primes de base
              </SecondaryButton>
              <PrimaryButton
                type="button"
                disabled={busy || pendingCount === 0}
                onClick={() => void onConfirmPrimes()}
              >
                {busy
                  ? "Confirmation…"
                  : `Confirmer les primes (${month}/${year})`}
              </PrimaryButton>
            </div>
          </div>
        </Card>

        <Card className="mb-6">
          <div className="mb-4">
            <h2 className="font-semibold text-zinc-900">
              Primes confirmées —{" "}
              {new Date(year, month - 1, 1).toLocaleString("fr-DZ", {
                month: "long",
                year: "numeric",
              })}
            </h2>
            <p className="mt-1 text-sm text-zinc-500">
              Primes d&apos;évaluation et commerciales créditées au solde.
            </p>
          </div>
          <div className="overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead className="text-xs uppercase text-zinc-500">
                <tr>
                  <th className="pb-3 pr-3 text-left">Employé</th>
                  <th className="pb-3 pr-3 text-left">Type</th>
                  <th className="pb-3 pr-3 text-left">Détail</th>
                  <th className="pb-3 text-right">Prime</th>
                </tr>
              </thead>
              <tbody>
                {confirmedEval.map((row) => (
                  <tr
                    key={`eval-ok-${row.employee._id}`}
                    className="border-t border-zinc-100"
                  >
                    <td className="py-3 pr-3 font-medium text-zinc-900">
                      {row.employee.name}
                    </td>
                    <td className="py-3 pr-3">
                      <Badge className="bg-zinc-100 text-zinc-700">
                        Évaluation
                      </Badge>
                    </td>
                    <td className="py-3 pr-3 text-zinc-700">
                      {row.evaluation.percentage
                        ? `${row.evaluation.percentage}%`
                        : "—"}
                    </td>
                    <td className="py-3 text-right font-semibold text-zinc-900">
                      {moneyDZD(row.evaluation.computedBonus || 0)}
                    </td>
                  </tr>
                ))}
                {confirmedCommercial.map((row) => (
                  <tr
                    key={`com-ok-${row.employee._id}`}
                    className="border-t border-zinc-100"
                  >
                    <td className="py-3 pr-3 font-medium text-zinc-900">
                      {row.employee.name}
                    </td>
                    <td className="py-3 pr-3">
                      <Badge className="bg-sky-100 text-sky-800">
                        Commerciale
                      </Badge>
                    </td>
                    <td className="py-3 pr-3 text-xs text-zinc-600">
                      Obj{" "}
                      {(
                        (row.calculation?.objectiveRatio ?? 0) * 100
                      ).toFixed(0)}
                      % · Rec{" "}
                      {(
                        (row.calculation?.recoveryRatio ?? 0) * 100
                      ).toFixed(0)}
                      % · Éval {row.calculation?.evaluationPercent ?? 0}%
                    </td>
                    <td className="py-3 text-right font-semibold text-zinc-900">
                      {moneyDZD(row.calculation?.totalAmount ?? 0)}
                    </td>
                  </tr>
                ))}
                {confirmedEval.length + confirmedCommercial.length > 0 ? (
                  <tr className="border-t-2 border-zinc-300 bg-zinc-50 font-semibold">
                    <td className="py-3 pr-3" colSpan={3}>
                      Total primes
                    </td>
                    <td className="py-3 text-right">
                      {moneyDZD(definedPrimeTotal)}
                    </td>
                  </tr>
                ) : null}
              </tbody>
            </table>
            {!confirmedEval.length && !confirmedCommercial.length ? (
              <p className="py-6 text-sm text-zinc-500">
                Aucune prime confirmée pour ce mois.
              </p>
            ) : null}
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
                  .filter((e) => e.isActive)
                  .map((e) => (
                    <option key={e._id} value={e._id}>
                      {e.name}
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
            {(bonuses ?? []).map((b) => (
              <div
                key={b._id}
                className="flex items-center justify-between gap-3 border-b border-zinc-100 pb-3 last:border-0"
              >
                <div>
                  <p className="font-medium">
                    {b.employee.name} · {b.title}
                  </p>
                  <p className="text-sm text-zinc-500">{b.reason}</p>
                </div>
                <p className="font-semibold text-[#0088E8]">
                  {moneyDZD(b.amount)}
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
