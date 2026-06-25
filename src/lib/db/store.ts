// ───────────────────────────────────────────────────────────────────────────
// Persistence — a tiny repository over a local JSON file (zero-setup default).
//
// When Supabase env vars are present the repository delegates to the Supabase
// adapter instead (see ./supabase.ts and ./schema.sql). The rest of the app
// only ever imports the functions below, so swapping persistence is invisible
// to API routes and UI.
// ───────────────────────────────────────────────────────────────────────────

import { promises as fs } from "node:fs";
import path from "node:path";
import type { Audit, AuditSummaryRow, ReviewChecklist } from "../audit/types";
import {
  isSupabaseEnabled,
  supabaseGet,
  supabaseList,
  supabaseSave,
  supabaseUpdateReview,
} from "./supabase";

const DATA_DIR = path.resolve(process.env.DATA_DIR || ".data");
const DB_FILE = path.join(DATA_DIR, "audits.json");

interface DbShape {
  audits: Audit[];
}

async function readDb(): Promise<DbShape> {
  try {
    const raw = await fs.readFile(DB_FILE, "utf8");
    return JSON.parse(raw) as DbShape;
  } catch {
    return { audits: [] };
  }
}

async function writeDb(db: DbShape): Promise<void> {
  await fs.mkdir(DATA_DIR, { recursive: true });
  await fs.writeFile(DB_FILE, JSON.stringify(db, null, 2), "utf8");
}

function toRow(a: Audit): AuditSummaryRow {
  return {
    id: a.id,
    url: a.url,
    title: a.title,
    status: a.status,
    createdAt: a.createdAt,
    reviewer: a.reviewer,
    overall: a.score.overall,
    fail: a.summary.fail + a.links.filter((l) => l.status === "fail").length,
    warning: a.summary.warning,
    approved: a.review.approved,
  };
}

export async function saveAudit(audit: Audit): Promise<void> {
  if (isSupabaseEnabled()) return supabaseSave(audit);
  const db = await readDb();
  const idx = db.audits.findIndex((a) => a.id === audit.id);
  if (idx >= 0) db.audits[idx] = audit;
  else db.audits.unshift(audit);
  await writeDb(db);
}

export async function getAudit(id: string): Promise<Audit | null> {
  if (isSupabaseEnabled()) return supabaseGet(id);
  const db = await readDb();
  return db.audits.find((a) => a.id === id) ?? null;
}

export async function listAudits(): Promise<AuditSummaryRow[]> {
  if (isSupabaseEnabled()) return supabaseList();
  const db = await readDb();
  return db.audits
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
    .map(toRow);
}

export async function updateReview(
  id: string,
  review: ReviewChecklist,
): Promise<Audit | null> {
  if (isSupabaseEnabled()) return supabaseUpdateReview(id, review);
  const db = await readDb();
  const audit = db.audits.find((a) => a.id === id);
  if (!audit) return null;
  audit.review = review;
  await writeDb(db);
  return audit;
}

/** Aggregate stats for the admin dashboard. */
export async function dashboardStats() {
  const rows = await listAudits();
  const total = rows.length;
  const failed = rows.filter((r) => r.fail > 0).length;
  const approved = rows.filter((r) => r.approved).length;
  const avgScore =
    total > 0 ? Math.round(rows.reduce((s, r) => s + r.overall, 0) / total) : 0;

  // Reviewer performance
  const byReviewer = new Map<string, { audits: number; avg: number; approved: number }>();
  for (const r of rows) {
    const cur = byReviewer.get(r.reviewer) || { audits: 0, avg: 0, approved: 0 };
    cur.audits += 1;
    cur.avg += r.overall;
    cur.approved += r.approved ? 1 : 0;
    byReviewer.set(r.reviewer, cur);
  }
  const reviewers = Array.from(byReviewer, ([name, v]) => ({
    name,
    audits: v.audits,
    avgScore: Math.round(v.avg / v.audits),
    approved: v.approved,
  })).sort((a, b) => b.audits - a.audits);

  return { total, failed, approved, avgScore, reviewers, recent: rows.slice(0, 8) };
}
