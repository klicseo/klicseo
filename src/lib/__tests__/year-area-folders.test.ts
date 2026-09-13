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

describe("Year Area Sub-Folders Hierarchy", () => {
  beforeEach(() => {
    setLocationIndexCache({
      expires: Date.now() + 100000,
      leadMap: new Map(),
      areaToLeadIds: new Map(),
      yearToLeadIds: new Map(),
      allLeads: [
        {
          id: "lead-1",
          primaryLocality: "Velachery",
          pincode: null,
          area: "Velachery",
          year: "2026",
          source: "upload",
          status: "new",
        },
        {
          id: "lead-2",
          primaryLocality: "Velachery",
          pincode: null,
          area: "Velachery",
          year: "2026",
          source: "upload",
          status: "booked",
        },
        {
          id: "lead-3",
          primaryLocality: "Puzhuthivakkam",
          pincode: null,
          area: "Puzhuthivakkam",
          year: "2026",
          source: "upload",
          status: "booked",
        },
        {
          id: "lead-4",
          primaryLocality: "Madipakkam",
          pincode: null,
          area: "Madipakkam",
          year: "2025",
          source: "upload",
          status: "new",
        },
      ],
    });
  });

  it("calculates area count and bookedCount for 2026 sub-folders deck", async () => {
    const res = await listAreasWithCounts({ folder: "year_2026" });

    expect(res).toHaveLength(2);

    const velachery = res.find((r) => r.area === "Velachery");
    expect(velachery).toBeDefined();
    expect(velachery?.count).toBe(2);
    expect(velachery?.bookedCount).toBe(1);

    const puzhuthivakkam = res.find((r) => r.area === "Puzhuthivakkam");
    expect(puzhuthivakkam).toBeDefined();
    expect(puzhuthivakkam?.count).toBe(1);
    expect(puzhuthivakkam?.bookedCount).toBe(1);
  });

  it("calculates area count and bookedCount for 2025 sub-folders deck", async () => {
    const res = await listAreasWithCounts({ folder: "year_2025" });

    expect(res).toHaveLength(1);
    expect(res[0].area).toBe("Madipakkam");
    expect(res[0].count).toBe(1);
    expect(res[0].bookedCount).toBe(0);
  });
});
