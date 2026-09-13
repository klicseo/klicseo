import { describe, it, expect, vi, beforeEach } from "vitest";

process.env.SUPABASE_URL = "https://mock.supabase.co";
process.env.SUPABASE_SERVICE_ROLE_KEY = "mock-service-role-key";

vi.mock("@/lib/supabase", () => ({
  supabase: () => ({
    from: vi.fn().mockReturnThis(),
    select: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    order: vi.fn().mockReturnThis(),
    range: vi.fn().mockResolvedValue({ data: [], error: null }),
    in: vi.fn().mockResolvedValue({ data: [], error: null }),
  }),
}));

import { listAreasWithCounts, setLocationIndexCache } from "../area";
import { listFolderSummaries, listLeadStatusSummary, listPaginatedLeads } from "../leads";
import { isWebsiteFormLead, isHotLead, isYearLead } from "../leads-shared";

describe("Year & Area Cohort Leads Reconciliation & Exact Matching", () => {
  const mockDataset = [
    // 1. Website Form Leads (source: "wizard")
    {
      id: "web-1",
      name: "Online Client 1",
      primaryLocality: "Velachery",
      pincode: null,
      area: "Velachery",
      year: "2026",
      source: "wizard",
      status: "new",
      service: "CarWash",
    },
    {
      id: "web-2",
      name: "Online Client 2",
      primaryLocality: "Adyar",
      pincode: null,
      area: "Adyar",
      year: "2026",
      source: "wizard",
      status: "booked",
      service: "CarDetailing",
    },

    // 2. Hot Leads (source: "admin" / manual)
    {
      id: "hot-1",
      name: "VIP Walk-in",
      primaryLocality: "Anna Nagar",
      pincode: null,
      area: "Anna Nagar",
      year: "2026",
      source: "admin",
      status: "new",
      isBulkUpload: false,
      service: "CarWash",
    },
    {
      id: "hot-2",
      name: "Phone Inquiry",
      primaryLocality: "Anna Nagar",
      pincode: null,
      area: "Anna Nagar",
      year: "2026",
      source: "manual",
      status: "booked",
      isBulkUpload: false,
      service: "CarDetailing",
    },

    // 3. 2026 Bulk Uploaded Leads
    {
      id: "yr26-1",
      name: "Bulk Lead 1",
      primaryLocality: "Madipakkam",
      pincode: null,
      area: "Madipakkam",
      year: "2026",
      source: "upload",
      status: "new",
      isBulkUpload: true,
      service: "CarWash",
    },
    {
      id: "yr26-2",
      name: "Bulk Lead 2",
      primaryLocality: "Madipakkam",
      pincode: null,
      area: "Madipakkam",
      year: "2026",
      source: "upload",
      status: "booked",
      isBulkUpload: true,
      service: "CarWash",
    },
    {
      id: "yr26-3",
      name: "Bulk Lead 3",
      primaryLocality: "Velachery",
      pincode: null,
      area: "Velachery",
      year: "2026",
      source: "upload",
      status: "follow_up",
      isBulkUpload: true,
      service: "CarDetailing",
    },
    {
      id: "yr26-4",
      name: "Bulk Lead 4 (Unspecified Area)",
      primaryLocality: "Unspecified",
      pincode: null,
      area: null,
      year: "2026",
      source: "upload",
      status: "new",
      isBulkUpload: true,
      service: "CarWash",
    },

    // 4. 2025 Bulk Uploaded Leads
    {
      id: "yr25-1",
      name: "2025 Lead 1",
      primaryLocality: "Tambaram",
      pincode: null,
      area: "Tambaram",
      year: "2025",
      source: "upload",
      status: "new",
      isBulkUpload: true,
      service: "CarWash",
    },
    {
      id: "yr25-2",
      name: "2025 Lead 2",
      primaryLocality: "Tambaram",
      pincode: null,
      area: "Tambaram",
      year: "2025",
      source: "upload",
      status: "booked",
      isBulkUpload: true,
      service: "CarWash",
    },
  ];

  beforeEach(() => {
    setLocationIndexCache({
      expires: Date.now() + 100000,
      leadMap: new Map(mockDataset.map((l) => [l.id, l as any])),
      areaToLeadIds: new Map(),
      yearToLeadIds: new Map(),
      allLeads: mockDataset as any,
    });
  });

  it("strictly partitions leads across system folders without count leakage", async () => {
    const res = await listFolderSummaries();

    const websiteFolder = res.systemFolders.find((f) => f.id === "website_form");
    const hotFolder = res.systemFolders.find((f) => f.id === "hot_leads");
    const year2026Folder = res.systemFolders.find((f) => f.id === "year_2026");
    const year2025Folder = res.systemFolders.find((f) => f.id === "year_2025");

    expect(websiteFolder?.count).toBe(2);
    expect(hotFolder?.count).toBe(2);
    expect(year2026Folder?.count).toBe(4);
    expect(year2025Folder?.count).toBe(2);

    const totalSystemCount =
      (websiteFolder?.count || 0) +
      (hotFolder?.count || 0) +
      (year2026Folder?.count || 0) +
      (year2025Folder?.count || 0);

    expect(totalSystemCount).toBe(mockDataset.length);
  });

  it("ensures sum of all area cards in year_2026 matches the year folder total", async () => {
    const areas = await listAreasWithCounts({ folder: "year_2026" });

    const totalAreaLeads = areas.reduce((sum, a) => sum + a.count, 0);
    expect(totalAreaLeads).toBe(4); // 2 Madipakkam + 1 Velachery + 1 Unspecified

    const madipakkam = areas.find((a) => a.area === "Madipakkam");
    expect(madipakkam?.count).toBe(2);
    expect(madipakkam?.bookedCount).toBe(1);

    const velachery = areas.find((a) => a.area === "Velachery");
    expect(velachery?.count).toBe(1);
    expect(velachery?.bookedCount).toBe(0);

    const unspecified = areas.find((a) => a.area === "Unspecified / Other");
    expect(unspecified?.count).toBe(1);
    expect(unspecified?.bookedCount).toBe(0);
  });

  it("matches listPaginatedLeads and listLeadStatusSummary for a specific (year, area) pair", async () => {
    // Test 2026 Madipakkam
    const summary = await listLeadStatusSummary({ folder: "year_2026", area: "Madipakkam" });
    const paginated = await listPaginatedLeads({ folder: "year_2026", area: "Madipakkam" });

    expect(summary.total).toBe(2);
    expect(paginated.totalCount).toBe(2);
    expect(summary.new).toBe(1);
    expect(summary.booked).toBe(1);
    expect(summary.new + summary.booked).toBe(summary.total);
  });

  it("matches listPaginatedLeads and listLeadStatusSummary for Unspecified area leads in 2026", async () => {
    const summary = await listLeadStatusSummary({ folder: "year_2026", area: "Unspecified / Other" });
    const paginated = await listPaginatedLeads({ folder: "year_2026", area: "Unspecified / Other" });

    expect(summary.total).toBe(1);
    expect(paginated.totalCount).toBe(1);
    expect(summary.new).toBe(1);
  });

  it("ensures website and hot leads are not included in year area queries", async () => {
    const summary = await listLeadStatusSummary({ folder: "year_2026", area: "Anna Nagar" });
    const paginated = await listPaginatedLeads({ folder: "year_2026", area: "Anna Nagar" });

    // Anna Nagar only had Hot Leads in 2026; under year_2026 folder it must be 0!
    expect(summary.total).toBe(0);
    expect(paginated.totalCount).toBe(0);
  });
});
