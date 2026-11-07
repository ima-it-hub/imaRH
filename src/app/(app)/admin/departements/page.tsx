"use client";

import { FormEvent, useEffect, useState } from "react";
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
  inputClass,
} from "@/components/ui";
import { useAuth } from "@/lib/auth";

export default function AdminDepartementsPage() {
  const { token } = useAuth();
  const workplaces = useQuery(api.workplaces.list, token ? { token } : "skip");
  const createWorkplace = useMutation(api.workplaces.create);
  const updateWorkplace = useMutation(api.workplaces.update);
  const removeWorkplace = useMutation(api.workplaces.remove);
  const createDept = useMutation(api.departments.create);
  const updateDept = useMutation(api.departments.update);
  const removeDept = useMutation(api.departments.remove);
  const addCondition = useMutation(api.departments.addCondition);
  const updateCondition = useMutation(api.departments.updateCondition);
  const removeCondition = useMutation(api.departments.removeCondition);
  const migrateInvert = useMutation(api.departments.migrateWorkplaceOwnership);

  const [wpName, setWpName] = useState("");
  const [wpDescription, setWpDescription] = useState("");
  const [selectedWpId, setSelectedWpId] = useState<Id<"workplaces"> | "">("");
  const [editWpName, setEditWpName] = useState("");
  const [editWpDescription, setEditWpDescription] = useState("");

  const [deptName, setDeptName] = useState("");
  const [deptDescription, setDeptDescription] = useState("");
  const [selectedDeptId, setSelectedDeptId] = useState<Id<"departments"> | "">(
    ""
  );
  const [editDeptName, setEditDeptName] = useState("");
  const [editDeptDescription, setEditDeptDescription] = useState("");
  const [conditionLabel, setConditionLabel] = useState("");
  const [conditionDrafts, setConditionDrafts] = useState<
    Record<string, string>
  >({});
  const [msg, setMsg] = useState("");
  const [error, setError] = useState("");

  const selectedWp = (workplaces ?? []).find((w) => w._id === selectedWpId);
  const deptDetails = useQuery(
    api.departments.listByWorkplace,
    token && selectedWpId
      ? { token, workplaceId: selectedWpId as Id<"workplaces"> }
      : "skip"
  );
  const selectedDeptFull = (deptDetails ?? []).find(
    (d) => d._id === selectedDeptId
  );

  useEffect(() => {
    if (!selectedWp) return;
    setEditWpName(selectedWp.name);
    setEditWpDescription(selectedWp.description ?? "");
  }, [selectedWp]);

  useEffect(() => {
    if (!selectedDeptFull) return;
    setEditDeptName(selectedDeptFull.name);
    setEditDeptDescription(selectedDeptFull.description ?? "");
    const drafts: Record<string, string> = {};
    for (const c of selectedDeptFull.conditions) {
      drafts[c._id] = c.label;
    }
    setConditionDrafts(drafts);
  }, [selectedDeptFull]);

  async function onCreateWorkplace(e: FormEvent) {
    e.preventDefault();
    if (!token) return;
    setError("");
    setMsg("");
    try {
      const row = await createWorkplace({
        token,
        name: wpName,
        description: wpDescription,
      });
      setWpName("");
      setWpDescription("");
      if (row) setSelectedWpId(row._id);
      setMsg("Lieu de travail créé");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erreur");
    }
  }

  async function onCreateDept(e: FormEvent) {
    e.preventDefault();
    if (!token || !selectedWpId) return;
    setError("");
    setMsg("");
    try {
      const row = await createDept({
        token,
        workplaceId: selectedWpId,
        name: deptName,
        description: deptDescription,
      });
      setDeptName("");
      setDeptDescription("");
      if (row) setSelectedDeptId(row._id);
      setMsg("Département créé");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erreur");
    }
  }

  async function onAddCondition(e: FormEvent) {
    e.preventDefault();
    if (!token || !selectedDeptId) return;
    setError("");
    try {
      await addCondition({
        token,
        departmentId: selectedDeptId,
        label: conditionLabel,
      });
      setConditionLabel("");
      setMsg("Condition ajoutée");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erreur");
    }
  }

  return (
    <RequireAuth role="admin">
      <PageShell
        title="Lieux & départements"
        description="Créez d'abord un lieu de travail, puis assignez-y des départements et leurs critères d'évaluation."
      >
        {error ? <p className="mb-3 text-sm text-red-600">{error}</p> : null}
        {msg ? <p className="mb-3 text-sm text-emerald-600">{msg}</p> : null}

        <div className="mb-4">
          <SecondaryButton
            type="button"
            onClick={async () => {
              if (!token) return;
              try {
                const r = await migrateInvert({ token });
                setMsg(
                  `Migration : ${r.linked} dép. liés, ${r.copied} copiés, ${r.syncedUsers} employés alignés`
                );
              } catch (err) {
                setError(err instanceof Error ? err.message : "Erreur");
              }
            }}
          >
            Migrer (départements → lieux)
          </SecondaryButton>
        </div>

        <div className="grid gap-6 lg:grid-cols-[300px_300px_1fr]">
          <div className="space-y-4">
            <Card>
              <h2 className="font-semibold text-zinc-900">Nouveau lieu</h2>
              <form onSubmit={onCreateWorkplace} className="mt-3 space-y-3">
                <Field label="Nom">
                  <input
                    required
                    className={inputClass}
                    value={wpName}
                    onChange={(e) => setWpName(e.target.value)}
                  />
                </Field>
                <Field label="Description">
                  <input
                    className={inputClass}
                    value={wpDescription}
                    onChange={(e) => setWpDescription(e.target.value)}
                  />
                </Field>
                <PrimaryButton type="submit" className="w-full">
                  Créer le lieu
                </PrimaryButton>
              </form>
            </Card>

            <Card>
              <h2 className="mb-3 font-semibold text-zinc-900">Lieux</h2>
              <div className="space-y-2">
                {(workplaces ?? []).map((w) => (
                  <button
                    key={w._id}
                    type="button"
                    onClick={() => {
                      setSelectedWpId(w._id);
                      setSelectedDeptId("");
                    }}
                    className={`flex w-full items-center justify-between rounded-xl border px-3 py-2 text-left text-sm transition ${
                      selectedWpId === w._id
                        ? "border-[#0088E8]/40 bg-[#0088E8]/5"
                        : "border-zinc-200 hover:bg-zinc-50"
                    }`}
                  >
                    <span className="font-medium text-zinc-900">{w.name}</span>
                    <Badge className="bg-zinc-100 text-zinc-600">
                      {w.departmentCount} dép. · {w.employeeCount} emp.
                    </Badge>
                  </button>
                ))}
                {!workplaces?.length ? (
                  <p className="text-sm text-zinc-500">Aucun lieu.</p>
                ) : null}
              </div>
            </Card>
          </div>

          <div className="space-y-4">
            {selectedWp ? (
              <>
                <Card>
                  <div className="mb-3 flex items-start justify-between gap-2">
                    <h2 className="font-semibold text-zinc-900">
                      {selectedWp.name}
                    </h2>
                    <SecondaryButton
                      type="button"
                      onClick={async () => {
                        if (!token) return;
                        if (
                          !confirm(
                            `Supprimer le lieu « ${selectedWp.name} » ?`
                          )
                        ) {
                          return;
                        }
                        try {
                          await removeWorkplace({
                            token,
                            workplaceId: selectedWp._id,
                          });
                          setSelectedWpId("");
                          setSelectedDeptId("");
                          setMsg("Lieu supprimé");
                        } catch (err) {
                          setError(
                            err instanceof Error ? err.message : "Erreur"
                          );
                        }
                      }}
                    >
                      Supprimer
                    </SecondaryButton>
                  </div>
                  <div className="space-y-2">
                    <Field label="Nom">
                      <input
                        className={inputClass}
                        value={editWpName}
                        onChange={(e) => setEditWpName(e.target.value)}
                      />
                    </Field>
                    <Field label="Description">
                      <input
                        className={inputClass}
                        value={editWpDescription}
                        onChange={(e) => setEditWpDescription(e.target.value)}
                      />
                    </Field>
                    <PrimaryButton
                      type="button"
                      onClick={async () => {
                        if (!token) return;
                        try {
                          await updateWorkplace({
                            token,
                            workplaceId: selectedWp._id,
                            name: editWpName,
                            description: editWpDescription,
                          });
                          setMsg("Lieu mis à jour");
                        } catch (err) {
                          setError(
                            err instanceof Error ? err.message : "Erreur"
                          );
                        }
                      }}
                    >
                      Enregistrer le lieu
                    </PrimaryButton>
                  </div>
                </Card>

                <Card>
                  <h2 className="font-semibold text-zinc-900">
                    Nouveau département
                  </h2>
                  <form onSubmit={onCreateDept} className="mt-3 space-y-3">
                    <Field label="Nom">
                      <input
                        required
                        className={inputClass}
                        value={deptName}
                        onChange={(e) => setDeptName(e.target.value)}
                      />
                    </Field>
                    <Field label="Description">
                      <input
                        className={inputClass}
                        value={deptDescription}
                        onChange={(e) => setDeptDescription(e.target.value)}
                      />
                    </Field>
                    <PrimaryButton type="submit" className="w-full">
                      Ajouter au lieu
                    </PrimaryButton>
                  </form>
                </Card>

                <Card>
                  <h2 className="mb-3 font-semibold text-zinc-900">
                    Départements
                  </h2>
                  <div className="space-y-2">
                    {(deptDetails ?? selectedWp.departments ?? []).map((d) => (
                      <button
                        key={d._id}
                        type="button"
                        onClick={() => setSelectedDeptId(d._id)}
                        className={`flex w-full items-center justify-between rounded-xl border px-3 py-2 text-left text-sm transition ${
                          selectedDeptId === d._id
                            ? "border-[#0088E8]/40 bg-[#0088E8]/5"
                            : "border-zinc-200 hover:bg-zinc-50"
                        }`}
                      >
                        <span className="font-medium text-zinc-900">
                          {d.name}
                        </span>
                        <Badge className="bg-zinc-100 text-zinc-600">
                          {"employeeCount" in d
                            ? Number(d.employeeCount) || 0
                            : 0}{" "}
                          emp.
                        </Badge>
                      </button>
                    ))}
                    {!(deptDetails ?? selectedWp.departments ?? []).length ? (
                      <p className="text-sm text-zinc-500">
                        Aucun département sur ce lieu.
                      </p>
                    ) : null}
                  </div>
                </Card>
              </>
            ) : (
              <Card>
                <p className="text-sm text-zinc-500">
                  Sélectionnez un lieu pour y ajouter des départements.
                </p>
              </Card>
            )}
          </div>

          <Card>
            {selectedDeptFull ? (
              <div className="space-y-6">
                <div className="space-y-3">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div>
                      <h2 className="text-lg font-semibold text-zinc-900">
                        {selectedDeptFull.name}
                      </h2>
                      <p className="text-sm text-zinc-500">
                        Lieu : {selectedWp?.name}
                      </p>
                    </div>
                    <SecondaryButton
                      type="button"
                      onClick={async () => {
                        if (!token) return;
                        if (
                          !confirm(
                            `Supprimer le département « ${selectedDeptFull.name} » ?`
                          )
                        ) {
                          return;
                        }
                        try {
                          await removeDept({
                            token,
                            departmentId: selectedDeptFull._id,
                          });
                          setSelectedDeptId("");
                          setMsg("Département supprimé");
                        } catch (err) {
                          setError(
                            err instanceof Error ? err.message : "Erreur"
                          );
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
                      value={editDeptName}
                      onChange={(e) => setEditDeptName(e.target.value)}
                    />
                  </Field>
                  <Field label="Description">
                    <input
                      className={inputClass}
                      value={editDeptDescription}
                      onChange={(e) => setEditDeptDescription(e.target.value)}
                    />
                  </Field>
                  <PrimaryButton
                    type="button"
                    onClick={async () => {
                      if (!token) return;
                      try {
                        await updateDept({
                          token,
                          departmentId: selectedDeptFull._id,
                          name: editDeptName,
                          description: editDeptDescription,
                          workplaceId: selectedWpId
                            ? (selectedWpId as Id<"workplaces">)
                            : undefined,
                        });
                        setMsg("Département mis à jour");
                      } catch (err) {
                        setError(err instanceof Error ? err.message : "Erreur");
                      }
                    }}
                  >
                    Enregistrer le département
                  </PrimaryButton>
                </div>

                <div>
                  <h3 className="mb-2 font-semibold text-zinc-900">
                    Conditions d&apos;évaluation
                  </h3>
                  <p className="mb-3 text-sm text-zinc-500">
                    Le manager note chaque condition de 1 à 5. Le pourcentage =
                    moyenne des notes ÷ 5.
                  </p>

                  <form
                    onSubmit={onAddCondition}
                    className="mb-4 flex flex-wrap gap-2"
                  >
                    <input
                      required
                      className={inputClass + " min-w-[220px] flex-1"}
                      placeholder="Nouvelle condition…"
                      value={conditionLabel}
                      onChange={(e) => setConditionLabel(e.target.value)}
                    />
                    <PrimaryButton type="submit">Ajouter</PrimaryButton>
                  </form>

                  <div className="space-y-2">
                    {selectedDeptFull.conditions.map((c) => (
                      <div
                        key={c._id}
                        className="flex flex-wrap items-center gap-2 rounded-xl border border-zinc-200 px-3 py-2"
                      >
                        <input
                          className={inputClass + " min-w-[180px] flex-1"}
                          value={conditionDrafts[c._id] ?? c.label}
                          onChange={(e) =>
                            setConditionDrafts((prev) => ({
                              ...prev,
                              [c._id]: e.target.value,
                            }))
                          }
                        />
                        <Badge
                          className={
                            c.isActive
                              ? "bg-emerald-50 text-emerald-700"
                              : "bg-zinc-100 text-zinc-500"
                          }
                        >
                          {c.isActive ? "active" : "inactive"}
                        </Badge>
                        <SecondaryButton
                          type="button"
                          onClick={async () => {
                            if (!token) return;
                            await updateCondition({
                              token,
                              conditionId: c._id,
                              label: conditionDrafts[c._id] ?? c.label,
                              isActive: c.isActive,
                            });
                            setMsg("Condition mise à jour");
                          }}
                        >
                          Sauver
                        </SecondaryButton>
                        <SecondaryButton
                          type="button"
                          onClick={async () => {
                            if (!token) return;
                            await updateCondition({
                              token,
                              conditionId: c._id,
                              label: conditionDrafts[c._id] ?? c.label,
                              isActive: !c.isActive,
                            });
                          }}
                        >
                          {c.isActive ? "Désactiver" : "Activer"}
                        </SecondaryButton>
                        <SecondaryButton
                          type="button"
                          onClick={async () => {
                            if (!token) return;
                            if (!confirm("Supprimer cette condition ?")) return;
                            await removeCondition({
                              token,
                              conditionId: c._id,
                            });
                          }}
                        >
                          ×
                        </SecondaryButton>
                      </div>
                    ))}
                    {!selectedDeptFull.conditions.length ? (
                      <p className="text-sm text-zinc-500">
                        Aucune condition. Ajoutez les critères que les managers
                        noteront.
                      </p>
                    ) : null}
                  </div>
                </div>
              </div>
            ) : (
              <p className="text-sm text-zinc-500">
                {selectedWp
                  ? "Sélectionnez un département pour gérer ses conditions."
                  : "Sélectionnez un lieu, puis un département."}
              </p>
            )}
          </Card>
        </div>
      </PageShell>
    </RequireAuth>
  );
}
