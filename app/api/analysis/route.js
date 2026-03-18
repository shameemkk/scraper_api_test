import { NextResponse } from "next/server";
import { readCSV, parseEmails } from "@/lib/csv";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const rows = readCSV();
    if (!rows) {
      return NextResponse.json({ error: "CSV not found" }, { status: 404 });
    }

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
        comparisonCounts[row.comparison] = (comparisonCounts[row.comparison] || 0) + 1;
      }

      const oldEmails = parseEmails(row.emails);
      const newEmails = parseEmails(row.new_emails);
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

    return NextResponse.json({
      total: rows.length,
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
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
