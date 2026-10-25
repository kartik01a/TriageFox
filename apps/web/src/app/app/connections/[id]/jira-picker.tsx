"use client";

import {
  PRIORITIES,
  PRIORITY_NAMES,
  TICKET_TYPE_LABELS,
  TICKET_TYPES,
  type TicketType,
} from "@triagefox/shared";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { api } from "./api";

type Site = { id: string; name: string; url: string };
type Project = { id: string; key: string; name: string };
type IssueType = {
  id: string;
  name: string;
  subtask: boolean;
  blockingFields: { id: string; name: string }[];
  hasPriority: boolean;
  hasDueDate: boolean;
};
type Setup = {
  issueTypes: IssueType[];
  priorities: { id: string; name: string }[];
  suggestions: {
    issueTypeMap: Partial<Record<TicketType, string>>;
    priorityMap: Record<string, string>;
  };
};
type Current = {
  cloudId?: string;
  projectKey?: string;
  issueTypeMap?: Record<string, string>;
  priorityMap?: Record<string, string>;
};

/** Keep an earlier choice if it still exists in the project, otherwise use the suggestion. */
function keep(
  previous: string | undefined,
  valid: Set<string>,
  suggestion: string | undefined,
): string {
  return previous && valid.has(previous) ? previous : (suggestion ?? "");
}

export function JiraPicker({
  id,
  sites,
  current,
}: {
  id: string;
  sites: Site[];
  current?: Current;
}) {
  const router = useRouter();
  const [cloudId, setCloudId] = useState(current?.cloudId ?? sites[0]?.id ?? "");
  const [projects, setProjects] = useState<Project[] | null>(null);
  const [projectKey, setProjectKey] = useState(current?.projectKey ?? "");
  const [setup, setSetup] = useState<Setup | null>(null);
  const [typeMap, setTypeMap] = useState<Record<string, string>>(current?.issueTypeMap ?? {});
  const [prioMap, setPrioMap] = useState<Record<string, string>>(current?.priorityMap ?? {});
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!cloudId) return;
    setProjects(null);
    api<{ projects: Project[] }>(
      `/api/connections/${id}/targets?kind=projects&cloudId=${encodeURIComponent(cloudId)}`,
    ).then((r) => {
      if (r.ok) setProjects(r.projects);
      else setError(r.error ?? "Could not load your projects.");
    });
  }, [id, cloudId]);

  useEffect(() => {
    if (!projectKey) return setSetup(null);
    setSetup(null);
    api<Setup>(
      `/api/connections/${id}/targets?kind=setup&cloudId=${encodeURIComponent(cloudId)}&projectKey=${encodeURIComponent(projectKey)}`,
    ).then((r) => {
      if (!r.ok) return setError(r.error ?? "Could not read the project setup.");
      setError(null);
      setSetup(r);
      // Keep earlier choices when they still exist; otherwise use our suggestions.
      const typeIds = new Set(r.issueTypes.map((t) => t.id));
      const prioIds = new Set(r.priorities.map((p) => p.id));
      setTypeMap((prev) =>
        Object.fromEntries(
          TICKET_TYPES.map((t) => [t, keep(prev[t], typeIds, r.suggestions.issueTypeMap[t])]),
        ),
      );
      setPrioMap((prev) =>
        Object.fromEntries(
          PRIORITIES.map((p) => [
            String(p),
            keep(prev[String(p)], prioIds, r.suggestions.priorityMap[String(p)]),
          ]),
        ),
      );
    });
  }, [id, cloudId, projectKey]);

  const usable = setup?.issueTypes.filter((t) => !t.subtask && t.blockingFields.length === 0) ?? [];
  const blocked = setup?.issueTypes.filter((t) => !t.subtask && t.blockingFields.length > 0) ?? [];
  const complete =
    setup && TICKET_TYPES.every((t) => typeMap[t]) && PRIORITIES.every((p) => prioMap[String(p)]);

  async function save() {
    setBusy(true);
    setError(null);
    setSaved(false);
    const r = await api(`/api/connections/${id}/targets`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ cloudId, projectKey, issueTypeMap: typeMap, priorityMap: prioMap }),
    });
    setBusy(false);
    if (r.ok) {
      setSaved(true);
      router.refresh();
    } else setError(r.error ?? "Could not save.");
  }

  return (
    <div className="space-y-6">
      <div className="grid gap-4 sm:grid-cols-2">
        {sites.length > 1 && (
          <div>
            <Label htmlFor="site">Jira site</Label>
            <Select
              id="site"
              value={cloudId}
              onChange={(e) => {
                setCloudId(e.target.value);
                setProjectKey("");
                setSaved(false);
              }}
            >
              {sites.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </Select>
          </div>
        )}
        <div>
          <Label htmlFor="project">Project for new issues</Label>
          <Select
            id="project"
            value={projectKey}
            disabled={!projects}
            onChange={(e) => {
              setProjectKey(e.target.value);
              setSaved(false);
            }}
          >
            <option value="">{projects ? "Choose a project…" : "Loading projects…"}</option>
            {projects?.map((p) => (
              <option key={p.id} value={p.key}>
                {p.name} ({p.key})
              </option>
            ))}
          </Select>
        </div>
      </div>

      {projectKey && !setup && !error && (
        <p className="text-sm text-muted-foreground">Reading the project's setup…</p>
      )}

      {setup && (
        <>
          {usable.length === 0 ? (
            <p className="rounded-lg bg-danger/10 px-4 py-3 text-sm text-danger" role="alert">
              None of this project's issue types can be used: each has required fields TriageFox
              can't fill. Make those fields optional in Jira, or choose another project.
            </p>
          ) : (
            blocked.length > 0 && (
              <div className="rounded-lg bg-muted px-4 py-3 text-sm">
                <p className="font-medium">Not available in this project:</p>
                <ul className="mt-1 list-disc pl-5 text-muted-foreground">
                  {blocked.map((t) => (
                    <li key={t.id}>
                      {t.name}: requires {t.blockingFields.map((f) => f.name).join(", ")}
                    </li>
                  ))}
                </ul>
              </div>
            )
          )}

          <fieldset className="space-y-3" disabled={usable.length === 0}>
            <legend className="text-sm font-semibold">Issue type for each kind of ticket</legend>
            <div className="grid gap-3 sm:grid-cols-2">
              {TICKET_TYPES.map((t) => (
                <div key={t}>
                  <Label htmlFor={`type-${t}`}>{TICKET_TYPE_LABELS[t]}</Label>
                  <Select
                    id={`type-${t}`}
                    value={typeMap[t] ?? ""}
                    onChange={(e) => {
                      setTypeMap({ ...typeMap, [t]: e.target.value });
                      setSaved(false);
                    }}
                  >
                    <option value="">Choose…</option>
                    {usable.map((u) => (
                      <option key={u.id} value={u.id}>
                        {u.name}
                      </option>
                    ))}
                  </Select>
                </div>
              ))}
            </div>
          </fieldset>

          <fieldset className="space-y-3" disabled={usable.length === 0}>
            <legend className="text-sm font-semibold">
              Jira priority for each TriageFox priority
            </legend>
            <div className="grid gap-3 sm:grid-cols-3">
              {[...PRIORITIES].reverse().map((p) => (
                <div key={p}>
                  <Label htmlFor={`prio-${p}`}>
                    P{p} · {PRIORITY_NAMES[p]}
                  </Label>
                  <Select
                    id={`prio-${p}`}
                    value={prioMap[String(p)] ?? ""}
                    onChange={(e) => {
                      setPrioMap({ ...prioMap, [String(p)]: e.target.value });
                      setSaved(false);
                    }}
                  >
                    <option value="">Choose…</option>
                    {setup.priorities.map((jp) => (
                      <option key={jp.id} value={jp.id}>
                        {jp.name}
                      </option>
                    ))}
                  </Select>
                </div>
              ))}
            </div>
            {!usable.some((t) => t.hasPriority) && (
              <p className="text-xs text-muted-foreground">
                This project's create screen has no Priority field, so TriageFox sets the priority
                right after creating each issue.
              </p>
            )}
          </fieldset>
        </>
      )}

      {error && (
        <p className="text-sm text-danger" role="alert">
          {error}
        </p>
      )}
      {saved && (
        <p className="text-sm text-success" role="status">
          Saved. New issues will be created in this project.
        </p>
      )}
      <Button onClick={save} disabled={busy || !complete || usable.length === 0}>
        {busy ? "Saving…" : "Save target"}
      </Button>
    </div>
  );
}
