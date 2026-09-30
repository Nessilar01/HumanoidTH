"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { cookies } from "next/headers";
import type { SourceType } from "../generated/prisma";
import { prisma } from "@/lib/prisma";
import { runAdapter } from "@/lib/ingest/adapters";
import { canonicalizeUrl } from "@/lib/url";
import { checkAdminCredentials } from "@/lib/auth";
import { clearSession, getSession, requireRole, setSession } from "@/lib/session";

function readTextField(formData: FormData, key: string) {
  return String(formData.get(key) ?? "").trim();
}

function readOptionalTextField(formData: FormData, key: string) {
  const value = readTextField(formData, key);
  return value || null;
}

function readOptionalUrlField(formData: FormData, key: string) {
  const value = canonicalizeUrl(readTextField(formData, key));
  return value || null;
}

function readOptionalNumberField(formData: FormData, key: string) {
  const value = readTextField(formData, key);
  if (!value) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function readOptionalDateField(formData: FormData, key: string) {
  const value = readTextField(formData, key);
  if (!value) return null;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function revalidateAtlasCms() {
  const paths = [
    "/",
    "/dashboard",
    "/database",
    "/robots",
    "/inventory",
    "/contributions",
    "/perspectives",
    "/analytics",
    "/submit-data",
    "/admin",
    "/admin/submitted-data",
    "/admin/cms"
  ];

  for (const path of paths) {
    revalidatePath(path);
  }
}

export async function createSubmission(formData: FormData) {
  // B1: identity comes from the signed session, not a plain user_email cookie.
  const session = await getSession();
  if (!session) {
    redirect("/profile?from=/submit-data");
  }

  const user = await prisma.user.findUnique({ where: { email: session.email } });
  if (!user) {
    redirect("/profile?from=/submit-data");
  }

  await prisma.submittedData.create({
    data: {
      submissionType: String(formData.get("submissionType") ?? "source_url"),
      title: String(formData.get("title") ?? ""),
      url: canonicalizeUrl(String(formData.get("url") ?? "")) || null,
      notes: String(formData.get("notes") ?? "") || null,
      submitterName: user.name || null,
      submitterContact: user.email,
      submittedById: user.id,
      status: "QUEUED"
    }
  });

  revalidateAtlasCms();
  revalidatePath("/profile");
  redirect("/profile");
}

export async function updateSubmissionStatus(id: string, status: "APPROVED" | "REJECTED" | "NEEDS_REVIEW") {
  await requireRole("ADMIN"); // B1: server actions are public endpoints; check here, not only in the UI
  await prisma.submittedData.update({ where: { id }, data: { status } });
  revalidateAtlasCms();
}

export async function runDataPull(formData: FormData) {
  await requireRole("ADMIN"); // B1: server actions are public endpoints; check here, not only in the UI
  const adapter = String(formData.get("adapter") ?? "OPENALEX") as SourceType;
  const query = String(formData.get("query") ?? "").trim();
  const limit = Number(formData.get("limit") ?? 10);

  if (!query) {
    throw new Error("Query is required.");
  }

  const job = await prisma.sourcePullJob.create({
    data: { adapter, query, status: "RUNNING", startedAt: new Date() }
  });

  try {
    const result = await runAdapter(adapter, { query, limit });
    await prisma.sourcePullJob.update({
      where: { id: job.id },
      data: {
        status: result.missingKeys?.length ? "SKIPPED_MISSING_KEY" : "SUCCEEDED",
        recordsFound: result.recordsFound,
        recordsSaved: result.recordsSaved,
        errorMessage: result.missingKeys?.join(", ") || null,
        finishedAt: new Date()
      }
    });
  } catch (error) {
    await prisma.sourcePullJob.update({
      where: { id: job.id },
      data: {
        status: "FAILED",
        errorMessage: error instanceof Error ? error.message : "Unknown ingestion error",
        finishedAt: new Date()
      }
    });
  }

  revalidatePath("/data-pulls");
  revalidatePath("/");
}

// ---------------------------------------------------------------------------
// Login / logout (Baseline B1)
//
// Upstream accepted `role` from the client (form field or bound argument) and
// set unsigned cookies, so anyone could register as ADMIN. Now:
//   - Email login can only create USER accounts and never changes a role.
//   - Accounts with the ADMIN role cannot log in by email; they must use
//     /admin-login with the env credentials.
//   - The session is a signed httpOnly cookie (lib/session.ts).
// Known limitation (not fixed here): email login has no password, so knowing a
// non-admin user's email lets you act as that user. See docs/baseline-audit.md.
// ---------------------------------------------------------------------------

export async function registerAndLoginUser(formData: FormData) {
  const email = String(formData.get("email") ?? "").trim().toLowerCase();
  const name = String(formData.get("name") ?? "").trim();
  const redirectTo = String(formData.get("redirectTo") ?? "/profile");
  // Note: any "role" field in formData is ignored on purpose.

  if (!email) {
    throw new Error("Email is required");
  }

  const existing = await prisma.user.findUnique({ where: { email } });
  if (existing?.role === "ADMIN") {
    redirect("/admin-login?error=use_admin_login");
  }

  const user = existing
    ? await prisma.user.update({ where: { email }, data: { name: name || undefined } }) // role untouched
    : await prisma.user.create({ data: { email, name: name || email.split("@")[0], role: "USER" } });

  await setSession(user.email, user.role);
  revalidatePath("/profile");
  revalidateAtlasCms();
  // Only allow same-site relative redirects ("//evil.com" is protocol-relative).
  const safeRedirect = redirectTo.startsWith("/") && !redirectTo.startsWith("//") ? redirectTo : "/profile";
  redirect(safeRedirect);
}

export async function logoutUser() {
  await clearSession();
  revalidatePath("/profile");
  revalidateAtlasCms();
  redirect("/profile");
}

export async function adminLoginAction(formData: FormData) {
  const email = String(formData.get("email") ?? "").trim();
  const password = String(formData.get("password") ?? "");

  // Credentials come only from ADMIN_BASIC_USER / ADMIN_BASIC_PASSWORD.
  // If either env var is unset, this always fails (no default password).
  if (!(await checkAdminCredentials(email, password))) {
    redirect("/admin-login?error=invalid_credentials");
  }

  const user = await prisma.user.upsert({
    where: { email },
    update: { role: "ADMIN" },
    create: { email, name: "Admin", role: "ADMIN" }
  });

  await setSession(user.email, "ADMIN");
  revalidateAtlasCms();
  redirect("/admin?collection=submitted-data");
}

export async function setLanguage(lang: "en" | "th") {
  const cookieStore = await cookies();
  cookieStore.set("lang", lang, { path: "/" });
  revalidatePath("/", "layout");
}

export async function upsertSourceRecordAction(formData: FormData) {
  await requireRole("ADMIN"); // B1: server actions are public endpoints; check here, not only in the UI
  const id = readTextField(formData, "id");
  const url = readOptionalUrlField(formData, "url");
  const sourceType = readTextField(formData, "sourceType") as any;
  const title = readTextField(formData, "title");

  if (!title) throw new Error("Source title is required.");
  if (!url) throw new Error("Source URL is required.");

  const existing = id
    ? await prisma.sourceRecord.findUnique({ where: { id }, select: { rawMeta: true } })
    : null;

  const payload = {
    sourceType,
    title,
    url,
    excerpt: readOptionalTextField(formData, "excerpt") || "",
    publishedAt: readOptionalDateField(formData, "publishedAt"),
    author: readOptionalTextField(formData, "author"),
    platform: readOptionalTextField(formData, "platform"),
    relevanceStatus: readTextField(formData, "relevanceStatus") as any,
    relevanceReason: readOptionalTextField(formData, "relevanceReason"),
    relevanceConfidence: readOptionalNumberField(formData, "relevanceConfidence") ?? 0
  };

  if (id) {
    await prisma.sourceRecord.update({ where: { id }, data: { ...payload, rawMeta: existing?.rawMeta ?? {} } });
  } else {
    await prisma.sourceRecord.upsert({
      where: { url },
      create: { ...payload, rawMeta: {} },
      update: { ...payload, rawMeta: existing?.rawMeta ?? {} }
    });
  }

  revalidateAtlasCms();
}

export async function upsertRobotModelAction(formData: FormData) {
  await requireRole("ADMIN"); // B1: server actions are public endpoints; check here, not only in the UI
  const id = readTextField(formData, "id");
  const canonicalName = readTextField(formData, "canonicalName");

  if (!canonicalName) throw new Error("Canonical name is required.");

  const existing = id
    ? await prisma.robotModel.findUnique({ where: { id }, select: { sourceMeta: true } })
    : null;

  const payload = {
    canonicalName,
    manufacturer: readOptionalTextField(formData, "manufacturer"),
    developerOrg: readOptionalTextField(formData, "developerOrg"),
    countryOfOrigin: readOptionalTextField(formData, "countryOfOrigin"),
    robotType: readOptionalTextField(formData, "robotType") || "unknown",
    embodimentLevel: readOptionalTextField(formData, "embodimentLevel"),
    primaryUseCase: readOptionalTextField(formData, "primaryUseCase"),
    thailandStatus: readOptionalTextField(formData, "thailandStatus") || "observed_in_thailand",
    statusConfidence: readOptionalNumberField(formData, "statusConfidence") ?? 0.5,
    officialUrl: readOptionalUrlField(formData, "officialUrl"),
    description: readOptionalTextField(formData, "description"),
    firstSeenYear: readOptionalNumberField(formData, "firstSeenYear"),
    lastVerifiedAt: readOptionalDateField(formData, "lastVerifiedAt")
  };

  if (id) {
    await prisma.robotModel.update({ where: { id }, data: { ...payload, sourceMeta: existing?.sourceMeta ?? {} } });
  } else {
    await prisma.robotModel.upsert({
      where: { canonicalName },
      create: { ...payload, sourceMeta: {} },
      update: { ...payload, sourceMeta: existing?.sourceMeta ?? {} }
    });
  }

  revalidateAtlasCms();
}

export async function upsertContributionAction(formData: FormData) {
  await requireRole("ADMIN"); // B1: server actions are public endpoints; check here, not only in the UI
  const id = readTextField(formData, "id");
  const title = readTextField(formData, "title");
  const contributionType = readTextField(formData, "contributionType");
  const sourceUrl = readOptionalUrlField(formData, "sourceUrl");

  if (!title) throw new Error("Contribution title is required.");
  if (!contributionType) throw new Error("Contribution type is required.");

  const payload = {
    contributorName: readOptionalTextField(formData, "contributorName"),
    contributorType: readOptionalTextField(formData, "contributorType"),
    organization: readOptionalTextField(formData, "organization"),
    contributionType,
    title,
    description: readOptionalTextField(formData, "description"),
    relatedRobotModelId: readOptionalTextField(formData, "relatedRobotModelId"),
    sourceUrl,
    license: readOptionalTextField(formData, "license"),
    visibility: readOptionalTextField(formData, "visibility") || "public",
    verificationStatus: readOptionalTextField(formData, "verificationStatus") as any || "NEEDS_REVIEW"
  };

  if (id) {
    await prisma.contribution.update({ where: { id }, data: payload });
  } else if (sourceUrl) {
    await prisma.contribution.upsert({
      where: { sourceUrl },
      create: payload,
      update: payload
    });
  } else {
    await prisma.contribution.create({ data: payload });
  }

  revalidateAtlasCms();
}

export async function upsertSubmittedDataAction(formData: FormData) {
  await requireRole("ADMIN"); // B1: server actions are public endpoints; check here, not only in the UI
  const id = readTextField(formData, "id");
  const title = readTextField(formData, "title");
  const submissionType = readTextField(formData, "submissionType");

  if (!title) throw new Error("Submission title is required.");
  if (!submissionType) throw new Error("Submission type is required.");

  const payload = {
    submissionType,
    title,
    url: readOptionalUrlField(formData, "url"),
    notes: readOptionalTextField(formData, "notes"),
    submitterName: readOptionalTextField(formData, "submitterName"),
    submitterContact: readOptionalTextField(formData, "submitterContact"),
    status: readOptionalTextField(formData, "status") as any || "QUEUED",
    reviewNotes: readOptionalTextField(formData, "reviewNotes")
  };

  if (id) {
    await prisma.submittedData.update({ where: { id }, data: payload });
  } else {
    await prisma.submittedData.create({ data: { ...payload, payloadJson: {} } });
  }

  revalidateAtlasCms();
}
