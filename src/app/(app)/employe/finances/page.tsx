"use client";

import { FormEvent, useState } from "react";
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
  StatCard,
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

export default function FinancesPage() {
  const { token, user } = useAuth();
  const balance = useQuery(api.finances.myBalance, token ? { token } : "skip");
  const salaries = useQuery(api.finances.mySalaries, token ? { token } : "skip");
  const bonuses = useQuery(api.finances.myBonuses, token ? { token } : "skip");
  const lateDeductions = useQuery(
    api.finances.myLateDeductions,
    token ? { token } : "skip"
  );
  const orders = useQuery(
    api.finances.myPaymentOrders,
    token ? { token } : "skip"
  );
  const requestPayment = useMutation(api.finances.requestPayment);
  const confirmPaymentReceived = useMutation(
    api.finances.confirmPaymentReceived
  );

  const [tab, setTab] = useState<
    "salaires" | "primes" | "retards" | "paiements"
  >("paiements");
  const [type, setType] = useState<"SALAIRE_MENSUEL" | "ACOMPTE" | "PRIME">(
    "ACOMPTE"
  );
  const [amount, setAmount] = useState("");
  const [note, setNote] = useState("");
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [busy, setBusy] = useState(false);
  const [confirmingId, setConfirmingId] = useState<string | null>(null);

  const available = balance?.available ?? 0;
  const totalLateDeductions = balance?.totalLateDeductions ?? 0;

  async function onRequest(e: FormEvent) {
    e.preventDefault();
    if (!token) return;
    const value = Number(amount);
    setBusy(true);
    setError("");
    setSuccess("");

    if (value > available) {
      setError(
        `Vous ne pouvez pas demander plus que votre solde disponible (${moneyDZD(available)})`
      );
      setBusy(false);
      return;
    }

    try {
      await requestPayment({
        token,
        type,
        amount: value,
        note,
      });
      setSuccess("Demande envoyée");
      setAmount("");
      setNote("");
      setTab("paiements");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erreur");
    } finally {
      setBusy(false);
    }
  }

  async function onConfirmReceipt(orderId: Id<"paymentOrders">) {
    if (!token) return;
    if (!window.confirm("Confirmez-vous avoir reçu ce paiement ?")) return;
    setConfirmingId(orderId);
    setError("");
    setSuccess("");
    try {
      await confirmPaymentReceived({ token, orderId });
      setSuccess("Réception du paiement confirmée");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erreur");
    } finally {
      setConfirmingId(null);
    }
  }

  return (
    <RequireAuth role="employee" page="finances">
      <PageShell
        title="Rémunération & Primes"
        description="Consultez vos salaires, primes et solde disponible pour vos demandes de paiement."
      >
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <p className="text-sm text-zinc-500">
            Imprimez le tableau mensuel (salaire, prime, réduction, retraits,
            solde).
          </p>
          <SecondaryButton
            type="button"
            disabled={!user}
            onClick={() => {
              if (!user) return;
              try {
                printFinanceHistory({
                  employeeName: user.name,
                  salaries: salaries ?? [],
                  bonuses: bonuses ?? [],
                  lateDeductions: lateDeductions ?? [],
                  orders: orders ?? [],
                });
              } catch (err) {
                setError(err instanceof Error ? err.message : "Impression impossible");
              }
            }}
          >
            Imprimer
          </SecondaryButton>
        </div>

        <div className="mb-6 grid gap-4 sm:grid-cols-2 xl:grid-cols-5">
          <StatCard
            label="Solde disponible"
            value={moneyDZD(available)}
            hint="Inclut les primes à partir du troisième mois après leur attribution."
          />
          <StatCard
            label="Total salaires"
            value={moneyDZD(balance?.totalSalaries ?? 0)}
          />
          <StatCard
            label="Total primes"
            value={moneyDZD(balance?.totalBonuses ?? 0)}
          />
          <StatCard
            label="Retenues pour retards"
            value={
              totalLateDeductions > 0
                ? `-${moneyDZD(totalLateDeductions)}`
                : moneyDZD(0)
            }
          />
          <StatCard
            label="Déjà demandé / payé"
            value={moneyDZD(balance?.reservedOrPaid ?? 0)}
          />
        </div>

        <div className="mb-4 flex flex-wrap gap-2">
          {(
            [
              ["paiements", "Paiements"],
              ["salaires", "Salaires"],
              ["primes", "Primes"],
              ["retards", "Retards"],
            ] as const
          ).map(([key, label]) => (
            <button
              key={key}
              type="button"
              onClick={() => setTab(key)}
              className={`rounded-full px-4 py-2 text-sm font-medium ${
                tab === key
                  ? "bg-[#0088E8] text-white"
                  : "bg-white text-zinc-600 ring-1 ring-zinc-200"
              }`}
            >
              {label}
            </button>
          ))}
        </div>

        {tab === "salaires" ? (
          <Card>
            <div className="overflow-x-auto">
              <table className="min-w-full text-sm">
                <thead className="text-xs uppercase text-zinc-500">
                  <tr>
                    <th className="pb-3 text-left">Période</th>
                    <th className="pb-3 text-left">Base</th>
                    <th className="pb-3 text-left">Congés non payés</th>
                    <th className="pb-3 text-left">Net</th>
                  </tr>
                </thead>
                <tbody>
                  {(salaries ?? []).map((s) => (
                    <tr key={s._id} className="border-t border-zinc-100">
                      <td className="py-3">
                        {s.month}/{s.year}
                      </td>
                      <td className="py-3">{moneyDZD(s.baseSalary)}</td>
                      <td className="py-3">
                        {moneyDZD(s.leaveDeductions ?? 0)}
                      </td>
                      <td className="py-3 font-medium">
                        {moneyDZD(s.netPay ?? s.baseSalary)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {!salaries?.length ? (
                <p className="py-4 text-sm text-zinc-500">Aucun bulletin.</p>
              ) : null}
            </div>
          </Card>
        ) : null}

        {tab === "retards" ? (
          <Card>
            <div className="space-y-3">
              {(lateDeductions ?? []).map((row) => (
                <div
                  key={row._id}
                  className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-red-100 px-4 py-3"
                >
                  <div>
                    <p className="font-medium text-zinc-900">
                      Retenue validée —{" "}
                      {new Date(row.year, row.month - 1, 1).toLocaleString(
                        "fr-DZ",
                        { month: "long", year: "numeric" }
                      )}
                    </p>
                  </div>
                  <p className="text-lg font-semibold text-red-600">
                    -{moneyDZD(row.amount)}
                  </p>
                </div>
              ))}
              {!lateDeductions?.length ? (
                <p className="text-sm text-zinc-500">
                  Aucune retenue pour retard.
                </p>
              ) : null}
            </div>
          </Card>
        ) : null}

        {tab === "primes" ? (
          <Card>
            <div className="space-y-3">
              {(bonuses ?? []).map((b) => (
                <div
                  key={b._id}
                  className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-zinc-100 px-4 py-3"
                >
                  <div>
                    <p className="font-medium text-zinc-900">{b.title}</p>
                  </div>
                  <p className="text-lg font-semibold text-[#0088E8]">
                    {moneyDZD(b.amount)}
                  </p>
                </div>
              ))}
              {!bonuses?.length ? (
                <p className="text-sm text-zinc-500">Aucune prime.</p>
              ) : null}
            </div>
          </Card>
        ) : null}

        {tab === "paiements" ? (
          <div className="grid gap-6 lg:grid-cols-[340px_1fr]">
            <Card>
              <h2 className="font-semibold text-zinc-900">
                Demander un paiement
              </h2>
              <p className="mt-2 rounded-xl bg-[#0088E8]/5 px-3 py-2 text-sm text-[#0088E8]">
                Solde disponible : <strong>{moneyDZD(available)}</strong>
              </p>
              <form onSubmit={onRequest} className="mt-4 space-y-3">
                <Field label="Type">
                  <select
                    className={inputClass}
                    value={type}
                    onChange={(e) =>
                      setType(
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
                    max={available || undefined}
                    step={1}
                    className={inputClass}
                    value={amount}
                    onChange={(e) => setAmount(e.target.value)}
                    placeholder={`Max ${available}`}
                  />
                </Field>
                <Field label="Note">
                  <textarea
                    className={inputClass}
                    rows={3}
                    value={note}
                    onChange={(e) => setNote(e.target.value)}
                  />
                </Field>
                {error ? <p className="text-sm text-red-600">{error}</p> : null}
                {success ? (
                  <p className="text-sm text-emerald-600">{success}</p>
                ) : null}
                <PrimaryButton
                  type="submit"
                  disabled={busy || available <= 0}
                  className="w-full"
                >
                  {available <= 0 ? "Solde insuffisant" : "Envoyer"}
                </PrimaryButton>
              </form>
            </Card>

            <Card>
              <h2 className="mb-4 font-semibold text-zinc-900">
                Suivi des demandes
              </h2>
              <div className="space-y-3">
                {(orders ?? []).map((o) => (
                  <div
                    key={o._id}
                    className="flex items-center justify-between gap-3 rounded-xl border border-zinc-100 px-4 py-3"
                  >
                    <div>
                      <p className="font-medium text-zinc-900">
                        {o.type} · {moneyDZD(o.amount)}
                      </p>
                      <p className="text-xs text-zinc-500">
                        {formatDate(o.requestedAt)}
                      </p>
                      {o.status === "A_CONFIRMER" && o.disbursedAt ? (
                        <p className="text-xs text-amber-700">
                          Remis le {formatDate(o.disbursedAt)}
                        </p>
                      ) : null}
                    </div>
                    <Badge className={statusBadgeClass(o.status)}>
                      {paymentStatusLabel(o.status)}
                    </Badge>
                    {o.status === "A_CONFIRMER" ? (
                      <PrimaryButton
                        type="button"
                        className="px-3 py-1.5 text-xs"
                        disabled={confirmingId === o._id}
                        onClick={() => void onConfirmReceipt(o._id)}
                      >
                        {confirmingId === o._id
                          ? "Confirmation…"
                          : "Confirmer la réception"}
                      </PrimaryButton>
                    ) : null}
                  </div>
                ))}
                {!orders?.length ? (
                  <p className="text-sm text-zinc-500">Aucune demande.</p>
                ) : null}
              </div>
            </Card>
          </div>
        ) : null}
      </PageShell>
    </RequireAuth>
  );
}
