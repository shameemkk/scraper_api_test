import { NextResponse } from "next/server";
import { getLogs } from "@/lib/state";

export const dynamic = "force-dynamic";

export async function GET() {
  return NextResponse.json({ logs: getLogs(100) });
}
