import { NextResponse } from "next/server";
import { listConversations } from "@/lib/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const conversations = await listConversations();
  return NextResponse.json({ conversations });
}
