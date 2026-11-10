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
  Modal,
  PrimaryButton,
  SecondaryButton,
  inputClass,
} from "@/components/ui";
import { useAuth } from "@/lib/auth";

export default function AdminDepartementsPage() {
  const { token } = useAuth();
  const departments = useQuery(
    api.departments.list,
    token ? { token } : "skip"
  );
  const createDepartment = useMutation(api.departments.create);
  const updateDepartment = useMutation(api.departments.update);
  const removeDepartment = useMutation(api.departments.remove);
  const addCondition = useMutation(api.departments.addCondition);
  const conditionLibrary = useQuery(
    api.departments.listConditionLibrary,
    token ? { token } : "skip"
  );
  const createLibraryCondition = useMutation(
    api.departments.createLibraryCondition
  );
  const updateLibraryCondition = useMutation(
    api.departments.updateLibraryCondition
  );
  const deleteLibraryCondition = useMutation(
    api.departments.deleteLibraryCondition
  );
  const prepareConditionLibrary = useMutation(
    api.departments.prepareConditionLibrary
  );
  const updateCondition = useMutation(api.departments.updateCondition);
  const removeCondition = useMutation(api.departments.removeCondition);
  const saveEvaluationSettings = useMutation(
    api.departments.saveEvaluationSettings
  );

  const [newName, setNewName] = useState("");
  const [newDescription, setNewDescription] = useState("");
  const [newDepartmentOpen, setNewDepartmentOpen] = useState(false);
  const [selectedDepartmentId, setSelectedDepartmentId] =
    useState<Id<"departments"> | null>(null);
  const [editName, setEditName] = useState("");
  const [editDescription, setEditDescription] = useState("");
  const [conditionLabel, setConditionLabel] = useState("");
  const [conditionDescription, setConditionDescription] = useState("");
  const [conditionLibraryDrafts, setConditionLibraryDrafts] = useState<
    Record<string, { label: string; description: string }>
  >({});
  const [expandedLibraryConditionId, setExpandedLibraryConditionId] =
    useState<Id<"evaluationConditionLibrary"> | null>(null);
  const [conditionLibraryOpen, setConditionLibraryOpen] = useState(false);
  const [selectedLibraryConditionId, setSelectedLibraryConditionId] =
    useState<Id<"evaluationConditionLibrary"> | "">("");
  const [conditionDrafts, setConditionDrafts] = useState<
    Record<string, string>
  >({});
  const [conditionWeightDrafts, setConditionWeightDrafts] = useState<
    Record<string, string>
  >({});
  const [primeWeightDrafts, setPrimeWeightDrafts] = useState({
    evaluation: "20",
    realisation: "80",
    companyRealisation: "0",
  });
  const [msg, setMsg] = useState("");
  const [error, setError] = useState("");

  const selectedDepartment = (departments ?? []).find(
    (department) => department._id === selectedDepartmentId
  );

  function selectDepartment(
    department: NonNullable<typeof departments>[number]
  ) {
    setSelectedDepartmentId(department._id);
    setEditName(department.name);
    setEditDescription(department.description ?? "");
    setConditionDrafts(
      Object.fromEntries(
        department.conditions.map((condition) => [
          condition._id,
          condition.label,
        ])
      )
    );
    setConditionWeightDrafts(
      Object.fromEntries(
        department.conditions.map((condition) => [
          condition._id,
          String(condition.weightPercent ?? 0),
        ])
      )
    );
    setPrimeWeightDrafts({
      evaluation: String(department.evaluationWeightPercent ?? 20),
      realisation: String(department.realisationWeightPercent ?? 80),
      companyRealisation: String(
        department.companyRealisationWeightPercent ?? 0
      ),
    });
  }

  async function onCreateDepartment(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!token) return;
    setError("");
    setMsg("");
    try {
      const department = await createDepartment({
        token,
        name: newName,
        description: newDescription,
      });
      setNewName("");
      setNewDescription("");
      setNewDepartmentOpen(false);
      if (department) {
        setSelectedDepartmentId(department._id);
        setEditName(department.name);
        setEditDescription(department.description ?? "");
        setConditionDrafts({});
        setConditionWeightDrafts({});
        setPrimeWeightDrafts({
          evaluation: "20",
          realisation: "80",
          companyRealisation: "0",
        });
      }
      setMsg("Département créé pour tous les lieux de travail");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erreur");
    }
  }

  async function onAddLibraryCondition(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!token) return;
    setError("");
    setMsg("");
    try {
      await createLibraryCondition({
        token,
        label: conditionLabel,
        description: conditionDescription,
      });
      setConditionLabel("");
      setConditionDescription("");
      setMsg("Condition ajoutée à la bibliothèque");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erreur");
    }
  }

  async function onSaveLibraryCondition(
    conditionId: Id<"evaluationConditionLibrary">,
    label: string,
    description: string
  ) {
    if (!token) return;
    setError("");
    setMsg("");
    try {
      await updateLibraryCondition({
        token,
        conditionId,
        label,
        description,
      });
      setConditionLibraryDrafts((previous) => {
        const next = { ...previous };
        delete next[conditionId];
        return next;
      });
      setMsg("Condition mise à jour");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erreur");
    }
  }

  async function onDeleteLibraryCondition(
    conditionId: Id<"evaluationConditionLibrary">,
    label: string
  ) {
    if (
      !token ||
      !confirm(
        `Retirer « ${label} » de la bibliothèque ? Les départements qui l'utilisent la conserveront.`
      )
    ) {
      return;
    }
    setError("");
    setMsg("");
    try {
      await deleteLibraryCondition({ token, conditionId });
      setMsg("Condition retirée de la bibliothèque");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erreur");
    }
  }

  async function onAssignCondition() {
    if (!token || !selectedDepartment || !selectedLibraryConditionId) return;
    setError("");
    setMsg("");
    try {
      await addCondition({
        token,
        departmentId: selectedDepartment._id,
        libraryConditionId: selectedLibraryConditionId,
      });
      setConditionWeightDrafts((previous) => ({
        ...previous,
        [selectedLibraryConditionId]: "0",
      }));
      setSelectedLibraryConditionId("");
      setMsg("Condition ajoutée au département");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erreur");
    }
  }

  async function onOpenConditionLibrary() {
    if (!token) return;
    setError("");
    try {
      await prepareConditionLibrary({ token });
      setConditionLibraryOpen(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erreur");
    }
  }

  async function onSaveDepartment() {
    if (!token || !selectedDepartment) return;
    setError("");
    setMsg("");
    try {
      await updateDepartment({
        token,
        departmentId: selectedDepartment._id,
        name: editName,
        description: editDescription,
      });
      setMsg("Département mis à jour");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erreur");
    }
  }

  async function onSaveEvaluationSettings() {
    if (!token || !selectedDepartment) return;
    setError("");
    setMsg("");
    try {
      await saveEvaluationSettings({
        token,
        departmentId: selectedDepartment._id,
        evaluationWeightPercent: Number(primeWeightDrafts.evaluation),
        realisationWeightPercent: Number(primeWeightDrafts.realisation),
        companyRealisationWeightPercent: Number(
          primeWeightDrafts.companyRealisation
        ),
        conditionWeights: selectedDepartment.conditions
          .filter((condition) => condition.isActive)
          .map((condition) => ({
            conditionId: condition._id,
            weightPercent: Number(conditionWeightDrafts[condition._id]),
          })),
      });
      setMsg("Pondérations enregistrées");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erreur");
    }
  }

  return (
    <RequireAuth page="admin-departements">
      <PageShell
        title="Départements"
        description="Les départements et leurs règles sont communs à tous les lieux de travail. Gérez les conditions d'évaluation et les parts de prime par département."
        className="max-w-[1200px]"
      >
        <div className="mb-4 flex flex-wrap gap-2">
          <PrimaryButton
            type="button"
            onClick={() => setNewDepartmentOpen(true)}
          >
            Nouveau département
          </PrimaryButton>
          <SecondaryButton
            type="button"
            onClick={() => void onOpenConditionLibrary()}
          >
            Conditions d&apos;évaluation
          </SecondaryButton>
        </div>
        {error ? <p className="mb-3 text-sm text-red-600">{error}</p> : null}
        {msg ? <p className="mb-3 text-sm text-emerald-600">{msg}</p> : null}

        <div className="grid gap-6 lg:grid-cols-[320px_1fr]">
          <div className="space-y-4">
            <Card>
              <h2 className="mb-3 font-semibold text-zinc-900">
                Départements ({departments?.length ?? 0})
              </h2>
              <div className="space-y-2">
                {(departments ?? []).map((department) => (
                  <button
                    key={department._id}
                    type="button"
                    onClick={() => selectDepartment(department)}
                    className={`flex w-full items-center justify-between gap-2 rounded-xl border px-3 py-2 text-left text-sm transition ${
                      selectedDepartmentId === department._id
                        ? "border-[#0088E8]/40 bg-[#0088E8]/5"
                        : "border-zinc-200 hover:bg-zinc-50"
                    }`}
                  >
                    <span className="font-medium text-zinc-900">
                      {department.name}
                    </span>
                    <Badge className="shrink-0 bg-zinc-100 text-zinc-600">
                      {department.employeeCount} emp.
                    </Badge>
                  </button>
                ))}
                {!departments?.length ? (
                  <p className="text-sm text-zinc-500">
                    Aucun département.
                  </p>
                ) : null}
              </div>
            </Card>
          </div>

          <Card>
            {selectedDepartment ? (
              <div className="space-y-7">
                <section className="space-y-3">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div>
                      <h2 className="text-lg font-semibold text-zinc-900">
                        {selectedDepartment.name}
                      </h2>
                      <p className="text-sm text-zinc-500">
                        Partagé par tous les lieux de travail
                      </p>
                    </div>
                    <SecondaryButton
                      type="button"
                      onClick={async () => {
                        if (
                          !token ||
                          !confirm(
                            `Supprimer le département « ${selectedDepartment.name} » ?`
                          )
                        ) {
                          return;
                        }
                        setError("");
                        try {
                          await removeDepartment({
                            token,
                            departmentId: selectedDepartment._id,
                          });
                          setSelectedDepartmentId(null);
                          setMsg("Département supprimé");
                        } catch (err) {
                          setError(err instanceof Error ? err.message : "Erreur");
                        }
                      }}
                    >
                      Supprimer
                    </SecondaryButton>
                  </div>
                  <Field label="Nom">
                    <input
                      required
                      className={inputClass}
                      value={editName}
                      onChange={(event) => setEditName(event.target.value)}
                    />
                  </Field>
                  <Field label="Description">
                    <input
                      className={inputClass}
                      value={editDescription}
                      onChange={(event) =>
                        setEditDescription(event.target.value)
                      }
                    />
                  </Field>
                  <PrimaryButton type="button" onClick={() => void onSaveDepartment()}>
                    Enregistrer le département
                  </PrimaryButton>
                </section>

                <section>
                  <h3 className="mb-2 font-semibold text-zinc-900">
                    Répartition de la prime
                  </h3>
                  <p className="mb-3 text-sm text-zinc-500">
                    Les trois parts doivent totaliser 100 %. La part entreprise
                    utilise la réalisation de BEN ZARGA par rapport à son
                    objectif mensuel. L&apos;ajustement de recouvrement reste
                    appliqué séparément.
                  </p>
                  <div className="grid gap-3 sm:grid-cols-3">
                    {(
                      [
                        ["evaluation", "Évaluation (%)"],
                        ["realisation", "Réalisation personnelle (%)"],
                        ["companyRealisation", "Réalisation entreprise (%)"],
                      ] as const
                    ).map(([key, label]) => (
                      <Field key={key} label={label}>
                        <input
                          type="number"
                          min="0"
                          max="100"
                          step="0.01"
                          className={inputClass}
                          value={primeWeightDrafts[key]}
                          onChange={(event) =>
                            setPrimeWeightDrafts((previous) => ({
                              ...previous,
                              [key]: event.target.value,
                            }))
                          }
                        />
                      </Field>
                    ))}
                  </div>
                </section>

                <section>
                  <h3 className="mb-2 font-semibold text-zinc-900">
                    Conditions d&apos;évaluation
                  </h3>
                  <p className="mb-3 text-sm text-zinc-500">
                    Le manager note chaque condition de 1 à 5. Les poids actifs
                    doivent totaliser 100 %.
                  </p>
                  <div className="mb-4 flex flex-wrap gap-2">
                    <select
                      className={inputClass + " min-w-[220px] flex-1"}
                      value={selectedLibraryConditionId}
                      onChange={(event) =>
                        setSelectedLibraryConditionId(
                          event.target.value as
                            | Id<"evaluationConditionLibrary">
                            | ""
                        )
                      }
                    >
                      <option value="">Choisir une condition existante…</option>
                      {(conditionLibrary ?? [])
                        .filter(
                          (libraryCondition) =>
                            !selectedDepartment.conditions.some(
                              (condition) =>
                                condition.libraryConditionId ===
                                libraryCondition._id
                            )
                        )
                        .map((condition) => (
                          <option key={condition._id} value={condition._id}>
                            {condition.label}
                          </option>
                        ))}
                    </select>
                    <PrimaryButton
                      type="button"
                      disabled={!selectedLibraryConditionId}
                      onClick={() => void onAssignCondition()}
                    >
                      Ajouter au département
                    </PrimaryButton>
                    <SecondaryButton
                      type="button"
                      onClick={() => void onOpenConditionLibrary()}
                    >
                      Nouvelle condition
                    </SecondaryButton>
                  </div>

                  <div className="space-y-2">
                    {selectedDepartment.conditions.map((condition) => (
                      <div
                        key={condition._id}
                        className="flex flex-wrap items-center gap-2 rounded-xl border border-zinc-200 px-3 py-2"
                      >
                        <input
                          className={inputClass + " min-w-[180px] flex-1"}
                          value={
                            conditionDrafts[condition._id] ?? condition.label
                          }
                          onChange={(event) =>
                            setConditionDrafts((previous) => ({
                              ...previous,
                              [condition._id]: event.target.value,
                            }))
                          }
                        />
                        {condition.isActive ? (
                          <label className="flex items-center gap-2 text-sm text-zinc-600">
                            Poids %
                            <input
                              type="number"
                              min="0"
                              max="100"
                              step="0.01"
                              className={inputClass + " w-24"}
                              value={
                                conditionWeightDrafts[condition._id] ?? ""
                              }
                              onChange={(event) =>
                                setConditionWeightDrafts((previous) => ({
                                  ...previous,
                                  [condition._id]: event.target.value,
                                }))
                              }
                            />
                          </label>
                        ) : null}
                        <Badge
                          className={
                            condition.isActive
                              ? "bg-emerald-50 text-emerald-700"
                              : "bg-zinc-100 text-zinc-500"
                          }
                        >
                          {condition.isActive ? "active" : "inactive"}
                        </Badge>
                        <SecondaryButton
                          type="button"
                          onClick={async () => {
                            if (!token) return;
                            setError("");
                            try {
                              await updateCondition({
                                token,
                                conditionId: condition._id,
                                label:
                                  conditionDrafts[condition._id] ??
                                  condition.label,
                                isActive: condition.isActive,
                              });
                              setMsg("Condition mise à jour");
                            } catch (err) {
                              setError(
                                err instanceof Error ? err.message : "Erreur"
                              );
                            }
                          }}
                        >
                          Sauver
                        </SecondaryButton>
                        <SecondaryButton
                          type="button"
                          onClick={async () => {
                            if (!token) return;
                            setError("");
                            try {
                              await updateCondition({
                                token,
                                conditionId: condition._id,
                                label:
                                  conditionDrafts[condition._id] ??
                                  condition.label,
                                isActive: !condition.isActive,
                              });
                              setMsg(
                                condition.isActive
                                  ? "Condition désactivée"
                                  : "Condition activée"
                              );
                            } catch (err) {
                              setError(
                                err instanceof Error ? err.message : "Erreur"
                              );
                            }
                          }}
                        >
                          {condition.isActive ? "Désactiver" : "Activer"}
                        </SecondaryButton>
                        <SecondaryButton
                          type="button"
                          onClick={async () => {
                            if (
                              !token ||
                              !confirm("Supprimer cette condition ?")
                            ) {
                              return;
                            }
                            setError("");
                            try {
                              await removeCondition({
                                token,
                                conditionId: condition._id,
                              });
                              setMsg("Condition supprimée");
                            } catch (err) {
                              setError(
                                err instanceof Error ? err.message : "Erreur"
                              );
                            }
                          }}
                        >
                          ×
                        </SecondaryButton>
                      </div>
                    ))}
                    {!selectedDepartment.conditions.length ? (
                      <p className="text-sm text-zinc-500">
                        Aucune condition. Ajoutez les critères que les managers
                        noteront.
                      </p>
                    ) : null}
                  </div>
                  <PrimaryButton
                    type="button"
                    className="mt-4"
                    onClick={() => void onSaveEvaluationSettings()}
                  >
                    Enregistrer les pondérations
                  </PrimaryButton>
                </section>
              </div>
            ) : (
              <p className="text-sm text-zinc-500">
                Sélectionnez un département pour modifier ses conditions et ses
                pondérations.
              </p>
            )}
          </Card>
        </div>

        <Modal
          open={newDepartmentOpen}
          onClose={() => setNewDepartmentOpen(false)}
          title="Nouveau département"
        >
          <form onSubmit={onCreateDepartment} className="space-y-3">
            <Field label="Nom">
              <input
                required
                className={inputClass}
                value={newName}
                onChange={(event) => setNewName(event.target.value)}
              />
            </Field>
            <Field label="Description">
              <input
                className={inputClass}
                value={newDescription}
                onChange={(event) => setNewDescription(event.target.value)}
              />
            </Field>
            <PrimaryButton type="submit" className="w-full">
              Créer le département
            </PrimaryButton>
          </form>
        </Modal>

        <Modal
          open={conditionLibraryOpen}
          onClose={() => setConditionLibraryOpen(false)}
          title="Conditions d'évaluation"
        >
          <form onSubmit={onAddLibraryCondition} className="space-y-3">
            <Field label="Nom de la condition">
              <input
                required
                className={inputClass}
                value={conditionLabel}
                onChange={(event) => setConditionLabel(event.target.value)}
                placeholder="Ex. Ponctualité & assiduité"
              />
            </Field>
            <Field label="Description (facultative)">
              <textarea
                rows={3}
                className={inputClass}
                value={conditionDescription}
                onChange={(event) =>
                  setConditionDescription(event.target.value)
                }
              />
            </Field>
            <PrimaryButton type="submit" className="w-full">
              Ajouter à la bibliothèque
            </PrimaryButton>
          </form>
          {error ? (
            <p className="mt-3 text-sm text-red-600">{error}</p>
          ) : null}
          {msg ? (
            <p className="mt-3 text-sm text-emerald-600">{msg}</p>
          ) : null}
          <div className="mt-5">
            <h3 className="mb-2 text-sm font-semibold text-zinc-900">
              Conditions existantes
            </h3>
            <div className="max-h-[45vh] space-y-2 overflow-y-auto">
              {(conditionLibrary ?? []).map((condition) => (
                <div
                  key={condition._id}
                  className="rounded-xl border border-zinc-200"
                >
                  <button
                    type="button"
                    aria-expanded={
                      expandedLibraryConditionId === condition._id
                    }
                    onClick={() =>
                      setExpandedLibraryConditionId((current) =>
                        current === condition._id ? null : condition._id
                      )
                    }
                    className="flex w-full items-center justify-between gap-3 px-3 py-2.5 text-left"
                  >
                    <span className="min-w-0">
                      <span className="block truncate text-sm font-medium text-zinc-900">
                        {condition.label}
                      </span>
                      {condition.description ? (
                        <span className="mt-0.5 block truncate text-xs text-zinc-500">
                          {condition.description}
                        </span>
                      ) : null}
                    </span>
                    <span
                      aria-hidden="true"
                      className="shrink-0 text-zinc-500"
                    >
                      {expandedLibraryConditionId === condition._id ? "−" : "+"}
                    </span>
                  </button>
                  {expandedLibraryConditionId === condition._id ? (
                    <div className="space-y-2 border-t border-zinc-100 p-3">
                      <Field label="Nom">
                        <input
                          required
                          className={inputClass}
                          value={
                            conditionLibraryDrafts[condition._id]?.label ??
                            condition.label
                          }
                          onChange={(event) =>
                            setConditionLibraryDrafts((previous) => ({
                              ...previous,
                              [condition._id]: {
                                label: event.target.value,
                                description:
                                  previous[condition._id]?.description ??
                                  condition.description ??
                                  "",
                              },
                            }))
                          }
                        />
                      </Field>
                      <Field label="Description (facultative)">
                        <textarea
                          rows={2}
                          className={inputClass}
                          value={
                            conditionLibraryDrafts[condition._id]
                              ?.description ??
                            condition.description ??
                            ""
                          }
                          onChange={(event) =>
                            setConditionLibraryDrafts((previous) => ({
                              ...previous,
                              [condition._id]: {
                                label:
                                  previous[condition._id]?.label ??
                                  condition.label,
                                description: event.target.value,
                              },
                            }))
                          }
                        />
                      </Field>
                      <div className="flex flex-wrap gap-2">
                        <PrimaryButton
                          type="button"
                          onClick={() =>
                            void onSaveLibraryCondition(
                              condition._id,
                              conditionLibraryDrafts[condition._id]?.label ??
                                condition.label,
                              conditionLibraryDrafts[condition._id]
                                ?.description ??
                                condition.description ??
                                ""
                            )
                          }
                        >
                          Enregistrer
                        </PrimaryButton>
                        <SecondaryButton
                          type="button"
                          onClick={() =>
                            void onDeleteLibraryCondition(
                              condition._id,
                              condition.label
                            )
                          }
                        >
                          Supprimer
                        </SecondaryButton>
                      </div>
                    </div>
                  ) : null}
                </div>
              ))}
              {!conditionLibrary?.length ? (
                <p className="text-sm text-zinc-500">
                  Aucune condition dans la bibliothèque.
                </p>
              ) : null}
            </div>
          </div>
        </Modal>
      </PageShell>
    </RequireAuth>
  );
}
