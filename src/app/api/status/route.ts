import { NextResponse } from "next/server";
import { getConfigStatus } from "@/lib/bird";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  return NextResponse.json(getConfigStatus());
}
