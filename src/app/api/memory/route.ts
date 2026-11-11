import { NextRequest, NextResponse } from "next/server";
import {
  createFact,
  getMemoryDbPath,
  listFacts,
  listRecentMessages,
} from "@/lib/memory";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** GET ?contactKey=… — facts + recent snippets for a contact. */
export async function GET(request: NextRequest) {
  const contactKey = request.nextUrl.searchParams.get("contactKey")?.trim();
  if (!contactKey) {
    return NextResponse.json(
      { error: { message: "`contactKey` query param is required" } },
      { status: 400 },
    );
  }

  try {
    return NextResponse.json({
      contactKey,
      dbPath: getMemoryDbPath(),
      facts: listFacts(contactKey),
      messages: listRecentMessages(contactKey),
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Memory read failed";
    return NextResponse.json({ error: { message } }, { status: 500 });
  }
}

/** POST — create a fact (`Salva fatto`) or append a snippet. */
export async function POST(request: NextRequest) {
  let payload: {
    contactKey?: string;
    conversationId?: string;
    fact?: string;
    source?: string;
    role?: "human" | "ai" | "system";
    content?: string;
    messageId?: string;
    kind?: "fact" | "message";
  };
  try {
    payload = (await request.json()) as typeof payload;
  } catch {
    return NextResponse.json(
      { error: { message: "Invalid JSON body" } },
      { status: 400 },
    );
  }

  const contactKey = payload.contactKey?.trim();
  if (!contactKey) {
    return NextResponse.json(
      { error: { message: "`contactKey` is required" } },
      { status: 400 },
    );
  }

  try {
    const kind =
      payload.kind ||
      (payload.fact ? "fact" : payload.content ? "message" : "fact");

    if (kind === "message") {
      const { appendMessage } = await import("@/lib/memory");
      const content = payload.content?.trim();
      if (!content) {
        return NextResponse.json(
          { error: { message: "`content` is required for message snippets" } },
          { status: 400 },
        );
      }
      const message = appendMessage({
        contactKey,
        conversationId: payload.conversationId,
        role: payload.role || "human",
        content,
        messageId: payload.messageId,
      });
      return NextResponse.json({ message }, { status: 201 });
    }

    const factText = payload.fact?.trim();
    if (!factText) {
      return NextResponse.json(
        { error: { message: "`fact` is required" } },
        { status: 400 },
      );
    }
    const fact = createFact({
      contactKey,
      conversationId: payload.conversationId,
      fact: factText,
      source: payload.source || "ui",
    });
    return NextResponse.json({ fact }, { status: 201 });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Memory write failed";
    return NextResponse.json({ error: { message } }, { status: 500 });
  }
}
