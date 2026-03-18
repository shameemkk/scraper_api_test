import pLimit from "p-limit";
import { readCSV, saveCSV, parseEmails, compareEmails } from "./csv.js";
import { getState, addLog, resetState } from "./state.js";

const BATCH_SAVE_INTERVAL = 50;

async function scrapeUrl(url, apiUrl, signal) {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 150000);

    // Link external abort signal
    if (signal) {
      signal.addEventListener("abort", () => controller.abort());
    }

    const res = await fetch(apiUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ url }),
      signal: controller.signal,
    });
    clearTimeout(timeout);

    if (!res.ok) {
      return { success: false, error: `HTTP ${res.status}: ${res.statusText}`, emails: [] };
    }

    const data = await res.json();
    if (!data.success) {
      return { success: false, error: data.error || data.message || "API returned failure", emails: data.emails || [] };
    }
    return data;
  } catch (err) {
    return { success: false, error: err.message, emails: [] };
  }
}

export async function runScraper(concurrency = 200, apiUrl, { retryErrors = false } = {}) {
  const state = getState();

  if (state.isRunning) {
    throw new Error("Scraper is already running");
  }

  const rows = readCSV();
  if (!rows) {
    throw new Error("CSV file not found");
  }

  // Set up state
  state.isRunning = true;
  state.abortController = new AbortController();
  const { signal } = state.abortController;

  resetState();
  const progress = state.progress;
  progress.total = rows.length;

  // If retryErrors, reset error rows so they get re-processed
  if (retryErrors) {
    let errorCount = 0;
    rows.forEach((r) => {
      if (r.status === "error") {
        r.status = "";
        r.new_emails = "";
        r.comparison = "";
        r.pages_crawled = "";
        r.note = "";
        errorCount++;
      }
    });
    addLog(`Retrying ${errorCount} error rows`);
  }

  // Check for resume — skip already-scraped rows
  const alreadyScraped = new Set();
  rows.forEach((r) => {
    if (r.status === "scraped" || r.status === "error") {
      alreadyScraped.add(r.id);
    }
  });
  progress.completed = alreadyScraped.size;

  addLog(`Loaded ${rows.length} rows`);
  addLog(`API: ${apiUrl}`);
  addLog(`Concurrency: ${concurrency}`);
  if (alreadyScraped.size > 0) {
    addLog(`Skipping: ${alreadyScraped.size} already processed`);
  }

  const limit = pLimit(concurrency);
  let completedSinceLastSave = 0;

  const tasks = rows.map((row) =>
    limit(async () => {
      if (signal.aborted) return;
      if (alreadyScraped.has(row.id)) return;

      const oldEmails = parseEmails(row.emails);
      const result = await scrapeUrl(row.url, apiUrl, signal);

      if (signal.aborted) return;

      const newEmails = (result.emails || []).map((e) => e.trim().toLowerCase());
      const comparison = compareEmails(oldEmails, newEmails);

      row.status = result.success ? "scraped" : "error";
      row.new_emails = JSON.stringify(newEmails);
      row.comparison = comparison;
      row.pages_crawled = result.pages_crawled || 0;
      row.note = result.success ? "" : result.error || "unknown error";

      progress.completed++;
      if (result.success) progress.success++;
      else progress.failed++;
      progress.stats[comparison] = (progress.stats[comparison] || 0) + 1;

      progress.recentResults.unshift({
        id: row.id,
        url: row.url,
        oldCount: oldEmails.length,
        newCount: newEmails.length,
        comparison,
        status: row.status,
      });
      if (progress.recentResults.length > 20) progress.recentResults.pop();

      completedSinceLastSave++;

      const pct = ((progress.completed / progress.total) * 100).toFixed(1);
      const elapsed = ((Date.now() - progress.startTime) / 1000).toFixed(0);
      const rate = (progress.completed / (elapsed || 1)).toFixed(1);
      addLog(
        `[${pct}%] ${progress.completed}/${progress.total} | ${rate}/s | ${row.status} | ${comparison} | ${row.url}`
      );

      if (completedSinceLastSave >= BATCH_SAVE_INTERVAL) {
        completedSinceLastSave = 0;
        saveCSV(rows);
      }
    })
  );

  try {
    await Promise.all(tasks);
  } catch (err) {
    addLog(`[ERROR] ${err.message}`);
  }

  progress.running = false;
  progress.endTime = Date.now();
  state.isRunning = false;
  state.abortController = null;
  saveCSV(rows);

  const elapsed = ((progress.endTime - progress.startTime) / 1000).toFixed(1);
  addLog(`\nSCRAPING COMPLETE`);
  addLog(`Total: ${progress.total} | Success: ${progress.success} | Failed: ${progress.failed} | Time: ${elapsed}s`);
}
