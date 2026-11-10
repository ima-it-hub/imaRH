"use client";

import { useMemo, useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { Trash2 } from "lucide-react";
import { api } from "../../../../../convex/_generated/api";
import { PageShell } from "@/components/PageShell";
import { RequireAuth } from "@/components/RequireAuth";
import { Badge, Card, Field, PrimaryButton, inputClass } from "@/components/ui";
import { useAuth } from "@/lib/auth";
import { moneyDZD } from "@/lib/format";

type PrimeDraft = {
  selected: boolean;
  objective: string;
  realisation: string;
  recoveryObjective: string;
  recouvrement: string;
};

type WorkplacePrimeDraft = {
  objective: string;
  realisation: string;
  recoveryObjective: string;
  recouvrement: string;
};

type SilwanRealisationResult = {
  key: string;
  code: string;
  matched: boolean;
  totalRealisation: number;
  totalRecouvrement: number;
};

function isCentralWorkplace(name: string) {
  return name.trim().toLocaleUpperCase("fr-DZ") === "BEN ZARGA";
}

function formatRealisation(value: number) {
  return (Math.round(value * 100) / 100).toFixed(2);
}

export default function AdminCalculPrimesPage() {
  const { token } = useAuth();
  const now = new Date();
  const [month, setMonth] = useState(now.getMonth() + 1);
  const [year, setYear] = useState(now.getFullYear());
  const [draftOverrides, setDraftOverrides] = useState<
    Record<string, Partial<PrimeDraft>>
  >({});
  const [workplaceOverrides, setWorkplaceOverrides] = useState<
    Record<string, Partial<WorkplacePrimeDraft>>
  >({});
  const [employeeToAdd, setEmployeeToAdd] = useState("");
  const [busy, setBusy] = useState(false);
  const [silwanBusy, setSilwanBusy] = useState(false);
  const [msg, setMsg] = useState("");
  const [error, setError] = useState("");

  const rows = useQuery(
    api.primeCalculations.employeesForMonth,
    token ? { token, month, year } : "skip"
  );
  const workplaceRows = useQuery(
    api.primeCalculations.workplaceMetricsForMonth,
    token ? { token, month, year } : "skip"
  );
  const saveDrafts = useMutation(api.primeCalculations.saveDrafts);
  const saveSilwanRealisations = useMutation(
    api.primeCalculations.saveSilwanRealisations
  );

  const drafts = useMemo(() => {
    const result: Record<string, PrimeDraft> = {};
    for (const row of rows ?? []) {
      const calc = row.calculation;
      result[row.employee._id] = {
        selected:
          (calc?.calculationVersion === 2 && calc.hasOwnMetrics === true) ||
          row.silwanRealisation !== null,
        objective:
          calc?.calculationVersion === 2
            ? String(calc.objective)
            : row.previousMonthObjective !== null
              ? String(row.previousMonthObjective)
              : "",
        realisation:
          row.silwanRealisation !== null
            ? formatRealisation(row.silwanRealisation)
            : calc?.realisation !== undefined
              ? formatRealisation(calc.realisation)
              : "",
        recoveryObjective:
          calc?.recoveryObjective !== undefined
            ? String(calc.recoveryObjective)
            : row.previousMonthRecoveryObjective !== null
              ? String(row.previousMonthRecoveryObjective)
              : "",
        recouvrement:
          row.silwanRecouvrement !== null
            ? formatRealisation(row.silwanRecouvrement)
            : calc?.recouvrement !== undefined
              ? formatRealisation(calc.recouvrement)
              : "",
        ...draftOverrides[row.employee._id],
      };
    }
    return result;
  }, [rows, draftOverrides]);

  const workplaceDrafts = useMemo(() => {
    const result: Record<string, WorkplacePrimeDraft> = {};
    for (const row of workplaceRows ?? []) {
      const metric = row.metrics;
      result[row.workplace._id] = {
        objective: metric
          ? String(metric.objective)
          : row.previousMonthObjective !== null
            ? String(row.previousMonthObjective)
            : "",
        realisation:
          row.silwanRealisation !== null
            ? formatRealisation(row.silwanRealisation)
            : metric
              ? formatRealisation(metric.realisation)
              : "",
        recoveryObjective:
          metric?.recoveryObjective !== undefined
            ? String(metric.recoveryObjective)
            : row.previousMonthRecoveryObjective !== null
              ? String(row.previousMonthRecoveryObjective)
              : "",
        recouvrement:
          row.silwanRecouvrement !== null
            ? formatRealisation(row.silwanRecouvrement)
            : metric?.recouvrement !== undefined
              ? formatRealisation(metric.recouvrement)
              : "",
        ...workplaceOverrides[row.workplace._id],
      };
    }
    return result;
  }, [workplaceRows, workplaceOverrides]);

  const selectedCount = (rows ?? []).filter(
    (row) => drafts[row.employee._id]?.selected
  ).length;
  const selectedRows = (rows ?? []).filter(
    (row) => drafts[row.employee._id]?.selected
  );
  const availableToAdd = (rows ?? []).filter(
    (row) =>
      !drafts[row.employee._id]?.selected &&
      (row.employee.role !== "employee" || row.employee.baseBonus > 0)
  );
  const hasSelectionChanges = (rows ?? []).some(
    (row) =>
      (row.calculation?.hasOwnMetrics === true) !==
        (drafts[row.employee._id]?.selected === true)
  );
  const workplaceRowsToSave = (workplaceRows ?? []).filter((row) => {
    const draft = workplaceDrafts[row.workplace._id];
    const metric = row.metrics;
    return (
      draft.objective !==
        (metric
          ? String(metric.objective)
          : row.previousMonthObjective !== null
            ? String(row.previousMonthObjective)
            : "") ||
      draft.realisation !== (metric ? String(metric.realisation) : "") ||
      draft.recoveryObjective !==
        (metric?.recoveryObjective !== undefined
          ? String(metric.recoveryObjective)
          : row.previousMonthRecoveryObjective !== null
            ? String(row.previousMonthRecoveryObjective)
            : "") ||
      draft.recouvrement !==
        (metric?.recouvrement !== undefined ? String(metric.recouvrement) : "")
    );
  });
  const hasWorkplaceChanges = workplaceRowsToSave.length > 0;
  const isPayoutEmployee = (role: string) => role === "employee";

  function updateDraft(
    employeeId: string,
    field: keyof PrimeDraft,
    value: string | boolean
  ) {
    setDraftOverrides((prev) => ({
      ...prev,
      [employeeId]: {
        ...drafts[employeeId],
        ...prev[employeeId],
        [field]: value,
      },
    }));
  }

  function addEmployee() {
    if (!employeeToAdd) return;
    updateDraft(employeeToAdd, "selected", true);
    setEmployeeToAdd("");
  }

  function updateWorkplaceDraft(
    workplaceId: string,
    field: keyof WorkplacePrimeDraft,
    value: string
  ) {
    setWorkplaceOverrides((prev) => ({
      ...prev,
      [workplaceId]: {
        ...workplaceDrafts[workplaceId],
        ...prev[workplaceId],
        [field]: value,
      },
    }));
  }

  async function importSilwanRealisations() {
    if (!token || !rows || !workplaceRows) return;
    const workplaceEntries = workplaceRows.flatMap(({ workplace }) => {
      if (isCentralWorkplace(workplace.name)) {
        return [
          {
            key: `workplace:${workplace._id}`,
            code: "",
            allDocuments: true,
            kind: "workplace" as const,
            workplaceId: workplace._id,
          },
        ];
      }
      return workplace.associatedAgentCode?.trim()
        ? [
            {
              key: `workplace:${workplace._id}`,
              code: workplace.associatedAgentCode,
              allDocuments: false,
              kind: "workplace" as const,
              workplaceId: workplace._id,
            },
          ]
        : [];
    });
    const entries = [
      ...workplaceEntries,
      ...rows.flatMap(({ employee }) =>
        employee.role === "employee" &&
        employee.baseBonus > 0 &&
        employee.associatedAgentCode?.trim()
          ? [
              {
                key: `employee:${employee._id}`,
                code: employee.associatedAgentCode,
                allDocuments: false,
                kind: "employee" as const,
                employeeId: employee._id,
              },
            ]
          : []
      ),
    ];
    if (!entries.length) {
      setError(
        "Aucun code AssociatedAgent n'est défini sur les fiches employé ou lieu de travail."
      );
      return;
    }

    setSilwanBusy(true);
    setError("");
    setMsg("");
    try {
      const response = await fetch("/api/silwan/realisation", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          token,
          month,
          year,
          entries: entries.map(({ key, code, allDocuments }) => ({
            key,
            code,
            allDocuments,
          })),
        }),
      });
      const payload = (await response.json()) as {
        error?: string;
        results?: SilwanRealisationResult[];
      };
      if (!response.ok || !payload.results) {
        throw new Error(
          payload.error ?? "Impossible d'importer les réalisations Silwan."
        );
      }
      const results = payload.results;
      const requestByKey = new Map(entries.map((entry) => [entry.key, entry]));
      const matchedResults = results.filter((result) => result.matched);
      await saveSilwanRealisations({
        token,
        month,
        year,
        employeeEntries: matchedResults.flatMap((result) => {
          const requestEntry = requestByKey.get(result.key);
          if (!requestEntry || requestEntry.kind !== "employee") return [];
          return [
            {
              employeeId: requestEntry.employeeId,
              associatedAgentCode: requestEntry.code,
              realisation: Number(formatRealisation(result.totalRealisation)),
              recouvrement: Number(formatRealisation(result.totalRecouvrement)),
            },
          ];
        }),
        workplaceEntries: matchedResults.flatMap((result) => {
          const requestEntry = requestByKey.get(result.key);
          if (!requestEntry || requestEntry.kind !== "workplace") return [];
          return [
            {
              workplaceId: requestEntry.workplaceId,
              associatedAgentCode: requestEntry.allDocuments
                ? undefined
                : requestEntry.code,
              allDocuments: requestEntry.allDocuments,
              realisation: Number(formatRealisation(result.totalRealisation)),
              recouvrement: Number(formatRealisation(result.totalRecouvrement)),
            },
          ];
        }),
      });

      setWorkplaceOverrides((previous) => {
        const next = { ...previous };
        for (const result of results) {
          if (!result.matched || !result.key.startsWith("workplace:")) continue;
          const workplaceId = result.key.slice("workplace:".length);
          const draft = workplaceDrafts[workplaceId];
          if (draft) {
            next[workplaceId] = {
              ...draft,
              ...previous[workplaceId],
              realisation: formatRealisation(result.totalRealisation),
              recouvrement: formatRealisation(result.totalRecouvrement),
            };
          }
        }
        return next;
      });
      setDraftOverrides((previous) => {
        const next = { ...previous };
        for (const result of results) {
          if (!result.matched || !result.key.startsWith("employee:")) continue;
          const employeeId = result.key.slice("employee:".length);
          const draft = drafts[employeeId];
          if (draft) {
            next[employeeId] = {
              ...draft,
              ...previous[employeeId],
              selected: true,
              realisation: formatRealisation(result.totalRealisation),
              recouvrement: formatRealisation(result.totalRecouvrement),
            };
          }
        }
        return next;
      });

      const matchedCount = matchedResults.length;
      setMsg(
        `${matchedCount} réalisation(s) et recouvrement(s) importé(s) et enregistré(s) pour ${month}/${year}. Enregistrez les données pour recalculer les primes; une nouvelle synchronisation ne sera pas nécessaire.`
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erreur d'importation Silwan");
    } finally {
      setSilwanBusy(false);
    }
  }

  async function onSave() {
    if (!token || !rows || !workplaceRows) return;
    const selectedRows = rows.filter(
      (row) => drafts[row.employee._id]?.selected
    );
    if (
      !selectedRows.length &&
      !hasSelectionChanges &&
      !hasWorkplaceChanges
    ) {
      setError("Aucune modification à enregistrer.");
      return;
    }

    setBusy(true);
    setError("");
    setMsg("");
    try {
      const result = await saveDrafts({
        token,
        month,
        year,
        selectedEmployeeIds: selectedRows.map((row) => row.employee._id),
        entries: selectedRows.map((row) => {
          const draft = drafts[row.employee._id];
          return {
            employeeId: row.employee._id,
            objective: Number(draft.objective) || 0,
            realisation: Number(draft.realisation) || 0,
            recoveryObjective: Number(draft.recoveryObjective) || 0,
            recouvrement: Number(draft.recouvrement) || 0,
          };
        }),
        workplaceEntries: workplaceRowsToSave.map((row) => {
          const draft = workplaceDrafts[row.workplace._id];
          const numberOrNull = (value: string) =>
            value.trim() === "" ? null : Number(value);
          return {
            workplaceId: row.workplace._id,
            objective: numberOrNull(draft.objective),
            realisation: numberOrNull(draft.realisation),
            recoveryObjective: numberOrNull(draft.recoveryObjective),
            recouvrement: numberOrNull(draft.recouvrement),
          };
        }),
      });
      setDraftOverrides({});
      setWorkplaceOverrides({});
      setMsg(
        `${result.selected} calcul(s) individuel(s) enregistré(s), ${result.inherited} prime(s) préparée(s) avec les données du lieu de travail ou du manager. ${result.blocked} employé(s) en attente de données ou d'une prime de base.`
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erreur");
    } finally {
      setBusy(false);
    }
  }

  return (
    <RequireAuth page="admin-calcul-primes">
      <PageShell
        title="Calcul des primes"
        description="Saisissez les résultats par lieu de travail et ajoutez uniquement les employés qui ont des objectifs individuels. Les autres utilisent les données de leur lieu ou, si elles manquent, celles de leur manager."
        className="max-w-[1400px]"
      >
        {msg ? <p className="mb-4 text-sm text-emerald-600">{msg}</p> : null}
        {error ? <p className="mb-4 text-sm text-red-600">{error}</p> : null}

        <div className="mb-4 flex flex-wrap items-end gap-3">
          <Field label="Mois">
            <select
              className={inputClass}
              value={month}
              onChange={(e) => {
                setMonth(Number(e.target.value));
                setDraftOverrides({});
                setWorkplaceOverrides({});
                setEmployeeToAdd("");
              }}
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
              onChange={(e) => {
                setYear(Number(e.target.value));
                setDraftOverrides({});
                setWorkplaceOverrides({});
                setEmployeeToAdd("");
              }}
            />
          </Field>
          <PrimaryButton
            type="button"
            disabled={silwanBusy || !rows || !workplaceRows}
            onClick={() => void importSilwanRealisations()}
          >
            {silwanBusy ? "Import Silwan…" : "Importer depuis Silwan"}
          </PrimaryButton>
        </div>

        <Card>
          <section className="mb-6">
            <h2 className="font-semibold text-zinc-900">
              Objectifs par lieu de travail
            </h2>
            {/* <p className="mt-1 text-sm text-zinc-500">
              Les employés non sélectionnés individuellement utilisent les
              objectifs et résultats de leur lieu. Le recouvrement s&apos;applique
              uniquement au département « resposible showroom ». Laissez les
              champs de recouvrement vides s&apos;ils ne sont pas utilisés.
            </p> */}
            <div className="mt-3 overflow-x-auto">
              <table className="w-full min-w-[900px] table-fixed text-sm">
                <colgroup>
                  <col className="w-[220px]" />
                  <col className="w-[160px]" />
                  <col className="w-[160px]" />
                  <col className="w-[180px]" />
                  <col className="w-[160px]" />
                </colgroup>
                <thead className="text-xs uppercase text-zinc-500">
                  <tr>
                    <th className="border-b border-zinc-100 p-3 text-left">
                      Lieu de travail
                    </th>
                    <th className="border-b border-zinc-100 p-3 text-left">
                      Objectif réalisation
                    </th>
                    <th className="border-b border-zinc-100 p-3 text-left">
                      Réalisation
                    </th>
                    <th className="border-b border-zinc-100 p-3 text-left">
                      Objectif recouvrement
                    </th>
                    <th className="border-b border-zinc-100 p-3 text-left">
                      Recouvrement
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {(workplaceRows ?? []).map(({ workplace }) => {
                    const draft = workplaceDrafts[workplace._id] ?? {
                      objective: "",
                      realisation: "",
                      recoveryObjective: "",
                      recouvrement: "",
                    };
                    const fields = [
                      ["objective", "Objectif réalisation"],
                      ["realisation", "Réalisation"],
                      ["recoveryObjective", "Objectif recouvrement"],
                      ["recouvrement", "Recouvrement"],
                    ] as const;
                    return (
                      <tr
                        key={workplace._id}
                        className="border-b border-zinc-100 align-middle"
                      >
                        <td className="p-3 font-medium text-zinc-900">
                          {workplace.name}
                        </td>
                        {fields.map(([field, label]) => (
                          <td key={field} className="p-3">
                            <label className="block">
                              <span className="sr-only">
                                {label} — {workplace.name}
                              </span>
                              <input
                                type="number"
                                min={
                                  field === "objective" ||
                                  field === "recoveryObjective"
                                    ? 1
                                    : field === "realisation"
                                      ? 0
                                      : undefined
                                }
                                step="0.01"
                                className="w-full min-w-0 rounded-lg border border-zinc-200 px-2 py-2 tabular-nums"
                                value={draft[field]}
                                onChange={(e) =>
                                  updateWorkplaceDraft(
                                    workplace._id,
                                    field,
                                    e.target.value
                                  )
                                }
                              />
                            </label>
                          </td>
                        ))}
                      </tr>
                    );
                  })}
                </tbody>
              </table>
              {!workplaceRows?.length ? (
                <p className="py-4 text-sm text-zinc-500">
                  Aucun lieu de travail n&apos;est configuré.
                </p>
              ) : null}
            </div>
          </section>

          <div className="mb-4 border-t border-zinc-100 pt-5">
            <h2 className="font-semibold text-zinc-900">
              Calculs individuels
            </h2>
            {/* <p className="mt-1 text-sm text-zinc-500">
              Ajoutez uniquement les employés qui ont des objectifs personnels.
              Les autres reprennent les données de leur lieu de travail si elles
              sont enregistrées, sinon celles de leur manager.
            </p> */}
          </div>
          <div className="mb-4 flex flex-wrap items-end gap-3">
            <Field label="Ajouter un employé au calcul individuel">
              <select
                className={inputClass + " min-w-64"}
                value={employeeToAdd}
                onChange={(e) => setEmployeeToAdd(e.target.value)}
              >
                <option value="">Choisir un employé ou manager</option>
                {availableToAdd.map((row) => (
                  <option key={row.employee._id} value={row.employee._id}>
                    {row.employee.name}
                    {row.employee.role === "admin" ? " (manager)" : ""}
                  </option>
                ))}
              </select>
            </Field>
            <PrimaryButton
              type="button"
              disabled={!employeeToAdd}
              onClick={addEmployee}
            >
              Ajouter
            </PrimaryButton>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[1320px] table-fixed text-sm">
              <colgroup>
                <col className="w-[180px]" />
                <col className="w-[130px]" />
                <col className="w-[145px]" />
                <col className="w-[145px]" />
                <col className="w-[170px]" />
                <col className="w-[145px]" />
                <col className="w-[100px]" />
                <col className="w-[130px]" />
                <col className="w-[125px]" />
                <col className="w-12" />
              </colgroup>
              <thead className="text-xs uppercase text-zinc-500">
                <tr>
                  <th className="border-b border-zinc-100 p-3 text-left">Employé / calcul</th>
                  <th className="border-b border-zinc-100 p-3 text-right">Prime de base</th>
                  <th className="border-b border-zinc-100 p-3 text-left">Objectif</th>
                  <th className="border-b border-zinc-100 p-3 text-left">Réalisation</th>
                  <th className="border-b border-zinc-100 p-3 text-left">Obj. recouvrement</th>
                  <th className="border-b border-zinc-100 p-3 text-left">Recouvrement</th>
                  <th className="border-b border-zinc-100 p-3 text-right">Évaluation</th>
                  <th className="border-b border-zinc-100 p-3 text-right">Résultat</th>
                  <th className="border-b border-zinc-100 p-3 text-left">État</th>
                  <th className="border-b border-zinc-100 p-3" aria-label="Actions" />
                </tr>
              </thead>
              <tbody>
                {selectedRows.map((row) => {
                  const id = row.employee._id;
                  const draft = drafts[id] ?? {
                    selected: false,
                    objective: "",
                    realisation: "",
                    recoveryObjective: "",
                    recouvrement: "",
                  };
                  const calc = row.calculation;
                  const confirmed = calc?.status === "CONFIRME";
                  const selected = draft.selected;
                  const blocked =
                    (isPayoutEmployee(row.employee.role) &&
                      row.employee.baseBonus <= 0) ||
                    (!selected &&
                      calc?.calculationVersion !== 2 &&
                      !row.managerHasOwnMetrics);

                  return (
                    <tr key={id} className="border-b border-zinc-100 align-middle">
                      <td className="p-3">
                        <span className="block font-medium text-zinc-900">
                          {row.employee.name}
                        </span>
                        <span className="block text-xs text-zinc-500">
                          {selected
                            ? row.employee.role === "employee"
                              ? "Saisie individuelle"
                              : "Objectifs du manager"
                            : row.managerName
                              ? `Manager : ${row.managerName}`
                              : row.employee.role === "admin"
                                ? "Manager"
                                : "Aucun manager"}
                        </span>
                        {isPayoutEmployee(row.employee.role) &&
                        row.employee.baseBonus <= 0 ? (
                          <p className="mt-1 text-xs text-red-600">
                            Prime de base à définir sur la fiche employé.
                          </p>
                        ) : null}
                        {!selected &&
                        blocked &&
                        isPayoutEmployee(row.employee.role) &&
                        row.employee.baseBonus > 0 ? (
                          <p className="mt-1 text-xs text-amber-700">
                            En attente : sélectionnez son manager pour saisir
                            ses objectifs.
                          </p>
                        ) : null}
                        {!selected &&
                        row.managerHasOwnMetrics &&
                        row.managerObjective !== null ? (
                          <p className="mt-1 text-xs text-zinc-500">
                            Hérite de {row.managerName} : objectif{" "}
                            {moneyDZD(row.managerObjective)}, réalisation{" "}
                            {moneyDZD(row.managerRealisation ?? 0)}
                          </p>
                        ) : null}
                      </td>
                      <td className="p-3 text-right tabular-nums">
                        {isPayoutEmployee(row.employee.role)
                          ? moneyDZD(row.employee.baseBonus)
                          : "Données manager"}
                      </td>
                      {(
                        [
                          ["objective", "Objectif"],
                          ["realisation", "Réalisation"],
                          ["recoveryObjective", "Objectif recouvrement"],
                          ["recouvrement", "Recouvrement"],
                        ] as const
                      ).map(([field, label]) => (
                        <td key={field} className="p-3">
                          {row.employee.role === "admin" &&
                          field !== "objective" &&
                          field !== "realisation" ? (
                            "—"
                          ) : selected ? (
                            <label className="block">
                              <span className="sr-only">{label}</span>
                              <input
                                type="number"
                                min={
                                  field === "objective" ||
                                  field === "recoveryObjective"
                                    ? 1
                                    : field === "realisation"
                                      ? 0
                                      : undefined
                                }
                                step="0.01"
                                className="w-full min-w-0 rounded-lg border border-zinc-200 px-2 py-2 tabular-nums"
                                value={draft[field]}
                                onChange={(e) =>
                                  updateDraft(id, field, e.target.value)
                                }
                              />
                            </label>
                          ) : (
                            <span className="text-zinc-500">
                              {field === "objective" &&
                              calc?.calculationVersion === 2
                                ? moneyDZD(calc.objective)
                                : field === "realisation" &&
                                    calc?.calculationVersion === 2
                                  ? moneyDZD(calc.realisation)
                                  : field === "recoveryObjective" &&
                                      calc?.recoveryObjective
                                    ? moneyDZD(calc.recoveryObjective)
                                    : field === "recouvrement" &&
                                        calc?.hasOwnMetrics
                                      ? moneyDZD(calc.recouvrement)
                                      : "—"}
                            </span>
                          )}
                        </td>
                      ))}
                      <td className="p-3 text-right tabular-nums">
                        {isPayoutEmployee(row.employee.role)
                          ? `${row.evaluationPercent}%`
                          : "—"}
                      </td>
                      <td className="p-3 text-right font-semibold tabular-nums">
                        {!isPayoutEmployee(row.employee.role)
                          ? "—"
                          : calc?.calculationVersion === 2
                          ? moneyDZD(calc.totalAmount)
                          : "—"}
                      </td>
                      <td className="p-3">
                        {!isPayoutEmployee(row.employee.role) ? (
                          <Badge className="bg-indigo-100 text-indigo-800">
                            {calc?.hasOwnMetrics
                              ? "Manager prêt"
                              : "Manager"}
                          </Badge>
                        ) : confirmed ? (
                          <Badge className="bg-emerald-100 text-emerald-800">
                            Confirmée
                          </Badge>
                        ) : calc?.calculationVersion === 2 ? (
                          <Badge className="bg-amber-100 text-amber-800">
                            Brouillon
                          </Badge>
                        ) : blocked ? (
                          <Badge className="bg-zinc-100 text-zinc-600">
                            En attente
                          </Badge>
                        ) : (
                          <Badge className="bg-sky-100 text-sky-800">
                            Prêt à calculer
                          </Badge>
                        )}
                      </td>
                      <td className="p-3 text-right">
                        {selected ? (
                          <button
                            type="button"
                            aria-label={`Supprimer ${row.employee.name} du calcul individuel`}
                            title="Supprimer"
                            className="inline-flex size-8 items-center justify-center rounded-lg text-red-600 transition hover:bg-red-50 hover:text-red-700"
                            onClick={() =>
                              updateDraft(id, "selected", false)
                            }
                          >
                            <Trash2 size={16} aria-hidden="true" />
                          </button>
                        ) : null}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            {selectedRows.length === 0 ? (
              <p className="py-8 text-sm text-zinc-500">
                Aucun employé ajouté. Choisissez un employé dans la liste
                ci-dessus pour commencer.
              </p>
            ) : null}
          </div>

          <div className="mt-4 flex flex-wrap items-center justify-between gap-3 border-t border-zinc-100 pt-4">
            <p className="text-sm text-zinc-600">
              {selectedCount} employé(s) ajouté(s) au calcul individuel.
            </p>
            <PrimaryButton
              type="button"
              disabled={
                busy ||
                (!hasSelectionChanges &&
                  !hasWorkplaceChanges &&
                  selectedCount === 0)
              }
              onClick={() => void onSave()}
            >
              {busy ? "Enregistrement…" : "Enregistrer les données et calculer"}
            </PrimaryButton>
          </div>
        </Card>
      </PageShell>
    </RequireAuth>
  );
}
