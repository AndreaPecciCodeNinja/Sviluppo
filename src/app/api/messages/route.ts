import { NextRequest, NextResponse } from "next/server";
import {
  BirdApiError,
  getConversation,
  sendTextMessage,
} from "@/lib/bird";
import type { SendMessageRequest } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  let payload: SendMessageRequest;
  try {
    payload = (await request.json()) as SendMessageRequest;
  } catch {
    return NextResponse.json(
      { error: { message: "Invalid JSON body" } },
      { status: 400 },
    );
  }

  const text = payload.text?.trim();
  if (!text) {
    return NextResponse.json(
      { error: { message: "`text` is required" } },
      { status: 400 },
    );
  }

  try {
    let to = payload.to?.trim();
    const conversationId = payload.conversationId?.trim();

    if (conversationId && !to) {
      const conversation = await getConversation(conversationId);
      to = conversation.contactAddress;
    }

    if (!to) {
      return NextResponse.json(
        {
          error: {
            message:
              "Provide `conversationId` (inbox reply) or `to` (E.164 / BSUID)",
          },
        },
        { status: 400 },
      );
    }

    const message = await sendTextMessage({ to, text });
    if (conversationId) {
      message.conversationId = conversationId;
    }

    return NextResponse.json({ message }, { status: 202 });
  } catch (err) {
    if (err instanceof BirdApiError) {
      return NextResponse.json(
        { error: { message: err.message, body: err.body } },
        { status: err.status >= 400 && err.status < 600 ? err.status : 502 },
      );
    }
    const message = err instanceof Error ? err.message : "Send failed";
    return NextResponse.json({ error: { message } }, { status: 500 });
  }
}
