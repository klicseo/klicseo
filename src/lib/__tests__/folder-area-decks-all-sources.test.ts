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
  }),
}));

import { listAreasWithCounts, setLocationIndexCache } from "../area";
import { listFolderSummaries } from "../leads";

describe("Universal Folder Area Decks & Source Isolation", () => {
  beforeEach(() => {
    setLocationIndexCache({
      expires: Date.now() + 100000,
      leadMap: new Map(),
      areaToLeadIds: new Map(),
      yearToLeadIds: new Map(),
      allLeads: [
        // Website form leads (source: "wizard")
        {
          id: "web-1",
          primaryLocality: "Velachery",
          pincode: null,
          area: "Velachery",
          year: "2026",
          source: "wizard",
          status: "new",
        },
        {
          id: "web-2",
          primaryLocality: "Velachery",
          pincode: null,
          area: "Velachery",
          year: "2026",
          source: "wizard",
          status: "booked",
        },
        {
          id: "web-3",
          primaryLocality: "Adyar",
          pincode: null,
          area: "Adyar",
          year: "2026",
          source: "wizard",
          status: "booked",
        },

        // Hot leads (admin / manual added)
        {
          id: "hot-1",
          primaryLocality: "Anna Nagar",
          pincode: null,
          area: "Anna Nagar",
          year: "2026",
          source: "admin",
          status: "new",
          isBulkUpload: false,
        },
        {
          id: "hot-2",
          primaryLocality: "Anna Nagar",
          pincode: null,
          area: "Anna Nagar",
          year: "2026",
          source: "manual",
          status: "booked",
          isBulkUpload: false,
        },

        // 2026 bulk uploaded / historical vehicle database leads
        {
          id: "upload-2026-1",
          primaryLocality: "Madipakkam",
          pincode: null,
          area: "Madipakkam",
          year: "2026",
          source: "upload",
          status: "new",
          isBulkUpload: true,
        },
        {
          id: "upload-2026-2",
          primaryLocality: "Madipakkam",
          pincode: null,
          area: "Madipakkam",
          year: "2026",
          source: "upload",
          status: "booked",
          isBulkUpload: true,
        },

        // 2025 bulk uploaded leads
        {
          id: "upload-2025-1",
          primaryLocality: "Tambaram",
          pincode: null,
          area: "Tambaram",
          year: "2025",
          source: "upload",
          status: "new",
          isBulkUpload: true,
        },
      ],
    });
  });

  it("listFolderSummaries counts website leads in website_form folder and excludes them from year cohorts", async () => {
    const res = await listFolderSummaries();

    const websiteFolder = res.systemFolders.find((f) => f.id === "website_form");
    expect(websiteFolder).toBeDefined();
    expect(websiteFolder?.count).toBe(3);
    expect(websiteFolder?.bookedCount).toBe(2);

    const hotFolder = res.systemFolders.find((f) => f.id === "hot_leads");
    expect(hotFolder).toBeDefined();
    expect(hotFolder?.count).toBe(2);
    expect(hotFolder?.bookedCount).toBe(1);

    const year2026Folder = res.systemFolders.find((f) => f.id === "year_2026");
    expect(year2026Folder).toBeDefined();
    // 2026 should ONLY count the 2 bulk uploaded leads, NOT the 3 wizard leads or 2 hot leads!
    expect(year2026Folder?.count).toBe(2);
    expect(year2026Folder?.bookedCount).toBe(1);

    const year2025Folder = res.systemFolders.find((f) => f.id === "year_2025");
    expect(year2025Folder).toBeDefined();
    expect(year2025Folder?.count).toBe(1);
    expect(year2025Folder?.bookedCount).toBe(0);
  });

  it("listAreasWithCounts computes area breakdown for Website Form Leads folder", async () => {
    const areas = await listAreasWithCounts({ folder: "website_form" });
    expect(areas).toHaveLength(2);

    const velachery = areas.find((a) => a.area === "Velachery");
    expect(velachery).toBeDefined();
    expect(velachery?.count).toBe(2);
    expect(velachery?.bookedCount).toBe(1);

    const adyar = areas.find((a) => a.area === "Adyar");
    expect(adyar).toBeDefined();
    expect(adyar?.count).toBe(1);
    expect(adyar?.bookedCount).toBe(1);
  });

  it("listAreasWithCounts computes area breakdown for Hot Leads folder", async () => {
    const areas = await listAreasWithCounts({ folder: "hot_leads" });
    expect(areas).toHaveLength(1);
    expect(areas[0].area).toBe("Anna Nagar");
    expect(areas[0].count).toBe(2);
    expect(areas[0].bookedCount).toBe(1);
  });

  it("listAreasWithCounts computes area breakdown for 2026 Year folder strictly without website leads", async () => {
    const areas = await listAreasWithCounts({ folder: "year_2026" });
    const areaNames = areas.map((a) => a.area);
    expect(areaNames).toContain("Madipakkam");
    expect(areaNames).not.toContain("Velachery"); // Website form lead
    expect(areaNames).not.toContain("Adyar"); // Website form lead
  });
});
