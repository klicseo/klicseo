import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock Supabase
const mockSelect = vi.fn();
const mockFrom = vi.fn();
const mockEq = vi.fn();
const mockRange = vi.fn();

vi.mock("@/lib/supabase", () => ({
  supabase: () => ({
    from: mockFrom.mockReturnThis(),
    select: mockSelect.mockReturnThis(),
    eq: mockEq.mockReturnThis(),
    range: mockRange,
    order: vi.fn().mockReturnThis(),
    in: vi.fn().mockReturnThis(),
    not: vi.fn().mockReturnThis(),
    lte: vi.fn().mockReturnThis(),
    gte: vi.fn().mockReturnThis(),
    limit: vi.fn().mockReturnThis(),
    maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }),
  }),
}));

vi.mock("@/lib/area", () => ({
  getOrBuildLocationIndex: vi.fn(async () => ({
    allLeads: [
      { id: "l1", service: "Foam Wash", primaryLocality: "Velachery", status: "new" },
      { id: "l2", service: "Foam Wash", primaryLocality: "Velachery", status: "booked" },
      { id: "l3", service: "Ceramic Coating", primaryLocality: "Adyar", status: "contacted" },
    ],
    leadMap: new Map(),
    areaToLeadIds: new Map(),
    yearToLeadIds: new Map(),
    expires: Date.now() + 60_000,
  })),
  listAreasWithCounts: vi.fn(async () => []),
  areaFromPincode: vi.fn(async () => null),
  extractAreaFromAddress: vi.fn(async () => null),
  resolveLeadIdsForArea: vi.fn(async () => []),
  resolveLeadIdsForYear: vi.fn(async () => []),
  invalidateAreaCountsCache: vi.fn(),
}));

describe("Performance Optimizations", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("listServiceCounts aggregates from locationIndex in-memory with zero while-loop queries", async () => {
    const { listServiceCounts } = await import("@/lib/leads");

    const counts = await listServiceCounts();
    expect(counts).toEqual([
      { service: "Foam Wash", count: 2 },
      { service: "Ceramic Coating", count: 1 },
    ]);
  });

  it("listServiceCounts filters by area in-memory correctly", async () => {
    const { listServiceCounts } = await import("@/lib/leads");

    const counts = await listServiceCounts({ area: "Velachery" });
    expect(counts).toEqual([
      { service: "Foam Wash", count: 2 },
    ]);
  });

  it("listFolderSummaries correctly builds system and custom folders", async () => {
    mockRange.mockResolvedValueOnce({
      data: [{ id: "list-1", name: "Velachery Campaign", assigned_admin_user_id: "staff-1", admin_users: { email: "staff@example.com", employees: { name: "Staff User" } } }],
      error: null,
    }).mockResolvedValueOnce({ data: [{ list_id: "list-1", lead_id: "l1" }], error: null })
      .mockResolvedValueOnce({ data: [{ key: "lead_custom_folder:list-1", value: "true" }], error: null })
      .mockResolvedValueOnce({ data: [], error: null })
      .mockResolvedValueOnce({ data: [{ list_id: "list-1", lead_id: "l1" }], error: null });

    const { listFolderSummaries } = await import("@/lib/leads");
    const res = await listFolderSummaries();

    expect(res.systemFolders.length).toBeGreaterThan(0);
    expect(res.customFolders.length).toBe(1);
    expect(res.customFolders[0].name).toBe("Velachery Campaign");
    expect(res.customFolders[0].count).toBe(1);
  });
});
