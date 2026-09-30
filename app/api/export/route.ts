import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/session";
import { checkAdminCredentials } from "@/lib/auth";

async function isAuthorizedAdmin(req: NextRequest) {
  if ((await getSession())?.role === "ADMIN") return true;
  const header = req.headers.get("authorization");
  if (!header?.startsWith("Basic ")) return false;
  try {
    const decoded = atob(header.slice("Basic ".length));
    const sep = decoded.indexOf(":");
    return sep >= 0 && (await checkAdminCredentials(decoded.slice(0, sep), decoded.slice(sep + 1)));
  } catch {
    return false;
  }
}

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  // B3: defense in depth. middleware.ts already checks this; repeat it here so a
  // matcher change cannot expose the export. Accept admin session OR valid Basic.
  if (!(await isAuthorizedAdmin(req))) {
    return NextResponse.json({ error: "Unauthorized. Admin credentials required." }, { status: 401 });
  }

  const { searchParams } = new URL(req.url);
  const table = searchParams.get("table") || "sources";

  let data: any[] = [];

  switch (table) {
    case "robots":
      data = await prisma.robotModel.findMany();
      break;
    case "contributions":
      data = await prisma.contribution.findMany();
      break;
    case "submissions":
      data = await prisma.submittedData.findMany();
      break;
    case "perspective_annotations":
      data = await prisma.perspectiveAnnotation.findMany();
      break;
    case "pull_jobs":
      data = await prisma.sourcePullJob.findMany();
      break;
    default:
      data = await prisma.sourceRecord.findMany();
  }

  if (data.length === 0) {
    return new NextResponse("id,empty\n1,No records found", {
      headers: {
        "Content-Type": "text/csv",
        "Content-Disposition": `attachment; filename="${table}_export.csv"`
      }
    });
  }

  // Parse columns
  const keys = Object.keys(data[0]);
  
  // Helper to escape values for CSV compatibility
  const escapeCSVValue = (val: any) => {
    if (val === null || val === undefined) return "";
    let str = typeof val === "object" ? JSON.stringify(val) : String(val);
    // Escape double quotes by doubling them
    str = str.replace(/"/g, '""');
    // Wrap in double quotes if it contains commas, quotes, or newlines
    if (str.includes(",") || str.includes('"') || str.includes("\n") || str.includes("\r")) {
      return `"${str}"`;
    }
    return str;
  };

  // Build CSV content
  const headerRow = keys.join(",");
  const rows = data.map((row) => 
    keys.map((key) => escapeCSVValue(row[key])).join(",")
  );

  const csvContent = [headerRow, ...rows].join("\n");

  return new NextResponse(csvContent, {
    headers: {
      "Content-Type": "text/csv",
      "Content-Disposition": `attachment; filename="${table}_export.csv"`
    }
  });
}
