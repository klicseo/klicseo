import "server-only";
import { supabase } from "./supabase";
import { readAllRows } from "./db-pagination";

let assignedLeadIdsCache: { set: Set<string>; expires: number } | null = null;
let inFlightAssignedPromise: Promise<Set<string>> | null = null;
let generation = 0;

export function invalidateAssignedLeadsCache(): void {
  generation++;
  assignedLeadIdsCache = null;
  inFlightAssignedPromise = null;
}

export function setAssignedLeadsCache(set: Set<string>, ttlMs: number = 300000): void {
  invalidateAssignedLeadsCache();
  assignedLeadIdsCache = { set, expires: Date.now() + ttlMs };
}

export function markLeadsAsAssigned(leadIds: string[]): void {
  // A read started before this write must never republish stale membership.
  if (inFlightAssignedPromise) invalidateAssignedLeadsCache();
  if (assignedLeadIdsCache) {
    for (const id of leadIds) assignedLeadIdsCache.set.add(id);
  }
}

/** Complete, ordered membership reads; failures never become an empty pool. */
export async function getAllAssignedLeadIds(options: { fresh?: boolean } = {}): Promise<Set<string>> {
  if (options.fresh && !inFlightAssignedPromise) invalidateAssignedLeadsCache();
  if (assignedLeadIdsCache && assignedLeadIdsCache.expires > Date.now()) return assignedLeadIdsCache.set;
  if (inFlightAssignedPromise) return inFlightAssignedPromise;
  const readGeneration = generation;
  inFlightAssignedPromise = (async () => {
    try {
      const items = await readAllRows(supabase().from("lead_list_items").select("lead_id").order("lead_id"));
      const set = new Set(items.map((item) => item.lead_id));
      if (readGeneration === generation) assignedLeadIdsCache = { set, expires: Date.now() + 300000 };
      return set;
    } finally {
      if (readGeneration === generation) inFlightAssignedPromise = null;
    }
  })();
  return inFlightAssignedPromise;
}
