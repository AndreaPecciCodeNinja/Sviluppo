import { NextRequest, NextResponse } from "next/server";
import { listSpecialistCatalog, routeInboundMessage } from "@/lib/agents";
import { getReplyAgentStatus } from "@/lib/reply-agent";
import { listReplyTemplates } from "@/lib/reply-templates";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const status = getReplyAgentStatus();
  return NextResponse.json({
    ...status,
    templates: listReplyTemplates().map((t) => ({
      id: t.id,
      label: t.label,
      slots: t.slots.map((s) => s.name),
    })),
    specialists: listSpecialistCatalog(),
  });
}

export async function POST(request: NextRequest) {
  let payload: {
    text?: string;
    contactKey?: string;
    conversationId?: string;
    contactDisplayName?: string;
    priorTexts?: unknown;
  };
  try {
    payload = (await request.json()) as typeof payload;
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

  const status = getReplyAgentStatus();
  if (!status.configured) {
    return NextResponse.json(
      {
        error: {
          message:
            status.provider === "claude"
              ? "Missing ANTHROPIC_API_KEY — set it in .env.local, or set REPLY_PROVIDER=ollama"
              : "Reply provider is not configured",
          code:
            status.provider === "claude"
              ? "missing_anthropic_api_key"
              : "reply_provider_not_configured",
          provider: status.provider,
        },
      },
      { status: 503 },
    );
  }

  const priorTexts = Array.isArray(payload.priorTexts)
    ? payload.priorTexts
        .filter((item): item is string => typeof item === "string")
        .slice(-40)
    : [];

  try {
    const suggestion = await routeInboundMessage(text, {
      contactKey: payload.contactKey,
      conversationId: payload.conversationId,
      contactDisplayName: payload.contactDisplayName,
      priorTexts,
    });
    return NextResponse.json({ suggestion });
  } catch (err) {
    const message =
      err instanceof Error ? err.message : "Suggest reply failed";
    const unreachable =
      /ollama unreachable|cannot reach anthropic|econnrefused|non risponde in tempo/i.test(
        message,
      );
    return NextResponse.json(
      {
        error: {
          message,
          code: unreachable ? "provider_unreachable" : "suggest_reply_failed",
          provider: status.provider,
        },
      },
      { status: unreachable ? 503 : 502 },
    );
  }
}
