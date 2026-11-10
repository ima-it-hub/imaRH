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
  Modal,
  PrimaryButton,
  SecondaryButton,
  inputClass,
} from "@/components/ui";
import { useAuth } from "@/lib/auth";
import { formatDate } from "@/lib/format";

type Draft = {
  adminReport: string;
  employeeReport: string;
  scores: Record<string, number>;
};

export default function AdminReportsPage() {
  const { token } = useAuth();
  const reports = useQuery(api.reports.listAll, token ? { token } : "skip");
  const employees = useQuery(
    api.users.listEmployees,
    token ? { token } : "skip"
  );
  const confirmReport = useMutation(api.reports.confirm);
  const rejectReport = useMutation(api.reports.reject);

  const [drafts, setDrafts] = useState<Record<string, Draft>>({});
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [msg, setMsg] = useState("");
  const [error, setError] = useState("");
  const [busyId, setBusyId] = useState<string | null>(null);
  const [period, setPeriod] = useState(() => {
    const now = new Date();
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
  });
  const [filterEmployeeId, setFilterEmployeeId] = useState("");
  const [showUnevaluated, setShowUnevaluated] = useState(false);
  const [periodYear, periodMonth] = period.split("-").map(Number);

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
      };
    }
    setDrafts(next);
  }, [reports]);

  const filteredReports = useMemo(
    () =>
      (reports ?? []).filter(
        (report) =>
          report.year === periodYear &&
          report.month === periodMonth &&
          (!filterEmployeeId || report.employeeId === filterEmployeeId)
      ),
    [reports, periodYear, periodMonth, filterEmployeeId]
  );
  const pending = useMemo(
    () => filteredReports.filter((r) => r.status === "EN_ATTENTE"),
    [filteredReports]
  );
  const confirmed = useMemo(
    () => filteredReports.filter((r) => r.status === "CONFIRME"),
    [filteredReports]
  );
  const unevaluatedEmployees = useMemo(() => {
    const evaluatedIds = new Set(
      (reports ?? [])
        .filter(
          (report) =>
            report.year === periodYear && report.month === periodMonth
        )
        .map((report) => report.employeeId)
    );
    return (employees ?? []).filter(
      (employee) =>
        employee.isActive &&
        (!filterEmployeeId || employee._id === filterEmployeeId) &&
        !evaluatedIds.has(employee._id)
    );
  }, [employees, reports, periodYear, periodMonth, filterEmployeeId]);

  function draftPct(
    draft: Draft | undefined,
    conditionWeights: Record<string, number>
  ) {
    const entries = Object.entries(draft?.scores ?? {});
    if (!entries.length) return 0;
    const totalWeight = entries.reduce(
      (sum, [conditionId]) => sum + (conditionWeights[conditionId] ?? 1),
      0
    );
    if (totalWeight <= 0) return 0;
    const weightedScore = entries.reduce(
      (sum, [conditionId, points]) =>
        sum + points * (conditionWeights[conditionId] ?? 1),
      0
    );
    return Math.round((weightedScore / (totalWeight * 5)) * 1000) / 10;
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
    <RequireAuth page="admin-rapports">
      <PageShell
        title="Rapports & évaluations"
        description="Revoir les évaluations soumises. La confirmation des primes se fait aussi sur la page Primes."
      >
        {error ? <p className="mb-3 text-sm text-red-600">{error}</p> : null}
        {msg ? <p className="mb-3 text-sm text-emerald-600">{msg}</p> : null}

        <Card className="mb-6">
          <div className="flex flex-wrap items-end justify-between gap-3">
            <div className="flex flex-wrap gap-3">
              <Field label="Mois">
                <input
                  type="month"
                  className={inputClass}
                  value={period}
                  onChange={(e) => setPeriod(e.target.value)}
                />
              </Field>
              <Field label="Employé">
                <select
                  className={inputClass}
                  value={filterEmployeeId}
                  onChange={(e) => setFilterEmployeeId(e.target.value)}
                >
                  <option value="">Tous les employés</option>
                  {(employees ?? []).map((employee) => (
                    <option key={employee._id} value={employee._id}>
                      {employee.name}
                    </option>
                  ))}
                </select>
              </Field>
            </div>
            <SecondaryButton
              type="button"
              onClick={() => setShowUnevaluated(true)}
            >
              Employés non évalués ({unevaluatedEmployees.length})
            </SecondaryButton>
          </div>
        </Card>

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
              const pct = draftPct(draft, report.conditionWeights);
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

        <Modal
          open={showUnevaluated}
          onClose={() => setShowUnevaluated(false)}
          title={`Employés non évalués — ${periodMonth}/${periodYear}`}
        >
          <div className="space-y-2">
            {unevaluatedEmployees.map((employee) => (
              <div
                key={employee._id}
                className="rounded-lg border border-zinc-100 px-3 py-2"
              >
                <p className="font-medium text-zinc-900">{employee.name}</p>
                <p className="text-xs text-zinc-500">
                  {employee.department || "Aucun département"}
                </p>
              </div>
            ))}
            {!unevaluatedEmployees.length ? (
              <p className="text-sm text-zinc-500">
                Tous les employés correspondent à un rapport pour ce mois.
              </p>
            ) : null}
          </div>
        </Modal>

        <div className="space-y-4">
          <h2 className="font-semibold text-zinc-900">Confirmées</h2>
          {confirmed.map((report) => (
            <Card key={report._id}>
              <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
                <div>
                  <h3 className="font-semibold text-zinc-900">
                    Évaluation {report.month}/{report.year}
                  </h3>
                  <p className="text-xs text-zinc-500">
                    {report.employee.name} · par {report.authorName} · publiée
                    le{" "}
                    {formatDate(report.confirmedAt ?? report.publishedAt)}
                  </p>
                </div>
                <div className="flex flex-wrap gap-2">
                  <Badge className="bg-[#0088E8]/10 text-[#0088E8]">
                    Score {report.percentage}%
                  </Badge>
                </div>
              </div>
              {(report.scores ?? []).length > 0 ? (
                <div className="mb-4 grid gap-2 sm:grid-cols-2">
                  {report.scores.map((score) => (
                    <div
                      key={score.conditionId}
                      className="rounded-xl border border-zinc-100 bg-zinc-50 px-3 py-2 text-sm"
                    >
                      <p className="text-zinc-600">{score.label}</p>
                      <p className="font-semibold text-zinc-900">
                        {score.points}/5 ·{" "}
                        {Math.round((score.points / 5) * 100)}%
                      </p>
                    </div>
                  ))}
                </div>
              ) : null}
              <p className="whitespace-pre-wrap text-sm leading-6 text-zinc-700">
                {report.employeeReport || report.content || "—"}
              </p>
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
