import { NextResponse } from "next/server";
import { checkOllamaHealth } from "@/lib/reply-agent";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Lightweight Ollama probe for the inbox badge (GET /api/tags upstream). Always runs. */
export async function GET() {
  const health = await checkOllamaHealth();
  // 200 even when down so the UI can always render the badge + debug line.
  return NextResponse.json(health);
}
