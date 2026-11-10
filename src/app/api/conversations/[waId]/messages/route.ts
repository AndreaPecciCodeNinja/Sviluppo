import { NextRequest, NextResponse } from "next/server";
import { listMessages, markConversationRead } from "@/lib/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type RouteContext = {
  params: Promise<{ waId: string }>;
};

export async function GET(_request: NextRequest, context: RouteContext) {
  const { waId: raw } = await context.params;
  const waId = decodeURIComponent(raw);

  if (!waId) {
    return NextResponse.json({ error: "Missing waId" }, { status: 400 });
  }

  const messages = await listMessages(waId);
  await markConversationRead(waId);
  return NextResponse.json({ messages });
}
