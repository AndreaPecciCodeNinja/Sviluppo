import type { DraftContext } from "./types";

/** Best-effort SQLite snippet + prompt block. Does not throw. */
export async function rememberInbound(ctx: DraftContext): Promise<string> {
  const contactKey = ctx.contactKey?.trim() || "";
  if (!contactKey) return "";
  const { buildMemoryPromptBlock, appendMessage } = await import(
    "@/lib/memory/store"
  );
  const block = buildMemoryPromptBlock(contactKey);
  try {
    appendMessage({
      contactKey,
      conversationId: ctx.conversationId,
      role: "human",
      content: ctx.text,
    });
  } catch {
    /* memory write-back is best-effort */
  }
  return block;
}
