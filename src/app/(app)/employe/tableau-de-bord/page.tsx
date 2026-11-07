"use client";

import { useQuery } from "convex/react";
import { api } from "../../../../../convex/_generated/api";
import { PageShell } from "@/components/PageShell";
import { RequireAuth } from "@/components/RequireAuth";
import { Badge, Card, StatCard } from "@/components/ui";
import { useAuth } from "@/lib/auth";
import {
  leaveStatusLabel,
  moneyDZD,
  paymentStatusLabel,
  statusBadgeClass,
} from "@/lib/format";

export default function EmployeeDashboardPage() {
  const { token, user } = useAuth();
  const data = useQuery(api.dashboard.employeeHome, token ? { token } : "skip");
  const today = useQuery(api.attendance.myToday, token ? { token } : "skip");
  const workSchedule = useQuery(
    api.attendance.myWorkSchedule,
    token ? { token } : "skip"
  );

  const attendance = today ?? data?.todayAttendance;

  return (
    <RequireAuth role="employee" page="tableau-de-bord">
      <PageShell
        title="Tableau de bord"
        description={`Bonjour ${user?.firstName || user?.name || ""}. Gérez votre journée RH.`}
      >
        <div className="mb-6 grid gap-4 lg:grid-cols-[1.2fr_1fr]">
          <Card className="bg-gradient-to-br from-white to-[#fff5f5]">
            <p className="text-sm font-medium text-zinc-500">Pointage du jour</p>
            <p className="mt-1 text-xs text-zinc-400">
              Pointage via badge / scan uniquement
            </p>
            {workSchedule ? (
              <p className="mt-2 text-xs text-zinc-500">
                {workSchedule.workplace} · {workSchedule.startTime}–
                {workSchedule.endTime} · durée requise{" "}
                {workSchedule.requiredWorkMinutes} min
              </p>
            ) : null}
            <div className="mt-4 flex flex-wrap gap-3 text-sm text-zinc-600">
              <span>Scans : {attendance?.scans?.length ?? 0}</span>
              <span>
                Travaillé :{" "}
                {"workedMinutes" in (attendance ?? {})
                  ? (attendance as { workedMinutes?: number }).workedMinutes ?? 0
                  : 0}{" "}
                min
              </span>
              <span>Retard : {attendance?.lateMinutes ?? 0} min</span>
            </div>
          </Card>

          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-1">
            <StatCard
              label="Congés restants"
              value={`${data?.user.annualLeaveBalance ?? user?.annualLeaveBalance ?? 0} / ${data?.user.annualLeaveQuota ?? user?.annualLeaveQuota ?? 30}`}
              hint="jours cette année"
            />
            <StatCard
              label="Retards du mois"
              value={`${data?.lateMinutes ?? 0} min`}
            />
          </div>
        </div>

        <div className="mb-6 grid gap-4 sm:grid-cols-2">
          <StatCard
            label="Dernier salaire net"
            value={
              data?.lastSalary
                ? moneyDZD(data.lastSalary.netPay ?? data.lastSalary.baseSalary)
                : "—"
            }
            hint={
              data?.lastSalary
                ? `${data.lastSalary.month}/${data.lastSalary.year}`
                : undefined
            }
          />
          <StatCard
            label="Dernière prime"
            value={data?.lastBonus ? moneyDZD(data.lastBonus.amount) : "—"}
            hint={data?.lastBonus?.title}
          />
        </div>

        <div className="grid gap-4 lg:grid-cols-2">
          <Card>
            <h2 className="font-semibold text-zinc-900">Dernières notifications</h2>
            <div className="mt-4 space-y-3">
              {(data?.notifications ?? []).length === 0 ? (
                <p className="text-sm text-zinc-500">Aucune notification.</p>
              ) : (
                data?.notifications.map((n) => (
                  <div key={n._id} className="rounded-xl bg-zinc-50 px-3 py-2">
                    <p className="text-sm font-medium text-zinc-900">{n.title}</p>
                    <p className="text-xs text-zinc-500">{n.message}</p>
                  </div>
                ))
              )}
            </div>
          </Card>

          <Card>
            <h2 className="font-semibold text-zinc-900">Suivi des demandes</h2>
            <div className="mt-4 space-y-3">
              {(data?.recentLeaves ?? []).slice(0, 3).map((leave) => (
                <div
                  key={leave._id}
                  className="flex items-center justify-between gap-3"
                >
                  <div>
                    <p className="text-sm font-medium text-zinc-900">
                      Congé {leave.type}
                    </p>
                    <p className="text-xs text-zinc-500">
                      {leave.startDate} → {leave.endDate}
                    </p>
                  </div>
                  <Badge className={statusBadgeClass(leave.status)}>
                    {leaveStatusLabel(leave.status)}
                  </Badge>
                </div>
              ))}
              {(data?.recentPayments ?? []).slice(0, 3).map((order) => (
                <div
                  key={order._id}
                  className="flex items-center justify-between gap-3"
                >
                  <div>
                    <p className="text-sm font-medium text-zinc-900">
                      Paiement {order.type}
                    </p>
                    <p className="text-xs text-zinc-500">
                      {moneyDZD(order.amount)}
                    </p>
                  </div>
                  <Badge className={statusBadgeClass(order.status)}>
                    {paymentStatusLabel(order.status)}
                  </Badge>
                </div>
              ))}
              {!data?.recentLeaves?.length && !data?.recentPayments?.length ? (
                <p className="text-sm text-zinc-500">Aucune demande récente.</p>
              ) : null}
            </div>
          </Card>
        </div>
      </PageShell>
    </RequireAuth>
  );
}
