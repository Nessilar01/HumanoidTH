import { cookies } from "next/headers";
import { getSession } from "@/lib/session";
import type { Metadata } from "next";
import { prisma } from "@/lib/prisma";
import { createSubmission, registerAndLoginUser } from "@/app/actions";
import { getTranslation } from "@/lib/translations";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Contribute Data & Sightings | Thailand Humanoid Atlas",
  description: "Help keep the Thailand Humanoid Atlas accurate. Submit new robot deployments, academic papers, source links, or physical inventory updates.",
  alternates: { canonical: "/submit-data" },
  openGraph: {
    title: "Contribute Data & Sightings | Thailand Humanoid Atlas",
    description: "Help keep the Thailand Humanoid Atlas accurate. Submit new robot deployments, academic papers, source links, or physical inventory updates.",
    url: "/submit-data",
    siteName: "Thailand Humanoid Atlas",
    images: [
      {
        url: "/logo.png",
        width: 512,
        height: 512,
        alt: "Thailand Humanoid Atlas Logo"
      }
    ],
    locale: "en_US",
    type: "website"
  },
  twitter: {
    card: "summary_large_image",
    title: "Contribute Data & Sightings | Thailand Humanoid Atlas",
    description: "Help keep the Thailand Humanoid Atlas accurate. Submit new robot deployments, academic papers, source links, or physical inventory updates.",
    images: ["/logo.png"]
  }
};const copy = {
  en: {
    accountTitle: "Create an account to submit data",
    accountText: "Submissions are connected to your profile so you can track review status and show your contribution history to the community.",
    accountEmail: "Email Address",
    accountName: "Display Name",
    accountButton: "Create Account / Continue",
    accountHint: "Already have an account? Use the same email to continue.",
    type: "Submission Type",
    title: "Title / Identifier",
    refUrl: "Reference URL",
    desc: "Description / Core Source Notes",
    submitBtn: "Submit for Verification Review",
    signedInAs: "Submitting as",
    locked: "Create an account first to unlock the submission form.",
    policyTitle: "Submission Policy",
    policyText: "All submissions enter a review queue before they become public records.",
    policyOne: "Your submitted URLs and notes are kept with your profile.",
    policyTwo: "Administrators approve, reject, or request more information before indexing submissions.",
    policyThree: "Approved submissions can be credited as community contributions.",
    queue: "Your Submission Queue",
    queueHelp: "These records also appear on your profile so you can track review progress and show your community contributions.",
    titleCol: "Title / Reference",
    typeCol: "Type",
    statusCol: "Status",
    notesCol: "Notes & Sources",
    dateCol: "Date",
    empty: "No submissions queued yet."
  },
  th: {
    accountTitle: "สร้างบัญชีก่อนส่งข้อมูล",
    accountText: "รายการที่คุณส่งจะเชื่อมกับโปรไฟล์ เพื่อให้ติดตามสถานะการตรวจสอบและแสดงผลงานที่ช่วยชุมชนได้",
    accountEmail: "อีเมล",
    accountName: "ชื่อที่แสดง",
    accountButton: "สร้างบัญชี / ดำเนินการต่อ",
    accountHint: "มีบัญชีแล้ว? ใช้อีเมลเดิมเพื่อดำเนินการต่อ",
    type: "ประเภทข้อมูล",
    title: "ชื่อเรื่อง / ตัวระบุข้อมูล",
    refUrl: "ลิงก์อ้างอิง",
    desc: "คำอธิบาย / หมายเหตุแหล่งข้อมูล",
    submitBtn: "ส่งเพื่อตรวจสอบ",
    signedInAs: "กำลังส่งในนาม",
    locked: "กรุณาสร้างบัญชีก่อนส่งข้อมูล",
    policyTitle: "นโยบายการส่งข้อมูล",
    policyText: "ข้อมูลที่ส่งจะเข้าสู่คิวตรวจสอบก่อนเผยแพร่เป็นข้อมูลสาธารณะ",
    policyOne: "ลิงก์และหมายเหตุที่คุณส่งจะถูกเก็บไว้กับโปรไฟล์ของคุณ",
    policyTwo: "ผู้ดูแลระบบจะอนุมัติ ปฏิเสธ หรือขอข้อมูลเพิ่มเติมก่อนจัดทำดัชนี",
    policyThree: "รายการที่อนุมัติแล้วสามารถแสดงเป็นผลงานร่วมของชุมชนได้",
    queue: "คิวข้อมูลที่คุณส่ง",
    queueHelp: "รายการเหล่านี้จะแสดงในโปรไฟล์ของคุณ เพื่อใช้ติดตามสถานะและแสดงผลงานที่ช่วยชุมชน",
    titleCol: "ชื่อเรื่อง / อ้างอิง",
    typeCol: "ประเภท",
    statusCol: "สถานะ",
    notesCol: "หมายเหตุและแหล่งข้อมูล",
    dateCol: "วันที่ส่ง",
    empty: "ยังไม่มีรายการที่ส่ง"
  }
} as const;

export default async function SubmitDataPage() {
  const cookieStore = await cookies();
  const currentEmail = (await getSession())?.email; // B1: signed session
  const lang = (cookieStore.get("lang")?.value || "en") as "en" | "th";
  const t = getTranslation(lang);
  const localT = copy[lang];

  const currentUser = currentEmail
    ? await prisma.user.findUnique({ where: { email: currentEmail } })
    : null;

  const submissions = currentUser
    ? await prisma.submittedData.findMany({
        where: { submittedById: currentUser.id },
        orderBy: { createdAt: "desc" },
        take: 20
      })
    : [];

  return (
    <>
      <div className="topline">
        <div>
          <h1>{t.submitTitle}</h1>
          <p className="muted">{t.submitDesc}</p>
        </div>
      </div>

      {!currentUser && (
        <section className="panel" style={{ border: "1px solid var(--warning)", marginBottom: 16 }}>
          <h2>{localT.accountTitle}</h2>
          <p className="muted" style={{ marginBottom: 14 }}>{localT.accountText}</p>
          <form action={registerAndLoginUser} className="form" style={{ maxWidth: 520, gap: 12 }}>
            <input type="hidden" name="redirectTo" value="/submit-data" />
            <input type="hidden" name="role" value="USER" />
            <label>
              {localT.accountEmail}
              <input name="email" type="email" required placeholder="ichiro.kato@waseda.jp" />
            </label>
            <label>
              {localT.accountName}
              <input name="name" placeholder="Ichiro Kato" />
            </label>
            <button type="submit" className="primary">{localT.accountButton}</button>
          </form>
          <p className="muted" style={{ fontSize: 12, marginTop: 12 }}>{localT.accountHint}</p>
        </section>
      )}

      <div className="two" style={{ gap: 16 }}>
        <form className="form panel" action={createSubmission} aria-disabled={!currentUser}>
          {currentUser && (
            <div className="notice">
              {localT.signedInAs}: <strong>{currentUser.name || currentUser.email}</strong>
            </div>
          )}

          <label>
            {localT.type}
            <select name="submissionType" required disabled={!currentUser}>
              <option value="source_url">Source URL (News, Article, Blog)</option>
              <option value="robot_model">Robot Model Spec</option>
              <option value="owned_inventory_update">Owned Inventory Unit Update</option>
              <option value="contribution_claim">Contribution Claim (Paper, Repo)</option>
              <option value="event_demo_record">Event or Public Demo Record</option>
              <option value="correction_request">Database Correction Request</option>
            </select>
          </label>

          <label>
            {localT.title}
            <input name="title" required disabled={!currentUser} placeholder="e.g. NAO Robot deployment at KMUTT, Dinsaw Mini review" />
          </label>

          <label>
            {localT.refUrl}
            <input name="url" type="url" disabled={!currentUser} placeholder="https://example.com/source-link" />
          </label>

          <label>
            {localT.desc}
            <textarea name="notes" rows={5} disabled={!currentUser} placeholder="Provide source excerpts, model details, correction notes, or inventory context." />
          </label>

          <button className="primary" type="submit" disabled={!currentUser} style={{ marginTop: 10 }}>
            {localT.submitBtn}
          </button>
          {!currentUser && <p className="muted" style={{ fontSize: 12, margin: 0 }}>{localT.locked}</p>}
        </form>

        <aside className="panel" style={{ fontSize: 13 }}>
          <h2>{localT.policyTitle}</h2>
          <p className="muted" style={{ marginBottom: 10 }}>{localT.policyText}</p>
          <ul style={{ paddingLeft: 18, margin: "6px 0", color: "var(--text-secondary)", display: "flex", flexDirection: "column", gap: 6 }}>
            <li>{localT.policyOne}</li>
            <li>{localT.policyTwo}</li>
            <li>{localT.policyThree}</li>
          </ul>
        </aside>
      </div>

      <h2 style={{ marginTop: 24 }}>{localT.queue}</h2>
      {currentUser && <p className="muted" style={{ marginTop: -8 }}>{localT.queueHelp}</p>}
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>{localT.titleCol}</th>
              <th>{localT.typeCol}</th>
              <th>{localT.statusCol}</th>
              <th>{localT.notesCol}</th>
              <th>{localT.dateCol}</th>
            </tr>
          </thead>
          <tbody>
            {submissions.map((sub) => (
              <tr key={sub.id}>
                <td>
                  <strong>{sub.title}</strong>
                  {sub.url && (
                    <div style={{ marginTop: 4 }}>
                      <a href={sub.url} target="_blank" rel="noreferrer" style={{ fontSize: 12, wordBreak: "break-all" }}>
                        {sub.url}
                      </a>
                    </div>
                  )}
                </td>
                <td><span className="badge">{sub.submissionType.replace(/_/g, " ")}</span></td>
                <td>
                  <span className={`badge ${sub.status === "APPROVED" ? "ok" : sub.status === "REJECTED" || sub.status === "FAILED" ? "danger" : "warn"}`}>
                    {sub.status.toLowerCase()}
                  </span>
                </td>
                <td style={{ fontSize: 12, color: "var(--text-secondary)", maxWidth: 280, wordBreak: "break-word" }}>
                  {sub.notes || sub.reviewNotes || "Manual review pending."}
                </td>
                <td style={{ fontSize: 12 }}>{sub.createdAt.toLocaleDateString()}</td>
              </tr>
            ))}
            {!submissions.length && (
              <tr>
                <td className="empty" colSpan={5}>{localT.empty}</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </>
  );
}

