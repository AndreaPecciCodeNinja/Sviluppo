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
 * Visible when REPLY_PROVIDER=ollama: green when up+model present, warning otherwise.
 */
export function OllamaStatusBadge({ health, checking }: Props) {
  if (!health?.active) {
    return null;
  }

  if (checking && !health) {
    return (
      <p className="provider-badge checking" role="status">
        Controllo Ollama…
      </p>
    );
  }

  if (health.ok) {
    return (
      <p className="provider-badge ok" role="status" title={health.baseUrl}>
        <span className="provider-dot" aria-hidden />
        Ollama disponibile
        <span className="provider-badge-meta"> · {health.model}</span>
      </p>
    );
  }

  return (
    <p className="provider-badge warn" role="alert" title={health.baseUrl}>
      <span className="provider-dot" aria-hidden />
      {health.message}
    </p>
  );
}
