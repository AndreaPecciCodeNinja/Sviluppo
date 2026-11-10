import crypto from "crypto";
import type { MetaTextSendResponse } from "./types";

export function getMetaConfig() {
  return {
    accessToken: process.env.WHATSAPP_ACCESS_TOKEN ?? "",
    phoneNumberId: process.env.WHATSAPP_PHONE_NUMBER_ID ?? "",
    businessAccountId: process.env.WHATSAPP_BUSINESS_ACCOUNT_ID ?? "",
    verifyToken: process.env.WHATSAPP_WEBHOOK_VERIFY_TOKEN ?? "",
    appSecret: process.env.WHATSAPP_APP_SECRET ?? "",
    apiVersion: process.env.META_GRAPH_API_VERSION || "v21.0",
  };
}

export function verifyWebhookChallenge(params: {
  mode: string | null;
  token: string | null;
  challenge: string | null;
}): string | null {
  const { verifyToken } = getMetaConfig();
  if (
    params.mode === "subscribe" &&
    params.token &&
    params.token === verifyToken &&
    params.challenge
  ) {
    return params.challenge;
  }
  return null;
}

/**
 * Validate Meta X-Hub-Signature-256 against the raw request body.
 * If WHATSAPP_APP_SECRET is unset, validation is skipped (local scaffold only).
 */
export function verifySignature(
  rawBody: string,
  signatureHeader: string | null,
): boolean {
  const { appSecret } = getMetaConfig();
  if (!appSecret) {
    console.warn(
      "[webhook] WHATSAPP_APP_SECRET not set — skipping signature check (dev only)",
    );
    return true;
  }
  if (!signatureHeader?.startsWith("sha256=")) {
    return false;
  }
  const provided = signatureHeader.slice("sha256=".length);
  const expected = crypto
    .createHmac("sha256", appSecret)
    .update(rawBody, "utf8")
    .digest("hex");

  try {
    const a = Buffer.from(provided, "hex");
    const b = Buffer.from(expected, "hex");
    if (a.length !== b.length) return false;
    return crypto.timingSafeEqual(a, b);
  } catch {
    return false;
  }
}

export async function sendTextMessage(
  to: string,
  text: string,
): Promise<MetaTextSendResponse> {
  const { accessToken, phoneNumberId, apiVersion } = getMetaConfig();

  if (!accessToken || !phoneNumberId) {
    return {
      error: {
        message:
          "Missing WHATSAPP_ACCESS_TOKEN or WHATSAPP_PHONE_NUMBER_ID in environment",
        code: 0,
      },
    };
  }

  const url = `https://graph.facebook.com/${apiVersion}/${phoneNumberId}/messages`;
  const response = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      messaging_product: "whatsapp",
      recipient_type: "individual",
      to,
      type: "text",
      text: { preview_url: false, body: text },
    }),
  });

  const data = (await response.json()) as MetaTextSendResponse;
  if (!response.ok && !data.error) {
    return {
      error: {
        message: `Graph API HTTP ${response.status}`,
        code: response.status,
      },
    };
  }
  return data;
}

/** Normalize Meta unix timestamp (seconds) to ISO string. */
export function metaTimestampToIso(ts: string | number | undefined): string {
  if (ts === undefined || ts === null || ts === "") {
    return new Date().toISOString();
  }
  const n = typeof ts === "string" ? Number(ts) : ts;
  if (!Number.isFinite(n)) return new Date().toISOString();
  return new Date(n * 1000).toISOString();
}
