"use client";

import type { SessionSnapshot } from "@/lib/types";

type QrLoginProps = {
  session: SessionSnapshot | null;
  onLogout: () => void;
  loggingOut: boolean;
};

export function QrLogin({ session, onLogout, loggingOut }: QrLoginProps) {
  const status = session?.status ?? "starting";
  const showQr = Boolean(session?.qrDataUrl) && status !== "ready";

  return (
    <div className="qr-screen">
      <div className="qr-card">
        <p className="qr-eyebrow">Sviluppo · WhatsApp Web session</p>
        <h1>Link your phone</h1>
        <p className="qr-copy">
          Scan this QR with WhatsApp → Linked Devices. This uses an unofficial
          multi-device client (Baileys), not Meta Business Cloud API.
        </p>

        <div className="qr-frame" aria-live="polite">
          {showQr ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={session!.qrDataUrl!}
              alt="WhatsApp linking QR code"
              width={280}
              height={280}
            />
          ) : (
            <div className="qr-placeholder">
              <p>
                {status === "starting" || status === "connecting"
                  ? "Starting session…"
                  : status === "disconnected"
                    ? "Reconnecting…"
                    : "Waiting for QR…"}
              </p>
            </div>
          )}
        </div>

        <ol className="qr-steps">
          <li>Open WhatsApp on your phone</li>
          <li>Settings → Linked Devices → Link a Device</li>
          <li>Point the camera at the QR above</li>
        </ol>

        <p className="status-line">
          Status: <strong>{status}</strong>
          {session?.lastError ? ` — ${session.lastError}` : ""}
        </p>

        <p className="caveat">
          Unofficial client · WhatsApp ToS risk · keep this bound to localhost ·
          phone must remain a primary device
        </p>

        {(status === "ready" || status === "logged_out" || status === "qr") && (
          <button
            type="button"
            className="ghost-btn"
            onClick={onLogout}
            disabled={loggingOut}
          >
            {loggingOut ? "Resetting…" : "Reset / logout session"}
          </button>
        )}
      </div>
    </div>
  );
}
