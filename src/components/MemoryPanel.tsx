"use client";

import { FormEvent, useCallback, useEffect, useState } from "react";

export type MemoryFactView = {
  id: number;
  contactKey: string;
  conversationId: string | null;
  fact: string;
  source: string | null;
  createdAt: string;
  updatedAt: string;
};

type Props = {
  contactKey: string | null;
  conversationId: string | null;
  draftText: string;
};

export function MemoryPanel({
  contactKey,
  conversationId,
  draftText,
}: Props) {
  const [facts, setFacts] = useState<MemoryFactView[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [editText, setEditText] = useState("");
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    if (!contactKey) {
      setFacts([]);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(
        `/api/memory?contactKey=${encodeURIComponent(contactKey)}`,
      );
      const data = (await res.json()) as {
        facts?: MemoryFactView[];
        error?: { message?: string };
      };
      if (!res.ok) {
        setError(data.error?.message || `Memory HTTP ${res.status}`);
        return;
      }
      setFacts(data.facts || []);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Memory load failed");
    } finally {
      setLoading(false);
    }
  }, [contactKey]);

  useEffect(() => {
    void load();
  }, [load]);

  if (!contactKey) {
    return null;
  }

  async function saveFactFromDraft() {
    const fact = draftText.trim();
    if (!fact || saving) return;
    setSaving(true);
    setError(null);
    try {
      const res = await fetch("/api/memory", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          kind: "fact",
          contactKey,
          conversationId,
          fact,
          source: "composer",
        }),
      });
      const data = (await res.json()) as { error?: { message?: string } };
      if (!res.ok) {
        setError(data.error?.message || `Save failed (${res.status})`);
        return;
      }
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Save failed");
    } finally {
      setSaving(false);
    }
  }

  async function saveEdit(event: FormEvent) {
    event.preventDefault();
    if (editingId == null || !editText.trim()) return;
    setSaving(true);
    setError(null);
    try {
      const res = await fetch(`/api/memory/${editingId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ fact: editText }),
      });
      const data = (await res.json()) as { error?: { message?: string } };
      if (!res.ok) {
        setError(data.error?.message || `Update failed (${res.status})`);
        return;
      }
      setEditingId(null);
      setEditText("");
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Update failed");
    } finally {
      setSaving(false);
    }
  }

  async function removeFact(id: number) {
    setSaving(true);
    setError(null);
    try {
      const res = await fetch(`/api/memory/${id}`, { method: "DELETE" });
      if (!res.ok) {
        const data = (await res.json()) as { error?: { message?: string } };
        setError(data.error?.message || `Delete failed (${res.status})`);
        return;
      }
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Delete failed");
    } finally {
      setSaving(false);
    }
  }

  return (
    <aside className="memory-panel" aria-label="Memoria contatto">
      <header className="memory-panel-header">
        <h3>Memoria (SQLite)</h3>
        <p className="muted mono memory-key">{contactKey}</p>
      </header>

      <div className="memory-actions">
        <button
          type="button"
          className="memory-btn"
          disabled={saving || !draftText.trim()}
          onClick={() => void saveFactFromDraft()}
        >
          {saving ? "Salvo…" : "Salva fatto dal box"}
        </button>
        <button
          type="button"
          className="linkish memory-refresh"
          onClick={() => void load()}
          disabled={loading}
        >
          Aggiorna
        </button>
      </div>

      {error ? (
        <p className="memory-error" role="alert">
          {error}
        </p>
      ) : null}

      {loading && facts.length === 0 ? (
        <p className="muted">Carico memoria…</p>
      ) : facts.length === 0 ? (
        <p className="muted">
          Nessun fatto salvato. Seleziona testo nel box e usa «Salva fatto».
        </p>
      ) : (
        <ul className="memory-list">
          {facts.map((f) => (
            <li key={f.id} className="memory-item">
              {editingId === f.id ? (
                <form onSubmit={saveEdit} className="memory-edit-form">
                  <textarea
                    rows={2}
                    value={editText}
                    onChange={(e) => setEditText(e.target.value)}
                    disabled={saving}
                  />
                  <div className="memory-item-actions">
                    <button type="submit" disabled={saving || !editText.trim()}>
                      Salva
                    </button>
                    <button
                      type="button"
                      className="linkish"
                      onClick={() => {
                        setEditingId(null);
                        setEditText("");
                      }}
                    >
                      Annulla
                    </button>
                  </div>
                </form>
              ) : (
                <>
                  <p className="memory-fact-text">{f.fact}</p>
                  <div className="memory-item-actions">
                    <button
                      type="button"
                      className="linkish"
                      onClick={() => {
                        setEditingId(f.id);
                        setEditText(f.fact);
                      }}
                    >
                      Modifica
                    </button>
                    <button
                      type="button"
                      className="linkish"
                      onClick={() => void removeFact(f.id)}
                      disabled={saving}
                    >
                      Elimina
                    </button>
                  </div>
                </>
              )}
            </li>
          ))}
        </ul>
      )}
    </aside>
  );
}
