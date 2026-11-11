import { NextResponse } from "next/server";
import { checkOllamaHealth } from "@/lib/reply-agent";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Lightweight Ollama probe for the inbox badge (GET /api/tags upstream). */
export async function GET() {
  const health = await checkOllamaHealth();
  return NextResponse.json(health, {
    status: health.active && !health.ok ? 503 : 200,
  });
}
