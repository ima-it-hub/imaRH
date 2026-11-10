"use client";

import Link from "next/link";
import { useQuery } from "convex/react";
import { api } from "../../../../../convex/_generated/api";
import { PageShell } from "@/components/PageShell";
import { RequireAuth } from "@/components/RequireAuth";
import { Card, StatCard } from "@/components/ui";
import { useAuth } from "@/lib/auth";
import { moneyDZD } from "@/lib/format";

export default function AdminDashboardPage() {
  const { token } = useAuth();
  const data = useQuery(api.dashboard.adminHome, token ? { token } : "skip");

  return (
    <RequireAuth page="admin-dashboard">
      <PageShell
        title="Tableau de bord RH"
        description="Indicateurs clés de l'effectif IMA Plomberie."
      >
        <div className="mb-6 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          <StatCard label="Effectif actif" value={data?.totalEmployees ?? "—"} />
          <StatCard
            label="Présence du jour"
            value={`${data?.presenceRate ?? 0}%`}
            hint={`${data?.presentCount ?? 0} présent(s)`}
          />
          <StatCard
            label="Congés à traiter"
            value={data?.pendingLeaves ?? "—"}
          />
          <StatCard
            label="Paiements en attente"
            value={data?.pendingPayments ?? "—"}
          />
        </div>

        <div className="grid gap-4 lg:grid-cols-2">
          <Card>
            <h2 className="font-semibold text-zinc-900">Masse salariale mensuelle</h2>
            <p className="mt-3 text-3xl font-semibold text-[#0088E8]">
              {moneyDZD(data?.monthlyPayroll ?? 0)}
            </p>
            <div className="mt-4 flex flex-wrap gap-2">
              <Link
                href="/admin/gestion-conges"
                className="rounded-lg bg-zinc-100 px-3 py-2 text-sm text-zinc-700 hover:bg-zinc-200"
              >
                Traiter les congés
              </Link>
              <Link
                href="/admin/salaires"
                className="rounded-lg bg-zinc-100 px-3 py-2 text-sm text-zinc-700 hover:bg-zinc-200"
              >
                Salaires
              </Link>
              <Link
                href="/admin/primes"
                className="rounded-lg bg-zinc-100 px-3 py-2 text-sm text-zinc-700 hover:bg-zinc-200"
              >
                Primes
              </Link>
            </div>
          </Card>

          <Card>
            <h2 className="mb-3 font-semibold text-zinc-900">
              Retards significatifs du jour (≥ 15 min)
            </h2>
            <div className="space-y-3">
              {(data?.significantLates ?? []).map((row) => (
                <div
                  key={row._id}
                  className="flex items-center justify-between rounded-xl bg-amber-50 px-3 py-2"
                >
                  <div>
                    <p className="text-sm font-medium text-zinc-900">
                      {row.employee.name}
                    </p>
                    <p className="text-xs text-zinc-500">
                      {row.employee.department || "—"}
                    </p>
                  </div>
                  <p className="text-sm font-semibold text-amber-700">
                    +{row.lateMinutes} min
                  </p>
                </div>
              ))}
              {!data?.significantLates?.length ? (
                <p className="text-sm text-zinc-500">
                  Aucun retard significatif aujourd&apos;hui.
                </p>
              ) : null}
            </div>
          </Card>
        </div>
      </PageShell>
    </RequireAuth>
  );
}
