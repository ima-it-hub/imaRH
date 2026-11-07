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
  Modal,
  PrimaryButton,
  SecondaryButton,
  inputClass,
} from "@/components/ui";
import { useAuth } from "@/lib/auth";
import { leaveStatusLabel, statusBadgeClass } from "@/lib/format";

/** End/return date is not counted as leave. */
function daysBetweenLocal(start: string, end: string) {
  if (!start || !end || end <= start) return 0;
  const a = new Date(start + "T00:00:00");
  const b = new Date(end + "T00:00:00");
  return Math.round((b.getTime() - a.getTime()) / 86400000);
}

function previewDeducted(
  requested: number,
  actual: number,
  delay?: "ACCEPTABLE" | "NON_ACCEPTABLE"
) {
  if (actual <= 0) return 0;
  if (actual <= requested) return actual;
  const extra = actual - requested;
  if (delay === "NON_ACCEPTABLE") return requested + extra * 2;
  return actual;
}

export default function AdminCongesPage() {
  const { token } = useAuth();
  const employees = useQuery(
    api.users.listEmployees,
    token ? { token } : "skip"
  );
  const pending = useQuery(api.leaves.pending, token ? { token } : "skip");
  const toClose = useQuery(api.leaves.toClose, token ? { token } : "skip");
  const all = useQuery(api.leaves.all, token ? { token } : "skip");
  const decide = useMutation(api.leaves.decide);
  const recordActualDates = useMutation(api.leaves.recordActualDates);
  const requestForEmployee = useMutation(api.leaves.requestForEmployee);

  const [responses, setResponses] = useState<Record<string, string>>({});
  const [maladiePaid, setMaladiePaid] = useState<
    Record<string, "" | "paid" | "unpaid">
  >({});
  const [closeDrafts, setCloseDrafts] = useState<
    Record<
      string,
      {
        actualStartDate: string;
        actualEndDate: string;
        delayStatus: "" | "ACCEPTABLE" | "NON_ACCEPTABLE";
      }
    >
  >({});
  const [showCreate, setShowCreate] = useState(false);
  const [newEmpId, setNewEmpId] = useState("");
  const [newType, setNewType] = useState<"annuel" | "maladie" | "sans_solde">(
    "annuel"
  );
  const [newIsPaid, setNewIsPaid] = useState<"" | "paid" | "unpaid">("");
  const [newStart, setNewStart] = useState("");
  const [newEnd, setNewEnd] = useState("");
  const [newReason, setNewReason] = useState("");
  const [autoApprove, setAutoApprove] = useState(true);
  const [error, setError] = useState("");
  const [msg, setMsg] = useState("");
  const [formError, setFormError] = useState("");

  const history = useMemo(
    () => (all ?? []).filter((l) => l.status !== "EN_ATTENTE"),
    [all]
  );

  function getCloseDraft(leaveId: string, startDate: string, endDate: string) {
    return (
      closeDrafts[leaveId] ?? {
        actualStartDate: startDate,
        actualEndDate: endDate,
        delayStatus: "" as const,
      }
    );
  }

  function openCreate() {
    setFormError("");
    setShowCreate(true);
  }

  function closeCreate() {
    setShowCreate(false);
    setFormError("");
  }

  async function onCreateLeave(e: FormEvent) {
    e.preventDefault();
    if (!token || !newEmpId) return;
    if (newType === "maladie" && !newIsPaid) {
      setFormError("Choisissez si le congé maladie est payé ou non payé");
      return;
    }
    setFormError("");
    try {
      await requestForEmployee({
        token,
        employeeId: newEmpId as Id<"users">,
        type: newType,
        startDate: newStart,
        endDate: newEnd,
        reason: newReason,
        autoApprove,
        isPaid:
          newType === "maladie"
            ? newIsPaid === "paid"
            : newType === "sans_solde"
              ? false
              : undefined,
      });
      setMsg(
        autoApprove
          ? "Congé créé et approuvé — à clôturer avec les dates réelles"
          : "Demande de congé créée (en attente)"
      );
      setNewReason("");
      setNewStart("");
      setNewEnd("");
      setNewIsPaid("");
      setShowCreate(false);
    } catch (err) {
      setFormError(err instanceof Error ? err.message : "Erreur");
    }
  }

  async function onDecide(
    leaveId: Id<"leaves">,
    status: "APPROUVE" | "REFUSE",
    leaveType: "annuel" | "maladie" | "sans_solde"
  ) {
    if (!token) return;
    if (status === "APPROUVE" && leaveType === "maladie") {
      const choice = maladiePaid[leaveId];
      if (!choice) {
        setError("Choisissez payé ou non payé pour ce congé maladie");
        return;
      }
    }
    setError("");
    setMsg("");
    try {
      await decide({
        token,
        leaveId,
        status,
        adminResponse: responses[leaveId],
        isPaid:
          leaveType === "maladie" && status === "APPROUVE"
            ? maladiePaid[leaveId] === "paid"
            : undefined,
      });
      setMsg(
        status === "APPROUVE"
          ? "Congé approuvé — décompte à la clôture des dates réelles"
          : "Congé refusé"
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erreur");
    }
  }

  async function onClose(leaveId: Id<"leaves">, requestedDays: number) {
    if (!token) return;
    const draft = closeDrafts[leaveId];
    if (!draft?.actualStartDate || !draft?.actualEndDate) {
      setError("Saisissez la date de départ et la date de retour");
      return;
    }
    const actual = daysBetweenLocal(
      draft.actualStartDate,
      draft.actualEndDate
    );
    if (actual > requestedDays && !draft.delayStatus) {
      setError(
        "Jours réels > demande : choisissez si le retard est acceptable ou non"
      );
      return;
    }
    setError("");
    setMsg("");
    try {
      await recordActualDates({
        token,
        leaveId,
        actualStartDate: draft.actualStartDate,
        actualEndDate: draft.actualEndDate,
        delayStatus: draft.delayStatus || undefined,
      });
      setMsg("Congé clôturé — solde mis à jour");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erreur");
    }
  }

  return (
    <RequireAuth role="admin">
      <PageShell
        title="Gestion des congés"
        description="Pour maladie : choisissez payé (aucun décompte) ou non payé (solde annuel puis salaire). Sans solde : déduit du salaire à la clôture."
      >
        {error ? (
          <p className="mb-4 rounded-xl bg-red-50 px-4 py-3 text-sm text-red-600">
            {error}
          </p>
        ) : null}
        {msg ? (
          <p className="mb-4 rounded-xl bg-emerald-50 px-4 py-3 text-sm text-emerald-700">
            {msg}
          </p>
        ) : null}

        <div className="mb-6 flex justify-end">
          <PrimaryButton type="button" onClick={openCreate}>
            Nouveau congé
          </PrimaryButton>
        </div>

        <h2 className="mb-3 text-lg font-semibold text-zinc-900">
          File d&apos;attente
        </h2>
        <div className="mb-8 space-y-3">
          {(pending ?? []).map((leave) => (
            <Card key={leave._id}>
              <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                <div className="min-w-0 flex-1">
                  <p className="font-semibold text-zinc-900">
                    {leave.employee.name}
                  </p>
                  <p className="text-sm text-zinc-500">
                    {leave.type} · {leave.days} jour(s) demandés · solde{" "}
                    {leave.employee.annualLeaveBalance}
                  </p>
                  <p className="mt-1 text-sm text-zinc-600">
                    Demandé : {leave.startDate} → {leave.endDate}
                  </p>
                  <div className="mt-3 rounded-xl border border-zinc-100 bg-zinc-50 px-3 py-2">
                    <p className="text-xs font-semibold uppercase tracking-wide text-zinc-500">
                      Remarque / motif de l&apos;employé
                    </p>
                    <p className="mt-1 whitespace-pre-wrap text-sm text-zinc-800">
                      {leave.reason || "—"}
                    </p>
                  </div>
                </div>
                <div className="min-w-[260px] space-y-2">
                  {leave.type === "maladie" ? (
                    <Field label="Maladie — payé ou non ?">
                      <select
                        className={inputClass}
                        value={maladiePaid[leave._id] ?? ""}
                        onChange={(e) =>
                          setMaladiePaid((prev) => ({
                            ...prev,
                            [leave._id]: e.target.value as
                              | ""
                              | "paid"
                              | "unpaid",
                          }))
                        }
                      >
                        <option value="">Choisir…</option>
                        <option value="paid">
                          Payé (solde annuel non touché)
                        </option>
                        <option value="unpaid">
                          Non payé (solde puis salaire)
                        </option>
                      </select>
                    </Field>
                  ) : null}
                  {leave.type === "sans_solde" ? (
                    <p className="rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-800">
                      Sans solde : les jours seront déduits du salaire à la
                      clôture.
                    </p>
                  ) : null}
                  <input
                    className={inputClass}
                    placeholder="Motif du refus (optionnel)"
                    value={responses[leave._id] ?? ""}
                    onChange={(e) =>
                      setResponses((prev) => ({
                        ...prev,
                        [leave._id]: e.target.value,
                      }))
                    }
                  />
                  <div className="flex gap-2">
                    <PrimaryButton
                      type="button"
                      onClick={() =>
                        onDecide(leave._id, "APPROUVE", leave.type)
                      }
                    >
                      Approuver
                    </PrimaryButton>
                    <SecondaryButton
                      type="button"
                      onClick={() =>
                        onDecide(leave._id, "REFUSE", leave.type)
                      }
                    >
                      Refuser
                    </SecondaryButton>
                  </div>
                </div>
              </div>
            </Card>
          ))}
          {!pending?.length ? (
            <Card>
              <p className="text-sm text-zinc-500">Aucune demande en attente.</p>
            </Card>
          ) : null}
        </div>

        <h2 className="mb-3 text-lg font-semibold text-zinc-900">
          À clôturer (dates réelles)
        </h2>
        <p className="mb-3 text-sm text-zinc-500">
          Après retour de l&apos;employé, saisissez départ et retour. Le solde
          annuel n&apos;est décompté qu&apos;à cette étape. Si jours réels &gt;
          demande : retard acceptable = jours réels ; non acceptable = demande +
          2 × jours en plus.
        </p>
        <div className="mb-8 space-y-3">
          {(toClose ?? []).map((leave) => {
            const draft = getCloseDraft(
              leave._id,
              leave.startDate,
              leave.endDate
            );
            const actual = daysBetweenLocal(
              draft.actualStartDate,
              draft.actualEndDate
            );
            const over = actual > leave.days;
            const preview = previewDeducted(
              leave.days,
              actual,
              draft.delayStatus || undefined
            );
            return (
              <Card key={leave._id}>
                <div className="space-y-3">
                  <div>
                    <p className="font-semibold text-zinc-900">
                      {leave.employee.name} · {leave.type}
                      {leave.type === "maladie"
                        ? leave.isPaid === true
                          ? " (payé)"
                          : leave.isPaid === false
                            ? " (non payé)"
                            : ""
                        : leave.type === "sans_solde"
                          ? " → salaire"
                          : ""}
                    </p>
                    <p className="text-sm text-zinc-500">
                      Demande : {leave.startDate} → {leave.endDate} (
                      {leave.days} j) · solde{" "}
                      {leave.employee.annualLeaveBalance}
                    </p>
                    <div className="mt-2 rounded-xl border border-zinc-100 bg-zinc-50 px-3 py-2">
                      <p className="text-xs font-semibold uppercase tracking-wide text-zinc-500">
                        Remarque employé
                      </p>
                      <p className="mt-1 whitespace-pre-wrap text-sm text-zinc-800">
                        {leave.reason || "—"}
                      </p>
                    </div>
                  </div>

                  <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                    <Field label="Date de départ (réelle)">
                      <input
                        type="date"
                        className={inputClass}
                        value={draft.actualStartDate}
                        onChange={(e) =>
                          setCloseDrafts((prev) => ({
                            ...prev,
                            [leave._id]: {
                              ...draft,
                              actualStartDate: e.target.value,
                            },
                          }))
                        }
                      />
                    </Field>
                    <Field label="Date de retour réelle (non décomptée)">
                      <input
                        type="date"
                        className={inputClass}
                        value={draft.actualEndDate}
                        onChange={(e) =>
                          setCloseDrafts((prev) => ({
                            ...prev,
                            [leave._id]: {
                              ...draft,
                              actualEndDate: e.target.value,
                            },
                          }))
                        }
                      />
                    </Field>
                    {over ? (
                      <Field label="Retard / jours en plus">
                        <select
                          className={inputClass}
                          value={draft.delayStatus}
                          onChange={(e) =>
                            setCloseDrafts((prev) => ({
                              ...prev,
                              [leave._id]: {
                                ...draft,
                                delayStatus: e.target.value as
                                  | ""
                                  | "ACCEPTABLE"
                                  | "NON_ACCEPTABLE",
                              },
                            }))
                          }
                        >
                          <option value="">Choisir…</option>
                          <option value="ACCEPTABLE">Acceptable</option>
                          <option value="NON_ACCEPTABLE">Non acceptable</option>
                        </select>
                      </Field>
                    ) : (
                      <div />
                    )}
                    <div className="flex flex-col justify-end gap-2">
                      <p className="text-sm text-zinc-600">
                        Réels : <strong>{actual || "—"}</strong> j · À décompter
                        : <strong>{preview || "—"}</strong> j
                      </p>
                      <PrimaryButton
                        type="button"
                        onClick={() => onClose(leave._id, leave.days)}
                      >
                        Clôturer &amp; décompter
                      </PrimaryButton>
                    </div>
                  </div>
                </div>
              </Card>
            );
          })}
          {!toClose?.length ? (
            <Card>
              <p className="text-sm text-zinc-500">
                Aucun congé approuvé en attente de dates réelles.
              </p>
            </Card>
          ) : null}
        </div>

        <h2 className="mb-3 text-lg font-semibold text-zinc-900">Historique</h2>
        <Card>
          <div className="overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead className="text-xs uppercase text-zinc-500">
                <tr>
                  <th className="pb-3 pr-3 text-left">Employé</th>
                  <th className="pb-3 pr-3 text-left">Type</th>
                  <th className="pb-3 pr-3 text-left">Demande</th>
                  <th className="pb-3 pr-3 text-left">Réel</th>
                  <th className="pb-3 pr-3 text-right">Jours</th>
                  <th className="pb-3 pr-3 text-left">Motif</th>
                  <th className="pb-3 text-left">Statut</th>
                </tr>
              </thead>
              <tbody>
                {history.map((leave) => (
                  <tr key={leave._id} className="border-t border-zinc-100">
                    <td className="py-3 pr-3">
                      <p className="font-medium text-zinc-900">
                        {leave.employee.name}
                      </p>
                      <p className="text-xs text-zinc-500">
                        {leave.employee.email}
                      </p>
                    </td>
                    <td className="py-3 pr-3 text-zinc-700">
                      {leave.type}
                      {leave.type === "maladie"
                        ? leave.isPaid === true
                          ? " · payé"
                          : leave.isPaid === false
                            ? " · non payé"
                            : ""
                        : ""}
                    </td>
                    <td className="py-3 pr-3 whitespace-nowrap text-zinc-600">
                      {leave.startDate} → {leave.endDate}
                      <span className="block text-xs text-zinc-400">
                        {leave.days} j demandés
                      </span>
                    </td>
                    <td className="py-3 pr-3 whitespace-nowrap text-zinc-600">
                      {leave.actualStartDate && leave.actualEndDate ? (
                        <>
                          {leave.actualStartDate} → {leave.actualEndDate}
                          {leave.delayStatus === "NON_ACCEPTABLE" ? (
                            <span className="block text-xs text-amber-700">
                              Retard ×2
                            </span>
                          ) : leave.delayStatus === "ACCEPTABLE" ? (
                            <span className="block text-xs text-zinc-400">
                              Retard acceptable
                            </span>
                          ) : null}
                        </>
                      ) : (
                        "—"
                      )}
                    </td>
                    <td className="py-3 pr-3 text-right font-medium text-zinc-900">
                      {leave.status === "CLOTURE" ? (
                        <>
                          {(leave.deductedDays ?? 0) > 0
                            ? `${leave.deductedDays} j solde`
                            : null}
                          {(leave.salaryDeductedDays ?? 0) > 0 ? (
                            <span className="block text-xs text-amber-700">
                              {leave.salaryDeductedDays} j salaire
                            </span>
                          ) : null}
                          {(leave.deductedDays ?? 0) === 0 &&
                          (leave.salaryDeductedDays ?? 0) === 0
                            ? "0 décompté"
                            : null}
                        </>
                      ) : (
                        `${leave.days} demandés`
                      )}
                    </td>
                    <td className="max-w-[220px] py-3 pr-3 text-zinc-600">
                      <p className="line-clamp-3 whitespace-pre-wrap">
                        {leave.reason || "—"}
                      </p>
                      {leave.adminResponse ? (
                        <p className="mt-1 text-xs text-zinc-400">
                          Réponse : {leave.adminResponse}
                        </p>
                      ) : null}
                    </td>
                    <td className="py-3">
                      <Badge className={statusBadgeClass(leave.status)}>
                        {leaveStatusLabel(leave.status)}
                      </Badge>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {!history.length ? (
              <p className="py-6 text-sm text-zinc-500">Aucun historique.</p>
            ) : null}
          </div>
        </Card>

        <Modal
          open={showCreate}
          onClose={closeCreate}
          title="Créer un congé pour un employé"
        >
          {formError ? (
            <p className="mb-3 text-sm text-red-600">{formError}</p>
          ) : null}
          <form onSubmit={onCreateLeave} className="grid gap-3">
            <Field label="Employé">
              <select
                required
                className={inputClass}
                value={newEmpId}
                onChange={(e) => setNewEmpId(e.target.value)}
              >
                <option value="">Choisir…</option>
                {(employees ?? [])
                  .filter((e) => e.isActive)
                  .map((e) => (
                    <option key={e._id} value={e._id}>
                      {e.name} · solde {e.annualLeaveBalance} j
                    </option>
                  ))}
              </select>
            </Field>
            <Field label="Type">
              <select
                className={inputClass}
                value={newType}
                onChange={(e) => {
                  setNewType(
                    e.target.value as "annuel" | "maladie" | "sans_solde"
                  );
                  setNewIsPaid("");
                }}
              >
                <option value="annuel">Annuel</option>
                <option value="maladie">Maladie</option>
                <option value="sans_solde">Sans solde</option>
              </select>
            </Field>
            {newType === "maladie" ? (
              <Field label="Maladie — payé ou non ?">
                <select
                  required
                  className={inputClass}
                  value={newIsPaid}
                  onChange={(e) =>
                    setNewIsPaid(e.target.value as "" | "paid" | "unpaid")
                  }
                >
                  <option value="">Choisir…</option>
                  <option value="paid">Payé</option>
                  <option value="unpaid">Non payé</option>
                </select>
              </Field>
            ) : null}
            <Field label="Date début">
              <input
                required
                type="date"
                className={inputClass}
                value={newStart}
                onChange={(e) => setNewStart(e.target.value)}
              />
            </Field>
            <Field label="Date de retour (non décomptée)">
              <input
                required
                type="date"
                className={inputClass}
                value={newEnd}
                onChange={(e) => setNewEnd(e.target.value)}
              />
            </Field>
            <Field label="Motif / remarque">
              <textarea
                required
                rows={2}
                className={inputClass}
                value={newReason}
                onChange={(e) => setNewReason(e.target.value)}
              />
            </Field>
            <label className="flex items-center gap-2 text-sm text-zinc-700">
              <input
                type="checkbox"
                className="accent-[#0088E8]"
                checked={autoApprove}
                onChange={(e) => setAutoApprove(e.target.checked)}
              />
              Approuver immédiatement (solde décompté à la clôture des dates
              réelles)
            </label>
            <div className="mt-2 flex justify-end gap-2">
              <SecondaryButton type="button" onClick={closeCreate}>
                Annuler
              </SecondaryButton>
              <PrimaryButton type="submit">Créer le congé</PrimaryButton>
            </div>
          </form>
        </Modal>
      </PageShell>
    </RequireAuth>
  );
}
