import { readAllRows } from "./db-pagination";
import "server-only";
import { cache } from "react";
import { supabase } from "./supabase";
import { unseal } from "./crypto";
import { isWebsiteFormLead, isHotLead, isYearLead } from "./leads-shared";
import { getAllAssignedLeadIds } from "./lead-assignments";

// Resolve a pincode → locality name via the pincode_areas lookup table. The
// table is small + stable, so React-cache the full map per-request rather
// than running a query per lead.

const PIN_REGEX = /^\d{6}$/;

interface PincodeAreaRow {
  pincode: string;
  area: string;
}

const DEFAULT_KNOWN_AREAS = [
  "Adambakkam",
  "Adyar",
  "Alwarpet",
  "Ambattur",
  "Ambattur Industrial Estate",
  "Ambattur OT",
  "Aminjikarai",
  "Anna Nagar",
  "Anna Nagar West",
  "Annanagar West Extn",
  "Anna Salai",
  "Arumbakkam",
  "Avadi",
  "Besant Nagar",
  "Chetpet",
  "Choolaimedu",
  "Chromepet",
  "Egmore",
  "George Town",
  "Gopalapuram",
  "Guindy",
  "Injambakkam",
  "Iyyappanthangal",
  "K. K. Nagar",
  "Karapakkam",
  "Keelkattalai",
  "Kelambakkam",
  "Kilpauk",
  "Kodambakkam",
  "Kodambakkam West",
  "Kolathur",
  "Kottivakkam",
  "Kotturpuram",
  "Kovilambakkam",
  "Madhavaram",
  "Madipakkam",
  "Manapakkam",
  "Medavakkam",
  "Meenambakkam",
  "Mogappair",
  "Mogappair East",
  "Moovarasampettai",
  "Mugalivakkam",
  "Mylapore",
  "Nandanam",
  "Nanganallur",
  "Nanmangalam",
  "Navalur",
  "Neelankarai",
  "Nungambakkam",
  "OMR / Padur",
  "Palavakkam",
  "Pallavaram",
  "Pallikaranai",
  "Park Town",
  "Perambur",
  "Periyapalayam",
  "Perumbakkam",
  "Perungudi",
  "Poonamallee",
  "Porur",
  "Puzhuthivakkam",
  "Puzhudhivakkam",
  "Puzhuthivakam",
  "R. A. Puram",
  "Ramapuram",
  "Royapettah",
  "Saidapet",
  "Saligramam",
  "Selaiyur",
  "Semmancheri",
  "Shenoy Nagar",
  "Sholinganallur",
  "Siruseri",
  "Sithalapakkam",
  "St. Thomas Mount",
  "Tambaram",
  "Tambaram East",
  "Tambaram West",
  "Tambaram Sanatorium",
  "Taramani",
  "T. Nagar",
  "Teynampet",
  "Thirumazhisai",
  "Thiruvanmiyur",
  "Thoraipakkam",
  "Thousand Lights",
  "Triplicane",
  "Ullagaram",
  "Vadapalani",
  "Valasaravakkam",
  "Velappanchavadi",
  "Velachery",
  "Virugambakkam",
  "West Mambalam",
];

// Disambiguation patterns: False-positive phrases to ignore or strip before matching
const FALSE_POSITIVE_PHRASES = [
  /adyar\s+anand[bh]a\s+bhavan/gi, // Restaurant chain landmark
  /anna\s+salai/gi, // Highway
  /gst\s+road/gi,
  /velachery\s+tambaram\s+main\s+road/gi, // Inter-locality highway
  /anna\s+nagar\s+(1st|2nd|3rd|4th|5th|6th|7th|8th|9th|\d+th)\s+street/gi,
  /kk\s+nagar\s+(1st|2nd|3rd|4th|5th|6th|7th|8th|9th|\d+th)\s+street/gi,
];

export const CANONICAL_AREA_ALIASES: Record<string, string> = {
  "puzhudhivakkam": "Puzhuthivakkam",
  "puzhuthivakam": "Puzhuthivakkam",
  "puzhuthivakkam": "Puzhuthivakkam",
  "madipakam": "Madipakkam",
  "madipakkam": "Madipakkam",
  "nanganalur": "Nanganallur",
  "nanganallur": "Nanganallur",
  "tnhb velachery": "Velachery",
  "velachery": "Velachery",
  "velacherry": "Velachery",
  "adambakkam": "Adambakkam",
  "adambakam": "Adambakkam",
  "guindy": "Guindy",
  "alandur": "Alandur",
  "alandhur": "Alandur",
  "st. thomas mount": "St. Thomas Mount",
  "st thomas mount": "St. Thomas Mount",
  "parangi malai": "St. Thomas Mount",
  "ullagaram": "Ullagaram",
  "moovarasampettai": "Moovarasampettai",
  "keelkattalai": "Keelkattalai",
  "keelkatalai": "Keelkattalai",
  "porur": "Porur",
  "palavanthangal": "Pazhavanthangal",
  "pazhavanthangal": "Pazhavanthangal",
  "t. nagar": "T. Nagar",
  "t nagar": "T. Nagar",
  "t.nagar": "T. Nagar",
  "k. k. nagar": "K. K. Nagar",
  "kk nagar": "K. K. Nagar",
  "k.k. nagar": "K. K. Nagar",
  "bv nagar": "Nanganallur",
};

let pincodeMapCache: { map: Map<string, string>; expires: number } | null = null;

export async function loadPincodeMap(): Promise<Map<string, string>> {
  const now = Date.now();
  if (pincodeMapCache && pincodeMapCache.expires > now) {
    return pincodeMapCache.map;
  }
  const m = new Map<string, string>();
  try {
    const { data } = await supabase().from("pincode_areas").select("pincode,area");
    for (const r of (data ?? []) as PincodeAreaRow[]) m.set(r.pincode, r.area);
    pincodeMapCache = { map: m, expires: now + 3600_000 };
  } catch {
    // best-effort — unknown pincodes simply don't auto-derive
  }
  return m;
}

export async function areaFromPincode(pincode: string | null | undefined): Promise<string | null> {
  if (!pincode) return null;
  const p = String(pincode).trim();
  if (!PIN_REGEX.test(p)) return null;
  const map = await loadPincodeMap();
  return map.get(p) ?? null;
}

/**
 * Intelligently extract ALL locality / area names found in permanent address text and pincode.
 */
export async function extractAllAreasFromAddress(
  address: string | null | undefined,
  pincode?: string | null | undefined,
): Promise<string[]> {
  const foundAreas = new Set<string>();

  // 1. Direct explicit pincode
  if (pincode) {
    const derived = await areaFromPincode(pincode);
    if (derived) {
      const canonical = CANONICAL_AREA_ALIASES[derived.toLowerCase()] || derived;
      foundAreas.add(canonical);
    }
  }

  if (!address || !address.trim()) {
    return Array.from(foundAreas);
  }

  // 2. Clean address by stripping false-positive landmarks & road names
  let cleanedAddr = address.trim();
  for (const fp of FALSE_POSITIVE_PHRASES) {
    cleanedAddr = cleanedAddr.replace(fp, " ");
  }

  // 3. All 6-digit pincodes in address text
  const pinMatches = cleanedAddr.match(/\b(6\d{5})\b/g);
  if (pinMatches) {
    for (const pin of pinMatches) {
      const derived = await areaFromPincode(pin);
      if (derived) {
        const canonical = CANONICAL_AREA_ALIASES[derived.toLowerCase()] || derived;
        foundAreas.add(canonical);
      }
    }
  }

  // 4. Scan for all known locality names
  const knownAreas = await listKnownAreas();
  const sortedKnown = [
    ...new Set([...knownAreas, ...DEFAULT_KNOWN_AREAS, ...Object.keys(CANONICAL_AREA_ALIASES)]),
  ].sort((a, b) => b.length - a.length);

  const lowerAddr = cleanedAddr.toLowerCase();
  for (const area of sortedKnown) {
    const escaped = area
      .replace(/[+?^${}()|[\]\\]/g, "\\$&")
      .replace(/\./g, "\\.?")
      .replace(/\s+/g, "\\s+");
    const regex = new RegExp(`(^|[^a-zA-Z0-9])${escaped}([^a-zA-Z0-9]|$)`, "i");
    if (regex.test(lowerAddr)) {
      const canonical = CANONICAL_AREA_ALIASES[area.toLowerCase()] || area;
      foundAreas.add(canonical);
    }
  }

  // 5. Comma-separated address segment fallback if no known areas found
  if (foundAreas.size === 0) {
    const parts = cleanedAddr
      .split(/[,;\n]/)
      .map((p) => p.trim())
      .filter(Boolean);
    if (parts.length >= 2) {
      for (let i = parts.length - 1; i >= 0; i--) {
        const part = parts[i];
        if (/^(chennai|tamil nadu|tamilnadu|india|\d{6})$/i.test(part)) continue;
        if (/^(no|flat|plot|door|street|st|rd|road|lane|cross|main)\b/i.test(part) && part.length < 5) continue;
        if (part.length >= 3 && part.length <= 35) {
          const canonical = CANONICAL_AREA_ALIASES[part.toLowerCase()] || part;
          foundAreas.add(canonical);
          break;
        }
      }
    }
  }

  return Array.from(foundAreas);
}

/**
 * Returns the primary locality / area extracted from address.
 */
export async function extractAreaFromAddress(
  address: string | null | undefined,
  pincode?: string | null | undefined,
): Promise<string | null> {
  const all = await extractAllAreasFromAddress(address, pincode);
  return all.length > 0 ? all[0] : null;
}

// Locality Resolution and Cache Layer

/**
 * Resolves each lead to its single, most-accurate primary locality.
 */
export async function resolvePrimaryLocality(
  rawArea: string | null | undefined,
  plainAddress: string | null | undefined,
  pincode?: string | null | undefined,
): Promise<string | null> {
  const areaTrim = (rawArea || "").trim();
  const addrTrim = (plainAddress || "").trim();
  const pinTrim = (pincode || "").trim();

  let cleanedAddr = addrTrim;
  for (const fp of FALSE_POSITIVE_PHRASES) {
    cleanedAddr = cleanedAddr.replace(fp, " ");
  }
  const addrLower = cleanedAddr.toLowerCase();

  // 1. Scan address text for specific sub-localities (e.g. Puzhuthivakkam, Ullagaram, Alandur, Moovarasampettai)
  const knownAreas = await listKnownAreas();
  const sortedKnown = [
    ...new Set([...knownAreas, ...DEFAULT_KNOWN_AREAS, ...Object.keys(CANONICAL_AREA_ALIASES)]),
  ].sort((a, b) => b.length - a.length);

  for (const area of sortedKnown) {
    const escaped = area
      .replace(/[+?^${}()|[\]\\]/g, "\\$&")
      .replace(/\./g, "\\.?")
      .replace(/\s+/g, "\\s+");
    const regex = new RegExp(`(^|[^a-zA-Z0-9])${escaped}([^a-zA-Z0-9]|$)`, "i");
    if (regex.test(addrLower)) {
      return CANONICAL_AREA_ALIASES[area.toLowerCase()] || area;
    }
  }

  // 2. Direct Area column if specified
  if (areaTrim && areaTrim !== "null" && areaTrim !== "Unspecified") {
    const norm = areaTrim.toLowerCase();
    return CANONICAL_AREA_ALIASES[norm] || areaTrim;
  }

  // 3. Pincode lookup
  if (pinTrim) {
    const derived = await areaFromPincode(pinTrim);
    if (derived) {
      return CANONICAL_AREA_ALIASES[derived.toLowerCase()] || derived;
    }
  }

  // 4. Embedded pincode in address text
  const pinMatch = addrTrim.match(/\b(6\d{5})\b/);
  if (pinMatch) {
    const derived = await areaFromPincode(pinMatch[1]);
    if (derived) {
      return CANONICAL_AREA_ALIASES[derived.toLowerCase()] || derived;
    }
  }

  return null;
}

export function extractLeadYear(
  customFields: Record<string, any> | null | undefined,
  createdAt?: string | null,
): string {
  const cf = customFields || {};
  const regDate =
    cf["Reg. Date"] ||
    cf["REG DATE"] ||
    cf["REG. DATE"] ||
    cf["REG_DATE"] ||
    cf["Reg Date"] ||
    cf["reg_date"] ||
    cf["REG.DATE"] ||
    cf["Registration Date"] ||
    cf["DATE"];
  if (regDate) {
    const m = String(regDate).match(/\b(19\d\d|20\d\d)\b/);
    if (m) return m[1];
  }
  const uploadFile = cf["upload_file"] || cf["file_name"] || cf["source_file"];
  if (uploadFile) {
    const m = String(uploadFile).match(/\b(19\d\d|20\d\d)\b/);
    if (m) return m[1];
  }
  if (createdAt) {
    return createdAt.slice(0, 4);
  }
  return "2026";
}

export function isBulkUploadLead(
  customFields?: Record<string, any> | null,
  source?: string | null,
): boolean {
  if (source === "upload" || source === "csv_import") return true;
  if (!customFields) return false;
  const cf = customFields;
  if (cf["upload_file"] || cf["file_name"] || cf["source_file"]) return true;
  if (cf["Reg. Date"] || cf["REG DATE"] || cf["REG. DATE"] || cf["REG_DATE"] || cf["Registration Date"]) return true;
  if (cf["Vehicle Maker"] || cf["Vehicle Model"] || cf["Vehicle Class"] || cf["Owner Name"] || cf["Sale Amount"]) return true;
  return false;
}

export interface LeadLocationSummary {
  id: string;
  primaryLocality: string;
  area: string | null;
  pincode: string | null;
  service?: string | null;
  service_option?: string | null;
  price_total?: number | null;
  status?: string | null;
  source?: string | null;
  created_at?: string | null;
  year?: string;
  isBulkUpload?: boolean;
}

interface LocationIndexCache {
  expires: number;
  leadMap: Map<string, LeadLocationSummary>;
  areaToLeadIds: Map<string, string[]>;
  yearToLeadIds: Map<string, string[]>;
  allLeads: LeadLocationSummary[];
}

let locationIndexCache: LocationIndexCache | null = null;
let inFlightLocationIndexPromise: Promise<LocationIndexCache> | null = null;

export function invalidateAreaCountsCache(): void {
  locationIndexCache = null;
  inFlightLocationIndexPromise = null;
}

export function setLocationIndexCache(cache: LocationIndexCache | null): void {
  locationIndexCache = cache;
  inFlightLocationIndexPromise = null;
}

/**
 * Fast parallel-cached index of all lead locations and registration years with in-flight request de-duplication.
 */
export async function getOrBuildLocationIndex(): Promise<LocationIndexCache> {
  const now = Date.now();
  if (locationIndexCache && locationIndexCache.expires > now) {
    return locationIndexCache;
  }

  if (inFlightLocationIndexPromise) {
    return inFlightLocationIndexPromise;
  }

  inFlightLocationIndexPromise = (async () => {
    try {
      // 1. Get exact total count to fire parallel chunk requests
      const { count, error: countError } = await supabase()
        .from("leads")
        .select("*", { count: "exact", head: true });

      if (countError) throw countError;
      const total = count ?? 0;
      const batchSize = 1000;
      const chunkCount = Math.ceil(total / batchSize);

      const chunkPromises = [];
      for (let i = 0; i < chunkCount; i++) {
        const start = i * batchSize;
        chunkPromises.push(
          supabase()
            .from("leads")
            .select("id, area, address, pincode, service, service_option, price_total, status, source, created_at, custom_fields")
            .range(start, start + batchSize - 1),
        );
      }

      const chunkResults = await Promise.all(chunkPromises);
      const allRows: Array<{
        id: string;
        area: string | null;
        address: string | null;
        pincode: string | null;
        service: string | null;
        service_option?: string | null;
        price_total: number | null;
        status: string | null;
        source: string | null;
        created_at: string | null;
        custom_fields: Record<string, any> | null;
      }> = [];

      for (const res of chunkResults) {
        if (res.error) throw res.error;
        if (res.data) allRows.push(...res.data);
      }

      const leadMap = new Map<string, LeadLocationSummary>();
      const areaToLeadIds = new Map<string, string[]>();
      const yearToLeadIds = new Map<string, string[]>();
      const allLeads: LeadLocationSummary[] = [];

      const [pincodeMap, knownAreas] = await Promise.all([
        loadPincodeMap(),
        listKnownAreas(),
      ]);

      const sortedKnown = [
        ...new Set([...knownAreas, ...DEFAULT_KNOWN_AREAS, ...Object.keys(CANONICAL_AREA_ALIASES)]),
      ].sort((a, b) => b.length - a.length);

      const compiledAreaRegexes = sortedKnown.map((area) => {
        const escaped = area
          .replace(/[+?^${}()|[\]\\]/g, "\\$&")
          .replace(/\./g, "\\.?")
          .replace(/\s+/g, "\\s+");
        return {
          regex: new RegExp(`(^|[^a-zA-Z0-9])${escaped}([^a-zA-Z0-9]|$)`, "i"),
          canonical: CANONICAL_AREA_ALIASES[area.toLowerCase()] || area,
        };
      });

      function resolvePrimaryLocalityFast(
        rawArea: string | null | undefined,
        plainAddress: string | null | undefined,
        pincode: string | null | undefined,
      ): string | null {
        const areaTrim = (rawArea || "").trim();
        const addrTrim = (plainAddress || "").trim();
        const pinTrim = (pincode || "").trim();

        let cleanedAddr = addrTrim;
        for (const fp of FALSE_POSITIVE_PHRASES) {
          cleanedAddr = cleanedAddr.replace(fp, " ");
        }
        const addrLower = cleanedAddr.toLowerCase();

        // 1. Scan address text for specific sub-localities (e.g. Adyar, Besant Nagar, T. Nagar, Porur, Perungudi, etc.)
        for (const item of compiledAreaRegexes) {
          if (item.regex.test(addrLower)) {
            return item.canonical;
          }
        }

        // 2. Direct Area column if specified
        if (areaTrim && areaTrim !== "null" && areaTrim !== "Unspecified" && areaTrim !== "Unknown") {
          const norm = areaTrim.toLowerCase();
          return CANONICAL_AREA_ALIASES[norm] || areaTrim;
        }

        // 3. Pincode lookup
        if (pinTrim && pincodeMap.has(pinTrim)) {
          const derived = pincodeMap.get(pinTrim)!;
          return CANONICAL_AREA_ALIASES[derived.toLowerCase()] || derived;
        }

        // 4. Embedded pincode in address text
        const pinMatch = addrTrim.match(/\b(6\d{5})\b/);
        if (pinMatch && pincodeMap.has(pinMatch[1])) {
          const derived = pincodeMap.get(pinMatch[1])!;
          return CANONICAL_AREA_ALIASES[derived.toLowerCase()] || derived;
        }

        return null;
      }

      for (const r of allRows) {
        const plainAddress = unseal(r.address);
        const primary = resolvePrimaryLocalityFast(r.area, plainAddress, r.pincode);
        const resolved = primary || "Unspecified";
        const norm = resolved.toLowerCase();
        const year = extractLeadYear(r.custom_fields, r.created_at);
        const isBulk = isBulkUploadLead(r.custom_fields, r.source);

        const summary: LeadLocationSummary = {
          id: r.id,
          primaryLocality: resolved,
          area: r.area,
          pincode: r.pincode,
          service: r.service,
          service_option: r.service_option,
          price_total: r.price_total,
          status: r.status,
          source: r.source,
          created_at: r.created_at,
          year,
          isBulkUpload: isBulk,
        };

        leadMap.set(r.id, summary);
        allLeads.push(summary);

        if (resolved !== "Unspecified") {
          if (!areaToLeadIds.has(norm)) {
            areaToLeadIds.set(norm, []);
          }
          areaToLeadIds.get(norm)!.push(r.id);
        }

        if (year && r.source !== "wizard") {
          if (!yearToLeadIds.has(year)) {
            yearToLeadIds.set(year, []);
          }
          yearToLeadIds.get(year)!.push(r.id);
        }
      }

      locationIndexCache = {
        expires: Date.now() + 300000, // 5-minute in-memory TTL
        leadMap,
        areaToLeadIds,
        yearToLeadIds,
        allLeads,
      };

      return locationIndexCache;
    } finally {
      inFlightLocationIndexPromise = null;
    }
  })();

  return inFlightLocationIndexPromise;
}

export async function resolveLeadIdsForYear(year: string): Promise<string[]> {
  const idx = await getOrBuildLocationIndex();
  return idx.yearToLeadIds.get(year.trim()) || [];
}

export interface ListAreasOptions {
  assignedAdminUserId?: string;
  folder?: string;
  year?: string;
  source?: string;
  assignment?: "all" | "unassigned" | "assigned";
}

export interface AreaCountSummary {
  area: string;
  count: number;
  bookedCount: number;
  unassignedCount?: number;
}

/** Distinct areas + lead counts scoped to folder, year, or staff for the filter bar on /admin. */
export async function listAreasWithCounts(
  opts: ListAreasOptions | string = {},
): Promise<AreaCountSummary[]> {
  const options: ListAreasOptions = typeof opts === "string" ? { assignedAdminUserId: opts } : opts;
  const index = await getOrBuildLocationIndex();

  let candidateLeads = index.allLeads;

  // 1. Telecaller scope
  if (options.assignedAdminUserId) {
    const { data: items, error: itemsErr } = await supabase()
      .from("lead_list_items")
      .select("lead_id, lead_lists!inner(assigned_admin_user_id)")
      .eq("lead_lists.assigned_admin_user_id", options.assignedAdminUserId);
    if (itemsErr) throw itemsErr;
    const allowedSet = new Set((items ?? []).map((r: { lead_id: string }) => r.lead_id));
    candidateLeads = candidateLeads.filter((l) => allowedSet.has(l.id));
  }

  // 2. Custom List folder UUID
  if (options.folder && options.folder.match(/^[0-9a-fA-F-]{36}$/)) {
    const listItems = await readAllRows(supabase()
      .from("lead_collection_items")
      .select("lead_id")
      .eq("list_id", options.folder).order("lead_id"));
    const listSet = new Set((listItems ?? []).map((i) => i.lead_id));
    candidateLeads = candidateLeads.filter((l) => listSet.has(l.id));
  }

  // 3. Folder / Source filtering
  if (options.folder === "all_master" || options.folder === "all") {
    // Show all
  } else if (options.folder === "website_form" || options.source === "wizard") {
    candidateLeads = candidateLeads.filter(isWebsiteFormLead);
  } else if (options.folder === "hot_leads" || options.source === "admin") {
    candidateLeads = candidateLeads.filter(isHotLead);
  }

  // 4. Year folder or year filter
  const targetYear = options.folder && options.folder.startsWith("year_")
    ? options.folder.replace("year_", "")
    : options.year && options.year !== "all"
    ? options.year
    : null;

  if (targetYear) {
    candidateLeads = candidateLeads.filter((l) => isYearLead(l, targetYear));
  }

  const assignedSet = await getAllAssignedLeadIds();

  if (options.assignment && options.assignment !== "all") {
    if (options.assignment === "unassigned") {
      candidateLeads = candidateLeads.filter((l) => !assignedSet.has(l.id));
    } else if (options.assignment === "assigned") {
      candidateLeads = candidateLeads.filter((l) => assignedSet.has(l.id));
    }
  }

  const counts = new Map<string, { count: number; bookedCount: number; unassignedCount: number }>();

  for (const lead of candidateLeads) {
    const loc =
      lead.primaryLocality &&
      lead.primaryLocality !== "Unspecified" &&
      lead.primaryLocality !== "Unknown"
        ? lead.primaryLocality
        : "Unspecified / Other";

    const isBooked = lead.status === "booked";
    const isUnassigned = !assignedSet.has(lead.id);
    if (!counts.has(loc)) {
      counts.set(loc, { count: 0, bookedCount: 0, unassignedCount: 0 });
    }
    const stat = counts.get(loc)!;
    stat.count++;
    if (isBooked) stat.bookedCount++;
    if (isUnassigned) stat.unassignedCount++;
  }

  return [...counts.entries()]
    .map(([area, stat]) => ({
      area,
      count: stat.count,
      bookedCount: stat.bookedCount,
      unassignedCount: stat.unassignedCount,
    }))
    .sort((a, b) => {
      if (a.area === "Unspecified / Other") return 1;
      if (b.area === "Unspecified / Other") return -1;
      return b.count - a.count || a.area.localeCompare(b.area);
    });
}

/**
 * Resolves all lead IDs matching an area name across both the area column
 * and the decrypted permanent address text in 0ms via index cache.
 */
export async function resolveLeadIdsForArea(
  area: string,
  allowedLeadIds?: string[] | null,
): Promise<string[]> {
  const normTarget = (CANONICAL_AREA_ALIASES[area.trim().toLowerCase()] || area.trim()).toLowerCase();
  if (!normTarget || normTarget === "all") return [];

  const index = await getOrBuildLocationIndex();
  const ids = index.areaToLeadIds.get(normTarget) ?? [];

  if (allowedLeadIds && allowedLeadIds.length > 0) {
    const allowedSet = new Set(allowedLeadIds);
    return ids.filter((id) => allowedSet.has(id));
  }

  return ids;
}

/** Canonical area list from the lookup table — used for autocomplete suggestions
 *  on the lead form even before any lead has been tagged with that area. */
export async function listKnownAreas(): Promise<string[]> {
  const map = await loadPincodeMap();
  const dbAreas = Array.from(new Set(map.values()));
  return Array.from(new Set([...dbAreas, ...DEFAULT_KNOWN_AREAS])).sort((a, b) => a.localeCompare(b));
}
