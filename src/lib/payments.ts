import "server-only";
import { readAllRows } from "./db-pagination";
import { supabase } from "./supabase";
import { seal, unseal } from "./crypto";
import type { PaymentInput, PaymentRow } from "./payments-shared";

export * from "./payments-shared";

const COLS = "id,lead_id,period,amount,advance_amount,status,method,paid_at,notes";

/** Decrypt the `notes` column on a payment row (encrypted at rest). */
function unsealRow(row: PaymentRow): PaymentRow {
  return { ...row, notes: unseal(row.notes) };
}

/** All payment rows for a given month. */
export async function listPeriodPayments(period: string): Promise<PaymentRow[]> {
  const data = await readAllRows(supabase().from("payments").select(COLS).eq("period", period).order("id"));
  return ((data ?? []) as PaymentRow[]).map(unsealRow);
}

/**
 * All payment rows for the given set of customers, regardless of period.
 * Used by the Payments page to compute "how many months unpaid" per row.
 */
export async function listPaymentsForLeads(leadIds: string[]): Promise<PaymentRow[]> {
  if (leadIds.length === 0) return [];
  const data: PaymentRow[] = [];
  for (let offset = 0; offset < leadIds.length; offset += 250) {
    const batch = await readAllRows(supabase().from("payments").select(COLS).in("lead_id", leadIds.slice(offset, offset + 250)).order("id"));
    data.push(...batch as PaymentRow[]);
  }
  return data.map(unsealRow);
}

/** A customer's payment history (newest month first). */
export async function getCustomerPayments(leadId: string): Promise<PaymentRow[]> {
  const { data, error } = await supabase()
    .from("payments")
    .select(COLS)
    .eq("lead_id", leadId)
    .order("period", { ascending: false });
  if (error) throw error;
  return ((data ?? []) as PaymentRow[]).map(unsealRow);
}

/** Create or update the payment for a customer+month. */
export async function upsertPayment(input: PaymentInput): Promise<void> {
  const sealed = { ...input, notes: seal(input.notes), updated_at: new Date().toISOString() };
  const { error } = await supabase().from("payments").upsert(sealed, { onConflict: "lead_id,period" });
  if (error) throw error;
}
