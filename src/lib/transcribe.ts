import { downloadWhatsAppMedia } from "./bird";

export type TranscribeResult = {
  text: string;
  language: string;
  model: string;
  voiceNote: boolean;
  mimeType: string;
};

/**
 * Download Bird WhatsApp audio and transcribe with OpenAI Whisper.
 * Prefers Italian (`language: it`). Requires OPENAI_API_KEY.
 */
export async function transcribeWhatsAppAudio(params: {
  messageId: string;
  mediaId: string;
  voiceNote?: boolean;
  mimeTypeHint?: string | null;
}): Promise<TranscribeResult> {
  const apiKey = process.env.OPENAI_API_KEY?.trim();
  if (!apiKey) {
    throw new Error(
      "Missing OPENAI_API_KEY — copy .env.example to .env.local and set an OpenAI key for Whisper transcription",
    );
  }

  const model = process.env.OPENAI_TRANSCRIBE_MODEL?.trim() || "whisper-1";
  const language = process.env.OPENAI_TRANSCRIBE_LANGUAGE?.trim() || "it";

  const media = await downloadWhatsAppMedia(params.messageId, params.mediaId);
  const mimeType = params.mimeTypeHint || media.contentType;

  const form = new FormData();
  const blob = new Blob([new Uint8Array(media.bytes)], {
    type: mimeType || "application/octet-stream",
  });
  form.append("file", blob, media.filename);
  form.append("model", model);
  form.append("language", language);
  form.append(
    "prompt",
    "Trascrizione di un messaggio vocale WhatsApp in italiano.",
  );

  const response = await fetch(
    "https://api.openai.com/v1/audio/transcriptions",
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
      },
      body: form,
      cache: "no-store",
    },
  );

  const rawText = await response.text();
  let body: unknown = rawText;
  try {
    body = JSON.parse(rawText) as unknown;
  } catch {
    /* keep text */
  }

  if (!response.ok) {
    const message =
      typeof body === "object" &&
      body &&
      "error" in body &&
      typeof (body as { error?: { message?: string } }).error?.message ===
        "string"
        ? (body as { error: { message: string } }).error.message
        : `OpenAI transcription HTTP ${response.status}`;
    throw new Error(message);
  }

  const text =
    typeof body === "object" &&
    body &&
    "text" in body &&
    typeof (body as { text: unknown }).text === "string"
      ? (body as { text: string }).text.trim()
      : "";

  if (!text) {
    throw new Error("Transcription returned empty text");
  }

  return {
    text,
    language,
    model,
    voiceNote: Boolean(params.voiceNote),
    mimeType,
  };
}
