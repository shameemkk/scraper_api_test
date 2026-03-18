import { NextResponse } from "next/server";
import { getState } from "@/lib/state";

export const dynamic = "force-dynamic";

export async function POST() {
  const state = getState();

  if (!state.isRunning) {
    return NextResponse.json({ error: "No scraper running" }, { status: 400 });
  }

  if (state.abortController) {
    state.abortController.abort();
  }
  state.isRunning = false;
  state.progress.running = false;

  return NextResponse.json({ message: "Scraper stopped" });
}
