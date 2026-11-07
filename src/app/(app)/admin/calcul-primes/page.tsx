"use client";

import { useEffect, useState } from "react";
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

type Draft = {
  objective: string;
  realisation: string;
  recouvrement: string;
};

export default function AdminCalculPrimesPage() {
  const { token } = useAuth();
  const now = new Date();
  const [month, setMonth] = useState(now.getMonth() + 1);
  const [year, setYear] = useState(now.getFullYear());
  const [drafts, setDrafts] = useState<Record<string, Draft>>({});
  const [busyId, setBusyId] = useState<string | null>(null);
  const [msg, setMsg] = useState("");
  const [error, setError] = useState("");

  const rows = useQuery(
    api.primeCalculations.percentageEmployeesForMonth,
    token ? { token, month, year } : "skip"
  );
  const saveDraft = useMutation(api.primeCalculations.saveDraft);

  useEffect(() => {
    if (!rows) return;
    setDrafts((prev) => {
      const next: Record<string, Draft> = {};
      for (const row of rows) {
        const id = row.employee._id;
        const calc = row.calculation;
        next[id] = prev[id] ?? {
          objective: String(calc?.objective ?? ""),
          realisation: String(calc?.realisation ?? ""),
          recouvrement: String(calc?.recouvrement ?? ""),
        };
      }
      return next;
    });
  }, [rows]);

  const weights = rows?.[0]?.weights ?? {
    objective: 80,
    recovery: 10,
    evaluation: 10,
  };

  function updateDraft(
    employeeId: string,
    field: keyof Draft,
    value: string
  ) {
    setDrafts((prev) => ({
      ...prev,
      [employeeId]: {
        objective: prev[employeeId]?.objective ?? "",
        realisation: prev[employeeId]?.realisation ?? "",
        recouvrement: prev[employeeId]?.recouvrement ?? "",
        [field]: value,
      },
    }));
  }

  async function onSave(employeeId: Id<"users">) {
    if (!token) return;
    const draft = drafts[employeeId];
    if (!draft) return;
    setBusyId(employeeId);
    setError("");
    setMsg("");
    try {
      await saveDraft({
        token,
        employeeId,
        month,
        year,
        objective: Number(draft.objective) || 0,
        realisation: Number(draft.realisation) || 0,
        recouvrement: Number(draft.recouvrement) || 0,
      });
      setMsg(
        "Calcul enregistré — confirmez la prime sur la page Primes pour la créditer au solde"
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erreur");
    } finally {
      setBusyId(null);
    }
  }

  return (
    <RequireAuth role="admin">
      <PageShell
        title="Calcul des primes"
        description="Saisissez objectif, réalisation et recouvrement pour calculer la prime commerciale. La confirmation finale (crédit solde) se fait ensuite sur la page Primes, avec les primes d'évaluation."
      >
        {msg ? (
          <p className="mb-4 text-sm text-emerald-600">{msg}</p>
        ) : null}
        {error ? <p className="mb-4 text-sm text-red-600">{error}</p> : null}

        <div className="mb-4 flex flex-wrap items-end gap-3">
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
          <p className="pb-2 text-xs text-zinc-500">
            Pondérations : objectif {weights.objective}% · recouvrement{" "}
            {weights.recovery}% · évaluation {weights.evaluation}%
          </p>
        </div>

        <Card>
          <div className="overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead className="text-xs uppercase text-zinc-500">
                <tr>
                  <th className="pb-3 pr-3 text-left">Employé</th>
                  <th className="pb-3 pr-3 text-right">%</th>
                  <th className="pb-3 pr-3 text-left">Objectif</th>
                  <th className="pb-3 pr-3 text-left">Réalisation</th>
                  <th className="pb-3 pr-3 text-left">Recouvrement</th>
                  <th className="pb-3 pr-3 text-right">Prime base</th>
                  <th className="pb-3 pr-3 text-right">Obj.</th>
                  <th className="pb-3 pr-3 text-right">Rec.</th>
                  <th className="pb-3 pr-3 text-right">Éval.</th>
                  <th className="pb-3 pr-3 text-right">Total</th>
                  <th className="pb-3 pr-3 text-left">Statut</th>
                  <th className="pb-3 text-right">Actions</th>
                </tr>
              </thead>
              <tbody>
                {(rows ?? []).map((row) => {
                  const id = row.employee._id;
                  const draft = drafts[id] ?? {
                    objective: "",
                    realisation: "",
                    recouvrement: "",
                  };
                  const calc = row.calculation;
                  const confirmed = calc?.status === "CONFIRME";
                  const evalPct = calc?.evaluationPercent ?? row.evaluationPercent;

                  return (
                    <tr key={id} className="border-t border-zinc-100 align-top">
                      <td className="py-3 pr-3">
                        <p className="font-medium text-zinc-900">
                          {row.employee.name}
                        </p>
                        <p className="text-xs text-zinc-500">
                          {row.employee.department || "—"}
                        </p>
                      </td>
                      <td className="py-3 pr-3 text-right font-medium">
                        {row.employee.bonusPercent ?? 0}%
                      </td>
                      <td className="py-3 pr-3">
                        <input
                          type="number"
                          min={0}
                          disabled={confirmed}
                          className="w-28 rounded-lg border border-zinc-200 px-2 py-1.5"
                          value={draft.objective}
                          onChange={(e) =>
                            updateDraft(id, "objective", e.target.value)
                          }
                        />
                      </td>
                      <td className="py-3 pr-3">
                        <input
                          type="number"
                          min={0}
                          disabled={confirmed}
                          className="w-28 rounded-lg border border-zinc-200 px-2 py-1.5"
                          value={draft.realisation}
                          onChange={(e) =>
                            updateDraft(id, "realisation", e.target.value)
                          }
                        />
                      </td>
                      <td className="py-3 pr-3">
                        <input
                          type="number"
                          min={0}
                          disabled={confirmed}
                          className="w-28 rounded-lg border border-zinc-200 px-2 py-1.5"
                          value={draft.recouvrement}
                          onChange={(e) =>
                            updateDraft(id, "recouvrement", e.target.value)
                          }
                        />
                      </td>
                      <td className="py-3 pr-3 text-right text-zinc-700">
                        {calc ? moneyDZD(calc.primeBase) : "—"}
                      </td>
                      <td className="py-3 pr-3 text-right text-zinc-700">
                        {calc ? (
                          <>
                            <span className="block">
                              {moneyDZD(calc.objectiveAmount)}
                            </span>
                            <span className="text-xs text-zinc-400">
                              {(calc.objectiveRatio * 100).toFixed(0)}%
                            </span>
                          </>
                        ) : (
                          "—"
                        )}
                      </td>
                      <td className="py-3 pr-3 text-right text-zinc-700">
                        {calc ? (
                          <>
                            <span className="block">
                              {moneyDZD(calc.recoveryAmount)}
                            </span>
                            <span className="text-xs text-zinc-400">
                              {(calc.recoveryRatio * 100).toFixed(0)}%
                            </span>
                          </>
                        ) : (
                          "—"
                        )}
                      </td>
                      <td className="py-3 pr-3 text-right text-zinc-700">
                        {calc ? (
                          <>
                            <span className="block">
                              {moneyDZD(calc.evaluationAmount)}
                            </span>
                            <span className="text-xs text-zinc-400">
                              {evalPct}%
                            </span>
                          </>
                        ) : (
                          <span className="text-xs text-zinc-400">
                            {row.evaluationPercent}%
                          </span>
                        )}
                      </td>
                      <td className="py-3 pr-3 text-right font-semibold text-zinc-900">
                        {calc ? moneyDZD(calc.totalAmount) : "—"}
                      </td>
                      <td className="py-3 pr-3">
                        {confirmed ? (
                          <Badge className="bg-emerald-100 text-emerald-800">
                            Confirmé
                          </Badge>
                        ) : calc ? (
                          <Badge className="bg-amber-100 text-amber-800">
                            Brouillon
                          </Badge>
                        ) : (
                          <Badge className="bg-zinc-100 text-zinc-600">
                            À saisir
                          </Badge>
                        )}
                      </td>
                      <td className="py-3 text-right">
                        {!confirmed ? (
                          <PrimaryButton
                            type="button"
                            disabled={busyId === id}
                            onClick={() => onSave(id)}
                          >
                            {busyId === id ? "…" : "Calculer"}
                          </PrimaryButton>
                        ) : (
                          <span className="text-xs text-emerald-700">
                            Confirmée (page Primes)
                          </span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            {!rows?.length ? (
              <p className="py-8 text-sm text-zinc-500">
                Aucun employé avec une prime en pourcentage. Définissez le type
                de prime sur la fiche employé.
              </p>
            ) : null}
          </div>
        </Card>
      </PageShell>
    </RequireAuth>
  );
}
