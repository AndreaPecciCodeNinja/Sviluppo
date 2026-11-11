import { NextResponse } from "next/server";
import { checkOllamaHealth } from "@/lib/ollama-health";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Lightweight Ollama probe for the inbox badge (GET /api/tags upstream).
 * Standalone module — does not import reply-agent / memory / LangChain.
 */
export async function GET() {
  const health = await checkOllamaHealth();
  // 200 even when down so the UI can always render the badge + debug line.
  return NextResponse.json(health);
}
