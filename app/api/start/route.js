import { NextResponse } from "next/server";
import { getState } from "@/lib/state";
import { runScraper } from "@/lib/scraper";

export const dynamic = "force-dynamic";

export async function POST(request) {
  const state = getState();

  if (state.isRunning) {
    return NextResponse.json({ error: "Scraper is already running" }, { status: 400 });
  }

  const body = await request.json();
  const concurrency = body.concurrency || 200;
  const retryErrors = body.retryErrors || false;
  const apiUrl =
    body.apiUrl || "https://ocowgo8kkow0s4okc4g8kgcg.up.uparrowagency.com/extract-emails";

  // Fire and forget — don't await, let it run in the background
  runScraper(concurrency, apiUrl, { retryErrors }).catch((err) => {
    console.error("Scraper error:", err);
  });

  return NextResponse.json({ message: retryErrors ? "Retrying errors" : "Scraper started", concurrency, apiUrl });
}
