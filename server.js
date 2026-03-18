const express = require("express");
const fs = require("fs");
const path = require("path");
const { spawn } = require("child_process");
const { parse } = require("csv-parse/sync");

const app = express();
const PORT = process.env.PORT || 3099;

const CSV_PATH = path.join(__dirname, "email_scraper_api_rows (1).csv");
const PROGRESS_PATH = path.join(__dirname, "progress.json");

let scraperProcess = null;

app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));

// ── API Routes ──────────────────────────────────────────────────────────────

// Get live progress
app.get("/api/progress", (req, res) => {
  try {
    if (fs.existsSync(PROGRESS_PATH)) {
      const data = JSON.parse(fs.readFileSync(PROGRESS_PATH, "utf-8"));
      data.isRunning = scraperProcess !== null && !scraperProcess.killed;
      res.json(data);
    } else {
      res.json({
        total: 0,
        completed: 0,
        running: false,
        isRunning: false,
        stats: {},
        recentResults: [],
      });
    }
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Start scraper in background
app.post("/api/start", (req, res) => {
  if (scraperProcess && !scraperProcess.killed) {
    return res.status(400).json({ error: "Scraper is already running" });
  }

  const concurrency = req.body.concurrency || 200;
  const apiUrl =
    req.body.apiUrl ||
    "https://ocowgo8kkow0s4okc4g8kgcg.up.uparrowagency.com/extract-emails";

  scraperProcess = spawn(
    "node",
    [path.join(__dirname, "test_scraper.js")],
    {
      env: {
        ...process.env,
        CONCURRENCY: String(concurrency),
        API_URL: apiUrl,
      },
      stdio: ["ignore", "pipe", "pipe"],
    }
  );

  let logBuffer = [];

  scraperProcess.stdout.on("data", (data) => {
    const lines = data.toString().split("\n").filter(Boolean);
    logBuffer.push(...lines);
    if (logBuffer.length > 200) logBuffer = logBuffer.slice(-200);
  });

  scraperProcess.stderr.on("data", (data) => {
    logBuffer.push(`[ERROR] ${data.toString()}`);
  });

  scraperProcess.on("close", (code) => {
    logBuffer.push(`\nProcess exited with code ${code}`);
    scraperProcess = null;
  });

  // Attach log buffer to process for the /api/logs endpoint
  scraperProcess._logBuffer = logBuffer;

  res.json({ message: "Scraper started", concurrency, apiUrl });
});

// Stop scraper
app.post("/api/stop", (req, res) => {
  if (!scraperProcess || scraperProcess.killed) {
    return res.status(400).json({ error: "No scraper running" });
  }
  scraperProcess.kill("SIGTERM");
  scraperProcess = null;
  res.json({ message: "Scraper stopped" });
});

// Get recent logs
app.get("/api/logs", (req, res) => {
  if (scraperProcess && scraperProcess._logBuffer) {
    res.json({ logs: scraperProcess._logBuffer.slice(-100) });
  } else {
    res.json({ logs: [] });
  }
});

// Full analysis from CSV
app.get("/api/analysis", (req, res) => {
  try {
    if (!fs.existsSync(CSV_PATH)) {
      return res.status(404).json({ error: "CSV not found" });
    }
    const raw = fs.readFileSync(CSV_PATH, "utf-8");
    const rows = parse(raw, { columns: true, skip_empty_lines: true });

    const total = rows.length;
    let scraped = 0;
    let errors = 0;
    let pending = 0;
    const comparisonCounts = {};
    let totalOldEmails = 0;
    let totalNewEmails = 0;
    let gainedEmails = 0;
    let lostEmails = 0;
    const statusCounts = {};

    rows.forEach((row) => {
      const status = row.status || "pending";
      statusCounts[status] = (statusCounts[status] || 0) + 1;

      if (status === "scraped") scraped++;
      else if (status === "error") errors++;
      else pending++;

      if (row.comparison) {
        comparisonCounts[row.comparison] =
          (comparisonCounts[row.comparison] || 0) + 1;
      }

      // Count emails
      const oldEmails = parseEmailsSimple(row.emails);
      const newEmails = parseEmailsSimple(row.new_emails);
      totalOldEmails += oldEmails.length;
      totalNewEmails += newEmails.length;

      const oldSet = new Set(oldEmails);
      const newSet = new Set(newEmails);
      newEmails.forEach((e) => {
        if (!oldSet.has(e)) gainedEmails++;
      });
      oldEmails.forEach((e) => {
        if (!newSet.has(e)) lostEmails++;
      });
    });

    res.json({
      total,
      scraped,
      errors,
      pending,
      statusCounts,
      comparisonCounts,
      totalOldEmails,
      totalNewEmails,
      gainedEmails,
      lostEmails,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Sample rows for table view
app.get("/api/rows", (req, res) => {
  try {
    const page = parseInt(req.query.page || "1", 10);
    const limit = parseInt(req.query.limit || "50", 10);
    const filter = req.query.filter || "all"; // all, scraped, error, pending, new_has_more, different

    const raw = fs.readFileSync(CSV_PATH, "utf-8");
    const allRows = parse(raw, { columns: true, skip_empty_lines: true });

    let filtered = allRows;
    if (filter === "scraped")
      filtered = allRows.filter((r) => r.status === "scraped");
    else if (filter === "error")
      filtered = allRows.filter((r) => r.status === "error");
    else if (filter === "pending")
      filtered = allRows.filter((r) => !r.status || r.status === "pending");
    else if (filter === "new_has_more")
      filtered = allRows.filter((r) => r.comparison === "new_has_more");
    else if (filter === "different")
      filtered = allRows.filter((r) => r.comparison === "different");
    else if (filter === "no_new_emails")
      filtered = allRows.filter((r) => r.comparison === "no_new_emails");
    else if (filter === "exact_match")
      filtered = allRows.filter((r) => r.comparison === "exact_match");

    const start = (page - 1) * limit;
    const pageRows = filtered.slice(start, start + limit);

    res.json({
      total: filtered.length,
      page,
      limit,
      rows: pageRows,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

function parseEmailsSimple(raw) {
  if (!raw || raw === "[]") return [];
  try {
    const parsed = JSON.parse(raw.replace(/""/g, '"'));
    return Array.isArray(parsed) ? parsed.map((e) => e.trim().toLowerCase()) : [];
  } catch {
    try {
      const cleaned = raw
        .replace(/^\[""/, '["')
        .replace(/""]/g, '"]')
        .replace(/"",""/, '","');
      return JSON.parse(cleaned).map((e) => e.trim().toLowerCase());
    } catch {
      return [];
    }
  }
}

app.listen(PORT, () => {
  console.log(`Dashboard running at http://localhost:${PORT}`);
});
