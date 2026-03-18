import { NextResponse } from "next/server";
import { readCSV } from "@/lib/csv";

export const dynamic = "force-dynamic";

export async function GET(request) {
  try {
    const { searchParams } = new URL(request.url);
    const page = parseInt(searchParams.get("page") || "1", 10);
    const limit = parseInt(searchParams.get("limit") || "50", 10);
    const filter = searchParams.get("filter") || "all";

    const allRows = readCSV();
    if (!allRows) {
      return NextResponse.json({ error: "CSV not found" }, { status: 404 });
    }

    let filtered = allRows;
    if (filter === "scraped") filtered = allRows.filter((r) => r.status === "scraped");
    else if (filter === "error") filtered = allRows.filter((r) => r.status === "error");
    else if (filter === "pending") filtered = allRows.filter((r) => !r.status || r.status === "pending");
    else if (filter === "new_has_more") filtered = allRows.filter((r) => r.comparison === "new_has_more");
    else if (filter === "different") filtered = allRows.filter((r) => r.comparison === "different");
    else if (filter === "no_new_emails") filtered = allRows.filter((r) => r.comparison === "no_new_emails");
    else if (filter === "exact_match") filtered = allRows.filter((r) => r.comparison === "exact_match");

    const start = (page - 1) * limit;
    const pageRows = filtered.slice(start, start + limit);

    return NextResponse.json({
      total: filtered.length,
      page,
      limit,
      rows: pageRows,
    });
  } catch (err) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
