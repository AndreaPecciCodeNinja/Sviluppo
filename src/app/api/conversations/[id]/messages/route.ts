import { NextRequest, NextResponse } from "next/server";
import { BirdApiError, listConversationMessages } from "@/lib/bird";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ id: string }> };

export async function GET(request: NextRequest, context: RouteContext) {
  try {
    const { id } = await context.params;
    const startingAfter =
      request.nextUrl.searchParams.get("starting_after") || undefined;
    const limitParam = request.nextUrl.searchParams.get("limit");
    const limit = limitParam ? Number(limitParam) : 50;

    const result = await listConversationMessages(id, {
      limit: Number.isFinite(limit) ? limit : 50,
      startingAfter,
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
