import { NextRequest, NextResponse } from "next/server";
import { deleteFact, updateFact } from "@/lib/memory";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ id: string }> };

export async function PATCH(request: NextRequest, context: RouteContext) {
  const { id: idRaw } = await context.params;
  const id = Number(idRaw);
  if (!Number.isFinite(id)) {
    return NextResponse.json(
      { error: { message: "Invalid fact id" } },
      { status: 400 },
    );
  }

  let payload: { fact?: string };
  try {
    payload = (await request.json()) as { fact?: string };
  } catch {
    return NextResponse.json(
      { error: { message: "Invalid JSON body" } },
      { status: 400 },
    );
  }

  try {
    const fact = updateFact(id, payload.fact || "");
    if (!fact) {
      return NextResponse.json(
        { error: { message: "Fact not found" } },
        { status: 404 },
      );
    }
    return NextResponse.json({ fact });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Update failed";
    return NextResponse.json({ error: { message } }, { status: 400 });
  }
}

export async function DELETE(_request: NextRequest, context: RouteContext) {
  const { id: idRaw } = await context.params;
  const id = Number(idRaw);
  if (!Number.isFinite(id)) {
    return NextResponse.json(
      { error: { message: "Invalid fact id" } },
      { status: 400 },
    );
  }

  const ok = deleteFact(id);
  if (!ok) {
    return NextResponse.json(
      { error: { message: "Fact not found" } },
      { status: 404 },
    );
  }
  return NextResponse.json({ deleted: true });
}
