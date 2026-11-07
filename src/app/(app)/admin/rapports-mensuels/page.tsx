"use client";

import { useEffect, useMemo, useState } from "react";
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
import { formatDate, moneyDZD } from "@/lib/format";

type Draft = {
  adminReport: string;
  employeeReport: string;
  scores: Record<string, number>;
  baseBonus: string;
};

export default function AdminReportsPage() {
  const { token } = useAuth();
  const reports = useQuery(api.reports.listAll, token ? { token } : "skip");
  const confirmReport = useMutation(api.reports.confirm);
  const rejectReport = useMutation(api.reports.reject);

  const [drafts, setDrafts] = useState<Record<string, Draft>>({});
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [msg, setMsg] = useState("");
  const [error, setError] = useState("");
  const [busyId, setBusyId] = useState<string | null>(null);

  useEffect(() => {
    if (!reports) return;
    const next: Record<string, Draft> = {};
    for (const r of reports) {
      const scores: Record<string, number> = {};
      for (const s of r.scores ?? []) {
        scores[s.conditionId] = s.points;
      }
      next[r._id] = {
        adminReport: r.adminReport || "",
        employeeReport: r.employeeReport || r.content || "",
        scores,
        baseBonus: String(r.baseBonus ?? r.employee.baseBonus ?? 0),
      };
    }
    setDrafts(next);
  }, [reports]);

  const pending = useMemo(
    () => (reports ?? []).filter((r) => r.status === "EN_ATTENTE"),
    [reports]
  );
  const confirmed = useMemo(
    () => (reports ?? []).filter((r) => r.status === "CONFIRME"),
    [reports]
  );

  function draftPct(draft: Draft | undefined) {
    const values = Object.values(draft?.scores ?? {});
    if (!values.length) return 0;
    const sum = values.reduce((a, b) => a + b, 0);
    return Math.round((sum / (values.length * 5)) * 1000) / 10;
  }

  async function onConfirm(reportId: string) {
    if (!token) return;
    const draft = drafts[reportId];
    if (!draft) return;
    setBusyId(reportId);
    setError("");
    setMsg("");
    try {
      await confirmReport({
        token,
        reportId: reportId as Id<"monthlyReports">,
        adminReport: draft.adminReport,
        employeeReport: draft.employeeReport,
        baseBonus: Number(draft.baseBonus) || 0,
        scores: Object.entries(draft.scores).map(([conditionId, points]) => ({
          conditionId: conditionId as Id<"evaluationConditions">,
          points,
        })),
      });
      setMsg("Évaluation confirmée — visible par l'employé");
      setExpandedId(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erreur");
    } finally {
      setBusyId(null);
    }
  }

  return (
    <RequireAuth role="admin">
      <PageShell
        title="Rapports & évaluations"
        description="Revoir les évaluations soumises. La confirmation des primes se fait aussi sur la page Primes."
      >
        {error ? <p className="mb-3 text-sm text-red-600">{error}</p> : null}
        {msg ? <p className="mb-3 text-sm text-emerald-600">{msg}</p> : null}

        <Card className="mb-6">
          <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
            <div>
              <h2 className="font-semibold text-zinc-900">
                En attente de confirmation
              </h2>
              <p className="text-sm text-zinc-500">
                {pending.length} évaluation(s) à revoir
              </p>
            </div>
          </div>

          <div className="space-y-3">
            {pending.map((report) => {
              const draft = drafts[report._id];
              const open = expandedId === report._id;
              const pct = draftPct(draft);
              const prime = Math.round(
                ((Number(draft?.baseBonus) || 0) * pct) / 100
              );
              return (
                <div
                  key={report._id}
                  className="overflow-hidden rounded-2xl border border-amber-200 bg-amber-50/40"
                >
                  <button
                    type="button"
                    className="flex w-full flex-wrap items-center justify-between gap-3 px-4 py-3 text-left"
                    onClick={() =>
                      setExpandedId((id) =>
                        id === report._id ? null : report._id
                      )
                    }
                  >
                    <div>
                      <p className="font-semibold text-zinc-900">
                        {report.employee.name} · {report.month}/{report.year}
                      </p>
                      <p className="text-xs text-zinc-500">
                        Soumis par {report.authorName} ·{" "}
                        {formatDate(report.submittedAt ?? report.publishedAt)}
                      </p>
                    </div>
                    <div className="flex flex-wrap gap-2">
                      <Badge className="bg-amber-100 text-amber-800">
                        En attente
                      </Badge>
                      <Badge className="bg-[#0088E8]/10 text-[#0088E8]">
                        {pct || report.percentage}%
                      </Badge>
                      <Badge className="bg-emerald-50 text-emerald-700">
                        {moneyDZD(prime || report.computedBonus)}
                      </Badge>
                    </div>
                  </button>

                  {open && draft ? (
                    <div className="space-y-3 border-t border-amber-100 bg-white px-4 py-4">
                      {(report.scores ?? []).map((s) => (
                        <Field key={s.conditionId} label={s.label}>
                          <select
                            className={inputClass}
                            value={draft.scores[s.conditionId] ?? s.points}
                            onChange={(e) =>
                              setDrafts((prev) => ({
                                ...prev,
                                [report._id]: {
                                  ...draft,
                                  scores: {
                                    ...draft.scores,
                                    [s.conditionId]: Number(e.target.value),
                                  },
                                },
                              }))
                            }
                          >
                            {[1, 2, 3, 4, 5].map((n) => (
                              <option key={n} value={n}>
                                {n} / 5
                              </option>
                            ))}
                          </select>
                        </Field>
                      ))}

                      <Field label="Prime de base (DZD)">
                        <input
                          type="number"
                          min={0}
                          className={inputClass}
                          value={draft.baseBonus}
                          onChange={(e) =>
                            setDrafts((prev) => ({
                              ...prev,
                              [report._id]: {
                                ...draft,
                                baseBonus: e.target.value,
                              },
                            }))
                          }
                        />
                      </Field>

                      <p className="rounded-xl bg-zinc-50 px-3 py-2 text-xs text-zinc-600">
                        Score {pct}% → prime estimée{" "}
                        <strong>{moneyDZD(prime)}</strong>
                      </p>

                      <Field label="Rapport admin">
                        <textarea
                          rows={3}
                          className={inputClass}
                          value={draft.adminReport}
                          onChange={(e) =>
                            setDrafts((prev) => ({
                              ...prev,
                              [report._id]: {
                                ...draft,
                                adminReport: e.target.value,
                              },
                            }))
                          }
                        />
                      </Field>
                      <Field label="Rapport employé">
                        <textarea
                          rows={3}
                          className={inputClass}
                          value={draft.employeeReport}
                          onChange={(e) =>
                            setDrafts((prev) => ({
                              ...prev,
                              [report._id]: {
                                ...draft,
                                employeeReport: e.target.value,
                              },
                            }))
                          }
                        />
                      </Field>

                      <div className="flex flex-wrap gap-2">
                        <PrimaryButton
                          type="button"
                          disabled={busyId === report._id}
                          onClick={() => void onConfirm(report._id)}
                        >
                          {busyId === report._id
                            ? "Confirmation…"
                            : "Confirmer & publier"}
                        </PrimaryButton>
                        <SecondaryButton
                          type="button"
                          disabled={busyId === report._id}
                          onClick={async () => {
                            if (!token) return;
                            if (
                              !window.confirm("Supprimer cette évaluation ?")
                            ) {
                              return;
                            }
                            try {
                              await rejectReport({
                                token,
                                reportId: report._id as Id<"monthlyReports">,
                              });
                              setMsg("Évaluation rejetée / supprimée");
                            } catch (err) {
                              setError(
                                err instanceof Error ? err.message : "Erreur"
                              );
                            }
                          }}
                        >
                          Rejeter
                        </SecondaryButton>
                      </div>
                    </div>
                  ) : null}
                </div>
              );
            })}
            {!pending.length ? (
              <p className="text-sm text-zinc-500">
                Aucune évaluation en attente.
              </p>
            ) : null}
          </div>
        </Card>

        <div className="space-y-3">
          <h2 className="font-semibold text-zinc-900">Confirmées</h2>
          {confirmed.map((report) => (
            <Card key={report._id}>
              <div className="mb-2 flex flex-wrap items-center justify-between gap-3">
                <div>
                  <h3 className="font-semibold text-zinc-900">
                    {report.employee.name} · {report.month}/{report.year}
                  </h3>
                  <p className="text-xs text-zinc-500">
                    Par {report.authorName} · confirmée le{" "}
                    {formatDate(report.confirmedAt ?? report.publishedAt)}
                  </p>
                </div>
                <div className="flex flex-wrap gap-2">
                  <Badge className="bg-emerald-50 text-emerald-700">
                    Confirmée
                  </Badge>
                  <Badge className="bg-[#0088E8]/10 text-[#0088E8]">
                    {report.percentage}%
                  </Badge>
                  <Badge className="bg-zinc-100 text-zinc-700">
                    Prime {moneyDZD(report.computedBonus)}
                  </Badge>
                </div>
              </div>
              {(report.scores ?? []).length > 0 ? (
                <div className="mb-3 grid gap-1 sm:grid-cols-2">
                  {report.scores.map((s) => (
                    <p key={s.conditionId} className="text-xs text-zinc-600">
                      {s.label} : <strong>{s.points}/5</strong>
                    </p>
                  ))}
                </div>
              ) : null}
              <div className="space-y-3">
                <div>
                  <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-zinc-500">
                    Rapport admin
                  </p>
                  <p className="whitespace-pre-wrap text-sm leading-6 text-zinc-700">
                    {report.adminReport || "—"}
                  </p>
                </div>
                <div>
                  <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-zinc-500">
                    Rapport employé
                  </p>
                  <p className="whitespace-pre-wrap text-sm leading-6 text-zinc-700">
                    {report.employeeReport || report.content || "—"}
                  </p>
                </div>
              </div>
            </Card>
          ))}
          {!confirmed.length ? (
            <Card>
              <p className="text-sm text-zinc-500">
                Aucune évaluation confirmée.
              </p>
            </Card>
          ) : null}
        </div>
      </PageShell>
    </RequireAuth>
  );
}
