import { NextRequest, NextResponse } from "next/server";
import { verifyBirdWebhookSignature } from "@/lib/bird";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Optional Bird WhatsApp webhook receiver.
 * Local scaffold defaults to HTTP polling; wire this URL in Bird dashboard
 * (Webhooks) for near-realtime updates when you have a public HTTPS endpoint.
 *
 * Subscribed events of interest: whatsapp.received, whatsapp.sent,
 * whatsapp.delivered, whatsapp.read, whatsapp.failed, whatsapp.rejected.
 */
export async function POST(request: NextRequest) {
  const rawBody = await request.text();
  const ok = verifyBirdWebhookSignature({
    rawBody,
    webhookId: request.headers.get("webhook-id"),
    webhookTimestamp: request.headers.get("webhook-timestamp"),
    webhookSignature: request.headers.get("webhook-signature"),
  });

  if (!ok) {
    return NextResponse.json(
      { error: { message: "Invalid webhook signature" } },
      { status: 401 },
    );
  }

  let event: { type?: string; data?: unknown; timestamp?: string } = {};
  try {
    event = JSON.parse(rawBody) as typeof event;
  } catch {
    return NextResponse.json(
      { error: { message: "Invalid JSON body" } },
      { status: 400 },
    );
  }

  // Scaffold: acknowledge only. The UI polls Bird conversation APIs.
  console.info("[bird-webhook]", event.type, event.timestamp);
  return NextResponse.json({ received: true, type: event.type ?? null });
}
