import fs from "fs";
import path from "path";
import { parse } from "csv-parse/sync";
import { stringify } from "csv-stringify/sync";

const CSV_PATH = path.join(process.cwd(), "email_scraper_api_rows (1).csv");

export function readCSV() {
  if (!fs.existsSync(CSV_PATH)) return null;
  const raw = fs.readFileSync(CSV_PATH, "utf-8");
  return parse(raw, { columns: true, skip_empty_lines: true });
}

export function saveCSV(rows) {
  const output = stringify(rows, {
    header: true,
    columns: ["id", "url", "emails", "status", "new_emails", "comparison", "pages_crawled", "note"],
  });
  fs.writeFileSync(CSV_PATH, output);
}

export function parseEmails(raw) {
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

export function compareEmails(oldEmails, newEmails) {
  const oldSet = new Set(oldEmails);
  const newSet = new Set(newEmails);

  if (newEmails.length === 0 && oldEmails.length === 0) return "both_empty";
  if (newEmails.length === 0) return "no_new_emails";
  if (oldEmails.length === 0) return "no_old_emails";

  const onlyNew = newEmails.filter((e) => !oldSet.has(e));
  const onlyOld = oldEmails.filter((e) => !newSet.has(e));

  if (onlyNew.length === 0 && onlyOld.length === 0) return "exact_match";
  if (onlyNew.length > 0 && onlyOld.length === 0) return "new_has_more";
  if (onlyNew.length === 0 && onlyOld.length > 0) return "old_has_more";
  return "different";
}

export function getCSVPath() {
  return CSV_PATH;
}
