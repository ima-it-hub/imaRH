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
import {
  formatDate,
  moneyDZD,
  paymentStatusLabel,
  statusBadgeClass,
} from "@/lib/format";
import { printFinanceHistory, printPaymentReceipt } from "@/lib/pdfExport";

export default function AdminOrdresPaiementPage() {
  const { token, user } = useAuth();
  const employees = useQuery(
    api.users.listEmployees,
    token ? { token } : "skip"
  );
  const orders = useQuery(
    api.finances.listPaymentOrders,
    token ? { token } : "skip"
  );
  const treat = useMutation(api.finances.treatPaymentOrder);
  const validateBatch = useMutation(api.finances.validatePaymentOrdersBatch);
  const createForEmployee = useMutation(
    api.finances.requestPaymentForEmployee
  );

  const [filterEmployeeId, setFilterEmployeeId] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [showCreate, setShowCreate] = useState(false);
  const [newEmpId, setNewEmpId] = useState("");
  const [newType, setNewType] = useState<
    "SALAIRE_MENSUEL" | "ACOMPTE" | "PRIME"
  >("ACOMPTE");
  const [newAmount, setNewAmount] = useState("");
  const [newNote, setNewNote] = useState("");
  const [autoValidate, setAutoValidate] = useState(false);
  const [error, setError] = useState("");
  const [msg, setMsg] = useState("");
  const [formError, setFormError] = useState("");
  const [busyId, setBusyId] = useState<string | null>(null);
  const [selectedOrderIds, setSelectedOrderIds] = useState<
    Set<Id<"paymentOrders">>
  >(() => new Set());
  const [batchBusy, setBatchBusy] = useState(false);

  const employeeHistory = useQuery(
    api.finances.employeeHistory,
    token && filterEmployeeId
      ? { token, employeeId: filterEmployeeId as Id<"users"> }
      : "skip"
  );

  const filtered = useMemo(() => {
    let rows = orders ?? [];
    if (filterEmployeeId) {
      rows = rows.filter((o) => o.employeeId === filterEmployeeId);
    }
    if (statusFilter) {
      rows = rows.filter((o) => o.status === statusFilter);
    }
    return rows;
  }, [orders, filterEmployeeId, statusFilter]);
  const pendingFiltered = filtered.filter((order) => order.status === "DEMANDE");
  const selectedPendingOrderIds = (orders ?? [])
    .filter(
      (order) =>
        order.status === "DEMANDE" && selectedOrderIds.has(order._id)
    )
    .map((order) => order._id);
  const allPendingSelected =
    pendingFiltered.length > 0 &&
    pendingFiltered.every((order) => selectedOrderIds.has(order._id));

  function toggleOrderSelection(orderId: Id<"paymentOrders">) {
    setSelectedOrderIds((selected) => {
      const next = new Set(selected);
      if (next.has(orderId)) next.delete(orderId);
      else next.add(orderId);
      return next;
    });
  }

  function toggleAllPendingSelection() {
    setSelectedOrderIds((selected) => {
      const next = new Set(selected);
      if (allPendingSelected) {
        for (const order of pendingFiltered) next.delete(order._id);
      } else {
        for (const order of pendingFiltered) next.add(order._id);
      }
      return next;
    });
  }

  async function onValidateSelected() {
    if (!token || selectedPendingOrderIds.length === 0) return;
    setBatchBusy(true);
    setError("");
    setMsg("");
    try {
      const result = await validateBatch({
        token,
        orderIds: selectedPendingOrderIds,
      });
      setMsg(
        `${result.validated} demande(s) validée(s) — en attente de confirmation par les employés.`
      );
      setSelectedOrderIds(new Set());
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erreur");
    } finally {
      setBatchBusy(false);
    }
  }

  function openCreate() {
    setFormError("");
    setShowCreate(true);
  }

  function closeCreate() {
    setShowCreate(false);
    setFormError("");
  }

  async function onTreat(
    orderId: Id<"paymentOrders">,
    status: "VALIDE" | "REJETE"
  ) {
    if (!token) return;
    setBusyId(orderId);
    setError("");
    setMsg("");
    try {
      await treat({ token, orderId, status });
      setSelectedOrderIds((selected) => {
        const next = new Set(selected);
        next.delete(orderId);
        return next;
      });
      setMsg(
        status === "VALIDE"
          ? "Demande validée — l'employé peut confirmer sa réception"
          : "Demande rejetée"
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erreur");
    } finally {
      setBusyId(null);
    }
  }

  function onPrint() {
    if (!employeeHistory) {
      setError("Sélectionnez un employé pour imprimer son historique");
      return;
    }
    try {
      printFinanceHistory({
        employeeName: employeeHistory.employee.name,
        salaries: employeeHistory.salaries,
        bonuses: employeeHistory.bonuses,
        lateDeductions: employeeHistory.lateDeductions,
        orders: employeeHistory.orders,
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Impression impossible");
    }
  }

  function onPrintReceipt(order: NonNullable<typeof orders>[number]) {
    if (
      order.status !== "PAYE" ||
      !order.confirmedAt ||
      !order.receiptReference
    ) {
      return;
    }
    printPaymentReceipt({
      receiptReference: order.receiptReference,
      employeeName: order.employee.name,
      employeeEmail: order.employee.email,
      type: order.type,
      amount: order.amount,
      requestedAt: order.requestedAt,
      disbursedAt: order.disbursedAt,
      confirmedAt: order.confirmedAt,
    });
  }

  async function onCreateDemand(e: FormEvent) {
    e.preventDefault();
    if (!token || !newEmpId) return;
    setFormError("");
    try {
      await createForEmployee({
        token,
        employeeId: newEmpId as Id<"users">,
        type: newType,
        amount: Number(newAmount),
        note: newNote || undefined,
        autoValidate,
      });
      setMsg(
        autoValidate
          ? "Demande créée et validée — en attente de confirmation par l'employé"
          : "Demande de paiement créée"
      );
      setNewAmount("");
      setNewNote("");
      setShowCreate(false);
    } catch (err) {
      setFormError(err instanceof Error ? err.message : "Erreur");
    }
  }

  return (
    <RequireAuth page="admin-ordres">
      <PageShell
        title="Ordres de paiement"
        description="Validez les demandes. Le reçu est disponible après confirmation de réception par l'employé."
      >
        {error ? <p className="mb-3 text-sm text-red-600">{error}</p> : null}
        {msg ? <p className="mb-3 text-sm text-emerald-600">{msg}</p> : null}

        <Card className="mb-4">
          <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-end sm:justify-between">
            <div className="flex flex-wrap gap-3">
              <Field label="Employé">
                <select
                  className={inputClass + " min-w-[200px]"}
                  value={filterEmployeeId}
                  onChange={(e) => setFilterEmployeeId(e.target.value)}
                >
                  <option value="">Tous</option>
                  {(employees ?? []).map((e) => (
                    <option key={e._id} value={e._id}>
                      {e.name}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="Statut">
                <select
                  className={inputClass}
                  value={statusFilter}
                  onChange={(e) => setStatusFilter(e.target.value)}
                >
                  <option value="">Tous</option>
                  <option value="DEMANDE">Demande</option>
                  <option value="VALIDE">Validé</option>
                  <option value="A_CONFIRMER">À confirmer</option>
                  <option value="PAYE">Payé</option>
                  <option value="REJETE">Rejeté</option>
                </select>
              </Field>
            </div>
            <div className="flex flex-wrap gap-2">
              <SecondaryButton
                type="button"
                disabled={batchBusy || selectedPendingOrderIds.length === 0}
                onClick={() => void onValidateSelected()}
              >
                {batchBusy
                  ? "Validation…"
                  : `Valider la sélection (${selectedPendingOrderIds.length})`}
              </SecondaryButton>
              <PrimaryButton type="button" onClick={openCreate}>
                Nouvelle demande
              </PrimaryButton>
              {user?.role === "admin" ? (
                <SecondaryButton
                  type="button"
                  disabled={!filterEmployeeId || !employeeHistory}
                  onClick={onPrint}
                >
                  Imprimer PDF employé
                </SecondaryButton>
              ) : null}
            </div>
          </div>
          {filterEmployeeId && employeeHistory ? (
            <div className="mt-3 space-y-1 text-sm text-zinc-600">
              <p>
                Solde {employeeHistory.employee.name} :{" "}
                <strong>{moneyDZD(employeeHistory.balance.available)}</strong>
              </p>
              {employeeHistory.annualLeaveSettlements.map((settlement) => (
                <p key={settlement._id}>
                  Régularisation congés {settlement.year} (
                  {settlement.kind === "YEAR_END" ? "fin d'année" : "départ"}) :{" "}
                  <strong>
                    {settlement.amount < 0 ? "−" : "+"}
                    {moneyDZD(Math.abs(settlement.amount))}
                  </strong>
                </p>
              ))}
            </div>
          ) : null}
        </Card>

        <Card>
          <div className="overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead className="text-xs uppercase text-zinc-500">
                <tr>
                  <th className="pb-3 pr-3 text-left">
                    <input
                      type="checkbox"
                      aria-label="Sélectionner toutes les demandes en attente affichées"
                      checked={allPendingSelected}
                      disabled={pendingFiltered.length === 0 || batchBusy}
                      onChange={toggleAllPendingSelection}
                    />
                  </th>
                  <th className="pb-3 pr-3 text-left">Date</th>
                  <th className="pb-3 pr-3 text-left">Employé</th>
                  <th className="pb-3 pr-3 text-left">Type</th>
                  <th className="pb-3 pr-3 text-right">Montant</th>
                  <th className="pb-3 pr-3 text-left">Remarque</th>
                  <th className="pb-3 pr-3 text-left">Statut</th>
                  <th className="pb-3 text-left">Actions</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((order) => (
                  <tr key={order._id} className="border-t border-zinc-100">
                    <td className="py-3 pr-3">
                      {order.status === "DEMANDE" ? (
                        <input
                          type="checkbox"
                          aria-label={`Sélectionner la demande de ${order.employee.name}`}
                          checked={selectedOrderIds.has(order._id)}
                          disabled={batchBusy}
                          onChange={() => toggleOrderSelection(order._id)}
                        />
                      ) : null}
                    </td>
                    <td className="py-3 pr-3 whitespace-nowrap text-zinc-600">
                      {formatDate(order.requestedAt)}
                    </td>
                    <td className="py-3 pr-3">
                      <p className="font-medium text-zinc-900">
                        {order.employee.name}
                      </p>
                      <p className="text-xs text-zinc-500">
                        {order.employee.email}
                      </p>
                    </td>
                    <td className="py-3 pr-3 text-zinc-700">{order.type}</td>
                    <td className="py-3 pr-3 text-right font-medium text-zinc-900">
                      {moneyDZD(order.amount)}
                    </td>
                    <td className="max-w-[220px] py-3 pr-3 text-zinc-600">
                      <p className="line-clamp-3 whitespace-pre-wrap">
                        {order.note?.trim() ? order.note : "—"}
                      </p>
                    </td>
                    <td className="py-3 pr-3">
                      <Badge className={statusBadgeClass(order.status)}>
                        {paymentStatusLabel(order.status)}
                      </Badge>
                    </td>
                    <td className="py-3">
                      <div className="flex flex-wrap gap-2">
                        {order.status === "DEMANDE" ? (
                          <>
                            <PrimaryButton
                              type="button"
                              className="px-3 py-1.5 text-xs"
                              disabled={busyId === order._id}
                              onClick={() => onTreat(order._id, "VALIDE")}
                            >
                              Valider
                            </PrimaryButton>
                            <SecondaryButton
                              type="button"
                              className="px-3 py-1.5 text-xs"
                              disabled={busyId === order._id}
                              onClick={() => onTreat(order._id, "REJETE")}
                            >
                              Rejeter
                            </SecondaryButton>
                          </>
                        ) : null}
                        {order.status === "PAYE" &&
                        order.confirmedAt &&
                        order.receiptReference ? (
                          <SecondaryButton
                            type="button"
                            className="px-3 py-1.5 text-xs"
                            onClick={() => onPrintReceipt(order)}
                          >
                            Imprimer le reçu
                          </SecondaryButton>
                        ) : null}
                        {(order.status === "REJETE" ||
                          (order.status === "PAYE" && !order.confirmedAt)) ? (
                          <span className="text-xs text-zinc-400">—</span>
                        ) : null}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {!filtered.length ? (
              <p className="py-6 text-sm text-zinc-500">
                {filterEmployeeId || statusFilter
                  ? "Aucune demande pour ce filtre."
                  : "Aucune demande de paiement."}
              </p>
            ) : null}
          </div>
        </Card>

        <Modal
          open={showCreate}
          onClose={closeCreate}
          title="Créer une demande de paiement"
        >
          {formError ? (
            <p className="mb-3 text-sm text-red-600">{formError}</p>
          ) : null}
          <form onSubmit={onCreateDemand} className="grid gap-3">
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
                      {e.name}
                    </option>
                  ))}
              </select>
            </Field>
            <Field label="Type">
              <select
                className={inputClass}
                value={newType}
                onChange={(e) =>
                  setNewType(
                    e.target.value as "SALAIRE_MENSUEL" | "ACOMPTE" | "PRIME"
                  )
                }
              >
                <option value="ACOMPTE">Acompte</option>
                <option value="SALAIRE_MENSUEL">Salaire mensuel</option>
                <option value="PRIME">Prime</option>
              </select>
            </Field>
            <Field label="Montant (DZD)">
              <input
                required
                type="number"
                min={1}
                className={inputClass}
                value={newAmount}
                onChange={(e) => setNewAmount(e.target.value)}
              />
            </Field>
            <Field label="Remarque">
              <input
                className={inputClass}
                value={newNote}
                onChange={(e) => setNewNote(e.target.value)}
                placeholder="Optionnel"
              />
            </Field>
            <label className="flex items-center gap-2 text-sm text-zinc-700">
              <input
                type="checkbox"
                className="accent-[#0088E8]"
                checked={autoValidate}
                onChange={(e) => setAutoValidate(e.target.checked)}
              />
              Valider immédiatement (confirmation de réception par l&apos;employé)
            </label>
            <div className="mt-2 flex justify-end gap-2">
              <SecondaryButton type="button" onClick={closeCreate}>
                Annuler
              </SecondaryButton>
              <PrimaryButton type="submit">Créer la demande</PrimaryButton>
            </div>
          </form>
        </Modal>
      </PageShell>
    </RequireAuth>
  );
}
