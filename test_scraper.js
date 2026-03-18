const fs = require("fs");
const path = require("path");
const { parse } = require("csv-parse/sync");
const { stringify } = require("csv-stringify/sync");
const pLimit = require("p-limit");

const API_URL =
  process.env.API_URL ||
  "https://ocowgo8kkow0s4okc4g8kgcg.up.uparrowagency.com/extract-emails";
const CONCURRENCY = parseInt(process.env.CONCURRENCY || "200", 10);
const CSV_PATH = path.join(__dirname, "email_scraper_api_rows (1).csv");
const OUTPUT_PATH = path.join(__dirname, "email_scraper_api_rows (1).csv");
const PROGRESS_PATH = path.join(__dirname, "progress.json");
const BATCH_SAVE_INTERVAL = 50; // save progress every N completions

// ── helpers ──────────────────────────────────────────────────────────────────

function parseEmails(raw) {
  if (!raw || raw === "[]") return [];
  try {
    const parsed = JSON.parse(raw.replace(/""/g, '"'));
    return Array.isArray(parsed)
      ? parsed.map((e) => e.trim().toLowerCase())
      : [];
  } catch {
    // try cleaning common CSV escaping issues
    try {
      const cleaned = raw
        .replace(/^\[""/, '["')
        .replace(/""]/g, '"]')
        .replace(/"",""/, '","');
      const parsed = JSON.parse(cleaned);
      return Array.isArray(parsed)
        ? parsed.map((e) => e.trim().toLowerCase())
        : [];
    } catch {
      return [];
    }
  }
}

function compareEmails(oldEmails, newEmails) {
  const oldSet = new Set(oldEmails);
  const newSet = new Set(newEmails);

  if (newEmails.length === 0 && oldEmails.length === 0) return "both_empty";
  if (newEmails.length === 0) return "no_new_emails";
  if (oldEmails.length === 0) return "no_old_emails";

  const sameEmails = oldEmails.filter((e) => newSet.has(e));
  const onlyNew = newEmails.filter((e) => !oldSet.has(e));
  const onlyOld = oldEmails.filter((e) => !newSet.has(e));

  if (onlyNew.length === 0 && onlyOld.length === 0) return "exact_match";
  if (onlyNew.length > 0 && onlyOld.length === 0) return "new_has_more";
  if (onlyNew.length === 0 && onlyOld.length > 0) return "old_has_more";
  return "different";
}

async function scrapeUrl(url, retries = 1) {
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 150000); // 150s

      const res = await fetch(API_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url }),
        signal: controller.signal,
      });
      clearTimeout(timeout);

      const data = await res.json();
      return data;
    } catch (err) {
      if (attempt === retries) {
        return { success: false, error: err.message, emails: [] };
      }
      await new Promise((r) => setTimeout(r, 2000));
    }
  }
}

// ── progress tracking (shared with web dashboard) ───────────────────────────

function loadProgress() {
  try {
    if (fs.existsSync(PROGRESS_PATH)) {
      return JSON.parse(fs.readFileSync(PROGRESS_PATH, "utf-8"));
    }
  } catch {}
  return {
    total: 0,
    completed: 0,
    success: 0,
    failed: 0,
    running: true,
    startTime: null,
    stats: {
      exact_match: 0,
      new_has_more: 0,
      old_has_more: 0,
      different: 0,
      no_new_emails: 0,
      no_old_emails: 0,
      both_empty: 0,
    },
    recentResults: [],
  };
}

function saveProgress(progress) {
  fs.writeFileSync(PROGRESS_PATH, JSON.stringify(progress, null, 2));
}

// ── main ─────────────────────────────────────────────────────────────────────

async function main() {
  console.log(`Reading CSV from: ${CSV_PATH}`);
  const raw = fs.readFileSync(CSV_PATH, "utf-8");
  const rows = parse(raw, { columns: true, skip_empty_lines: true });

  console.log(`Loaded ${rows.length} rows`);
  console.log(`API: ${API_URL}`);
  console.log(`Concurrency: ${CONCURRENCY}`);

  // Check if we have a previous partial run to resume
  const existingProgress = loadProgress();
  const alreadyScraped = new Set();
  if (
    existingProgress.completed > 0 &&
    rows.some((r) => r.status === "scraped" || r.status === "error")
  ) {
    rows.forEach((r) => {
      if (r.status === "scraped" || r.status === "error") {
        alreadyScraped.add(r.id);
      }
    });
    console.log(`Resuming: ${alreadyScraped.size} already processed`);
  }

  const progress = {
    total: rows.length,
    completed: alreadyScraped.size,
    success: 0,
    failed: 0,
    running: true,
    startTime: Date.now(),
    stats: {
      exact_match: 0,
      new_has_more: 0,
      old_has_more: 0,
      different: 0,
      no_new_emails: 0,
      no_old_emails: 0,
      both_empty: 0,
    },
    recentResults: [],
  };
  saveProgress(progress);

  const limit = pLimit(CONCURRENCY);
  let completedSinceLastSave = 0;

  const tasks = rows.map((row, idx) =>
    limit(async () => {
      if (alreadyScraped.has(row.id)) return;

      const oldEmails = parseEmails(row.emails);
      const result = await scrapeUrl(row.url);

      const newEmails = (result.emails || []).map((e) =>
        e.trim().toLowerCase()
      );
      const comparison = compareEmails(oldEmails, newEmails);

      // Update row in-place
      row.status = result.success ? "scraped" : "error";
      row.new_emails = JSON.stringify(newEmails);
      row.comparison = comparison;
      row.pages_crawled = result.pages_crawled || 0;
      row.note = result.success ? "" : result.error || "unknown error";

      // Update progress
      progress.completed++;
      if (result.success) progress.success++;
      else progress.failed++;
      progress.stats[comparison] = (progress.stats[comparison] || 0) + 1;

      // Keep last 20 results for dashboard
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

      // Log progress
      const pct = ((progress.completed / progress.total) * 100).toFixed(1);
      const elapsed = ((Date.now() - progress.startTime) / 1000).toFixed(0);
      const rate = (progress.completed / (elapsed || 1)).toFixed(1);
      console.log(
        `[${pct}%] ${progress.completed}/${progress.total} | ` +
          `${rate}/s | ${row.status} | ${comparison} | ${row.url}`
      );

      // Periodic save
      if (completedSinceLastSave >= BATCH_SAVE_INTERVAL) {
        completedSinceLastSave = 0;
        saveProgress(progress);
        saveCSV(rows);
      }
    })
  );

  await Promise.all(tasks);

  // Final save
  progress.running = false;
  progress.endTime = Date.now();
  saveProgress(progress);
  saveCSV(rows);

  // Print summary
  const elapsed = ((progress.endTime - progress.startTime) / 1000).toFixed(1);
  console.log("\n══════════════════════════════════════════");
  console.log("  SCRAPING COMPLETE");
  console.log("══════════════════════════════════════════");
  console.log(`  Total:       ${progress.total}`);
  console.log(`  Success:     ${progress.success}`);
  console.log(`  Failed:      ${progress.failed}`);
  console.log(`  Time:        ${elapsed}s`);
  console.log(`  Rate:        ${(progress.total / elapsed).toFixed(1)}/s`);
  console.log("──────────────────────────────────────────");
  console.log("  Comparison Stats:");
  Object.entries(progress.stats).forEach(([k, v]) => {
    if (v > 0) console.log(`    ${k}: ${v}`);
  });
  console.log("══════════════════════════════════════════");
}

function saveCSV(rows) {
  const output = stringify(rows, {
    header: true,
    columns: [
      "id",
      "url",
      "emails",
      "status",
      "new_emails",
      "comparison",
      "pages_crawled",
      "note",
    ],
  });
  fs.writeFileSync(OUTPUT_PATH, output);
}

main().catch(console.error);
