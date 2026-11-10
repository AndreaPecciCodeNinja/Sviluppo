import { NextRequest, NextResponse } from "next/server";
import { sendTextMessage } from "@/lib/meta";
import { appendOutboundMessage } from "@/lib/store";
import type { SendMessageRequest } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  let payload: SendMessageRequest;
  try {
    payload = (await request.json()) as SendMessageRequest;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const to = payload.to?.trim();
  const text = payload.text?.trim();

  if (!to || !text) {
    return NextResponse.json(
      { error: "`to` and `text` are required" },
      { status: 400 },
    );
  }

  // Strip leading + if present; Graph API accepts digits-only wa_id.
  const waId = to.replace(/^\+/, "");

  const result = await sendTextMessage(waId, text);
  const now = new Date().toISOString();

  if (result.error) {
    const failed = await appendOutboundMessage({
      id: `local-fail-${Date.now()}`,
      waId,
      text,
      timestamp: now,
      status: "failed",
      error: result.error.error_data?.details || result.error.message,
    });
    return NextResponse.json(
      { error: result.error, message: failed },
      { status: 502 },
    );
  }

  const wamid = result.messages?.[0]?.id || `local-${Date.now()}`;
  const message = await appendOutboundMessage({
    id: wamid,
    waId: result.contacts?.[0]?.wa_id || waId,
    text,
    timestamp: now,
    status: "sent",
  });

  return NextResponse.json({ message });
}
