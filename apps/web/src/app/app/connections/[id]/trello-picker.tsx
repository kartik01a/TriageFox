"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { api } from "./api";

type Item = { id: string; name: string };

export function TrelloPicker({
  id,
  current,
}: {
  id: string;
  current?: { boardId: string; listId: string };
}) {
  const router = useRouter();
  const [boards, setBoards] = useState<Item[] | null>(null);
  const [lists, setLists] = useState<Item[]>([]);
  const [boardId, setBoardId] = useState(current?.boardId ?? "");
  const [listId, setListId] = useState(current?.listId ?? "");
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api<{ boards: Item[] }>(`/api/connections/${id}/targets?kind=boards`).then((r) => {
      if (r.ok) setBoards(r.boards);
      else setError(r.error ?? "Could not load your boards.");
    });
  }, [id]);

  useEffect(() => {
    if (!boardId) return setLists([]);
    api<{ lists: Item[] }>(
      `/api/connections/${id}/targets?kind=lists&boardId=${encodeURIComponent(boardId)}`,
    ).then((r) => {
      if (r.ok) setLists(r.lists);
      else setError(r.error ?? "Could not load the lists.");
    });
  }, [id, boardId]);

  async function save() {
    setBusy(true);
    setError(null);
    setSaved(false);
    const r = await api(`/api/connections/${id}/targets`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ boardId, listId }),
    });
    setBusy(false);
    if (r.ok) {
      setSaved(true);
      router.refresh();
    } else setError(r.error ?? "Could not save.");
  }

  return (
    <div className="space-y-4">
      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <Label htmlFor="board">Board</Label>
          <Select
            id="board"
            value={boardId}
            disabled={!boards}
            onChange={(e) => {
              setBoardId(e.target.value);
              setListId("");
              setSaved(false);
            }}
          >
            <option value="">{boards ? "Choose a board…" : "Loading boards…"}</option>
            {boards?.map((b) => (
              <option key={b.id} value={b.id}>
                {b.name}
              </option>
            ))}
          </Select>
        </div>
        <div>
          <Label htmlFor="list">List for new cards</Label>
          <Select
            id="list"
            value={listId}
            disabled={!boardId || lists.length === 0}
            onChange={(e) => {
              setListId(e.target.value);
              setSaved(false);
            }}
          >
            <option value="">{boardId ? "Choose a list…" : "Choose a board first"}</option>
            {lists.map((l) => (
              <option key={l.id} value={l.id}>
                {l.name}
              </option>
            ))}
          </Select>
        </div>
      </div>
      {error && (
        <p className="text-sm text-danger" role="alert">
          {error}
        </p>
      )}
      {saved && (
        <p className="text-sm text-success" role="status">
          Saved. New cards will be created here.
        </p>
      )}
      <Button onClick={save} disabled={busy || !boardId || !listId}>
        {busy ? "Saving…" : "Save target"}
      </Button>
    </div>
  );
}
