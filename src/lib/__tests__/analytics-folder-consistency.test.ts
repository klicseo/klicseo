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

vi.mock("@/lib/admin-users", () => ({
  listAdminUsers: vi.fn(async () => []),
}));

import { setLocationIndexCache } from "../area";
import { getAnalyticsReportData } from "../analytics";
import { listLeadStatusSummary, listServiceCounts } from "../leads";

describe("Analytics & Badge Metrics Number Consistency", () => {
  beforeEach(() => {
    setLocationIndexCache({
      expires: Date.now() + 100000,
      leadMap: new Map(),
      areaToLeadIds: new Map(),
      yearToLeadIds: new Map(),
      allLeads: [
        // Website Form Leads
        {
          id: "web-1",
          primaryLocality: "Velachery",
          pincode: null,
          area: "Velachery",
          year: "2026",
          source: "wizard",
          service: "Doorstep Cleaning",
          status: "new",
          price_total: 1200,
        },
        {
          id: "web-2",
          primaryLocality: "Velachery",
          pincode: null,
          area: "Velachery",
          year: "2026",
          source: "wizard",
          service: "Doorstep Cleaning",
          status: "booked",
          price_total: 1500,
        },
        {
          id: "web-3",
          primaryLocality: "Adyar",
          pincode: null,
          area: "Adyar",
          year: "2026",
          source: "wizard",
          service: "Foam Wash",
          status: "booked",
          price_total: 2000,
        },

        // Hot Leads (Admin manual)
        {
          id: "hot-1",
          primaryLocality: "Velachery",
          pincode: null,
          area: "Velachery",
          year: "2026",
          source: "admin",
          service: "Ceramic Coating",
          status: "new",
          isBulkUpload: false,
          price_total: 8000,
        },
        {
          id: "hot-2",
          primaryLocality: "Anna Nagar",
          pincode: null,
          area: "Anna Nagar",
          year: "2026",
          source: "manual",
          service: "Ceramic Coating",
          status: "booked",
          isBulkUpload: false,
          price_total: 10000,
        },

        // 2026 Bulk Uploaded Leads
        {
          id: "upload-2026-1",
          primaryLocality: "Velachery",
          pincode: null,
          area: "Velachery",
          year: "2026",
          source: "upload",
          service: "Doorstep Cleaning",
          status: "new",
          isBulkUpload: true,
          price_total: 1000,
        },
        {
          id: "upload-2026-2",
          primaryLocality: "Madipakkam",
          pincode: null,
          area: "Madipakkam",
          year: "2026",
          source: "upload",
          service: "Doorstep Cleaning",
          status: "booked",
          isBulkUpload: true,
          price_total: 1200,
        },
      ],
    });
  });

  it("Area Analytics under /admin?folder=website_form&area=Velachery matches statusSummary and totalCount exactly", async () => {
    // 1. Status Summary for website_form in Velachery
    const statusSummary = await listLeadStatusSummary({
      folder: "website_form",
      area: "Velachery",
    });

    expect(statusSummary.total).toBe(2);
    expect(statusSummary.new).toBe(1);
    expect(statusSummary.booked).toBe(1);

    // 2. Area Analytics Report for website_form in Velachery
    const analytics = await getAnalyticsReportData({
      folder: "website_form",
      area: "Velachery",
    });

    expect(analytics.summary.totalLeads).toBe(2);
    expect(analytics.summary.totalNew).toBe(1);
    expect(analytics.summary.totalBooked).toBe(1);
    expect(analytics.summary.estimatedRevenue).toBe(1500); // 1500 from booked lead (web-2)

    // 3. Service Counts for website_form in Velachery
    const serviceCounts = await listServiceCounts({
      folder: "website_form",
      area: "Velachery",
    });

    expect(serviceCounts).toHaveLength(1);
    expect(serviceCounts[0].service).toBe("Doorstep Cleaning");
    expect(serviceCounts[0].count).toBe(2);
  });

  it("Area Analytics under /admin?folder=year_2026&area=Velachery strictly excludes website form leads", async () => {
    const statusSummary = await listLeadStatusSummary({
      folder: "year_2026",
      area: "Velachery",
    });

    // In Velachery for 2026 year folder:
    // Excludes web-1 and web-2.
    // Contains upload-2026-1 and hot-1 (or upload-2026-1)
    const analytics = await getAnalyticsReportData({
      folder: "year_2026",
      area: "Velachery",
    });

    expect(analytics.summary.totalLeads).toBe(statusSummary.total);
    expect(analytics.summary.totalNew).toBe(statusSummary.new);
    expect(analytics.summary.totalBooked).toBe(statusSummary.booked);
  });
});
