import { afterEach, beforeEach, expect, it, vi } from "vitest";
const { rpc, derive, legacyIndex } = vi.hoisted(() => ({ rpc: vi.fn(), derive: vi.fn(), legacyIndex: vi.fn() }));
vi.mock("../supabase", () => ({ supabase: () => ({ rpc }) }));
vi.mock("../area", () => ({ deriveLeadLocations: derive, getOrBuildLocationIndex: legacyIndex }));
import { ensureLeadQueryMetadata, queryLeadDatabase, queryMatchingLeadIds } from "../lead-query";
import { listPaginatedLeads, listLeadStatusSummary, listServiceCounts } from "../leads";

beforeEach(() => {
  vi.stubEnv("LEAD_DATABASE_READS", "true");
  vi.clearAllMocks();
  rpc.mockImplementation(async (name, args) => {
    if (name === "lead_query_metadata_pending") return { data: [], error: null };
    if (args?.p_mode === "page") return { data: { leads: [{ id: "one", name: "One", status: "new", query_locality: "Adyar", query_year: "2025" }], totalCount: 10000 }, error: null };
    return { data: [], error: null };
  });
});
afterEach(() => { vi.unstubAllEnvs(); });

it("reads a bounded database page without building the all-lead index", async () => {
  const result = await listPaginatedLeads({ page: 3, pageSize: 25, folder: "year_2025", area: "Adyar", assignedAdminUserId: "staff" });
  expect(result).toMatchObject({ totalCount: 10000, totalPages: 400, leads: [{ primaryLocality: "Adyar", year: "2025" }] });
  expect(rpc).toHaveBeenCalledWith("admin_lead_query", expect.objectContaining({ p_mode: "page", p_limit: 25, p_offset: 50, p_filter: expect.objectContaining({ assignedAdminUserId: "staff", area: "Adyar" }) }));
  expect(legacyIndex).not.toHaveBeenCalled();
});

it("delegates status and service counts without downloading candidate leads", async () => {
  await Promise.all([listLeadStatusSummary({ folder: "year_2025" }), listServiceCounts({ folder: "year_2025" })]);
  expect(rpc.mock.calls.filter(([name]) => name === "admin_lead_query").map(([,args]) => args.p_mode).sort()).toEqual(["services", "status"]);
  expect(derive).not.toHaveBeenCalled();
  expect(legacyIndex).not.toHaveBeenCalled();
});

it("derives only pending rows and forwards their concurrency fingerprints", async () => {
  const row = { id: "one", fingerprint: "revision-1", address: "Adyar", source: "upload" };
  rpc.mockResolvedValueOnce({ data: [row], error: null }).mockResolvedValueOnce({ data: null, error: null }).mockResolvedValueOnce({ data: [], error: null });
  derive.mockResolvedValueOnce([{ id: "one", primaryLocality: "Adyar", year: "2024", source: "upload", isBulkUpload: true }]);
  await Promise.all([ensureLeadQueryMetadata(), ensureLeadQueryMetadata()]);
  expect(derive).toHaveBeenCalledTimes(1);
  expect(rpc).toHaveBeenCalledWith("save_lead_query_metadata", { p_rows: [{ id: "one", fingerprint: "revision-1", locality: "Adyar", year: "2024", bulk: true, kind: "year" }] });
});

it("does not hide database errors as successful empty lists", async () => {
  rpc.mockResolvedValueOnce({ data: null, error: new Error("Database unavailable") });
  await expect(queryLeadDatabase("page", {})).rejects.toThrow("Database unavailable");
});

it("preserves normalized phone search while narrowing candidates by SQL scope", async () => {
  rpc.mockImplementation(async (name) => name === "lead_query_metadata_pending" ? { data: [], error: null } : { data: [{ id: "match", phone: "+91 98765-43210" }, { id: "other", phone: "11111111" }], error: null });
  expect(await queryMatchingLeadIds({ search: "9876543210", assignedAdminUserId: "staff", folder: "folder" })).toEqual(["match"]);
  expect(rpc).toHaveBeenCalledWith("admin_lead_query", expect.objectContaining({ p_mode: "search", p_limit: 500, p_filter: expect.objectContaining({ assignedAdminUserId: "staff", folder: "folder" }) }));
});
