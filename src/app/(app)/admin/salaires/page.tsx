"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { api } from "../../../../../convex/_generated/api";
import type { Id } from "../../../../../convex/_generated/dataModel";
import { PageShell } from "@/components/PageShell";
import { RequireAuth } from "@/components/RequireAuth";
import {
  Card,
  Field,
  PrimaryButton,
  inputClass,
} from "@/components/ui";
import { useAuth } from "@/lib/auth";
import { formatDate, moneyDZD } from "@/lib/format";

type SalaryDraft = {
  baseSalary: string;
};

function monthAmountFromDraft(
  contractual: number,
  proration?: {
    daysWorked: number;
    daysInMonth: number;
    isProrated: boolean;
    notYetHired: boolean;
  } | null
) {
  if (!proration || proration.notYetHired) {
    return proration?.notYetHired ? 0 : contractual;
  }
  if (!proration.isProrated || proration.daysInMonth <= 0) {
    return contractual;
  }
  return Math.round(
    (contractual * proration.daysWorked) / proration.daysInMonth
  );
}

export default function AdminSalairesPage() {
  const { token } = useAuth();
  const setSalariesBatch = useMutation(api.finances.setSalariesBatch);

  const now = new Date();
  const [month, setMonth] = useState(now.getMonth() + 1);
  const [year, setYear] = useState(now.getFullYear());
  const [salaryDrafts, setSalaryDrafts] = useState<Record<string, SalaryDraft>>(
    {}
  );
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");
  const [error, setError] = useState("");

  const monthRows = useQuery(
    api.finances.salariesForMonth,
    token ? { token, month, year } : "skip"
  );
  useEffect(() => {
    if (!monthRows) return;
    const nextSalaries: Record<string, SalaryDraft> = {};
    for (const row of monthRows) {
      nextSalaries[row.employee._id] = {
        baseSalary: String(
          row.salary?.contractualSalary ??
            row.proration.contractualSalary ??
            row.employee.baseSalary ??
            0
        ),
      };
    }
    setSalaryDrafts(nextSalaries);
  }, [monthRows]);

  const leaveDeductionByEmployee = useMemo(() => {
    const map: Record<string, number> = {};
    for (const row of monthRows ?? []) {
      map[row.employee._id] = row.salary?.leaveDeductions ?? 0;
    }
    return map;
  }, [monthRows]);

  const totalDraft = useMemo(() => {
    return (monthRows ?? []).reduce((sum, row) => {
      const draft = salaryDrafts[row.employee._id];
      const contractual = Number(draft?.baseSalary) || 0;
      const monthPay = monthAmountFromDraft(contractual, row.proration);
      const leave = leaveDeductionByEmployee[row.employee._id] ?? 0;
      return sum + Math.max(0, monthPay - leave);
    }, 0);
  }, [monthRows, salaryDrafts, leaveDeductionByEmployee]);

  const definedSalaries = useMemo(() => {
    return (monthRows ?? []).filter((row) => row.salary != null);
  }, [monthRows]);

  const definedSalaryTotal = useMemo(() => {
    return definedSalaries.reduce((sum, row) => {
      const base = row.salary?.baseSalary ?? 0;
      const leave = row.salary?.leaveDeductions ?? 0;
      return sum + Math.max(0, base - leave);
    }, 0);
  }, [definedSalaries]);

  function updateSalaryDraft(
    employeeId: string,
    value: string
  ) {
    setSalaryDrafts((prev) => ({
      ...prev,
      [employeeId]: { baseSalary: value },
    }));
  }

  async function onSaveAll(e: FormEvent) {
    e.preventDefault();
    if (!token || !monthRows) return;
    setBusy(true);
    setError("");
    setMsg("");
    try {
      const entries = monthRows.map((row) => {
        const draft = salaryDrafts[row.employee._id] ?? {
          baseSalary: "0",
        };
        return {
          employeeId: row.employee._id as Id<"users">,
          baseSalary: Number(draft.baseSalary) || 0,
        };
      });

      const result = await setSalariesBatch({
        token,
        month,
        year,
        entries,
      });

      setMsg(
        `${result.saved} salaire(s) enregistré(s) pour ${month}/${year}; le salaire de base des employés a été mis à jour comme valeur par défaut pour les prochains mois. ${result.paymentOrdersCreated} ordre(s) de salaire créé(s), ${result.paymentOrdersUpdated} mis à jour.`
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erreur");
    } finally {
      setBusy(false);
    }
  }

  return (
    <RequireAuth role="admin">
      <PageShell
        title="Salaires"
        description="Définissez les salaires mensuels et les déductions."
      >
        {msg ? (
          <p className="mb-4 text-sm text-emerald-600">{msg}</p>
        ) : null}
        {error ? <p className="mb-4 text-sm text-red-600">{error}</p> : null}

        <div className="mb-4 flex flex-wrap gap-3">
          <Field label="Mois">
            <select
              className={inputClass}
              value={month}
              onChange={(e) => setMonth(Number(e.target.value))}
            >
              {Array.from({ length: 12 }, (_, i) => (
                <option key={i + 1} value={i + 1}>
                  {new Date(2000, i, 1).toLocaleString("fr-DZ", {
                    month: "long",
                  })}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Année">
            <input
              type="number"
              className={inputClass + " w-28"}
              value={year}
              onChange={(e) => setYear(Number(e.target.value))}
            />
          </Field>
        </div>

        <Card className="mb-6">
          <div>
            <h2 className="font-semibold text-zinc-900">
              Définir les salaires du mois
            </h2>
            <p className="mt-1 text-sm text-zinc-500">
              Saisissez le salaire mensuel complet. Si l&apos;employé a commencé
              en cours de mois, seul le prorata (jours travaillés / jours du
              mois) est crédité. Après l&apos;enregistrement, ce montant devient
              son salaire de base par défaut pour les prochains mois.
            </p>
          </div>

          <form onSubmit={onSaveAll} className="mt-5">
            <div className="overflow-x-auto">
              <table className="min-w-full text-sm">
                <thead className="text-xs uppercase text-zinc-500">
                  <tr>
                    <th className="pb-3 pr-3 text-left">Employé</th>
                    <th className="pb-3 pr-3 text-left">Département</th>
                    <th className="pb-3 pr-3 text-left">
                      Salaire mensuel
                      <span className="mt-1 block text-[10px] font-normal normal-case text-zinc-400">
                        Définit le salaire de base par défaut
                      </span>
                    </th>
                    <th className="pb-3 pr-3 text-left">Prorata mois</th>
                    <th className="pb-3 pr-3 text-left">Congés non payés</th>
                    <th className="pb-3 text-left">Net</th>
                  </tr>
                </thead>
                <tbody>
                  {(monthRows ?? []).map((row) => {
                    const draft = salaryDrafts[row.employee._id] ?? {
                      baseSalary: "0",
                    };
                    const contractual = Number(draft.baseSalary) || 0;
                    const monthPay = monthAmountFromDraft(
                      contractual,
                      row.proration
                    );
                    const leaveDed =
                      leaveDeductionByEmployee[row.employee._id] ?? 0;
                    const net = Math.max(0, monthPay - leaveDed);
                    return (
                      <tr
                        key={row.employee._id}
                        className="border-t border-zinc-100"
                      >
                        <td className="py-3 pr-3">
                          <p className="font-medium text-zinc-900">
                            {row.employee.name}
                          </p>
                          <p className="text-xs text-zinc-500">
                            {row.employee.email}
                          </p>
                          {row.employee.hireDate ? (
                            <p className="text-xs text-zinc-400">
                              Embauche : {formatDate(row.employee.hireDate)}
                            </p>
                          ) : null}
                        </td>
                        <td className="py-3 pr-3 text-zinc-600">
                          {row.employee.department || "—"}
                        </td>
                        <td className="py-3 pr-3">
                          <input
                            type="number"
                            min={0}
                            className="w-36 rounded-lg border border-zinc-200 px-2 py-1.5"
                            value={draft.baseSalary}
                            onChange={(e) =>
                              updateSalaryDraft(
                                row.employee._id,
                                e.target.value
                              )
                            }
                          />
                        </td>
                        <td className="py-3 pr-3">
                          <p className="font-medium text-zinc-900">
                            {moneyDZD(monthPay)}
                          </p>
                          {row.proration.isProrated ? (
                            <p className="text-xs text-amber-700">
                              {row.proration.notYetHired
                                ? "Pas encore embauché"
                                : `${row.proration.daysWorked}/${row.proration.daysInMonth} j (depuis le ${row.proration.hireDay})`}
                            </p>
                          ) : (
                            <p className="text-xs text-zinc-400">
                              {row.proration.daysInMonth} j — mois complet
                            </p>
                          )}
                        </td>
                        <td className="py-3 pr-3 text-zinc-700">
                          {moneyDZD(leaveDed)}
                        </td>
                        <td className="py-3 font-medium text-zinc-900">
                          {moneyDZD(net)}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
              {!monthRows?.length ? (
                <p className="py-6 text-sm text-zinc-500">
                  Aucun employé à afficher.
                </p>
              ) : null}
            </div>

            <div className="mt-4 flex flex-col gap-3 border-t border-zinc-100 pt-4 sm:flex-row sm:items-center sm:justify-between">
              <p className="text-sm text-zinc-600">
                Masse salariale nette :{" "}
                <strong className="text-zinc-900">{moneyDZD(totalDraft)}</strong>
              </p>
              <PrimaryButton type="submit" disabled={busy || !monthRows?.length}>
                {busy
                  ? "Enregistrement…"
                  : `Enregistrer salaires (${month}/${year})`}
              </PrimaryButton>
            </div>
          </form>
        </Card>

        <Card className="mb-6">
          <div className="mb-4">
            <h2 className="font-semibold text-zinc-900">
              Salaires définis —{" "}
              {new Date(year, month - 1, 1).toLocaleString("fr-DZ", {
                month: "long",
                year: "numeric",
              })}
            </h2>
            <p className="mt-1 text-sm text-zinc-500">
              Salaires enregistrés pour ce mois.
            </p>
          </div>
          <div className="overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead className="text-xs uppercase text-zinc-500">
                <tr>
                  <th className="pb-3 pr-3 text-left">Employé</th>
                  <th className="pb-3 pr-3 text-left">Département</th>
                  <th className="pb-3 pr-3 text-right">Mensuel</th>
                  <th className="pb-3 pr-3 text-right">Crédit mois</th>
                  <th className="pb-3 pr-3 text-right">Congés</th>
                  <th className="pb-3 text-right">Net</th>
                </tr>
              </thead>
              <tbody>
                {definedSalaries.map((row) => {
                  const monthPay = row.salary?.baseSalary ?? 0;
                  const contractual =
                    row.salary?.contractualSalary ??
                    row.employee.baseSalary ??
                    monthPay;
                  const leave = row.salary?.leaveDeductions ?? 0;
                  const net = Math.max(0, monthPay - leave);
                  const daysNote =
                    row.salary?.daysWorked != null &&
                    row.salary?.daysInMonth != null &&
                    row.salary.daysWorked < row.salary.daysInMonth
                      ? `${row.salary.daysWorked}/${row.salary.daysInMonth} j`
                      : null;
                  return (
                    <tr
                      key={`salary-defined-${row.employee._id}`}
                      className="border-t border-zinc-100"
                    >
                      <td className="py-3 pr-3 font-medium text-zinc-900">
                        {row.employee.name}
                      </td>
                      <td className="py-3 pr-3 text-zinc-600">
                        {row.employee.department || "—"}
                      </td>
                      <td className="py-3 pr-3 text-right text-zinc-700">
                        {moneyDZD(contractual)}
                      </td>
                      <td className="py-3 pr-3 text-right text-zinc-700">
                        {moneyDZD(monthPay)}
                        {daysNote ? (
                          <span className="block text-xs text-amber-700">
                            {daysNote}
                          </span>
                        ) : null}
                      </td>
                      <td className="py-3 pr-3 text-right text-zinc-700">
                        {moneyDZD(leave)}
                      </td>
                      <td className="py-3 text-right font-semibold text-zinc-900">
                        {moneyDZD(net)}
                      </td>
                    </tr>
                  );
                })}
                {definedSalaries.length > 0 ? (
                  <tr className="border-t-2 border-zinc-300 bg-zinc-50 font-semibold">
                    <td className="py-3 pr-3" colSpan={5}>
                      Total masse nette
                    </td>
                    <td className="py-3 text-right">
                      {moneyDZD(definedSalaryTotal)}
                    </td>
                  </tr>
                ) : null}
              </tbody>
            </table>
            {!definedSalaries.length ? (
              <p className="py-6 text-sm text-zinc-500">
                Aucun salaire enregistré pour ce mois.
              </p>
            ) : null}
          </div>
        </Card>
      </PageShell>
    </RequireAuth>
  );
}
