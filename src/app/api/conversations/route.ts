import { NextRequest, NextResponse } from "next/server";
import { BirdApiError, listConversations } from "@/lib/bird";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  try {
    const inboxStatus = request.nextUrl.searchParams.get("inbox_status");
    const startingAfter =
      request.nextUrl.searchParams.get("starting_after") || undefined;
    const limitParam = request.nextUrl.searchParams.get("limit");
    const limit = limitParam ? Number(limitParam) : 50;

    const result = await listConversations({
      limit: Number.isFinite(limit) ? limit : 50,
      startingAfter,
      inboxStatus:
        inboxStatus === "open" || inboxStatus === "resolved"
          ? inboxStatus
          : undefined,
    });

    return NextResponse.json(result);
  } catch (err) {
    if (err instanceof BirdApiError) {
      return NextResponse.json({ error: err.toJson() }, { status: err.status });
    }
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: { message } }, { status: 500 });
  }
}
