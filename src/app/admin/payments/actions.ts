"use server";

import { revalidatePath } from "next/cache";
import { assertLeadInScope } from "@/lib/leads";
import { currentAdmin, resolveScope } from "@/lib/admin-auth";
import { upsertPayment, listPeriodPayments, isValidPeriod, PAYMENT_METHODS, type PaymentStatus } from "@/lib/payments";
import { setMessageTemplates, getSiteSettings } from "@/lib/site-settings";
import { MESSAGE_TEMPLATE_DEFS, MESSAGE_TEMPLATE_DEFAULTS, type MessageTemplates } from "@/lib/site-settings-shared";
import { logAudit } from "@/lib/audit";

export async function savePaymentAction(
  _prev: { error?: string; ok?: string },
  formData: FormData,
): Promise<{ error?: string; ok?: string }> {
  try {
    // Payment editing requires both its dedicated permission and lead ownership.
    const me = await currentAdmin();
    if (!me) throw new Error("Unauthorized");
    if (!me.permissions.includes("payments.manage")) {
      throw new Error("Forbidden");
    }

    const lead_id = String(formData.get("lead_id") ?? "");
    const period = String(formData.get("period") ?? "");
    if (!lead_id || !isValidPeriod(period)) return { error: "Bad request." };

    const scope = await resolveScope(me);
    if (!scope) throw new Error("No admin account found.");
    await assertLeadInScope(lead_id, scope);

    const status: PaymentStatus = formData.get("status") === "paid" ? "paid" : "pending";
    const amountRaw = String(formData.get("amount") ?? "").trim();
    const amount = amountRaw === "" ? null : Math.max(0, Math.round(Number(amountRaw)));
    const advanceRaw = String(formData.get("advance") ?? "").trim();
    const advanceParsed = advanceRaw === "" ? 0 : Math.max(0, Math.round(Number(advanceRaw)));
    const advance_amount = Number.isFinite(advanceParsed) ? advanceParsed : 0;
    const methodRaw = String(formData.get("method") ?? "").trim();
    const method = (PAYMENT_METHODS as readonly string[]).includes(methodRaw) ? methodRaw : null;
    const paidRaw = String(formData.get("paid_at") ?? "").trim();
    // Auto-stamp today's date when marking paid with no date entered.
    const paid_at = status === "paid" ? (paidRaw || new Date().toISOString().slice(0, 10)) : (paidRaw || null);
    const notes = String(formData.get("notes") ?? "").trim() || null;

    // Look up the existing payment row (if any) for the audit before-snapshot.
    const existing = (await listPeriodPayments(period)).find((p) => p.lead_id === lead_id) ?? null;
    const beforeSnap = existing
      ? { status: existing.status, amount: existing.amount, advance_amount: existing.advance_amount, method: existing.method, paid_at: existing.paid_at, notes: existing.notes }
      : null;

    await upsertPayment({
      lead_id,
      period,
      amount: amount != null && Number.isFinite(amount) ? amount : null,
      advance_amount,
      status,
      method,
      paid_at,
      notes,
    });

    await logAudit("payment.save", {
      entity: "payment",
      entityId: lead_id,
      summary: `Payment ${period} → ${status}${amount != null ? ` (₹${amount})` : ""}${advance_amount > 0 ? ` + advance ₹${advance_amount}` : ""}`,
      metadata: { period },
      before: beforeSnap,
      after: { status, amount, advance_amount, method, paid_at, notes },
    });
    revalidatePath("/admin/payments");
    revalidatePath(`/admin/${lead_id}`);
    return { ok: status === "paid" ? "Marked paid" : "Saved" };
  } catch (err) {
    return { error: err instanceof Error ? err.message : "Couldn’t save." };
  }
}

// Admin-only: edit the WhatsApp message templates used by Payment rows.
export async function saveMessageTemplatesAction(
  _prev: { error?: string; ok?: string },
  formData: FormData,
): Promise<{ error?: string; ok?: string }> {
  try {
    const me = await currentAdmin();
    if (!me) throw new Error("Unauthorized");
    if (me.role !== "super_admin" && me.role !== "admin") throw new Error("Forbidden");

    // Snapshot the current templates before writing so the audit log carries
    // the precise old → new text per template.
    const before = (await getSiteSettings()).messageTemplates;

    const next: MessageTemplates = { ...MESSAGE_TEMPLATE_DEFAULTS };
    for (const def of MESSAGE_TEMPLATE_DEFS) {
      const raw = String(formData.get(`tpl_${def.key}`) ?? "").trim();
      next[def.key] = raw || MESSAGE_TEMPLATE_DEFAULTS[def.key];
    }
    await setMessageTemplates(next);

    // Use template keys (paymentReminder, paymentThanks) as the diff field
    // names so the audit log table renders them via humaniseField.
    await logAudit("settings.message_templates", {
      entity: "settings",
      summary: "Updated WhatsApp message templates",
      before: before as unknown as Record<string, unknown>,
      after: next as unknown as Record<string, unknown>,
    });
    // Layout-level revalidate so the polled SiteSettingsContext picks it up.
    revalidatePath("/", "layout");
    revalidatePath("/admin/payments");
    return { ok: "Saved." };
  } catch (err) {
    return { error: err instanceof Error ? err.message : "Couldn’t save." };
  }
}
