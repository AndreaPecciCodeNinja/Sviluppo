"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import type {
  SentimentConversation,
  SentimentLabel,
  SentimentReport,
} from "@/lib/sentiment";
import {
  LABEL_META,
  LABEL_ORDER,
  sortConversations,
} from "@/lib/sentiment";

type Props = {
  report: SentimentReport;
};

function DonutChart({
  distribution,
  active,
  onSelect,
}: {
  distribution: SentimentReport["distribution"];
  active: SentimentLabel | "all";
  onSelect: (label: SentimentLabel | "all") => void;
}) {
  const total = distribution.reduce((sum, d) => sum + d.count, 0) || 1;
  const radius = 72;
  const stroke = 22;
  const circumference = 2 * Math.PI * radius;
  let offset = 0;

  const segments = distribution.map((bucket) => {
    const length = (bucket.count / total) * circumference;
    const seg = {
      ...bucket,
      dash: `${length} ${circumference - length}`,
      offset: -offset,
      color: LABEL_META[bucket.label].color,
    };
    offset += length;
    return seg;
  });

  return (
    <div className="sent-donut-wrap">
      <svg
        className="sent-donut"
        viewBox="0 0 200 200"
        role="img"
        aria-label="Distribuzione sentiment a ciambella"
      >
        <circle
          cx="100"
          cy="100"
          r={radius}
          fill="none"
          stroke="rgba(255,255,255,0.06)"
          strokeWidth={stroke}
        />
        {segments.map((seg) => (
          <circle
            key={seg.label}
            className={`sent-donut-seg${active === seg.label ? " is-active" : ""}`}
            cx="100"
            cy="100"
            r={radius}
            fill="none"
            stroke={seg.color}
            strokeWidth={stroke}
            strokeDasharray={seg.dash}
            strokeDashoffset={seg.offset}
            strokeLinecap="butt"
            transform="rotate(-90 100 100)"
            onClick={() =>
              onSelect(active === seg.label ? "all" : seg.label)
            }
            style={{ cursor: "pointer" }}
          >
            <title>
              {LABEL_META[seg.label].it}: {seg.count} ({seg.pct}%)
            </title>
          </circle>
        ))}
        <text
          x="100"
          y="94"
          textAnchor="middle"
          className="sent-donut-total"
        >
          {total}
        </text>
        <text
          x="100"
          y="114"
          textAnchor="middle"
          className="sent-donut-sub"
        >
          chat analizzate
        </text>
      </svg>
      <ul className="sent-legend">
        {distribution.map((bucket) => (
          <li key={bucket.label}>
            <button
              type="button"
              className={`sent-legend-btn${active === bucket.label ? " is-active" : ""}`}
              onClick={() =>
                onSelect(active === bucket.label ? "all" : bucket.label)
              }
            >
              <span
                className="sent-swatch"
                style={{ background: LABEL_META[bucket.label].color }}
              />
              <span className="sent-legend-label">
                {LABEL_META[bucket.label].it}
              </span>
              <span className="sent-legend-count mono">
                {bucket.count}
                <span className="muted"> · {bucket.pct}%</span>
              </span>
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}

function BarChart({
  distribution,
  active,
  onSelect,
}: {
  distribution: SentimentReport["distribution"];
  active: SentimentLabel | "all";
  onSelect: (label: SentimentLabel | "all") => void;
}) {
  const max = Math.max(...distribution.map((d) => d.count), 1);
  const ordered = LABEL_ORDER.map(
    (label) => distribution.find((d) => d.label === label)!,
  ).filter(Boolean);

  return (
    <div className="sent-bars" role="img" aria-label="Distribuzione sentiment a barre">
      {ordered.map((bucket) => {
        const height = Math.max(8, (bucket.count / max) * 100);
        return (
          <button
            key={bucket.label}
            type="button"
            className={`sent-bar-col${active === bucket.label ? " is-active" : ""}`}
            onClick={() =>
              onSelect(active === bucket.label ? "all" : bucket.label)
            }
            title={`${LABEL_META[bucket.label].it}: ${bucket.count}`}
          >
            <div className="sent-bar-track">
              <div
                className="sent-bar-fill"
                style={{
                  height: `${height}%`,
                  background: LABEL_META[bucket.label].color,
                }}
              />
            </div>
            <span className="sent-bar-value mono">{bucket.count}</span>
            <span className="sent-bar-name">
              {LABEL_META[bucket.label].it.split(" ")[0]}
            </span>
          </button>
        );
      })}
    </div>
  );
}

function UrgencyCallouts({
  items,
  onFocus,
}: {
  items: SentimentConversation[];
  onFocus: (id: string) => void;
}) {
  if (items.length === 0) return null;
  return (
    <section className="sent-urgency" aria-label="Chat urgenti o negative">
      <div className="sent-section-head">
        <h2>Urgenze e criticità</h2>
        <p className="muted">
          Priorità dal report: da chiudere o monitorare.
        </p>
      </div>
      <div className="sent-urgency-grid">
        {items.map((c, index) => (
          <button
            key={c.id}
            type="button"
            className={`sent-urgency-card label-${c.label}`}
            onClick={() => onFocus(c.id)}
            style={{ animationDelay: `${index * 60}ms` }}
          >
            <div className="sent-urgency-top">
              <span className="sent-rank mono">#{c.urgencyRank ?? index + 1}</span>
              <span className={`sent-pill label-${c.label}`}>
                {LABEL_META[c.label].it}
              </span>
            </div>
            <strong>{c.contact}</strong>
            <span className="muted mono">{c.phone}</span>
            <p>{c.rationale}</p>
          </button>
        ))}
      </div>
    </section>
  );
}

export function SentimentView({ report }: Props) {
  const [query, setQuery] = useState("");
  const [labelFilter, setLabelFilter] = useState<SentimentLabel | "all">("all");
  const [themeFilter, setThemeFilter] = useState("all");
  const [focusId, setFocusId] = useState<string | null>(null);

  const allThemes = useMemo(() => {
    const set = new Set<string>();
    for (const c of report.conversations) {
      for (const t of c.themes) set.add(t);
    }
    return [...set].sort((a, b) => a.localeCompare(b, "it"));
  }, [report.conversations]);

  const urgent = useMemo(
    () =>
      sortConversations(
        report.conversations.filter(
          (c) => c.urgent || c.label === "negative",
        ),
      ),
    [report.conversations],
  );

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    const list = report.conversations.filter((c) => {
      if (labelFilter !== "all" && c.label !== labelFilter) return false;
      if (themeFilter !== "all" && !c.themes.includes(themeFilter)) return false;
      if (!q) return true;
      const hay = `${c.contact} ${c.phone} ${c.rationale} ${c.themes.join(" ")} ${LABEL_META[c.label].it}`.toLowerCase();
      return hay.includes(q);
    });
    return sortConversations(list);
  }, [report.conversations, query, labelFilter, themeFilter]);

  const onFocus = (id: string) => {
    setFocusId(id);
    const el = document.getElementById(`sent-row-${id}`);
    el?.scrollIntoView({ behavior: "smooth", block: "center" });
  };

  return (
    <div className="sent-page">
      <header className="sent-hero">
        <div className="sent-hero-copy">
          <p className="qr-eyebrow">Messaggistica WhatsApp · offline</p>
          <h1>Sentiment inbox</h1>
          <p className="sent-lede">{report.meta.headline}</p>
          <p className="muted">
            {report.meta.phoneName} {report.meta.phone} · analisi{" "}
            {report.meta.analyzedAt} · {report.meta.deepAnalyzedApprox} chat
            approfondite / {report.meta.conversationsListed} elencate · nessun
            Bird API key
          </p>
          <nav className="sent-nav">
            <Link href="/">← Inbox live</Link>
            <span className="muted">Fonte: data/sentiment.json</span>
          </nav>
        </div>
        <div className="sent-hero-stats">
          {report.distribution.map((bucket) => (
            <div
              key={bucket.label}
              className="sent-stat"
              style={{ borderColor: LABEL_META[bucket.label].color }}
            >
              <span
                className="sent-stat-n mono"
                style={{ color: LABEL_META[bucket.label].color }}
              >
                {bucket.count}
              </span>
              <span className="sent-stat-l">{LABEL_META[bucket.label].it}</span>
            </div>
          ))}
        </div>
      </header>

      <section className="sent-charts" aria-label="Grafici distribuzione">
        <div className="sent-panel">
          <div className="sent-section-head">
            <h2>Distribuzione</h2>
            <p className="muted">
              Clicca un segmento o una barra per filtrare la lista.
            </p>
          </div>
          <DonutChart
            distribution={report.distribution}
            active={labelFilter}
            onSelect={setLabelFilter}
          />
        </div>
        <div className="sent-panel">
          <div className="sent-section-head">
            <h2>Confronto etichette</h2>
            <p className="muted">Su ~{report.meta.deepAnalyzedApprox} chat con segnale.</p>
          </div>
          <BarChart
            distribution={report.distribution}
            active={labelFilter}
            onSelect={setLabelFilter}
          />
          <ul className="sent-themes-recurring">
            {report.themesRecurring.map((theme) => (
              <li key={theme}>{theme}</li>
            ))}
          </ul>
        </div>
      </section>

      <UrgencyCallouts items={urgent} onFocus={onFocus} />

      <section className="sent-list-section" aria-label="Elenco conversazioni">
        <div className="sent-section-head sent-list-head">
          <div>
            <h2>Conversazioni</h2>
            <p className="muted">
              Urgenti in cima · {filtered.length} risultati
            </p>
          </div>
          <div className="sent-filters">
            <label className="sent-field">
              <span className="sr-only">Cerca</span>
              <input
                type="search"
                placeholder="Cerca contatto, tema, razionale…"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
              />
            </label>
            <label className="sent-field">
              <span className="sr-only">Etichetta</span>
              <select
                value={labelFilter}
                onChange={(e) =>
                  setLabelFilter(e.target.value as SentimentLabel | "all")
                }
              >
                <option value="all">Tutte le etichette</option>
                {LABEL_ORDER.map((label) => (
                  <option key={label} value={label}>
                    {LABEL_META[label].it}
                  </option>
                ))}
              </select>
            </label>
            <label className="sent-field">
              <span className="sr-only">Tema</span>
              <select
                value={themeFilter}
                onChange={(e) => setThemeFilter(e.target.value)}
              >
                <option value="all">Tutti i temi</option>
                {allThemes.map((theme) => (
                  <option key={theme} value={theme}>
                    {theme}
                  </option>
                ))}
              </select>
            </label>
            {(query || labelFilter !== "all" || themeFilter !== "all") && (
              <button
                type="button"
                className="ghost-btn sent-reset"
                onClick={() => {
                  setQuery("");
                  setLabelFilter("all");
                  setThemeFilter("all");
                }}
              >
                Reset
              </button>
            )}
          </div>
        </div>

        <div className="sent-table-wrap">
          <table className="sent-table">
            <thead>
              <tr>
                <th>Contatto</th>
                <th>Etichetta</th>
                <th>Razionale</th>
                <th>Temi</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((c) => (
                <tr
                  key={c.id}
                  id={`sent-row-${c.id}`}
                  className={`label-${c.label}${c.urgent ? " is-urgent" : ""}${focusId === c.id ? " is-focus" : ""}`}
                >
                  <td>
                    <div className="sent-contact">
                      {c.urgent ? (
                        <span className="sent-urgent-dot" title="Urgente" />
                      ) : null}
                      <div>
                        <strong>{c.contact}</strong>
                        <div className="muted mono">{c.phone}</div>
                      </div>
                    </div>
                  </td>
                  <td>
                    <span className={`sent-pill label-${c.label}`}>
                      {LABEL_META[c.label].it}
                    </span>
                  </td>
                  <td className="sent-rationale">{c.rationale}</td>
                  <td>
                    <div className="sent-theme-chips">
                      {c.themes.map((theme) => (
                        <button
                          key={theme}
                          type="button"
                          className="sent-chip"
                          onClick={() => setThemeFilter(theme)}
                        >
                          {theme}
                        </button>
                      ))}
                    </div>
                  </td>
                </tr>
              ))}
              {filtered.length === 0 ? (
                <tr>
                  <td colSpan={4} className="center muted">
                    Nessuna conversazione corrisponde ai filtri.
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </section>

      <footer className="sent-footer muted">
        <p>
          Dati statici derivati da {report.meta.source}. Limiti: retention 30
          giorni Bird, niente trascrizione audio, classificazione qualitativa.
        </p>
        <ul>
          {report.meta.notes.map((note) => (
            <li key={note}>{note}</li>
          ))}
        </ul>
      </footer>
    </div>
  );
}
