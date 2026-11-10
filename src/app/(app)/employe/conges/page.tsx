"use client";

import { FormEvent, useMemo, useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { Pencil } from "lucide-react";
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
import {
  annualLeaveMinStartISO,
  formatDate,
  leaveTypeLabel,
  leaveTypeOptions,
  type LeaveType,
  leaveStatusLabel,
  statusBadgeClass,
} from "@/lib/format";
import { printLeaveHistory } from "@/lib/pdfExport";

function leaveDaysPreview(start: string, end: string) {
  if (!start || !end || end <= start) return 0;
  const a = new Date(start + "T00:00:00");
  const b = new Date(end + "T00:00:00");
  return Math.round((b.getTime() - a.getTime()) / 86400000);
}

export default function CongesPage() {
  const { token, user } = useAuth();
  const leaves = useQuery(api.leaves.myLeaves, token ? { token } : "skip");
  const annualBalance = useQuery(
    api.leaves.myBalance,
    token ? { token } : "skip"
  );
  const requestLeave = useMutation(api.leaves.request);
  const updateLeave = useMutation(api.leaves.updateMyPendingRequest);

  const [type, setType] = useState<LeaveType>(
    leaveTypeOptions[0].value
  );
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [reason, setReason] = useState("");
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [busy, setBusy] = useState(false);
  const [editingLeaveId, setEditingLeaveId] =
    useState<Id<"leaves"> | null>(null);

  const balance = annualBalance ?? user?.annualLeaveBalance ?? 0;
  const quota = user?.annualLeaveQuota ?? 30;
  const percent = Math.min(
    100,
    Math.round((balance / Math.max(quota, 1)) * 100)
  );
  const annualMinStart = useMemo(() => annualLeaveMinStartISO(), []);
  const startMin = type === "annuel" ? annualMinStart : undefined;
  const previewDays = useMemo(
    () => leaveDaysPreview(startDate, endDate),
    [startDate, endDate]
  );

  function onTypeChange(next: LeaveType) {
    setType(next);
    if (next === "annuel" && startDate && startDate < annualMinStart) {
      setStartDate("");
      setEndDate("");
    }
  }

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (!token) return;
    setBusy(true);
    setError("");
    setSuccess("");
    try {
      if (editingLeaveId) {
        await updateLeave({
          token,
          leaveId: editingLeaveId,
          type,
          startDate,
          endDate,
          reason,
        });
        setSuccess("Demande modifiée");
      } else {
        await requestLeave({ token, type, startDate, endDate, reason });
        setSuccess("Demande envoyée");
      }
      setEditingLeaveId(null);
      setReason("");
      setStartDate("");
      setEndDate("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erreur");
    } finally {
      setBusy(false);
    }
  }

  function onEditLeave(leave: NonNullable<typeof leaves>[number]) {
    if (leave.status !== "EN_ATTENTE" || leave.companyLeaveName) return;
    setEditingLeaveId(leave._id);
    setType(leave.type);
    setStartDate(leave.startDate);
    setEndDate(leave.endDate);
    setReason(leave.reason);
    setError("");
    setSuccess("");
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  function onCancelEdit() {
    setEditingLeaveId(null);
    setType(leaveTypeOptions[0].value);
    setStartDate("");
    setEndDate("");
    setReason("");
    setError("");
    setSuccess("");
  }

  function onPrint() {
    if (!user) return;
    try {
      printLeaveHistory({
        employeeName: user.name,
        balance,
        quota,
        leaves: leaves ?? [],
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Impression impossible");
    }
  }

  return (
    <RequireAuth role="employee" page="conges">
      <PageShell
        title="Congés & Absences"
        description="Consultez votre solde et soumettez une nouvelle demande."
        action={
          <SecondaryButton type="button" onClick={onPrint} className="w-full sm:w-auto">
            Imprimer
          </SecondaryButton>
        }
      >
        <Card className="mb-5">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <p className="text-xs font-semibold uppercase tracking-wide text-zinc-500">
                Solde annuel
              </p>
              <p className="mt-1 text-2xl font-semibold tabular-nums text-zinc-900 sm:text-3xl">
                {balance}
                <span className="text-base font-medium text-zinc-400">
                  {" "}
                  / {quota}
                </span>{" "}
                <span className="text-sm font-medium text-zinc-500">jours</span>
              </p>
            </div>
            <p className="shrink-0 text-sm text-zinc-500">{percent}% restant</p>
          </div>
          <div className="mt-3 h-2.5 overflow-hidden rounded-full bg-zinc-100">
            <div
              className="h-full rounded-full bg-[#0088E8]"
              style={{ width: `${percent}%` }}
            />
          </div>
        </Card>

        <div className="grid min-w-0 gap-5 lg:grid-cols-[minmax(0,340px)_minmax(0,1fr)]">
          <Card className="min-w-0">
            <h2 className="font-semibold text-zinc-900">
              {editingLeaveId ? "Modifier la demande" : "Nouvelle demande"}
            </h2>
            <form onSubmit={onSubmit} className="mt-4 space-y-3">
              <Field label="Type">
                <select
                  className={inputClass}
                  value={type}
                  onChange={(e) =>
                    onTypeChange(
                      e.target.value as LeaveType
                    )
                  }
                >
                  {leaveTypeOptions.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                  {editingLeaveId &&
                  ["annuel", "maladie", "sans_solde"].includes(type) ? (
                    <option value={type}>{leaveTypeLabel(type)}</option>
                  ) : null}
                </select>
              </Field>

              <div className="grid gap-3 sm:grid-cols-2">
                <Field label="Date début">
                  <input
                    required
                    type="date"
                    className={inputClass}
                    min={startMin}
                    value={startDate}
                    onChange={(e) => {
                      const next = e.target.value;
                      setStartDate(next);
                      if (endDate && endDate <= next) setEndDate("");
                    }}
                  />
                </Field>
                <Field label="Date retour">
                  <input
                    required
                    type="date"
                    className={inputClass}
                    min={startDate || startMin}
                    value={endDate}
                    onChange={(e) => setEndDate(e.target.value)}
                  />
                </Field>
              </div>
              <p className="text-xs text-zinc-500">
                La date de retour n&apos;est pas décomptée
                {previewDays > 0 ? (
                  <>
                    {" "}
                    · <strong className="text-zinc-700">{previewDays} j</strong>
                  </>
                ) : null}
              </p>
              {type === "annuel" ? (
                <p className="text-xs text-amber-700">
                  Congé annuel : départ au plus tôt le{" "}
                  {formatDate(annualMinStart)} (délai de 15 jours).
                </p>
              ) : null}
              {type !== "maladie" && type !== "sans_solde" ? (
                <p className="text-xs text-zinc-500">
                  Les jours demandés seront décomptés de votre solde annuel
                  (actuellement {balance} jour(s)).
                </p>
              ) : null}

              <Field
                label={type === "autre" ? "Motif (obligatoire)" : "Motif (optionnel)"}
              >
                <textarea
                  required={type === "autre"}
                  className={inputClass}
                  rows={3}
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                />
              </Field>
              {error ? <p className="text-sm text-red-600">{error}</p> : null}
              {success ? (
                <p className="text-sm text-emerald-600">{success}</p>
              ) : null}
              <div className="flex flex-col gap-2">
                <PrimaryButton type="submit" disabled={busy} className="w-full">
                  {busy
                    ? "Enregistrement…"
                    : editingLeaveId
                      ? "Enregistrer les modifications"
                      : "Envoyer la demande"}
                </PrimaryButton>
                {editingLeaveId ? (
                  <SecondaryButton
                    type="button"
                    disabled={busy}
                    className="w-full"
                    onClick={onCancelEdit}
                  >
                    Annuler
                  </SecondaryButton>
                ) : null}
              </div>
            </form>
          </Card>

          <Card className="min-w-0">
            <h2 className="mb-4 font-semibold text-zinc-900">Historique</h2>

            {/* Mobile: stacked cards */}
            <div className="space-y-3 md:hidden">
              {(leaves ?? []).map((leave) => (
                <div
                  key={leave._id}
                  className="rounded-xl border border-zinc-100 bg-zinc-50/80 p-3"
                >
                  <div className="flex items-start justify-between gap-2">
                    <p className="font-medium capitalize text-zinc-900">
                      {leave.companyLeaveName
                        ? `Congé collectif · ${leave.companyLeaveName}${
                            leave.companyLeaveHalfDay
                              ? ` · ½ journée${
                                  leave.companyLeaveLeavingTime
                                    ? ` · départ ${leave.companyLeaveLeavingTime}`
                                    : ""
                                }`
                              : ""
                          }`
                        : leaveTypeLabel(leave.type)}
                    </p>
                    <Badge className={statusBadgeClass(leave.status)}>
                      {leaveStatusLabel(leave.status)}
                    </Badge>
                  </div>
                  <dl className="mt-2 space-y-1.5 text-sm">
                    <div className="flex justify-between gap-3">
                      <dt className="text-zinc-500">Demande</dt>
                      <dd className="text-right tabular-nums text-zinc-800">
                        {leave.startDate} → {leave.endDate}
                      </dd>
                    </div>
                    <div className="flex justify-between gap-3">
                      <dt className="text-zinc-500">Réel</dt>
                      <dd className="text-right tabular-nums text-zinc-800">
                        {leave.actualStartDate && leave.actualEndDate
                          ? `${leave.actualStartDate} → ${leave.actualEndDate}`
                          : "—"}
                      </dd>
                    </div>
                    <div className="flex justify-between gap-3">
                      <dt className="text-zinc-500">Jours</dt>
                      <dd className="text-right font-medium text-zinc-900">
                        {leave.companyLeaveHalfDay
                          ? "½ journée non décomptée"
                          : leave.deductedDays != null
                          ? `${leave.deductedDays} décomptés`
                          : `${leave.days} demandés`}
                      </dd>
                    </div>
                  </dl>
                  {leave.reason ? (
                    <p className="mt-2 border-t border-zinc-200/80 pt-2 text-sm text-zinc-600">
                      {leave.reason}
                    </p>
                  ) : null}
                  {leave.adminResponse ? (
                    <p className="mt-1 text-xs text-zinc-400">
                      Réponse : {leave.adminResponse}
                    </p>
                  ) : null}
                  {leave.status === "EN_ATTENTE" && !leave.companyLeaveName ? (
                    <SecondaryButton
                      type="button"
                      className="mt-3 p-2"
                      aria-label="Modifier la demande de congé"
                      title="Modifier"
                      onClick={() => onEditLeave(leave)}
                    >
                      <Pencil aria-hidden="true" className="h-4 w-4" />
                    </SecondaryButton>
                  ) : null}
                </div>
              ))}
              {!leaves?.length ? (
                <p className="py-2 text-sm text-zinc-500">Aucune demande.</p>
              ) : null}
            </div>

            {/* Desktop: table */}
            <div className="hidden min-w-0 overflow-x-auto md:block">
              <table className="w-full min-w-[560px] text-sm">
                <thead className="text-xs uppercase text-zinc-500">
                  <tr>
                    <th className="pb-3 pr-3 text-left">Type</th>
                    <th className="pb-3 pr-3 text-left">Demande</th>
                    <th className="pb-3 pr-3 text-left">Réel</th>
                    <th className="pb-3 pr-3 text-right">Jours</th>
                    <th className="pb-3 pr-3 text-left">Statut</th>
                    <th className="pb-3 text-left">Motif</th>
                    <th className="pb-3 text-left">Action</th>
                  </tr>
                </thead>
                <tbody>
                  {(leaves ?? []).map((leave) => (
                    <tr key={leave._id} className="border-t border-zinc-100">
                      <td className="py-3 pr-3 font-medium capitalize text-zinc-900">
                        {leave.companyLeaveName
                          ? `Congé collectif · ${leave.companyLeaveName}${
                              leave.companyLeaveHalfDay
                                ? ` · ½ journée${
                                    leave.companyLeaveLeavingTime
                                      ? ` · départ ${leave.companyLeaveLeavingTime}`
                                      : ""
                                  }`
                                : ""
                            }`
                          : leaveTypeLabel(leave.type)}
                      </td>
                      <td className="py-3 pr-3 whitespace-nowrap text-zinc-600">
                        {leave.startDate} → {leave.endDate}
                      </td>
                      <td className="py-3 pr-3 whitespace-nowrap text-zinc-600">
                        {leave.actualStartDate && leave.actualEndDate
                          ? `${leave.actualStartDate} → ${leave.actualEndDate}`
                          : "—"}
                      </td>
                      <td className="py-3 pr-3 text-right text-zinc-900">
                        {leave.companyLeaveHalfDay
                          ? "½ journée non décomptée"
                          : leave.deductedDays != null
                          ? `${leave.deductedDays} décomptés`
                          : `${leave.days} demandés`}
                      </td>
                      <td className="py-3 pr-3">
                        <Badge className={statusBadgeClass(leave.status)}>
                          {leaveStatusLabel(leave.status)}
                        </Badge>
                      </td>
                      <td className="max-w-[180px] py-3 text-zinc-600">
                        <p className="line-clamp-2">{leave.reason}</p>
                        {leave.adminResponse ? (
                          <p className="mt-1 text-xs text-zinc-400">
                            Réponse : {leave.adminResponse}
                          </p>
                        ) : null}
                      </td>
                      <td className="py-3">
                        {leave.status === "EN_ATTENTE" &&
                        !leave.companyLeaveName ? (
                          <SecondaryButton
                            type="button"
                            className="p-2"
                            aria-label="Modifier la demande de congé"
                            title="Modifier"
                            onClick={() => onEditLeave(leave)}
                          >
                            <Pencil aria-hidden="true" className="h-4 w-4" />
                          </SecondaryButton>
                        ) : null}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {!leaves?.length ? (
                <p className="py-4 text-sm text-zinc-500">Aucune demande.</p>
              ) : null}
            </div>
          </Card>
        </div>
      </PageShell>
    </RequireAuth>
  );
}
