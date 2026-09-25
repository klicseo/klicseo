import "server-only";
import { cache } from "react";
import { supabase } from "./supabase";
import { unsealFields } from "./crypto";
import { matchesLeadSearch } from "./lead-search-shared";
import { isHotLead } from "./leads-shared";
import type { LeadRow, ListLeadsOptions } from "./leads";
import type { LeadLocationInput } from "./area";

/** Temporary rollback switch; migration 0045 must precede application deployment. */
export function databaseLeadReadsEnabled(): boolean {
  return process.env.LEAD_DATABASE_READS !== "false";
}

let metadataRefresh: Promise<void> | null = null;
export async function ensureLeadQueryMetadata(): Promise<void> {
  if (metadataRefresh) return metadataRefresh;
  metadataRefresh = (async () => {
    const { deriveLeadLocations } = await import("./area");
    // Only new/changed rows need decryption. The partial index makes an empty check cheap.
    for (;;) {
      const { data, error } = await supabase().rpc("lead_query_metadata_pending", { p_limit: 500 });
      if (error) throw error;
      const rows = data as (LeadLocationInput & { fingerprint: string })[];
      if (!rows?.length) break;
      const derived = await deriveLeadLocations(rows, true);
      const { error: saveError } = await supabase().rpc("save_lead_query_metadata", {
        p_rows: derived.map((lead, index) => ({
          id: lead.id, fingerprint: rows[index].fingerprint, locality: lead.primaryLocality,
          year: lead.year, bulk: lead.isBulkUpload,
          kind: lead.source === "wizard" ? "website_form" : isHotLead(lead) ? "hot_leads" : "year",
        })),
      });
      if (saveError) throw saveError;
    }
  })().finally(() => { metadataRefresh = null; });
  return metadataRefresh;
}

export async function queryLeadDatabase<T>(mode: string, filter: object, limit = 50, offset = 0): Promise<T> {
  const started = Date.now();
  if (mode !== "listStats") await ensureLeadQueryMetadata();
  const { data, error } = await supabase().rpc("admin_lead_query", {
    p_mode: mode, p_filter: filter, p_limit: limit, p_offset: offset,
  });
  if (error) throw error;
  const durationMs = Date.now() - started;
  if (process.env.LEAD_QUERY_TIMING === "true" || durationMs > 1000) {
    // No filters, search terms, or customer data in performance logs.
    console.info("lead_query", { mode, durationMs });
  }
  return data as T;
}

export function decodeQueryLead(row: LeadRow & { query_locality?: string; query_year?: string; query_bulk?: boolean; query_kind?: string; query_ready?: boolean }): LeadRow {
  const { query_locality, query_year, query_bulk, ...lead } = row;
  delete lead.query_kind;
  delete lead.query_ready;
  return {
    ...unsealFields(lead, ["phone", "car_number", "address", "map_link", "gate_access_notes", "notes"])!,
    primaryLocality: query_locality, year: query_year, isBulkUpload: query_bulk,
  };
}

/** Encrypted substring matching stays server-side, after SQL has narrowed the scope. */
const matchSearch = cache(async (key: string): Promise<string[]> => {
  const options: ListLeadsOptions = JSON.parse(key);
  const ids: string[] = [];
  let afterId: string | undefined;
  for (;;) {
    const rows = await queryLeadDatabase<LeadRow[]>("search", { ...options, status: undefined, assignment: undefined, afterId }, 500);
    for (const row of rows) if (matchesLeadSearch(decodeQueryLead(row), options.search!)) ids.push(row.id);
    if (rows.length < 500) break;
    afterId = rows[rows.length - 1].id;
  }
  return ids;
});

export async function queryMatchingLeadIds(options: ListLeadsOptions): Promise<string[] | undefined> {
  if (!options.search?.trim()) return undefined;
  // Page and KPI calls in the same request share the encrypted search scan.
  const excluded = new Set(["page", "pageSize", "limit", "offset", "status", "assignment"]);
  const filters = Object.fromEntries(Object.entries(options).filter(([key]) => !excluded.has(key)));
  return matchSearch(JSON.stringify(Object.fromEntries(Object.entries(filters).sort(([a], [b]) => a.localeCompare(b)))));
}
