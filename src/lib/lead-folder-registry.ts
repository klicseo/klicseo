import "server-only";
import { supabase } from "./supabase";
import { readAllRows } from "./db-pagination";

// Folder visibility is explicit metadata, stored in the existing service-only
// key/value table. Allocation batches share lead_lists but are not folders.
const PREFIX = "lead_custom_folder:";

export async function registerLeadFolders(ids: string[]): Promise<void> {
  if (!ids.length) return;
  const { error } = await supabase().from("app_settings").upsert(
    ids.map((id) => ({ key: `${PREFIX}${id}`, value: "true", updated_at: new Date().toISOString() })),
    { onConflict: "key" },
  );
  if (error) throw error;
}

export async function getManualLeadFolderIds(ids: string[]): Promise<Set<string>> {
  const manual = new Set<string>();
  for (let offset = 0; offset < ids.length; offset += 250) {
    const batch = ids.slice(offset, offset + 250);
    const [settings, creations] = await Promise.all([
      readAllRows(supabase().from("app_settings").select("key, value")
        .in("key", batch.map((id) => `${PREFIX}${id}`)).order("key")),
      // Recover existing manually created folders from their creation records.
      // Allocation/recycle jobs never emit these folder-creation actions.
      readAllRows(supabase().from("audit_logs").select("entity_id")
        .in("entity_id", batch).eq("entity", "lead_lists")
        .eq("action", "create").order("id")),
    ]);
    for (const setting of settings) {
      if (setting.value === "true") manual.add(setting.key.slice(PREFIX.length));
    }
    const recovered = [...new Set(creations.map((row) => row.entity_id).filter((id): id is string => !!id && !manual.has(id)))];
    // Persist recovered identities so audit retention and later renames cannot
    // change which cards belong in the directory. This upgrade is idempotent.
    await registerLeadFolders(recovered);
    for (const id of recovered) manual.add(id);
  }
  return manual;
}
