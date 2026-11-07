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
import { printFinanceHistory } from "@/lib/pdfExport";

export default function AdminOrdresPaiementPage() {
  const { token } = useAuth();
  const employees = useQuery(
    api.users.listEmployees,
    token ? { token } : "skip"
  );
  const orders = useQuery(
    api.finances.listPaymentOrders,
    token ? { token } : "skip"
  );
  const treat = useMutation(api.finances.treatPaymentOrder);
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
    status: "VALIDE" | "PAYE" | "REJETE"
  ) {
    if (!token) return;
    setBusyId(orderId);
    setError("");
    setMsg("");
    try {
      await treat({ token, orderId, status });
      setMsg(
        status === "VALIDE"
          ? "Demande validée — visible pour la caisse Finance"
          : status === "PAYE"
            ? "Marquée comme payée"
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
        orders: employeeHistory.orders,
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Impression impossible");
    }
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
          ? "Demande créée et validée — visible pour la caisse Finance"
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
    <RequireAuth role="admin">
      <PageShell
        title="Ordres de paiement"
        description="Une ligne par demande : remarque employé, validation admin, puis paiement."
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
                  <option value="PAYE">Payé</option>
                  <option value="REJETE">Rejeté</option>
                </select>
              </Field>
            </div>
            <div className="flex flex-wrap gap-2">
              <PrimaryButton type="button" onClick={openCreate}>
                Nouvelle demande
              </PrimaryButton>
              <SecondaryButton
                type="button"
                disabled={!filterEmployeeId || !employeeHistory}
                onClick={onPrint}
              >
                Imprimer PDF employé
              </SecondaryButton>
            </div>
          </div>
          {filterEmployeeId && employeeHistory ? (
            <p className="mt-3 text-sm text-zinc-600">
              Solde {employeeHistory.employee.name} :{" "}
              <strong>{moneyDZD(employeeHistory.balance.available)}</strong>
            </p>
          ) : null}
        </Card>

        <Card>
          <div className="overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead className="text-xs uppercase text-zinc-500">
                <tr>
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
                        {order.status === "VALIDE" ? (
                          <PrimaryButton
                            type="button"
                            className="px-3 py-1.5 text-xs"
                            disabled={busyId === order._id}
                            onClick={() => onTreat(order._id, "PAYE")}
                          >
                            Marquer payé
                          </PrimaryButton>
                        ) : null}
                        {order.status === "PAYE" || order.status === "REJETE" ? (
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
              Valider immédiatement (envoie à la caisse Finance)
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
