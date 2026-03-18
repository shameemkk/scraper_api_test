"use client";

import { useState, useEffect, useRef, useCallback } from "react";

const COLORS = {
  exact_match: "#3b82f6",
  new_has_more: "#22c55e",
  old_has_more: "#eab308",
  different: "#a855f7",
  no_new_emails: "#ef4444",
  no_old_emails: "#06b6d4",
  both_empty: "#64748b",
};

const COMPARISON_LABELS = {
  exact_match: "Exact Match",
  new_has_more: "New Has More",
  old_has_more: "Old Has More",
  different: "Different",
  no_new_emails: "No New Emails",
  no_old_emails: "No Old Emails",
  both_empty: "Both Empty",
};

const FILTERS = [
  { key: "all", label: "All" },
  { key: "scraped", label: "Scraped" },
  { key: "error", label: "Errors" },
  { key: "pending", label: "Pending" },
  { key: "exact_match", label: "Exact Match" },
  { key: "new_has_more", label: "New Has More" },
  { key: "different", label: "Different" },
  { key: "no_new_emails", label: "No New Emails" },
];

function truncate(s, n) {
  return s && s.length > n ? s.slice(0, n) + "\u2026" : s;
}

function parseEmailList(raw) {
  if (!raw || raw === "[]" || raw === "-") return [];
  try {
    return JSON.parse(raw.replace(/""/g, '"')).map((e) => e.trim().toLowerCase());
  } catch {
    try {
      const cleaned = raw.replace(/^\[""/, '["').replace(/""]/g, '"]').replace(/"",""/, '","');
      return JSON.parse(cleaned).map((e) => e.trim().toLowerCase());
    } catch {
      return [];
    }
  }
}

function emailDiffTooltip(oldRaw, newRaw) {
  const oldEmails = parseEmailList(oldRaw);
  const newEmails = parseEmailList(newRaw);
  if (!oldEmails.length && !newEmails.length) return "";
  const oldSet = new Set(oldEmails);
  const newSet = new Set(newEmails);
  const gained = newEmails.filter((e) => !oldSet.has(e));
  const lost = oldEmails.filter((e) => !newSet.has(e));
  const kept = newEmails.filter((e) => oldSet.has(e));
  const parts = [];
  if (kept.length) parts.push("Kept: " + kept.join(", "));
  if (gained.length) parts.push("+ New: " + gained.join(", "));
  if (lost.length) parts.push("- Lost: " + lost.join(", "));
  return parts.join("\n");
}

function formatTime(s) {
  if (s < 60) return Math.round(s) + "s";
  if (s < 3600) return Math.floor(s / 60) + "m " + Math.round(s % 60) + "s";
  return Math.floor(s / 3600) + "h " + Math.floor((s % 3600) / 60) + "m";
}

export default function Dashboard() {
  const [progress, setProgress] = useState({ total: 0, completed: 0, isRunning: false, stats: {}, recentResults: [] });
  const [analysis, setAnalysis] = useState(null);
  const [logs, setLogs] = useState([]);
  const [tableData, setTableData] = useState({ rows: [], total: 0, page: 1 });
  const [currentFilter, setCurrentFilter] = useState("all");
  const [currentPage, setCurrentPage] = useState(1);
  const [concurrency, setConcurrency] = useState("200");
  const [apiUrl, setApiUrl] = useState("https://ocowgo8kkow0s4okc4g8kgcg.up.uparrowagency.com/extract-emails");

  const logBoxRef = useRef(null);
  const isRunning = progress.isRunning || progress.running;

  const loadTable = useCallback(async () => {
    try {
      const res = await fetch(`/api/rows?page=${currentPage}&limit=50&filter=${currentFilter}`);
      const data = await res.json();
      setTableData(data);
    } catch (err) {
      console.error("Table error:", err);
    }
  }, [currentPage, currentFilter]);

  // Polling
  useEffect(() => {
    async function poll() {
      try {
        const [progressRes, analysisRes, logsRes] = await Promise.all([
          fetch("/api/progress").then((r) => r.json()),
          fetch("/api/analysis").then((r) => r.json()).catch(() => null),
          fetch("/api/logs").then((r) => r.json()).catch(() => ({ logs: [] })),
        ]);
        setProgress(progressRes);
        if (analysisRes && !analysisRes.error) setAnalysis(analysisRes);
        setLogs(logsRes.logs || []);
      } catch (err) {
        console.error("Poll error:", err);
      }
    }

    poll();
    const interval = setInterval(poll, 3000);
    return () => clearInterval(interval);
  }, []);

  // Table polling
  useEffect(() => {
    loadTable();
    const interval = setInterval(loadTable, 10000);
    return () => clearInterval(interval);
  }, [loadTable]);

  // Auto-scroll logs
  useEffect(() => {
    if (logBoxRef.current) {
      logBoxRef.current.scrollTop = logBoxRef.current.scrollHeight;
    }
  }, [logs]);

  async function startScraper(retryErrors = false) {
    try {
      const res = await fetch("/api/start", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ concurrency: parseInt(concurrency), apiUrl, retryErrors }),
      });
      const data = await res.json();
      if (!res.ok) alert(data.error);
    } catch (err) {
      alert("Failed to start: " + err.message);
    }
  }

  async function stopScraper() {
    if (!confirm("Stop the scraper?")) return;
    try {
      await fetch("/api/stop", { method: "POST" });
    } catch (err) {
      alert("Failed to stop: " + err.message);
    }
  }

  // Computed values
  const pct = progress.total ? ((progress.completed / progress.total) * 100).toFixed(1) : "0";
  const elapsed = progress.startTime ? (Date.now() - progress.startTime) / 1000 : 0;
  const rate = elapsed > 0 ? (progress.completed / elapsed).toFixed(1) : "-";
  const remaining = progress.total - progress.completed;
  const eta = elapsed > 0 && remaining > 0 ? formatTime(remaining / (progress.completed / elapsed)) : "Done";
  const totalPages = Math.ceil((tableData.total || 0) / 50);

  const stats = (analysis && analysis.comparisonCounts) || progress.stats || {};
  const maxStat = Math.max(...Object.values(stats), 1);

  const dotClass = isRunning ? "dot running" : progress.completed > 0 ? "dot stopped" : "dot idle";
  const statusText = isRunning ? "Running" : progress.completed > 0 ? "Completed" : "Idle";

  return (
    <>
      <div className="header">
        <h1>Email Scraper Dashboard</h1>
        <div className="status">
          <div className={dotClass}></div>
          <span>{statusText}</span>
        </div>
      </div>

      <div className="container">
        {/* Controls */}
        <div className="controls">
          <div>
            <label>Concurrency</label><br />
            <input type="number" value={concurrency} onChange={(e) => setConcurrency(e.target.value)} min="1" max="500" />
          </div>
          <div>
            <label>API URL</label><br />
            <input type="text" className="wide" value={apiUrl} onChange={(e) => setApiUrl(e.target.value)} />
          </div>
          <div style={{ marginTop: 18 }}>
            <button className="btn btn-start" onClick={() => startScraper(false)} disabled={isRunning}>Start Scraper</button>{" "}
            <button className="btn btn-start" onClick={() => startScraper(true)} disabled={isRunning} style={{ background: "#eab308", color: "#000" }}>Retry Errors</button>{" "}
            <button className="btn btn-stop" onClick={stopScraper} disabled={!isRunning}>Stop</button>
          </div>
        </div>

        {/* Progress Bar */}
        <div className="progress-bar">
          <div className="fill success" style={{ width: pct + "%" }}></div>
          <div className="text">
            {(progress.completed || 0).toLocaleString()} / {(progress.total || 0).toLocaleString()} ({pct}%)
          </div>
        </div>

        {/* Stats Cards */}
        <div className="grid">
          <div className="card"><div className="label">Total URLs</div><div className="value">{(progress.total || 0).toLocaleString()}</div></div>
          <div className="card green"><div className="label">Scraped</div><div className="value">{(progress.success || (analysis && analysis.scraped) || 0).toLocaleString()}</div></div>
          <div className="card red"><div className="label">Errors</div><div className="value">{(progress.failed || (analysis && analysis.errors) || 0).toLocaleString()}</div></div>
          <div className="card blue"><div className="label">Rate</div><div className="value">{rate}</div><div className="sub">urls/sec</div></div>
          <div className="card yellow"><div className="label">ETA</div><div className="value">{remaining > 0 ? eta : "Done"}</div></div>
          <div className="card purple"><div className="label">Elapsed</div><div className="value">{elapsed > 0 ? formatTime(elapsed) : "-"}</div></div>
        </div>

        {/* Email Stats */}
        <div className="card" style={{ marginBottom: 20 }}>
          <div className="label" style={{ marginBottom: 8 }}>Email Comparison Summary</div>
          <div className="email-stats">
            <div className="email-stat"><div className="num">{((analysis && analysis.totalOldEmails) || 0).toLocaleString()}</div><div className="lbl">Old Emails</div></div>
            <div className="email-stat"><div className="num">{((analysis && analysis.totalNewEmails) || 0).toLocaleString()}</div><div className="lbl">New Emails</div></div>
            <div className="email-stat"><div className="num" style={{ color: "#22c55e" }}>+{((analysis && analysis.gainedEmails) || 0).toLocaleString()}</div><div className="lbl">Gained</div></div>
            <div className="email-stat"><div className="num" style={{ color: "#ef4444" }}>-{((analysis && analysis.lostEmails) || 0).toLocaleString()}</div><div className="lbl">Lost</div></div>
          </div>
        </div>

        {/* Panels */}
        <div className="panels">
          {/* Comparison Chart */}
          <div className="panel">
            <div className="panel-header">Comparison Breakdown</div>
            <div className="panel-body bar-chart">
              {Object.entries(COMPARISON_LABELS).map(([key, label]) => {
                const val = stats[key] || 0;
                const w = ((val / maxStat) * 100).toFixed(1);
                return (
                  <div className="bar-row" key={key}>
                    <div className="bar-label">{label}</div>
                    <div className="bar-track">
                      <div className="bar-fill" style={{ width: w + "%", background: COLORS[key] || "#64748b" }}></div>
                    </div>
                    <div className="bar-count">{val.toLocaleString()}</div>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Logs */}
          <div className="panel">
            <div className="panel-header">
              Live Logs <span style={{ fontSize: 11, color: "#64748b" }}>({logs.length} lines)</span>
            </div>
            <div className="panel-body log-box" ref={logBoxRef}>
              {logs.length > 0 ? logs.slice(-50).join("\n") : "Waiting..."}
            </div>
          </div>
        </div>

        {/* Data Table */}
        <div className="panel" style={{ marginTop: 16 }}>
          <div className="panel-header">Results Table</div>
          <div style={{ padding: "12px 16px" }}>
            <div className="filter-bar">
              {FILTERS.map((f) => (
                <button
                  key={f.key}
                  className={`filter-btn${currentFilter === f.key ? " active" : ""}`}
                  onClick={() => { setCurrentFilter(f.key); setCurrentPage(1); }}
                >
                  {f.label}
                </button>
              ))}
            </div>
            <div style={{ overflowX: "auto", maxHeight: 500, overflowY: "auto" }}>
              <table>
                <thead>
                  <tr>
                    <th>ID</th>
                    <th>URL</th>
                    <th>Old Emails</th>
                    <th>New Emails</th>
                    <th>Status</th>
                    <th>Comparison</th>
                    <th>Note</th>
                  </tr>
                </thead>
                <tbody>
                  {(tableData.rows || []).map((r, i) => (
                    <tr key={r.id || i}>
                      <td>{r.id}</td>
                      <td title={r.url}>{truncate(r.url, 40)}</td>
                      <td title={r.emails || ""}>{truncate(r.emails || "-", 30)}</td>
                      <td title={emailDiffTooltip(r.emails, r.new_emails) || r.new_emails || ""}>{truncate(r.new_emails || "-", 30)}</td>
                      <td><span className={`badge ${r.status || ""}`}>{r.status || "pending"}</span></td>
                      <td><span className={`badge ${r.comparison || ""}`}>{r.comparison || "-"}</span></td>
                      <td title={r.note || ""}>{truncate(r.note || "", 25)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="pagination">
              <button disabled={currentPage <= 1} onClick={() => setCurrentPage(currentPage - 1)}>Prev</button>
              <span>Page {currentPage} of {totalPages} ({(tableData.total || 0).toLocaleString()} rows)</span>
              <button disabled={currentPage >= totalPages} onClick={() => setCurrentPage(currentPage + 1)}>Next</button>
            </div>
          </div>
        </div>
      </div>
    </>
  );
}
