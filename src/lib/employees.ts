import "server-only";
import { readAllRows } from "./db-pagination";
import { matchesLeadSearch } from "./lead-search-shared";
import { supabase } from "./supabase";
import { sealFields, unsealFields, unseal, phoneHash, normalizePhone } from "./crypto";
import type { CallReminder } from "./leads-shared";
import type { EmployeeScope } from "./admin-auth";
import type {
  EmployeeRow,
  EmployeeStatus,
  EmployeeUpdate,
  NewEmployee,
} from "./employees-shared";

// Re-export the shared types/catalog so existing server-side imports of
// "@/lib/employees" keep working. Client code must import from
// "@/lib/employees-shared" instead.
export * from "./employees-shared";

export const BUCKET = "employee-docs";

/** Encrypted-at-rest fields. Phone is encrypted + kept exact-match
 *  searchable via the sibling `phone_hash` column. */
export const ENCRYPTED_EMPLOYEE_FIELDS = ["phone", "aadhaar_number", "notes"] as const;

export async function uploadEmployeeFile(opts: {
  file: File;
  applicantId: string;
  kind: "aadhaar" | "profile" | "signature";
}): Promise<string> {
  const ext = guessExt(opts.file.type, opts.file.name) || "bin";
  const path = `${opts.applicantId}/${opts.kind}.${ext}`;
  const buf = Buffer.from(await opts.file.arrayBuffer());
  const { error } = await supabase()
    .storage.from(BUCKET)
    .upload(path, buf, { contentType: opts.file.type, upsert: true });
  if (error) throw error;
  return path;
}

function guessExt(mime: string, name: string): string | null {
  if (mime === "image/png") return "png";
  if (mime === "image/jpeg") return "jpg";
  if (mime === "image/webp") return "webp";
  if (mime === "application/pdf") return "pdf";
  const m = /\.([a-zA-Z0-9]+)$/.exec(name);
  return m ? m[1].toLowerCase() : null;
}

export async function signedUrlFor(
  path: string | null,
  expiresInSeconds = 600,
): Promise<string | null> {
  if (!path) return null;
  const { data, error } = await supabase().storage.from(BUCKET).createSignedUrl(path, expiresInSeconds);
  if (error) return null;
  return data?.signedUrl ?? null;
}

// In-memory short TTL caches for employee reminders and job counts
const employeeRemindersCache = new Map<string, { data: CallReminder[]; expires: number }>();
const jobCountsCache = new Map<string, { data: Array<{ job_role: string; count: number }>; expires: number }>();

export function invalidateEmployeeCaches(): void {
  employeeRemindersCache.clear();
  jobCountsCache.clear();
}

export async function insertEmployee(emp: NewEmployee): Promise<EmployeeRow> {
  invalidateEmployeeCaches();
  const payload: Record<string, unknown> = { ...emp, status: emp.status ?? "applied" };
  payload.phone_hash = phoneHash(emp.phone);
  const sealed = sealFields(payload, ENCRYPTED_EMPLOYEE_FIELDS);
  const { data, error } = await supabase()
    .from("employees")
    .insert(sealed)
    .select()
    .single();
  if (error) throw error;
  return unsealFields(data as EmployeeRow, ENCRYPTED_EMPLOYEE_FIELDS)!;
}

// aadhaar_number + phone are encrypted at rest — phone is searched via
// phone_hash below; aadhaar_number is no longer searchable by content.
const SEARCH_FIELDS = ["name", "location", "job_role"];

function sanitizeSearch(raw: string): string {
  return raw.replace(/[,()"'\\*]/g, " ").replace(/\s+/g, " ").trim();
}

export async function listEmployees(
  opts: {
    status?: EmployeeStatus | "all";
    search?: string;
    limit?: number;
    /** Only include employees assigned to this admin user id */
    assignedAdminUserId?: string;
    /** Inclusive lower bound on created_at, full ISO timestamp w/ TZ. */
    fromIso?: string;
    /** Inclusive upper bound on created_at, full ISO timestamp w/ TZ. */
    toIso?: string;
    /** Filter by job role */
    jobRole?: string;
    /** Filter by specific employee IDs */
    ids?: string[];
  } = {},
): Promise<EmployeeRow[]> {
  let q = supabase()
    .from("employees")
    .select("*, assigned_admin_user:assigned_admin_user_id (email, employees:employee_id (name))")
    .order("created_at", { ascending: false });
  if (opts.ids && opts.ids.length > 0) q = q.in("id", opts.ids);
  if (opts.status && opts.status !== "all") q = q.eq("status", opts.status);
  if (opts.assignedAdminUserId) q = q.eq("assigned_admin_user_id", opts.assignedAdminUserId);
  if (opts.jobRole && opts.jobRole !== "all") q = q.eq("job_role", opts.jobRole);
  if (opts.fromIso) q = q.gte("created_at", opts.fromIso);
  if (opts.toIso) q = q.lte("created_at", opts.toIso);
  const data = await readAllRows(q.order("id"));
  return (data ?? []).map((r) => {
    const row = unsealFields(r as EmployeeRow, ENCRYPTED_EMPLOYEE_FIELDS)!;
    const assignedAdminUser = Array.isArray(row.assigned_admin_user)
      ? row.assigned_admin_user[0] ?? null
      : row.assigned_admin_user ?? null;
    return { ...row, assigned_admin_user: assignedAdminUser };
  }).filter((row) => matchesLeadSearch(row, opts.search ?? "")).slice(0, opts.limit ?? 200) as EmployeeRow[];
}

export async function getEmployee(id: string): Promise<EmployeeRow | null> {
  const { data, error } = await supabase()
    .from("employees")
    .select("*, assigned_admin_user:assigned_admin_user_id (email, employees:employee_id (name))")
    .eq("id", id)
    .maybeSingle();
  if (error) throw error;
  if (!data) return null;
  const row = unsealFields(data as EmployeeRow, ENCRYPTED_EMPLOYEE_FIELDS)!;
  const assignedAdminUser = Array.isArray(row.assigned_admin_user)
    ? row.assigned_admin_user[0] ?? null
    : row.assigned_admin_user ?? null;
  return { ...row, assigned_admin_user: assignedAdminUser };
}

export async function updateEmployee(id: string, patch: EmployeeUpdate): Promise<void> {
  invalidateEmployeeCaches();
  const payload: Record<string, unknown> = { ...patch };
  if ("phone" in payload) payload.phone_hash = phoneHash(payload.phone as string | null);
  const sealed = sealFields(payload, ENCRYPTED_EMPLOYEE_FIELDS);
  const { error } = await supabase().from("employees").update(sealed).eq("id", id);
  if (error) throw error;
}

export async function updateEmployeeStatus(id: string, status: EmployeeStatus): Promise<void> {
  invalidateEmployeeCaches();
  const { error } = await supabase().from("employees").update({ status }).eq("id", id);
  if (error) throw error;
}

export async function deleteEmployee(id: string): Promise<void> {
  invalidateEmployeeCaches();
  const { error } = await supabase().from("employees").delete().eq("id", id);
  if (error) throw error;
}

// --- scope guards -----------------------------------------------------------

/** Check if `employeeId` is visible within `scope`. Returns boolean. */
export async function isEmployeeInScope(employeeId: string, scope: EmployeeScope): Promise<boolean> {
  if (scope.kind === "all") return true;
  const { data, error } = await supabase()
    .from("employees")
    .select("id")
    .eq("id", employeeId)
    .eq("assigned_admin_user_id", scope.adminUserId)
    .maybeSingle();
  if (error || !data) return false;
  return true;
}

/** Assert that `employeeId` is visible within `scope`. Throws an error if outside scope. */
export async function assertEmployeeInScope(employeeId: string, scope: EmployeeScope): Promise<void> {
  if (scope.kind === "all") return;
  const inScope = await isEmployeeInScope(employeeId, scope);
  if (!inScope) {
    throw new Error("Access Denied: This employee is outside your assigned scope.");
  }
}

/**
 * Employee call reminders + new applicant notifications — surfaced in the
 * notification bell on employee admin pages.
 *
 * Two feeds merged and sorted:
 *  1. "due"     — reminder_call_date ≤ today (overdue or today), non-resigned/rejected.
 *  2. "applied" — status="applied" employees not yet moved to screening/beyond.
 *                 Sorted newest first so the freshest applicants surface on top.
 */
export async function listEmployeeCallReminders(opts: { limit?: number; assignedAdminUserId?: string } = {}): Promise<CallReminder[]> {
  const { limit = 50, assignedAdminUserId } = opts;
  const cacheKey = `${assignedAdminUserId || "all"}_${limit}`;
  const now = Date.now();
  const cached = employeeRemindersCache.get(cacheKey);
  if (cached && cached.expires > now) {
    return cached.data;
  }

  const today = new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" });
  const sb = supabase();

  let dueQuery = sb
    .from("employees")
    .select("id,name,phone,status,reminder_call_date,created_at")
    .not("reminder_call_date", "is", null)
    .lte("reminder_call_date", today)
    .order("reminder_call_date", { ascending: true })
    .limit(limit * 2);
  let appliedQuery = sb
    .from("employees")
    .select("id,name,phone,job_role,created_at")
    .eq("status", "applied")
    .order("created_at", { ascending: false })
    .limit(limit);
  if (assignedAdminUserId) {
    dueQuery = dueQuery.eq("assigned_admin_user_id", assignedAdminUserId);
    appliedQuery = appliedQuery.eq("assigned_admin_user_id", assignedAdminUserId);
  }
  const [dueRes, appliedRes] = await Promise.all([dueQuery, appliedQuery]);
  if (dueRes.error) throw dueRes.error;
  if (appliedRes.error) throw appliedRes.error;

  type DueRow = { id: string; name: string; phone: string | null; status: EmployeeStatus; reminder_call_date: string };
  type AppliedRow = { id: string; name: string; phone: string | null; job_role: string; created_at: string };

  const out: CallReminder[] = [];

  // 1. Call reminders (due/overdue).
  for (const r of (dueRes.data ?? []) as DueRow[]) {
    if (r.status === "resigned" || r.status === "rejected") continue;
    const overdue = r.reminder_call_date < today;
    out.push({
      id: r.id,
      name: r.name,
      phone: unseal(r.phone),
      reason: overdue ? `Overdue · ${r.reminder_call_date}` : "Call today",
      kind: "due",
      href: `/admin/employees/${r.id}`,
    });
  }

  // 2. New applicants — show how recently they applied for the "wow" factor.
  for (const r of (appliedRes.data ?? []) as AppliedRow[]) {
    const daysAgo = Math.floor(
      (Date.now() - new Date(r.created_at).getTime()) / 86_400_000,
    );
    const when =
      daysAgo === 0 ? "Applied today" :
      daysAgo === 1 ? "Applied yesterday" :
      `Applied ${daysAgo} days ago`;
    out.push({
      id: r.id,
      name: r.name,
      phone: unseal(r.phone),
      reason: when,
      kind: "applied",
      href: `/admin/employees/${r.id}`,
    });
  }

  const res = out.slice(0, limit);
  employeeRemindersCache.set(cacheKey, { data: res, expires: now + 60_000 });
  return res;
}

/** Distinct job_role values + counts for the employee filter pill bar. */
export async function listJobCounts(opts: { assignedAdminUserId?: string } = {}): Promise<Array<{ job_role: string; count: number }>> {
  const cacheKey = opts.assignedAdminUserId || "all";
  const now = Date.now();
  const cached = jobCountsCache.get(cacheKey);
  if (cached && cached.expires > now) {
    return cached.data;
  }

  let q = supabase().from("employees").select("job_role");
  if (opts.assignedAdminUserId) q = q.eq("assigned_admin_user_id", opts.assignedAdminUserId);
  const { data, error } = await q.limit(5000);
  if (error) throw error;
  const counts = new Map<string, number>();
  for (const r of (data ?? []) as { job_role: string | null }[]) {
    if (!r.job_role) continue;
    counts.set(r.job_role, (counts.get(r.job_role) ?? 0) + 1);
  }
  const res = [...counts.entries()]
    .map(([job_role, count]) => ({ job_role, count }))
    .sort((a, b) => b.count - a.count || a.job_role.localeCompare(b.job_role));
  jobCountsCache.set(cacheKey, { data: res, expires: now + 20_000 });
  return res;
}

export interface BulkInsertEmployeesOptions {
  /** "skip" (default) will ignore employees whose phone number already exists in DB */
  duplicateStrategy?: "skip" | "allow";
  /** Optional assigned admin user ID for all imported employees */
  assignedAdminUserId?: string | null;
}

export interface BulkInsertEmployeesResult {
  insertedCount: number;
  duplicateCount: number;
  skippedCount: number;
  insertedIds: string[];
  errors: string[];
}

/**
 * Bulk insert employees with AES encryption, phone HMAC hashing, and duplicate detection.
 */
export async function bulkInsertEmployees(
  employees: NewEmployee[],
  options: BulkInsertEmployeesOptions = {},
): Promise<BulkInsertEmployeesResult> {
  invalidateEmployeeCaches();
  const duplicateStrategy = options.duplicateStrategy ?? "skip";
  const assignedAdminUserId = options.assignedAdminUserId || null;

  if (!employees.length) {
    return { insertedCount: 0, duplicateCount: 0, skippedCount: 0, insertedIds: [], errors: [] };
  }

  // 1. Calculate phone hashes for all incoming employees
  const incomingWithHash = employees.map((emp) => ({
    emp,
    phone_hash: phoneHash(emp.phone),
  }));

  // 2. Check for duplicates against existing DB rows if duplicateStrategy is "skip"
  const existingPhoneHashes = new Set<string>();
  if (duplicateStrategy === "skip") {
    const validHashes = incomingWithHash
      .map((i) => i.phone_hash)
      .filter((h): h is string => Boolean(h));

    if (validHashes.length > 0) {
      for (let i = 0; i < validHashes.length; i += 200) {
        const batch = validHashes.slice(i, i + 200);
        const { data: matched, error: hashErr } = await supabase()
          .from("employees")
          .select("phone_hash")
          .in("phone_hash", batch);

        if (hashErr) throw hashErr;
        for (const row of matched ?? []) {
          if (row.phone_hash) existingPhoneHashes.add(row.phone_hash);
        }
      }
    }
  }

  // 3. Filter employees and deduplicate within incoming batch
  const seenBatchHashes = new Set<string>();
  const toInsert: Record<string, unknown>[] = [];
  let duplicateCount = 0;

  for (const { emp, phone_hash } of incomingWithHash) {
    if (phone_hash && duplicateStrategy === "skip") {
      if (existingPhoneHashes.has(phone_hash) || seenBatchHashes.has(phone_hash)) {
        duplicateCount++;
        continue;
      }
      seenBatchHashes.add(phone_hash);
    }

    const payload: Record<string, unknown> = {
      ...emp,
      status: emp.status ?? "active",
      job_role: emp.job_role || "car-cleaner",
      assigned_admin_user_id: assignedAdminUserId ?? emp.assigned_admin_user_id ?? null,
      phone_hash,
    };

    const sealed = sealFields(payload, ENCRYPTED_EMPLOYEE_FIELDS);
    toInsert.push(sealed);
  }

  // 4. Batch insert into employees in chunks of 100
  const insertedIds: string[] = [];
  const errors: string[] = [];

  for (let i = 0; i < toInsert.length; i += 100) {
    const chunk = toInsert.slice(i, i + 100);
    const { data, error } = await supabase()
      .from("employees")
      .insert(chunk)
      .select("id");

    if (error) {
      errors.push(`Batch insert failed at rows ${i + 1}-${i + chunk.length}: ${error.message}`);
    } else if (data) {
      insertedIds.push(...data.map((r: { id: string }) => r.id));
    }
  }

  return {
    insertedCount: insertedIds.length,
    duplicateCount,
    skippedCount: duplicateCount,
    insertedIds,
    errors,
  };
}
