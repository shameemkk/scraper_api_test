import { NextResponse } from "next/server";
import { getState } from "@/lib/state";

export const dynamic = "force-dynamic";

export async function GET() {
  const state = getState();
  return NextResponse.json({
    ...state.progress,
    isRunning: state.isRunning,
  });
}
