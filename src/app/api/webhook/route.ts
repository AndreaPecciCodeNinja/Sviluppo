import { NextRequest, NextResponse } from "next/server";
import {
  metaTimestampToIso,
  verifySignature,
  verifyWebhookChallenge,
} from "@/lib/meta";
import {
  updateMessageStatus,
  upsertInboundMessage,
} from "@/lib/store";
import type { MessageStatus } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams;
  const challenge = verifyWebhookChallenge({
    mode: searchParams.get("hub.mode"),
    token: searchParams.get("hub.verify_token"),
    challenge: searchParams.get("hub.challenge"),
  });

  if (challenge === null) {
    return new NextResponse("Forbidden", { status: 403 });
  }

  return new NextResponse(challenge, {
    status: 200,
    headers: { "Content-Type": "text/plain" },
  });
}

type WebhookContact = {
  profile?: { name?: string };
  wa_id?: string;
};

type WebhookMessage = {
  id: string;
  from: string;
  timestamp: string;
  type?: string;
  text?: { body?: string };
};

type WebhookStatus = {
  id: string;
  status: string;
  timestamp?: string;
};

type WebhookValue = {
  messaging_product?: string;
  metadata?: { phone_number_id?: string };
  contacts?: WebhookContact[];
  messages?: WebhookMessage[];
  statuses?: WebhookStatus[];
};

type WebhookBody = {
  object?: string;
  entry?: Array<{
    id?: string;
    changes?: Array<{
      field?: string;
      value?: WebhookValue;
    }>;
  }>;
};

function mapStatus(status: string): MessageStatus | null {
  switch (status) {
    case "sent":
      return "sent";
    case "delivered":
      return "delivered";
    case "read":
      return "read";
    case "failed":
      return "failed";
    default:
      return null;
  }
}

function extractText(message: WebhookMessage): string {
  if (message.type === "text" && message.text?.body) {
    return message.text.body;
  }
  return `[${message.type || "unsupported"} message]`;
}

export async function POST(request: NextRequest) {
  const rawBody = await request.text();
  const signature = request.headers.get("x-hub-signature-256");

  if (!verifySignature(rawBody, signature)) {
    return new NextResponse("Invalid signature", { status: 401 });
  }

  let body: WebhookBody;
  try {
    body = JSON.parse(rawBody) as WebhookBody;
  } catch {
    return new NextResponse("Bad JSON", { status: 400 });
  }

  // Always ACK quickly; process what we can.
  if (body.object !== "whatsapp_business_account") {
    return NextResponse.json({ ok: true });
  }

  for (const entry of body.entry ?? []) {
    for (const change of entry.changes ?? []) {
      const value = change.value;
      if (!value) continue;

      const nameByWaId = new Map<string, string>();
      for (const contact of value.contacts ?? []) {
        if (contact.wa_id && contact.profile?.name) {
          nameByWaId.set(contact.wa_id, contact.profile.name);
        }
      }

      for (const message of value.messages ?? []) {
        await upsertInboundMessage({
          id: message.id,
          waId: message.from,
          displayName: nameByWaId.get(message.from),
          text: extractText(message),
          timestamp: metaTimestampToIso(message.timestamp),
        });
      }

      for (const status of value.statuses ?? []) {
        const mapped = mapStatus(status.status);
        if (mapped) {
          await updateMessageStatus(status.id, mapped);
        }
      }
    }
  }

  return NextResponse.json({ ok: true });
}
