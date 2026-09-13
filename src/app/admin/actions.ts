"use server";

import { after } from "next/server";
import { DEFAULT_LEAD_STATUS_ITEMS } from "@/lib/site-settings-shared";
import { getSiteSettings } from "@/lib/site-settings";
import { assertListAccess, resolveListOwner } from "@/lib/lead-access";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requirePermission, currentAdmin, resolveScope } from "@/lib/admin-auth";
import { getAdminUser } from "@/lib/admin-users";
import { addLeadsToList, insertLeadList } from "@/lib/leadLists";
import { supabase } from "@/lib/supabase";
import {
  deleteLead,
  insertLead,
  updateLead,
  updateLeadStatus,
  getLead,
  assertLeadInScope,
  type LeadStatus,
  type LeadUpdate,
  type NewLead,
} from "@/lib/leads";
import { priceFor, type ServiceDiscounts } from "@/lib/pricing";
import { getServiceDiscounts } from "@/lib/discounts";
import { logAudit } from "@/lib/audit";

import { processQueueAutoRefills } from "@/lib/lead-routing";

export async function setStatusAction(formData: FormData) {
  const me = await requirePermission("leads.manage");
  const id = String(formData.get("id") ?? "");
  const status = String(formData.get("status") ?? "") as LeadStatus;
  if (!id || !status) return;

  const scope = (await resolveScope(me)) ?? { kind: "all" as const };
  await assertLeadInScope(id, scope);

  const settings = await getSiteSettings();
  if (!(settings.leadStatuses ?? DEFAULT_LEAD_STATUS_ITEMS).some((item) => item.id === status)) throw new Error("Invalid lead status.");
  const before = await getLead(id);
  if (before?.status === status) return;
  await updateLeadStatus(id, status);
  await logAudit("lead.status", {
    entity: "lead",
    entityId: id,
    summary: `Set lead status → ${status}`,
    metadata: { status },
  });
  
  // Trigger Serverless Queue Auto-Refill in the background without blocking the UI response
  after(() => processQueueAutoRefills().then(() => undefined));

  revalidatePath("/admin");
  revalidatePath(`/admin/${id}`);
  revalidatePath("/admin/lists");
  revalidatePath("/admin/my-lists");
  revalidatePath("/admin/reports");
}

export async function deleteLeadAction(formData: FormData) {
  const me = await requirePermission("leads.manage");
  if (me.role !== "super_admin" && me.role !== "admin") {
    throw new Error("Forbidden: Only administrators can delete leads.");
  }
  const id = String(formData.get("id") ?? "");
  const returnTo = String(formData.get("returnTo") ?? "");
  if (!id) return;
  const scope = await resolveScope(me);
  if (!scope) throw new Error("No admin account found.");
  await assertLeadInScope(id, scope);
  await deleteLead(id);
  await logAudit("lead.delete", { entity: "lead", entityId: id, summary: "Deleted lead" });
  revalidatePath("/admin");
  revalidatePath("/admin/lists");
  revalidatePath("/admin/my-lists");
  const target = returnTo && returnTo.startsWith("/admin") ? returnTo : "/admin";
  redirect(target);
}

export async function updateLeadNotesAction(formData: FormData) {
  const me = await requirePermission("leads.manage");
  const id = String(formData.get("id") ?? "");
  const notes = String(formData.get("notes") ?? "");
  if (!id) return;

  const scope = (await resolveScope(me)) ?? { kind: "all" as const };
  await assertLeadInScope(id, scope);

  // Route through updateLead so the notes field is encrypted by the lib.
  await updateLead(id, { notes: notes || null });
  await logAudit("lead.notes", { entity: "lead", entityId: id, summary: "Updated lead notes" });
  revalidatePath("/admin");
  revalidatePath(`/admin/${id}`);
}

export const updateNotesAction = updateLeadNotesAction;

// Build the lead payload shared between create and update. The price override
// input is only applied when the user didn't pick a service+option combo we can
// auto-price; on edit, a blank field means "clear the override".
function readLeadFromForm(
  formData: FormData,
  serviceDiscounts: ServiceDiscounts,
): Omit<NewLead, "source" | "gate_access_consent" | "latitude" | "longitude" | "custom_fields"> {
  const service = (String(formData.get("service") ?? "") || null) as any;
  const service_option = (String(formData.get("service_option") ?? "") || null) as any;
  const interior_add_on = formData.get("interior_add_on") === "true" || formData.get("interior_add_on") === "on";
  const vehicle_type = (String(formData.get("vehicle_type") ?? "") || null) as any;
  const parking_location = (String(formData.get("parking_location") ?? "") || null) as any;

  const priced =
    service_option && vehicle_type
      ? priceFor(
          service_option,
          vehicle_type,
          interior_add_on,
          (parking_location as "" | "inside" | "outside") || "",
          serviceDiscounts,
        )
      : null;

  const overrideStr = String(formData.get("price_total") ?? "").trim();
  const override = overrideStr ? Number(overrideStr) : null;

  return {
    name: String(formData.get("name") ?? "").trim() || null,
    phone: String(formData.get("phone") ?? "").trim() || null,
    service,
    service_option,
    interior_add_on,
    vehicle_type,
    car_brand: String(formData.get("car_brand") ?? "") || null,
    car_model: String(formData.get("car_model") ?? "") || null,
    car_number: String(formData.get("car_number") ?? "") || null,
    pincode: String(formData.get("pincode") ?? "") || null,
    // Empty string → null so insertLead/updateLead auto-derive from pincode.
    area: String(formData.get("area") ?? "").trim() || null,
    address: String(formData.get("address") ?? "") || null,
    map_link: String(formData.get("map_link") ?? "").trim() || null,
    parking_location,
    car_cover_choice: String(formData.get("car_cover_choice") ?? "") || null,
    gate_access_notes: String(formData.get("gate_access_notes") ?? "").trim() || null,
    shift: String(formData.get("shift") ?? "") || null,
    callback_date: String(formData.get("callback_date") ?? "") || null,
    callback_time: String(formData.get("callback_time") ?? "") || null,
    price_total: (override != null && Number.isFinite(override) ? override : null) ?? priced?.discountedTotal ?? null,
    discount_percent: priced?.basePercent ?? null,
    notes: String(formData.get("notes") ?? "") || null,
    status: (String(formData.get("status") ?? "") || "new") as LeadStatus,
    add_on_labels: null,
  };
}

export async function createLeadAction(
  _prev: { error?: string },
  formData: FormData,
): Promise<{ error?: string }> {
  const me = await requirePermission("leads.manage");
  const selectedListId = String(formData.get("list_id") ?? "").trim();
  if (selectedListId) await assertListAccess(me, selectedListId);
  const data = readLeadFromForm(formData, await getServiceDiscounts());

  const lead = await insertLead({
    source: "admin",
    ...data,
    gate_access_consent: false,
    latitude: null,
    longitude: null,
    custom_fields: null,
  });

  const admin = await currentAdmin();
  const adminRow = admin?.email ? await getAdminUser(admin.email) : null;
  const listIdFromForm = String(formData.get("list_id") ?? "").trim();

  let targetListId = listIdFromForm || null;

  // If no list explicitly selected, auto-link to staff's list
  if (!targetListId && adminRow?.id) {
    const { data: staffLists } = await supabase()
      .from("lead_lists")
      .select("id, name")
      .eq("assigned_admin_user_id", adminRow.id)
      .order("created_at", { ascending: false })
      .limit(1);

    if (staffLists && staffLists.length > 0) {
      targetListId = staffLists[0].id;
    } else {
      // Auto-create an inbound list for the staff so the lead appears immediately in their view
      const staffName = adminRow.employees?.name || adminRow.email.split("@")[0];
      const newList = await insertLeadList({
        name: `Inbound Leads - ${staffName}`,
        assigned_admin_user_id: adminRow.id,
      });
      targetListId = newList.id;
    }
  }

  if (targetListId) {
    await addLeadsToList(targetListId, [lead.id]);
    revalidatePath(`/admin/lists/${targetListId}`);
  }

  await logAudit("lead.create", {
    entity: "lead",
    entityId: lead.id,
    summary: `Created lead ${data.name ?? ""}`.trim(),
    metadata: { targetListId },
  });

  revalidatePath("/admin");
  revalidatePath("/admin/my-lists");
  revalidatePath("/admin/lists");
  redirect("/admin");
}

export async function updateLeadAction(_prev: { error?: string }, formData: FormData) {
  const me = await requirePermission("leads.manage");
  const id = String(formData.get("id") ?? "");
  const returnTo = String(formData.get("returnTo") ?? "");
  if (!id) return { error: "Missing lead id." };

  const scope = (await resolveScope(me)) ?? { kind: "all" as const };
  await assertLeadInScope(id, scope);

  const data = readLeadFromForm(formData, await getServiceDiscounts());
  // Snapshot before/after so the audit log carries the field-level diff.
  const before = await getLead(id);
  await updateLead(id, data as LeadUpdate);
  const after = await getLead(id);

  await logAudit("lead.update", {
    entity: "lead",
    entityId: id,
    summary: `Edited lead ${data.name ?? before?.name ?? ""}`.trim(),
    before: before ? (before as unknown as Record<string, unknown>) : null,
    after: after ? (after as unknown as Record<string, unknown>) : null,
  });
  revalidatePath("/admin");
  revalidatePath(`/admin/${id}`);
  revalidatePath("/admin/lists");
  revalidatePath("/admin/my-lists");
  const target = `/admin/${id}${returnTo ? `?returnTo=${encodeURIComponent(returnTo)}` : ""}`;
  redirect(target);
}

export interface BulkImportActionPayload {
  leads: Array<{
    name: string | null;
    phone: string | null;
    car_number: string | null;
    car_brand: string | null;
    car_model: string | null;
    vehicle_type: string | null;
    address: string | null;
    pincode: string | null;
    custom_fields: Record<string, string> | null;
  }>;
  targetListId?: string | null;
  newListName?: string | null;
  assignedAdminUserId?: string | null;
  defaultStatus?: LeadStatus;
  duplicateStrategy?: "skip" | "update" | "allow";
  sourceFileName?: string;
}

export interface BulkImportActionResult {
  success: boolean;
  total: number;
  inserted: number;
  updated: number;
  skipped: number;
  listId: string | null;
  listName: string | null;
  errors: string[];
  error?: string;
}

export async function bulkImportLeadsAction(
  payload: BulkImportActionPayload,
): Promise<BulkImportActionResult> {
  const me = await requirePermission("leads.manage");

  if (!payload || !Array.isArray(payload.leads) || payload.leads.length === 0) {
    return {
      success: false,
      total: 0,
      inserted: 0,
      updated: 0,
      skipped: 0,
      listId: null,
      listName: null,
      errors: ["No valid lead rows provided for import."],
      error: "No leads to import.",
    };
  }

  const adminRow = me.email ? await getAdminUser(me.email) : null;
  // If caller is staff, force assignedAdminUserId = adminRow.id
  const effectiveAssignedUserId = await resolveListOwner(me, payload.assignedAdminUserId);
  if (payload.targetListId) await assertListAccess(me, payload.targetListId);

  let finalTargetListId: string | null = payload.targetListId || null;
  let finalListName: string | null = null;

  // 1. Create a new lead list if requested
  if (payload.newListName?.trim() || (!finalTargetListId && effectiveAssignedUserId)) {
    try {
      const { insertLeadList } = await import("@/lib/leadLists");
      const listRow = await insertLeadList({
        name: payload.newListName?.trim() || `Imported Leads - ${new Date().toLocaleDateString("en-IN")}`,
        assigned_admin_user_id: effectiveAssignedUserId,
      });
      finalTargetListId = listRow.id;
      finalListName = listRow.name;
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      return {
        success: false,
        total: payload.leads.length,
        inserted: 0,
        updated: 0,
        skipped: 0,
        listId: null,
        listName: null,
        errors: [`Failed to create new lead list: ${msg}`],
        error: `Failed to create lead list: ${msg}`,
      };
    }
  }

  // 2. Prepare NewLead objects
  const leadsToInsert: NewLead[] = payload.leads.map((l) => ({
    name: l.name || null,
    phone: l.phone || null,
    car_number: l.car_number || null,
    car_brand: l.car_brand || null,
    car_model: l.car_model || null,
    vehicle_type: l.vehicle_type || null,
    address: l.address || null,
    pincode: l.pincode || null,
    area: null, // auto-derived in bulkInsertLeads
    custom_fields: {
      ...(l.custom_fields || {}),
      upload_file: payload.sourceFileName || "Spreadsheet Upload",
    },
    status: payload.defaultStatus || "new",
    source: "upload",
    service: null,
    service_option: null,
    interior_add_on: false,
    add_on_labels: null,
    map_link: null,
    parking_location: null,
    car_cover_choice: null,
    gate_access_consent: false,
    gate_access_notes: null,
    shift: null,
    callback_date: null,
    callback_time: null,
    latitude: null,
    longitude: null,
    price_total: null,
    discount_percent: null,
    notes: payload.sourceFileName ? `Imported from ${payload.sourceFileName}` : "Bulk uploaded via spreadsheet",
  }));

  // 3. Execute bulk insert
  const { bulkInsertLeads } = await import("@/lib/leads");
  const result = await bulkInsertLeads(leadsToInsert, {
    duplicateStrategy: payload.duplicateStrategy || "skip",
    listId: finalTargetListId,
    scope: (await resolveScope(me)) ?? undefined,
  });

  // 4. Audit trail
  const summaryText = `Bulk import: ${result.inserted} added, ${result.updated} updated, ${result.skipped} skipped${
    finalListName ? ` into list "${finalListName}"` : ""
  }${payload.sourceFileName ? ` from ${payload.sourceFileName}` : ""}`;

  await logAudit("lead.bulk_upload", {
    entity: "lead",
    summary: summaryText,
    metadata: {
      total: result.total,
      inserted: result.inserted,
      updated: result.updated,
      skipped: result.skipped,
      listId: finalTargetListId,
      listName: finalListName,
      fileName: payload.sourceFileName,
      duplicateStrategy: payload.duplicateStrategy,
    },
  });

  revalidatePath("/admin");
  revalidatePath("/admin/lists");
  if (finalTargetListId) {
    revalidatePath(`/admin/lists/${finalTargetListId}`);
    revalidatePath("/admin/my-lists");
  }

  return {
    success: result.errors.length === 0 || result.inserted > 0 || result.updated > 0,
    total: result.total,
    inserted: result.inserted,
    updated: result.updated,
    skipped: result.skipped,
    listId: finalTargetListId,
    listName: finalListName,
    errors: result.errors,
  };
}

