"use client";

import { useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { api } from "../../../../../convex/_generated/api";
import type { Id } from "../../../../../convex/_generated/dataModel";
import { PageShell } from "@/components/PageShell";
import { RequireAuth } from "@/components/RequireAuth";
import { Badge, Card, PrimaryButton } from "@/components/ui";
import { useAuth } from "@/lib/auth";
import {
  formatDate,
  moneyDZD,
  paymentStatusLabel,
  statusBadgeClass,
} from "@/lib/format";

export default function CaissePaiementsPage() {
  const { token } = useAuth();
  const validated = useQuery(
    api.finances.listValidatedForFinance,
    token ? { token } : "skip"
  );
  const awaitingConfirmation = useQuery(
    api.finances.listPaidForFinance,
    token ? { token } : "skip"
  );
  const markDisbursed = useMutation(api.finances.markDisbursedByFinance);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [msg, setMsg] = useState("");

  async function onRecordDisbursement(orderId: Id<"paymentOrders">) {
    if (!token) return;
    setBusyId(orderId);
    setError("");
    setMsg("");
    try {
      await markDisbursed({ token, orderId });
      setMsg("Remise enregistrée — en attente de confirmation de l'employé");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erreur");
    } finally {
      setBusyId(null);
    }
  }

  return (
    <RequireAuth role="employee" page="caisse-paiements">
      <PageShell
        title="Caisse / Paiements"
        description="Demandes validées de votre lieu de travail — enregistrez la remise après avoir remis l'argent à l'employé."
      >
        {error ? (
          <p className="mb-4 text-sm text-red-600">{error}</p>
        ) : null}
        {msg ? (
          <p className="mb-4 text-sm text-emerald-600">{msg}</p>
        ) : null}

        <h2 className="mb-3 text-lg font-semibold text-zinc-900">
          À payer (validées)
        </h2>
        <Card className="mb-8">
          <div className="overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead className="text-xs uppercase text-zinc-500">
                <tr>
                  <th className="pb-3 pr-3 text-left">Employé</th>
                  <th className="pb-3 pr-3 text-left">Type</th>
                  <th className="pb-3 pr-3 text-right">Montant</th>
                  <th className="pb-3 pr-3 text-left">Demandée</th>
                  <th className="pb-3 pr-3 text-left">Validée</th>
                  <th className="pb-3 pr-3 text-left">Remarque</th>
                  <th className="pb-3 pr-3 text-left">Statut</th>
                  <th className="pb-3 text-left">Action</th>
                </tr>
              </thead>
              <tbody>
                {(validated ?? []).map((order) => (
                  <tr key={order._id} className="border-t border-zinc-100">
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
                    <td className="py-3 pr-3 whitespace-nowrap text-zinc-600">
                      {formatDate(order.requestedAt)}
                    </td>
                    <td className="py-3 pr-3 whitespace-nowrap text-zinc-600">
                      {order.treatedAt ? formatDate(order.treatedAt) : "—"}
                    </td>
                    <td className="max-w-[200px] py-3 pr-3 text-zinc-600">
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
                      <PrimaryButton
                        type="button"
                        className="px-3 py-1.5 text-xs"
                        disabled={busyId === order._id}
                        onClick={() => void onRecordDisbursement(order._id)}
                      >
                        {busyId === order._id ? "…" : "Enregistrer la remise"}
                      </PrimaryButton>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {!validated?.length ? (
              <p className="py-6 text-sm text-zinc-500">
                Aucune demande validée en attente de paiement.
              </p>
            ) : null}
          </div>
        </Card>

        <h2 className="mb-3 text-lg font-semibold text-zinc-900">
          Remises en attente de confirmation
        </h2>
        <Card>
          <div className="overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead className="text-xs uppercase text-zinc-500">
                <tr>
                  <th className="pb-3 pr-3 text-left">Employé</th>
                  <th className="pb-3 pr-3 text-left">Type</th>
                  <th className="pb-3 pr-3 text-right">Montant</th>
                  <th className="pb-3 pr-3 text-left">Remise le</th>
                  <th className="pb-3 text-left">Statut</th>
                </tr>
              </thead>
              <tbody>
                {(awaitingConfirmation ?? []).map((order) => (
                  <tr key={order._id} className="border-t border-zinc-100">
                    <td className="py-3 pr-3 font-medium text-zinc-900">
                      {order.employee.name}
                    </td>
                    <td className="py-3 pr-3 text-zinc-700">{order.type}</td>
                    <td className="py-3 pr-3 text-right font-medium text-zinc-900">
                      {moneyDZD(order.amount)}
                    </td>
                    <td className="py-3 pr-3 whitespace-nowrap text-zinc-600">
                      {formatDate(order.disbursedAt ?? order.requestedAt)}
                    </td>
                    <td className="py-3">
                      <Badge className={statusBadgeClass(order.status)}>
                        {paymentStatusLabel(order.status)}
                      </Badge>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {!awaitingConfirmation?.length ? (
              <p className="py-6 text-sm text-zinc-500">
                Aucune remise en attente de confirmation.
              </p>
            ) : null}
          </div>
        </Card>
      </PageShell>
    </RequireAuth>
  );
}
