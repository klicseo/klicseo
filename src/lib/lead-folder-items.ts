import "server-only";
import { supabase } from "./supabase";
import { readAllRows } from "./db-pagination";

/** Folder organization and staff assignment are independent memberships. */
export async function moveLeadsToCustomFolder(listId: string, leadIds: string[]): Promise<void> {
  if (!leadIds.length) return;
  const { error } = await supabase().from("lead_folder_items").upsert(
    [...new Set(leadIds)].map((lead_id) => ({ list_id: listId, lead_id, added_at: new Date().toISOString() })),
    { onConflict: "lead_id" },
  );
  if (error) throw error;
}

export async function removeLeadFromCustomFolder(listId: string, leadId: string): Promise<void> {
  const { error } = await supabase().from("lead_folder_items").delete().eq("list_id", listId).eq("lead_id", leadId);
  if (error) throw error;
}

export async function isCustomLeadFolder(listId: string): Promise<boolean> {
  const { data, error } = await supabase().from("lead_lists").select("is_custom_folder").eq("id", listId).maybeSingle();
  if (error) throw error;
  if (!data) throw new Error("Destination list no longer exists.");
  return data.is_custom_folder === true;
}

/** Unknown custom sources produce an empty pool, never a global allocation. */
export async function allocationFolderLeadIds(folder?: string | null): Promise<Set<string> | null> {
  if (!folder || ["all", "all_master", "website_form", "hot_leads"].includes(folder) || folder.startsWith("year_")) return null;
  if (!/^[0-9a-fA-F-]{36}$/.test(folder)) return new Set();
  const rows = await readAllRows(supabase().from("lead_folder_items").select("lead_id").eq("list_id", folder).order("lead_id"));
  return new Set(rows.map((row) => row.lead_id));
}
