import { describe, it, expect, vi, beforeEach } from "vitest";

process.env.SUPABASE_URL = "https://mock.supabase.co";
process.env.SUPABASE_SERVICE_ROLE_KEY = "mock-service-role-key";

vi.mock("@/lib/supabase", () => ({
  supabase: () => ({
    from: vi.fn().mockReturnValue({
      select: vi.fn().mockReturnValue({
        in: vi.fn().mockResolvedValue({
          data: [
            { car_brand: "Nissan", custom_fields: { "Vehicle Maker": "NISSAN MOTOR INDIA" } },
            { car_brand: "Volkswagen", custom_fields: { "Vehicle Maker": "VOLKSWAGEN INDIA" } },
            { car_brand: "Volkswagen", custom_fields: { "Vehicle Maker": "VOLKSWAGEN INDIA" } },
          ],
          error: null,
        }),
        eq: vi.fn().mockReturnThis(),
        order: vi.fn().mockReturnThis(),
      }),
    }),
  }),
}));

import { setLocationIndexCache } from "../area";
import { getAreaTerritoryAnalytics } from "../analytics";

describe("Area & Year Territory Analytics", () => {
  beforeEach(() => {
    setLocationIndexCache({
      expires: Date.now() + 100000,
      leadMap: new Map(),
      areaToLeadIds: new Map(),
      yearToLeadIds: new Map(),
      allLeads: [
        {
          id: "lead-v1",
          primaryLocality: "Velachery",
          pincode: null,
          area: "Velachery",
          year: "2026",
          source: "upload",
          status: "new",
          service: "ceramic_coating",
          price_total: 5000,
        },
        {
          id: "lead-v2",
          primaryLocality: "Velachery",
          pincode: null,
          area: "Velachery",
          year: "2026",
          source: "upload",
          status: "booked",
          service: "ceramic_coating",
          price_total: 12000,
        },
        {
          id: "lead-v3",
          primaryLocality: "Velachery",
          pincode: null,
          area: "Velachery",
          year: "2026",
          source: "upload",
          status: "follow_up",
          service: "interior_cleaning",
          price_total: 3000,
        },
        {
          id: "lead-v4-2025",
          primaryLocality: "Velachery",
          pincode: null,
          area: "Velachery",
          year: "2025",
          source: "upload",
          status: "booked",
          service: "ceramic_coating",
          price_total: 10000,
        },
        {
          id: "lead-p1",
          primaryLocality: "Puzhuthivakkam",
          pincode: null,
          area: "Puzhuthivakkam",
          year: "2026",
          source: "upload",
          status: "new",
        },
      ],
    });
  });

  it("computes territory KPI metrics strictly for Velachery in 2026", async () => {
    const data = await getAreaTerritoryAnalytics("Velachery", "2026");

    expect(data.area).toBe("Velachery");
    expect(data.year).toBe("2026");
    expect(data.totalLeads).toBe(3); // v1, v2, v3 in 2026 (v4 is 2025)
    expect(data.bookedCount).toBe(1);
    expect(data.followUpCount).toBe(1);
    expect(data.newCount).toBe(1);
    expect(data.conversionRate).toBe(33); // 1 out of 3 = 33%
    expect(data.estimatedRevenue).toBe(12000);
  });

  it("computes Year-over-Year comparison for Velachery across 2026 and 2025", async () => {
    const data = await getAreaTerritoryAnalytics("Velachery", "2026");

    expect(data.yearComparison).toHaveLength(2);
    const yr2026 = data.yearComparison.find((y) => y.year === "2026");
    const yr2025 = data.yearComparison.find((y) => y.year === "2025");

    expect(yr2026?.count).toBe(3);
    expect(yr2026?.bookedCount).toBe(1);
    expect(yr2025?.count).toBe(1);
    expect(yr2025?.bookedCount).toBe(1);
  });
});
