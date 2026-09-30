import { prisma } from "@/lib/prisma";
import type { Metadata } from "next";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { getSession } from "@/lib/session";
import { getTranslation } from "@/lib/translations";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "API Data Ingestion",
  robots: { index: false, follow: false }
};

export default async function DataPullsPage() {
  // B3: defense in depth. middleware.ts already redirects non-admins, but a
  // matcher change must not silently re-open this page to the public.
  const session = await getSession();
  if (session?.role !== "ADMIN") redirect("/admin-login?from=/data-pulls");

  const cookieStore = await cookies();
  const lang = (cookieStore.get("lang")?.value || "en") as "en" | "th";
  const t = getTranslation(lang);

  const jobs = await prisma.sourcePullJob.findMany({ orderBy: { createdAt: "desc" }, take: 50 });

  return (
    <div className="data-pulls-page">
      <h1>{t.dataPullsTitle}</h1>
      <p className="muted">{t.dataPullsDesc}</p>
      <div className="notice" style={{ marginBottom: 14 }}>
        Pull jobs save source records for later relevance and perspective review. They do not publish community submissions automatically.
      </div>

      <div className="table-wrap" style={{ marginTop: 14 }}>
        <table>
          <thead><tr><th>Adapter</th><th>Query</th><th>Status</th><th>Found</th><th>Saved</th><th>Error / missing key</th></tr></thead>
          <tbody>
            {jobs.map((job) => (
              <tr key={job.id}>
                <td>{job.adapter}</td>
                <td>{job.query}</td>
                <td>{job.status}</td>
                <td>{job.recordsFound}</td>
                <td>{job.recordsSaved}</td>
                <td>{job.errorMessage}</td>
              </tr>
            ))}
            {!jobs.length && <tr><td className="empty" colSpan={6}>No jobs yet.</td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  );
}
