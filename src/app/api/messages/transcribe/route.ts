import { NextRequest, NextResponse } from "next/server";
import { BirdApiError } from "@/lib/bird";
import { transcribeWhatsAppAudio } from "@/lib/transcribe";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type TranscribeBody = {
  messageId?: string;
  mediaId?: string;
  voiceNote?: boolean;
  mimeType?: string | null;
};

export async function POST(request: NextRequest) {
  let payload: TranscribeBody;
  try {
    payload = (await request.json()) as TranscribeBody;
  } catch {
    return NextResponse.json(
      { error: { message: "Invalid JSON body" } },
      { status: 400 },
    );
  }

  const messageId = payload.messageId?.trim();
  const mediaId = payload.mediaId?.trim();
  if (!messageId || !mediaId) {
    return NextResponse.json(
      {
        error: {
          message: "`messageId` and `mediaId` are required (Bird wam_… / waf_…)",
        },
      },
      { status: 400 },
    );
  }

  if (!process.env.OPENAI_API_KEY?.trim()) {
    return NextResponse.json(
      {
        error: {
          message:
            "Missing OPENAI_API_KEY — set it in .env.local for Whisper transcription",
          code: "missing_openai_api_key",
        },
      },
      { status: 503 },
    );
  }

  try {
    const result = await transcribeWhatsAppAudio({
      messageId,
      mediaId,
      voiceNote: payload.voiceNote,
      mimeTypeHint: payload.mimeType,
    });
    return NextResponse.json({ transcription: result });
  } catch (err) {
    if (err instanceof BirdApiError) {
      return NextResponse.json(
        { error: err.toJson() },
        { status: err.status >= 400 && err.status < 600 ? err.status : 502 },
      );
    }
    const message =
      err instanceof Error ? err.message : "Transcription failed";
    return NextResponse.json({ error: { message } }, { status: 502 });
  }
}
