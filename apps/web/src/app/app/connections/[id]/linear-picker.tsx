"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { api } from "./api";

type Team = { id: string; key: string; name: string; triageEnabled: boolean };
type Setup = {
  triageEnabled: boolean;
  states: { id: string; name: string; type: string }[];
  projects: { id: string; name: string }[];
};

export function LinearPicker({
  id,
  current,
}: {
  id: string;
  current?: { teamId?: string; stateId?: string; projectId?: string };
}) {
  const router = useRouter();
  const [teams, setTeams] = useState<Team[] | null>(null);
  const [setup, setSetup] = useState<Setup | null>(null);
  const [teamId, setTeamId] = useState(current?.teamId ?? "");
  const [stateId, setStateId] = useState(current?.stateId ?? "");
  const [projectId, setProjectId] = useState(current?.projectId ?? "");
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api<{ teams: Team[] }>(`/api/connections/${id}/targets?kind=teams`).then((r) => {
      if (r.ok) setTeams(r.teams);
      else setError(r.error ?? "Could not load your Linear teams.");
    });
  }, [id]);

  useEffect(() => {
    setSetup(null);
    if (!teamId) return;
    api<Setup>(
      `/api/connections/${id}/targets?kind=setup&teamId=${encodeURIComponent(teamId)}`,
    ).then((r) => {
      if (r.ok) setSetup(r);
      else setError(r.error ?? "Could not load the team's states and projects.");
    });
  }, [id, teamId]);

  async function save() {
    setBusy(true);
    setError(null);
    setSaved(false);
    const r = await api(`/api/connections/${id}/targets`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ teamId, stateId: stateId || null, projectId: projectId || null }),
    });
    setBusy(false);
    if (r.ok) {
      setSaved(true);
      router.refresh();
    } else setError(r.error ?? "Could not save.");
  }

  const automatic = setup?.triageEnabled
    ? "Automatic: the team's Triage inbox"
    : "Automatic: the team's default state";

  return (
    <div className="space-y-4">
      <div className="grid gap-4 sm:grid-cols-3">
        <div>
          <Label htmlFor="team">Team</Label>
          <Select
            id="team"
            value={teamId}
            disabled={!teams}
            onChange={(e) => {
              setTeamId(e.target.value);
              setStateId("");
              setProjectId("");
              setSaved(false);
            }}
          >
            <option value="">{teams ? "Choose a team…" : "Loading teams…"}</option>
            {teams?.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name} ({t.key})
              </option>
            ))}
          </Select>
        </div>
        <div>
          <Label htmlFor="state">New issues start in</Label>
          <Select
            id="state"
            value={stateId}
            disabled={!setup}
            onChange={(e) => {
              setStateId(e.target.value);
              setSaved(false);
            }}
          >
            <option value="">{setup ? automatic : "Choose a team first"}</option>
            {setup?.states.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </Select>
        </div>
        <div>
          <Label htmlFor="project">Project (optional)</Label>
          <Select
            id="project"
            value={projectId}
            disabled={!setup}
            onChange={(e) => {
              setProjectId(e.target.value);
              setSaved(false);
            }}
          >
            <option value="">No project</option>
            {setup?.projects.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </Select>
        </div>
      </div>
      {setup && !setup.triageEnabled && !stateId && (
        <p className="text-sm text-muted-foreground">
          Tip: switch on Triage for this team in Linear so new reports wait in its inbox for review.
        </p>
      )}
      {error && (
        <p className="text-sm text-danger" role="alert">
          {error}
        </p>
      )}
      {saved && (
        <p className="text-sm text-success" role="status">
          Saved. New issues will be created here.
        </p>
      )}
      <Button onClick={save} disabled={busy || !teamId || !setup}>
        {busy ? "Saving…" : "Save target"}
      </Button>
    </div>
  );
}
