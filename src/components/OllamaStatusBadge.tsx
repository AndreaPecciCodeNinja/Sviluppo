"use client";

export type OllamaHealthView = {
  provider: string;
  active: boolean;
  reachable: boolean;
  model: string;
  baseUrl: string;
  modelPresent: boolean;
  ok: boolean;
  message: string;
};

type Props = {
  health: OllamaHealthView | null;
  checking?: boolean;
};

/**
 * Always visible in the thread toolbar: green when Ollama is up (+ model),
 * amber warning when unreachable or model missing — even if REPLY_PROVIDER=claude.
 */
export function OllamaStatusBadge({ health, checking }: Props) {
  if (checking && !health) {
    return (
      <div className="provider-badge-wrap">
        <p className="provider-badge checking" role="status">
          Controllo Ollama…
        </p>
      </div>
    );
  }

  if (!health) {
    return (
      <div className="provider-badge-wrap">
        <p className="provider-badge checking" role="status">
          Controllo Ollama…
        </p>
        <p className="provider-debug muted">
          provider=? · reachable=?
        </p>
      </div>
    );
  }

  const debug = `provider=${health.provider} · reachable=${health.reachable ? "yes" : "no"} · model=${health.modelPresent ? "ok" : "missing"} · reply=${health.active ? "ollama" : "claude"}`;

  if (health.ok) {
    return (
      <div className="provider-badge-wrap">
        <p className="provider-badge ok" role="status" title={health.baseUrl}>
          <span className="provider-dot" aria-hidden />
          Ollama disponibile
          <span className="provider-badge-meta"> · {health.model}</span>
        </p>
        <p className="provider-debug muted" title={health.baseUrl}>
          {debug}
        </p>
      </div>
    );
  }

  return (
    <div className="provider-badge-wrap">
      <p className="provider-badge warn" role="alert" title={health.baseUrl}>
        <span className="provider-dot" aria-hidden />
        {health.message}
      </p>
      <p className="provider-debug muted" title={health.baseUrl}>
        {debug}
      </p>
      {!health.active ? (
        <p className="provider-setup muted">
          Reply agent attuale: Claude. Per suggerire con Ollama metti{" "}
          <code>REPLY_PROVIDER=ollama</code> in <code>.env.local</code> e
          riavvia <code>npm run dev</code>.
        </p>
      ) : !health.reachable ? (
        <p className="provider-setup muted">
          Su Mac: apri l&apos;app Ollama, poi verifica{" "}
          <code>curl http://127.0.0.1:11434/api/tags</code>.
        </p>
      ) : null}
    </div>
  );
}
