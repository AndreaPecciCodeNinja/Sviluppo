import { NextRequest, NextResponse } from "next/server";
import { getClaudeConfig, suggestReplyFromText } from "@/lib/reply-agent";
import { listReplyTemplates } from "@/lib/reply-templates";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const { model, apiKey } = getClaudeConfig();
  return NextResponse.json({
    configured: Boolean(apiKey),
    model,
    templates: listReplyTemplates().map((t) => ({
      id: t.id,
      label: t.label,
      slots: t.slots.map((s) => s.name),
    })),
  });
}

export async function POST(request: NextRequest) {
  let payload: { text?: string };
  try {
    payload = (await request.json()) as { text?: string };
  } catch {
    return NextResponse.json(
      { error: { message: "Invalid JSON body" } },
      { status: 400 },
    );
  }

  const text = payload.text?.trim();
  if (!text) {
    return NextResponse.json(
      {
        error: {
          message:
            "`text` is required — select an inbound message or type/paste content in the box",
        },
      },
      { status: 400 },
    );
  }

  if (!getClaudeConfig().apiKey) {
    return NextResponse.json(
      {
        error: {
          message:
            "Missing ANTHROPIC_API_KEY — set it in .env.local for Claude reply suggestions",
          code: "missing_anthropic_api_key",
        },
      },
      { status: 503 },
    );
  }

  try {
    const suggestion = await suggestReplyFromText(text);
    return NextResponse.json({ suggestion });
  } catch (err) {
    const message =
      err instanceof Error ? err.message : "Suggest reply failed";
    return NextResponse.json({ error: { message } }, { status: 502 });
  }
}
