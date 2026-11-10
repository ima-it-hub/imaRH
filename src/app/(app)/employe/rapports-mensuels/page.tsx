"use client";

import { FormEvent, useMemo, useState } from "react";
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
import { formatDate } from "@/lib/format";

function mondayDateInput() {
  const date = new Date();
  date.setDate(date.getDate() - ((date.getDay() + 6) % 7));
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

export default function EmployeeReportsPage() {
  const { token } = useAuth();
  const reports = useQuery(api.reports.myReports, token ? { token } : "skip");
  const team = useQuery(api.reports.myTeam, token ? { token } : "skip");
  const teamReports = useQuery(
    api.reports.listTeamReports,
    token ? { token } : "skip"
  );
  const publish = useMutation(api.reports.publish);
  const saveWeeklyEvaluation = useMutation(api.reports.saveWeeklyEvaluation);

  const [year, setYear] = useState(new Date().getFullYear());
  const [month, setMonth] = useState(0);
  const [selectedTab, setSelectedTab] = useState<"mine" | "team" | null>(
    null
  );
  const now = new Date();
  const [employeeId, setEmployeeId] = useState("");
  const [evalMonth, setEvalMonth] = useState(String(now.getMonth() + 1));
  const [evalYear, setEvalYear] = useState(String(now.getFullYear()));
  const [adminReport, setAdminReport] = useState("");
  const [employeeReport, setEmployeeReport] = useState("");
  const [monthlyScoreDraft, setMonthlyScoreDraft] = useState<{
    key: string;
    scores: Record<string, number>;
  } | null>(null);
  const [weeklyScoreDraft, setWeeklyScoreDraft] = useState<{
    key: string;
    scores: Record<string, number>;
  } | null>(null);
  const [weeklyMessageDraft, setWeeklyMessageDraft] = useState<{
    key: string;
    message: string;
  } | null>(null);
  const [evaluationMode, setEvaluationMode] = useState<"weekly" | "monthly">(
    "weekly"
  );
  const [weekStart, setWeekStart] = useState(mondayDateInput);
  const [msg, setMsg] = useState("");
  const [error, setError] = useState("");

  const isManager = (team?.length ?? 0) > 0;
  const tab = selectedTab ?? (isManager ? "team" : "mine");

  const conditions = useQuery(
    api.reports.conditionsForEmployee,
    token && employeeId
      ? { token, employeeId: employeeId as Id<"users"> }
      : "skip"
  );
  const weekEvaluation = useQuery(
    api.reports.managerWeeklyEvaluation,
    token &&
      employeeId &&
      evaluationMode === "weekly" &&
      weekStart &&
      new Date(`${weekStart}T00:00:00Z`).getUTCDay() === 1
      ? {
          token,
          employeeId: employeeId as Id<"users">,
          weekStart,
        }
      : "skip"
  );
  const weeklyAverage = useQuery(
    api.reports.monthlyWeeklyAverage,
    token &&
      employeeId &&
      evaluationMode === "monthly" &&
      Number.isInteger(Number(evalMonth)) &&
      Number(evalMonth) >= 1 &&
      Number(evalMonth) <= 12 &&
      Number.isInteger(Number(evalYear))
      ? {
          token,
          employeeId: employeeId as Id<"users">,
          month: Number(evalMonth),
          year: Number(evalYear),
        }
      : "skip"
  );

  const selected = useMemo(
    () => (team ?? []).find((e) => e._id === employeeId),
    [team, employeeId]
  );

  const weeklyScoreKey = `${employeeId}:${weekStart}`;
  const weeklyAdminMessage =
    weeklyMessageDraft?.key === weeklyScoreKey
      ? weeklyMessageDraft.message
      : weekEvaluation?.adminMessage ?? "";
  const weeklyScores = useMemo(() => {
    if (weeklyScoreDraft?.key === weeklyScoreKey) return weeklyScoreDraft.scores;
    const savedScores = new Map(
      (weekEvaluation?.scores ?? []).map((score) => [
        score.conditionId,
        score.points,
      ])
    );
    return Object.fromEntries(
      (conditions ?? []).map((condition) => [
        condition._id,
        savedScores.get(condition._id) ?? 3,
      ])
    );
  }, [conditions, weekEvaluation, weeklyScoreDraft, weeklyScoreKey]);
  const monthlyScoreKey = `${employeeId}:${evalYear}:${evalMonth}:${JSON.stringify(
    weeklyAverage?.scores ?? []
  )}`;
  const scores = useMemo(
    () =>
      monthlyScoreDraft?.key === monthlyScoreKey
        ? monthlyScoreDraft.scores
        : Object.fromEntries(
            (weeklyAverage?.scores ?? []).map((score) => [
              score.conditionId,
              Math.min(5, Math.max(1, Math.round(score.points))),
            ])
          ),
    [monthlyScoreDraft, monthlyScoreKey, weeklyAverage]
  );

  const previewPct = useMemo(() => {
    const scoredConditions = (conditions ?? []).filter(
      (condition) => scores[condition._id] !== undefined
    );
    if (!scoredConditions.length) return 0;
    const totalWeight = scoredConditions.reduce(
      (sum, condition) => sum + (condition.weightPercent ?? 1),
      0
    );
    if (totalWeight <= 0) return 0;
    const weightedScore = scoredConditions.reduce(
      (sum, condition) =>
        sum +
        scores[condition._id]! * (condition.weightPercent ?? 1),
      0
    );
    return Math.round((weightedScore / (totalWeight * 5)) * 1000) / 10;
  }, [conditions, scores]);

  const filtered = useMemo(() => {
    return (reports ?? []).filter((r) => {
      if (r.year !== year) return false;
      if (month && r.month !== month) return false;
      return true;
    });
  }, [reports, year, month]);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (!token || !employeeId) return;
    setError("");
    setMsg("");
    try {
      if (evaluationMode === "weekly") {
        await saveWeeklyEvaluation({
          token,
          employeeId: employeeId as Id<"users">,
          weekStart,
          adminMessage: weeklyAdminMessage,
          scores: Object.entries(weeklyScores).map(([conditionId, points]) => ({
            conditionId: conditionId as Id<"evaluationConditions">,
            points,
          })),
        });
        setMsg("Évaluation semaine envoyée à l'admin pour confirmation.");
        return;
      }
      await publish({
        token,
        employeeId: employeeId as Id<"users">,
        month: Number(evalMonth),
        year: Number(evalYear),
        adminReport,
        employeeReport,
        scores: Object.entries(scores).map(([conditionId, points]) => ({
          conditionId: conditionId as Id<"evaluationConditions">,
          points,
        })),
      });
      setMsg("Évaluation soumise — en attente de confirmation admin");
      setAdminReport("");
      setEmployeeReport("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erreur");
    }
  }

  return (
    <RequireAuth role="employee" page="rapports-mensuels">
      <PageShell
        title="Rapports mensuels"
        description={
          isManager
            ? "Évaluez votre équipe et consultez vos propres retours."
            : "Consultez les retours et le pourcentage d'évaluation publiés par votre manager."
        }
      >
        {isManager ? (
          <div className="mb-4 flex gap-2">
            <button
              type="button"
              onClick={() => setSelectedTab("team")}
              className={`rounded-xl px-4 py-2 text-sm font-medium ${
                tab === "team"
                  ? "bg-[#0088E8] text-white"
                  : "bg-zinc-100 text-zinc-700"
              }`}
            >
              Évaluer mon équipe
            </button>
            <button
              type="button"
              onClick={() => setSelectedTab("mine")}
              className={`rounded-xl px-4 py-2 text-sm font-medium ${
                tab === "mine"
                  ? "bg-[#0088E8] text-white"
                  : "bg-zinc-100 text-zinc-700"
              }`}
            >
              Mes rapports
            </button>
          </div>
        ) : null}

        {tab === "team" && isManager ? (
          <div className="grid gap-6 lg:grid-cols-[420px_1fr]">
            <Card>
              <h2 className="font-semibold text-zinc-900">Évaluer un collaborateur</h2>
              <form onSubmit={onSubmit} className="mt-4 space-y-3">
                <Field label="Collaborateur">
                  <select
                    required
                    className={inputClass}
                    value={employeeId}
                    onChange={(e) => setEmployeeId(e.target.value)}
                  >
                    <option value="">Choisir…</option>
                    {(team ?? []).map((e) => (
                      <option key={e._id} value={e._id}>
                        {e.name}
                        {e.department ? ` · ${e.department}` : ""}
                      </option>
                    ))}
                  </select>
                </Field>
                <div className="grid grid-cols-2 gap-2">
                  <button
                    type="button"
                    onClick={() => {
                      setEvaluationMode("weekly");
                      setError("");
                      setMsg("");
                    }}
                    className={`rounded-xl px-3 py-2 text-sm font-medium ${
                      evaluationMode === "weekly"
                        ? "bg-[#0088E8] text-white"
                        : "bg-zinc-100 text-zinc-700"
                    }`}
                  >
                    Évaluation semaine
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setEvaluationMode("monthly");
                      setError("");
                      setMsg("");
                    }}
                    className={`rounded-xl px-3 py-2 text-sm font-medium ${
                      evaluationMode === "monthly"
                        ? "bg-[#0088E8] text-white"
                        : "bg-zinc-100 text-zinc-700"
                    }`}
                  >
                    Rapport mensuel
                  </button>
                </div>
                {evaluationMode === "weekly" ? (
                  <Field label="Semaine (lundi)">
                    <input
                      type="date"
                      required
                      className={inputClass}
                      value={weekStart}
                      onChange={(e) => setWeekStart(e.target.value)}
                    />
                    {weekStart &&
                    new Date(`${weekStart}T00:00:00Z`).getUTCDay() !== 1 ? (
                      <p className="mt-1 text-xs text-red-600">
                        Sélectionnez le lundi de la semaine.
                      </p>
                    ) : null}
                  </Field>
                ) : (
                  <div className="grid grid-cols-2 gap-2">
                    <Field label="Mois">
                      <select
                        className={inputClass}
                        value={evalMonth}
                        onChange={(e) => setEvalMonth(e.target.value)}
                      >
                        {Array.from({ length: 12 }, (_, index) => (
                          <option key={index + 1} value={index + 1}>
                            {new Date(2000, index, 1).toLocaleString("fr-DZ", {
                              month: "long",
                            })}
                          </option>
                        ))}
                      </select>
                    </Field>
                    <Field label="Année">
                      <input
                        type="number"
                        min={2000}
                        className={inputClass}
                        value={evalYear}
                        onChange={(e) => setEvalYear(e.target.value)}
                      />
                    </Field>
                  </div>
                )}

                {evaluationMode === "monthly" &&
                weeklyAverage &&
                weeklyAverage.weekCount > 0 ? (
                  <p className="rounded-xl bg-zinc-50 px-3 py-2 text-xs text-zinc-600">
                    Moyenne de {weeklyAverage.weekCount} semaine(s) :{" "}
                    <strong>{weeklyAverage.percentage}%</strong>
                    {selected?.department
                      ? ` · ${selected.department}`
                      : ""}
                  </p>
                ) : null}
                {evaluationMode === "monthly" &&
                weeklyAverage &&
                weeklyAverage.weekCount === 0 ? (
                  <p className="rounded-xl bg-amber-50 px-3 py-2 text-sm text-amber-800">
                    Aucune évaluation semaine confirmée pour ce mois.
                    L&apos;admin doit confirmer les évaluations semaine avant le
                    rapport mensuel.
                  </p>
                ) : null}
                {evaluationMode === "weekly" &&
                selected &&
                Object.keys(weeklyScores).length > 0 ? (
                  <p className="rounded-xl bg-zinc-50 px-3 py-2 text-xs text-zinc-600">
                    {weekEvaluation?.status === "CONFIRME"
                      ? "Cette évaluation semaine est confirmée et ne peut plus être modifiée."
                      : weekEvaluation
                        ? "En attente de confirmation. Vous pouvez encore modifier cette évaluation semaine."
                        : "L'évaluation semaine sera envoyée à l'admin pour confirmation."}
                  </p>
                ) : null}

                {employeeId && !(conditions?.length) ? (
                  <p className="text-sm text-amber-700">
                    Pas de conditions pour ce département. Contactez l&apos;admin
                    RH.
                  </p>
                ) : null}

                {(conditions ?? []).map((c) =>
                  evaluationMode === "weekly" ? (
                    <fieldset
                      key={c._id}
                      className="rounded-xl border border-zinc-200 p-4"
                    >
                      <legend className="px-1 text-sm font-semibold text-zinc-900">
                        {c.label}
                      </legend>
                      {c.description ? (
                        <p className="mb-3 text-sm leading-5 text-zinc-600">
                          {c.description}
                        </p>
                      ) : null}
                      <div
                        className="flex flex-wrap gap-2"
                        role="radiogroup"
                        aria-label={`Note pour ${c.label}`}
                      >
                        {[1, 2, 3, 4, 5].map((n) => (
                          <label
                            key={n}
                            className={`flex min-w-12 cursor-pointer items-center justify-center gap-1.5 rounded-lg border px-3 py-2 text-sm transition ${
                              (weeklyScores[c._id] ?? 3) === n
                                ? "border-[#0088E8] bg-[#0088E8]/10 font-semibold text-[#0074c7]"
                                : "border-zinc-200 text-zinc-600 hover:bg-zinc-50"
                            }`}
                          >
                            <input
                              type="radio"
                              name={`score-${c._id}`}
                              value={n}
                              checked={(weeklyScores[c._id] ?? 3) === n}
                              disabled={
                                weekEvaluation?.status === "CONFIRME"
                              }
                              onChange={() =>
                                setWeeklyScoreDraft({
                                  key: weeklyScoreKey,
                                  scores: { ...weeklyScores, [c._id]: n },
                                })
                              }
                              className="accent-[#0088E8]"
                              aria-label={`${n} sur 5`}
                            />
                            <span>{n}</span>
                          </label>
                        ))}
                      </div>
                      <p className="mt-2 text-xs text-zinc-500">Note sur 5</p>
                    </fieldset>
                  ) : (
                    <fieldset
                      key={c._id}
                      className="rounded-xl border border-zinc-200 p-4"
                    >
                      <legend className="px-1 text-sm font-semibold text-zinc-900">
                        {c.label}
                      </legend>
                      {c.description ? (
                        <p className="mb-2 text-sm leading-5 text-zinc-600">
                          {c.description}
                        </p>
                      ) : null}
                      <p className="mb-3 text-xs text-zinc-500">
                        Moyenne hebdomadaire :{" "}
                        <strong>
                          {weeklyAverage?.scores
                            .find((score) => score.conditionId === c._id)
                            ?.points.toFixed(1) ?? "—"}
                          /5
                        </strong>
                        {" · Note mensuelle arrondie : "}
                        <strong>{scores[c._id] ?? "—"}/5</strong>
                      </p>
                      <div
                        className="flex flex-wrap gap-2"
                        role="radiogroup"
                        aria-label={`Note mensuelle pour ${c.label}`}
                      >
                        {[1, 2, 3, 4, 5].map((n) => (
                          <label
                            key={n}
                            className={`flex min-w-12 cursor-pointer items-center justify-center gap-1.5 rounded-lg border px-3 py-2 text-sm transition ${
                              scores[c._id] === n
                                ? "border-[#0088E8] bg-[#0088E8]/10 font-semibold text-[#0074c7]"
                                : "border-zinc-200 text-zinc-600 hover:bg-zinc-50"
                            }`}
                          >
                            <input
                              type="radio"
                              name={`monthly-score-${c._id}`}
                              value={n}
                              checked={scores[c._id] === n}
                              onChange={() =>
                                setMonthlyScoreDraft({
                                  key: monthlyScoreKey,
                                  scores: { ...scores, [c._id]: n },
                                })
                              }
                              className="accent-[#0088E8]"
                              aria-label={`${n} sur 5`}
                            />
                            <span>{n}</span>
                          </label>
                        ))}
                      </div>
                      <p className="mt-2 text-xs text-zinc-500">
                        Choisissez la note mensuelle sur 5.
                      </p>
                    </fieldset>
                  )
                )}

                {evaluationMode === "weekly" ? (
                  <Field label="Message pour l'admin">
                    <textarea
                      required
                      rows={3}
                      className={inputClass}
                      value={weeklyAdminMessage}
                      disabled={weekEvaluation?.status === "CONFIRME"}
                      placeholder="Ajoutez un commentaire concernant cette évaluation semaine."
                      onChange={(e) =>
                        setWeeklyMessageDraft({
                          key: weeklyScoreKey,
                          message: e.target.value,
                        })
                      }
                    />
                  </Field>
                ) : null}

                {evaluationMode === "monthly" ? (
                  <>
                    <p className="rounded-xl bg-zinc-50 px-3 py-2 text-xs text-zinc-600">
                      Modifiez les moyennes par condition si nécessaire.
                      L&apos;employé ne verra ce bilan qu&apos;après confirmation de
                      l&apos;admin. Score calculé : <strong>{previewPct}%</strong>
                    </p>
                    <Field label="Rapport pour l'admin">
                      <textarea
                        required
                        rows={4}
                        className={inputClass}
                        value={adminReport}
                        onChange={(e) => setAdminReport(e.target.value)}
                      />
                    </Field>
                    <Field label="Rapport pour l'employé">
                      <textarea
                        required
                        rows={4}
                        className={inputClass}
                        value={employeeReport}
                        onChange={(e) => setEmployeeReport(e.target.value)}
                      />
                    </Field>
                  </>
                ) : null}

                {error ? <p className="text-sm text-red-600">{error}</p> : null}
                {msg ? <p className="text-sm text-emerald-600">{msg}</p> : null}
                <PrimaryButton
                  type="submit"
                  className="w-full"
                  disabled={
                    evaluationMode === "monthly" &&
                    (!conditions?.length ||
                      !weeklyAverage?.weekCount ||
                      (conditions ?? []).some(
                        (condition) => !scores[condition._id]
                      ))
                    || (evaluationMode === "weekly" &&
                      (!weekStart ||
                        new Date(`${weekStart}T00:00:00Z`).getUTCDay() !== 1 ||
                        weekEvaluation === undefined ||
                        !conditions?.length ||
                        !weeklyAdminMessage.trim() ||
                        weekEvaluation?.status === "CONFIRME"))
                  }
                >
                  {evaluationMode === "weekly"
                    ? weekEvaluation?.status === "CONFIRME"
                      ? "Évaluation semaine confirmée"
                      : "Envoyer l'évaluation semaine"
                    : "Soumettre à l'admin"}
                </PrimaryButton>
                {evaluationMode === "monthly" ? (
                  <p className="text-xs text-zinc-500">
                    L&apos;employé ne verra le rapport qu&apos;après confirmation par
                    l&apos;admin RH.
                  </p>
                ) : null}
              </form>
            </Card>

            <div className="space-y-3">
              {(teamReports ?? []).map((report) => (
                <Card key={report._id}>
                  <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                    <h3 className="font-semibold text-zinc-900">
                      {report.employee.name} · {report.month}/{report.year}
                    </h3>
                    <div className="flex gap-2">
                      <Badge
                        className={
                          report.status === "EN_ATTENTE"
                            ? "bg-amber-50 text-amber-700"
                            : "bg-emerald-50 text-emerald-700"
                        }
                      >
                        {report.status === "EN_ATTENTE"
                          ? "En attente admin"
                          : "Confirmée"}
                      </Badge>
                      <Badge className="bg-[#0088E8]/10 text-[#0088E8]">
                        Score {report.percentage}%
                      </Badge>
                    </div>
                  </div>
                  <p className="mb-2 text-xs font-semibold uppercase text-zinc-500">
                    Rapport admin
                  </p>
                  <p className="mb-3 whitespace-pre-wrap text-sm text-zinc-700">
                    {report.adminReport || "—"}
                  </p>
                  <p className="mb-2 text-xs font-semibold uppercase text-zinc-500">
                    Rapport employé
                  </p>
                  <p className="whitespace-pre-wrap text-sm text-zinc-700">
                    {report.employeeReport}
                  </p>
                </Card>
              ))}
              {!teamReports?.length ? (
                <Card>
                  <p className="text-sm text-zinc-500">
                    Aucune évaluation d&apos;équipe pour le moment.
                  </p>
                </Card>
              ) : null}
            </div>
          </div>
        ) : (
          <>
            <div className="mb-4 flex flex-wrap gap-3">
              <select
                value={month}
                onChange={(e) => setMonth(Number(e.target.value))}
                className="rounded-xl border border-zinc-200 px-3 py-2 text-sm"
              >
                <option value={0}>Tous les mois</option>
                {Array.from({ length: 12 }, (_, i) => (
                  <option key={i + 1} value={i + 1}>
                    {new Date(2000, i, 1).toLocaleString("fr-DZ", {
                      month: "long",
                    })}
                  </option>
                ))}
              </select>
              <input
                type="number"
                value={year}
                onChange={(e) => setYear(Number(e.target.value))}
                className="w-28 rounded-xl border border-zinc-200 px-3 py-2 text-sm"
              />
            </div>

            <div className="space-y-4">
              {filtered.map((report) => (
                <Card key={report._id}>
                  <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
                    <div>
                      <h2 className="font-semibold text-zinc-900">
                        Évaluation {report.month}/{report.year}
                      </h2>
                      <p className="text-xs text-zinc-500">
                        Publié le {formatDate(report.publishedAt)}
                      </p>
                    </div>
                    <div className="flex flex-wrap gap-2">
                      <Badge className="bg-[#0088E8]/10 text-[#0088E8]">
                        Score {report.percentage}%
                      </Badge>
                    </div>
                  </div>

                  <p className="whitespace-pre-wrap text-sm leading-6 text-zinc-700">
                    {report.employeeReport}
                  </p>
                </Card>
              ))}
              {!filtered.length ? (
                <Card>
                  <p className="text-sm text-zinc-500">
                    Aucun rapport pour cette période.
                  </p>
                </Card>
              ) : null}
            </div>
          </>
        )}
      </PageShell>
    </RequireAuth>
  );
}
