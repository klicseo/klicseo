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
import { matchesFilter } from "../lead-routing";

describe("Folder-Scoped Area Counts & Strict Hot Leads Consistency", () => {
  beforeEach(() => {
    setLocationIndexCache({
      expires: Date.now() + 100000,
      leadMap: new Map(),
      areaToLeadIds: new Map(),
      yearToLeadIds: new Map(),
      allLeads: [
        {
          id: "lead-2026-velachery-upload",
          primaryLocality: "Velachery",
          pincode: null,
          area: "Velachery",
          year: "2026",
          source: "upload",
          status: "new",
        },
        {
          id: "lead-2026-puzhuthivakkam-upload",
          primaryLocality: "Puzhuthivakkam",
          pincode: null,
          area: "Puzhuthivakkam",
          year: "2026",
          source: "upload",
          status: "new",
        },
        {
          id: "lead-2025-madipakkam-upload",
          primaryLocality: "Madipakkam",
          pincode: null,
          area: "Madipakkam",
          year: "2025",
          source: "upload",
          status: "new",
        },
        {
          id: "lead-hot-admin-adyar",
          primaryLocality: "Adyar",
          pincode: null,
          area: "Adyar",
          year: "2026",
          source: "admin",
          status: "new",
        },
        {
          id: "lead-website-wizard-annanagar",
          primaryLocality: "Anna Nagar",
          pincode: null,
          area: "Anna Nagar",
          year: "2026",
          source: "wizard",
          status: "new",
        },
      ],
    });
  });

  it("scopes listAreasWithCounts to 2026 year folder", async () => {
    const areas2026 = await listAreasWithCounts({ folder: "year_2026" });
    const areaNames = areas2026.map((a) => a.area);

    expect(areaNames).toContain("Velachery");
    expect(areaNames).toContain("Puzhuthivakkam");
    expect(areaNames).not.toContain("Adyar"); // Hot lead isolated into hot_leads folder
    expect(areaNames).not.toContain("Anna Nagar"); // Website wizard lead isolated from year folder
    expect(areaNames).not.toContain("Madipakkam"); // 2025 lead
  });

  it("scopes listAreasWithCounts to 2025 year folder", async () => {
    const areas2025 = await listAreasWithCounts({ folder: "year_2025" });
    const areaNames = areas2025.map((a) => a.area);

    expect(areaNames).toEqual(["Madipakkam"]);
    expect(areaNames).not.toContain("Velachery");
    expect(areaNames).not.toContain("Puzhuthivakkam");
  });

  it("scopes listAreasWithCounts to hot_leads folder (admin manual leads only)", async () => {
    const hotAreas = await listAreasWithCounts({ folder: "hot_leads" });
    const areaNames = hotAreas.map((a) => a.area);

    expect(areaNames).toEqual(["Adyar"]);
    expect(areaNames).not.toContain("Velachery"); // upload lead
    expect(areaNames).not.toContain("Anna Nagar"); // wizard lead
  });

  it("strictly differentiates hot_leads vs bulk uploads vs website leads in lead routing", () => {
    const adminManualLead = { id: "1", source: "admin", status: "new" };
    const manualLead = { id: "2", source: "manual", status: "new" };
    const uploadLead = { id: "3", source: "upload", status: "new" };
    const wizardLead = { id: "4", source: "wizard", status: "new" };
    const legacyBulkUploadTaggedAdmin = {
      id: "5",
      source: "admin",
      status: "new",
      isBulkUpload: true,
      custom_fields: { upload_file: "leads_2026.xlsx", "Reg. Date": "2026-01-15" },
    };

    // Hot Leads folder strictly matches non-bulk admin and manual leads
    expect(matchesFilter(adminManualLead as any, { folder: "hot_leads" })).toBe(true);
    expect(matchesFilter(manualLead as any, { folder: "hot_leads" })).toBe(true);
    expect(matchesFilter(uploadLead as any, { folder: "hot_leads" })).toBe(false);
    expect(matchesFilter(wizardLead as any, { folder: "hot_leads" })).toBe(false);
    expect(matchesFilter(legacyBulkUploadTaggedAdmin as any, { folder: "hot_leads" })).toBe(false);

    // Website Form folder strictly matches wizard leads
    expect(matchesFilter(wizardLead as any, { folder: "website_form" })).toBe(true);
    expect(matchesFilter(adminManualLead as any, { folder: "website_form" })).toBe(false);
    expect(matchesFilter(uploadLead as any, { folder: "website_form" })).toBe(false);
  });
});
