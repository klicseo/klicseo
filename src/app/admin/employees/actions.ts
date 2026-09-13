"use server";

import { resolveListOwner } from "@/lib/lead-access";
import { randomUUID } from "crypto";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requirePermission, resolveScope } from "@/lib/admin-auth";
import { supabase } from "@/lib/supabase";
import {
  BUCKET,
  deleteEmployee,
  insertEmployee,
  updateEmployee,
  updateEmployeeStatus,
  getEmployee,
  assertEmployeeInScope,
  type EmployeeStatus,
  type EmployeeUpdate,
  type NewEmployee,
} from "@/lib/employees";
import { logAudit } from "@/lib/audit";

export async function setEmployeeStatusAction(formData: FormData) {
  const me = await requirePermission("employees.manage");
  const id = String(formData.get("id") ?? "");
  const status = String(formData.get("status") ?? "") as EmployeeStatus;
  if (!id || !status) return;

  const scope = (await resolveScope(me)) ?? { kind: "all" as const };
  await assertEmployeeInScope(id, scope);

  await updateEmployeeStatus(id, status);
  await logAudit("employee.status", { entity: "employee", entityId: id, summary: `Set employee status → ${status}` });
  revalidatePath("/admin/my-employees");
  revalidatePath("/admin/employees");
  revalidatePath(`/admin/employees/${id}`);
}

export async function deleteEmployeeAction(formData: FormData) {
  const me = await requirePermission("employees.manage");
  if (me.role !== "super_admin" && me.role !== "admin") {
    throw new Error("Forbidden: Only administrators can delete employees.");
  }
  const id = String(formData.get("id") ?? "");
  if (!id) return;
  const scope = await resolveScope(me);
  if (!scope) throw new Error("No admin account found.");
  await assertEmployeeInScope(id, scope);
  await deleteEmployee(id);
  await logAudit("employee.delete", { entity: "employee", entityId: id, summary: "Deleted employee" });
  revalidatePath("/admin/my-employees");
  revalidatePath("/admin/employees");
  redirect("/admin/employees");
}

function readCommonFields(formData: FormData) {
  const role = String(formData.get("job_role") ?? "").trim();
  if (!role) throw new Error("Job role is required.");

  const salaryRaw = String(formData.get("salary") ?? "").trim();
  const salary = salaryRaw === "" ? null : Number(salaryRaw);

  return {
    job_role: role,
    name: String(formData.get("name") ?? "").trim(),
    phone: String(formData.get("phone") ?? "").trim(),
    location: String(formData.get("location") ?? "").trim() || null,
    aadhaar_number: String(formData.get("aadhaar_number") ?? "").trim() || null,
    assigned_admin_user_id: String(formData.get("assigned_admin_user_id") ?? "").trim() || null,
    salary: salary != null && Number.isFinite(salary) ? salary : null,
    reminder_call_date: String(formData.get("reminder_call_date") ?? "") || null,
    joining_date: String(formData.get("joining_date") ?? "") || null,
    resignation_date: String(formData.get("resignation_date") ?? "") || null,
    notes: String(formData.get("notes") ?? "") || null,
  };
}

async function uploadIfPresent(
  applicantId: string,
  kind: string,
  formData: FormData,
  fieldName: string,
): Promise<string | null> {
  const f = formData.get(fieldName);
  if (!(f instanceof File) || f.size === 0) return null;
  const ext = extFromMime(f.type) || extFromName(f.name) || "bin";
  const path = `${applicantId}/${kind}.${ext}`;
  const buf = Buffer.from(await f.arrayBuffer());
  const { error } = await supabase()
    .storage.from(BUCKET)
    .upload(path, buf, { contentType: f.type || "application/octet-stream", upsert: true });
  if (error) throw error;
  return path;
}

function extFromMime(mime: string): string | null {
  if (mime === "image/png") return "png";
  if (mime === "image/jpeg") return "jpg";
  if (mime === "image/webp") return "webp";
  if (mime === "application/pdf") return "pdf";
  return null;
}
function extFromName(name: string): string | null {
  const m = /\.([a-zA-Z0-9]+)$/.exec(name);
  return m ? m[1].toLowerCase() : null;
}

function validate(name: string, phone: string): string | null {
  if (!name) return "Name is required.";
  if (!phone || phone.length < 8) return "Phone (min 8 digits) is required.";
  return null;
}

export async function createEmployeeAction(_prev: { error?: string }, formData: FormData) {
  const me = await requirePermission("employees.manage");
  const data = readCommonFields(formData);
  data.assigned_admin_user_id = await resolveListOwner(me, data.assigned_admin_user_id);
  const err = validate(data.name, data.phone);
  if (err) return { error: err };

  const applicantId = randomUUID();
  const aadhaar_photo_path = await uploadIfPresent(applicantId, "aadhaar", formData, "aadhaar_photo");
  const profile_photo_path = await uploadIfPresent(applicantId, "profile", formData, "profile_photo");

  const emp = await insertEmployee({
    ...data,
    aadhaar_photo_path,
    profile_photo_path,
    signature_path: null,
    terms_accepted_at: null,
  });

  await logAudit("employee.create", { entity: "employee", entityId: emp.id, summary: `Added employee ${data.name}` });
  revalidatePath("/admin/my-employees");
  revalidatePath("/admin/employees");
  redirect("/admin/employees");
}

export async function updateEmployeeAction(_prev: { error?: string }, formData: FormData) {
  const me = await requirePermission("employees.manage");
  const id = String(formData.get("id") ?? "");
  if (!id) return { error: "Missing employee id." };

  const scope = (await resolveScope(me)) ?? { kind: "all" as const };
  await assertEmployeeInScope(id, scope);

  const data = readCommonFields(formData);
  const err = validate(data.name, data.phone);
  if (err) return { error: err };

  data.assigned_admin_user_id = await resolveListOwner(me, data.assigned_admin_user_id);
  const patch: EmployeeUpdate = { ...data };

  // Re-uploaded files replace the old path; an empty file input leaves the
  // existing path untouched. Storage objects are upserted in place when the
  // same applicant folder is reused; on admin-created rows we mint a folder
  // from the row id to keep paths stable.
  const aadhaar = await uploadIfPresent(id, "aadhaar", formData, "aadhaar_photo");
  const profile = await uploadIfPresent(id, "profile", formData, "profile_photo");
  if (aadhaar) patch.aadhaar_photo_path = aadhaar;
  if (profile) patch.profile_photo_path = profile;

  const before = await getEmployee(id);
  await updateEmployee(id, patch);
  const after = await getEmployee(id);

  await logAudit("employee.update", {
    entity: "employee",
    entityId: id,
    summary: `Edited employee ${data.name}`,
    before: before ? (before as unknown as Record<string, unknown>) : null,
    after: after ? (after as unknown as Record<string, unknown>) : null,
  });
  revalidatePath("/admin/my-employees");
  revalidatePath("/admin/employees");
  revalidatePath(`/admin/employees/${id}`);
  redirect(`/admin/employees/${id}`);
}

export async function assignEmployeesAction(formData: FormData): Promise<{ error?: string }> {
  const me = await requirePermission("employees.manage");
  if (me.role !== "super_admin") {
    return { error: "Forbidden: Only the super admin can reassign employees." };
  }
  const adminUserId = String(formData.get("adminUserId") ?? "").trim() || null;
  const ids = formData.getAll("employeeIds").map((v) => String(v));
  if (!adminUserId) return { error: "Choose a team member to assign to." };
  if (!ids || ids.length === 0) return { error: "Select at least one employee." };

  await resolveListOwner(me, adminUserId);

  // Bulk update via supabase helper
  const { error } = await supabase()
    .from("employees")
    .update({ assigned_admin_user_id: adminUserId })
    .in("id", ids as string[]);
  if (error) return { error: error.message };

  for (const id of ids) {
    await logAudit("employee.assign", { entity: "employee", entityId: id, summary: `Assigned employee to admin ${adminUserId}` });
  }
  revalidatePath("/admin/my-employees");
  revalidatePath("/admin/employees");
  return { error: undefined };
}

export interface BulkImportEmployeesPayload {
  employees: {
    name: string;
    phone: string;
    job_role?: string;
    status?: EmployeeStatus;
    location?: string | null;
    salary?: number | null;
    joining_date?: string | null;
    aadhaar_number?: string | null;
    notes?: string | null;
  }[];
  defaultStatus?: EmployeeStatus;
  defaultJobRole?: string;
  assignedAdminUserId?: string | null;
  duplicateStrategy?: "skip" | "allow";
  sourceFileName?: string;
}

export interface BulkImportEmployeesActionResult {
  ok: boolean;
  insertedCount: number;
  duplicateCount: number;
  skippedCount: number;
  error?: string;
}

/**
 * Server action to bulk import employee rows from parsed spreadsheets.
 */
export async function bulkImportEmployeesAction(
  payload: BulkImportEmployeesPayload,
): Promise<BulkImportEmployeesActionResult> {
  const me = await requirePermission("employees.manage");
  const assignedAdminUserId = await resolveListOwner(me, payload.assignedAdminUserId);

  if (!payload.employees || !payload.employees.length) {
    return {
      ok: false,
      insertedCount: 0,
      duplicateCount: 0,
      skippedCount: 0,
      error: "No employee rows provided for import.",
    };
  }

  const { bulkInsertEmployees } = await import("@/lib/employees");

  const employeesToInsert: NewEmployee[] = payload.employees.map((e) => ({
    name: e.name,
    phone: e.phone,
    job_role: e.job_role || payload.defaultJobRole || "car-cleaner",
    status: e.status || payload.defaultStatus || "active",
    location: e.location || null,
    salary: e.salary ?? null,
    joining_date: e.joining_date || null,
    aadhaar_number: e.aadhaar_number || null,
    aadhaar_photo_path: null,
    profile_photo_path: null,
    signature_path: null,
    terms_accepted_at: null,
    reminder_call_date: null,
    resignation_date: null,
    assigned_admin_user_id: assignedAdminUserId,
    notes: e.notes || (payload.sourceFileName ? `Imported from ${payload.sourceFileName}` : "Bulk uploaded via spreadsheet"),
  }));

  const result = await bulkInsertEmployees(employeesToInsert, {
    duplicateStrategy: payload.duplicateStrategy ?? "skip",
    assignedAdminUserId: assignedAdminUserId ?? undefined,
  });

  const summary = `Bulk imported ${result.insertedCount} employee${
    result.insertedCount === 1 ? "" : "s"
  }${
    result.duplicateCount > 0
      ? ` (${result.duplicateCount} duplicates skipped)`
      : ""
  }${payload.sourceFileName ? ` from ${payload.sourceFileName}` : ""}`;

  await logAudit("employee.bulk_import", {
    entity: "employee",
    summary,
    metadata: {
      insertedCount: result.insertedCount,
      duplicateCount: result.duplicateCount,
      fileName: payload.sourceFileName,
      assignedAdminUserId: assignedAdminUserId ?? undefined,
    },
  });

  revalidatePath("/admin/my-employees");
  revalidatePath("/admin/employees");
  revalidatePath("/admin/my-employees");

  return {
    ok: result.insertedCount > 0 || result.duplicateCount > 0,
    insertedCount: result.insertedCount,
    duplicateCount: result.duplicateCount,
    skippedCount: result.skippedCount,
    error: result.errors.length > 0 ? result.errors.join("; ") : undefined,
  };
}
