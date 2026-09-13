import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock Supabase
const mockSelect = vi.fn();
const mockFrom = vi.fn();
const mockEq = vi.fn();
const mockIlike = vi.fn();
const mockIn = vi.fn();
const mockGte = vi.fn();
const mockLte = vi.fn();
const mockOrder = vi.fn();

vi.mock("@/lib/supabase", () => ({
  supabase: () => ({
    from: mockFrom.mockReturnThis(),
    select: mockSelect.mockReturnThis(),
    eq: mockEq.mockReturnThis(),
    ilike: mockIlike.mockReturnThis(),
    in: mockIn.mockReturnThis(),
    gte: mockGte.mockReturnThis(),
    lte: mockLte.mockReturnThis(),
    order: mockOrder.mockReturnThis(),
    range: vi.fn(async () => ({ data: [], error: null })),
  }),
}));

const mockCurrentAdmin = vi.fn();
const mockResolveScope = vi.fn();
const mockRequirePermission = vi.fn();

vi.mock("@/lib/admin-auth", () => ({
  currentAdmin: () => mockCurrentAdmin(),
  resolveScope: (me: any) => mockResolveScope(me),
  requirePermission: (perm: string) => mockRequirePermission(perm),
}));

vi.mock("@/lib/admin-users", () => ({
  listAdminUsers: vi.fn(async () => [
    {
      id: "admin-1",
      email: "admin@klicseo.com",
      role: "super_admin",
      status: "active",
      employees: { name: "Super Admin" },
    },
    {
      id: "staff-1",
      email: "staff1@klicseo.com",
      role: "staff",
      status: "active",
      employees: { name: "Karthik" },
    },
    {
      id: "staff-2",
      email: "staff2@klicseo.com",
      role: "staff",
      status: "active",
      employees: { name: "Rahul" },
    },
  ]),
  getAdminUser: vi.fn(async (email: string) => {
    if (email === "staff1@klicseo.com") {
      return { id: "staff-1", email: "staff1@klicseo.com", role: "staff" };
    }
    return { id: "admin-1", email: "admin@klicseo.com", role: "super_admin" };
  }),
}));

describe("Daily Reports Staff Access Control", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockFrom.mockReturnThis();
    mockSelect.mockReturnThis();
    mockEq.mockReturnThis();
    mockIlike.mockReturnThis();
    mockIn.mockReturnThis();
    mockGte.mockReturnThis();
    mockLte.mockReturnThis();
    mockOrder.mockReturnThis();
  });

  it("getDailyStaffReport returns only single staff stats when assignedAdminUserId is provided", async () => {
    const { getDailyStaffReport } = await import("@/lib/reports");

    const report = await getDailyStaffReport({
      date: "2026-08-27",
      assignedAdminUserId: "staff-1",
    });

    expect(report.staffMetrics.length).toBe(1);
    expect(report.staffMetrics[0].email).toBe("staff1@klicseo.com");
    expect(report.staffMetrics[0].name).toBe("Karthik");
  });

  it("getDailyStaffReport returns all active staff stats for administrators when assignedAdminUserId is undefined", async () => {
    const { getDailyStaffReport } = await import("@/lib/reports");

    const report = await getDailyStaffReport({
      date: "2026-08-27",
    });

    expect(report.staffMetrics.length).toBe(3);
    const emails = report.staffMetrics.map((s) => s.email);
    expect(emails).toContain("staff1@klicseo.com");
    expect(emails).toContain("staff2@klicseo.com");
    expect(emails).toContain("admin@klicseo.com");
  });

  it("fetchStaffTimelineAction blocks staff from requesting another telecaller's timeline", async () => {
    mockRequirePermission.mockResolvedValueOnce({
      email: "staff1@klicseo.com",
      role: "staff",
      permissions: ["leads.view"],
    });
    mockResolveScope.mockResolvedValueOnce({
      kind: "assigned",
      adminUserId: "staff-1",
    });

    const { fetchStaffTimelineAction } = await import("@/app/admin/reports/actions");

    const res = await fetchStaffTimelineAction("staff2@klicseo.com", "2026-08-27");
    expect(res.ok).toBe(false);
    expect(res.error).toContain("Forbidden: You can only view your own timeline activity.");
  });

  it("fetchStaffTimelineAction allows staff to request their own timeline", async () => {
    mockRequirePermission.mockResolvedValueOnce({
      email: "staff1@klicseo.com",
      role: "staff",
      permissions: ["leads.view"],
    });
    mockResolveScope.mockResolvedValueOnce({
      kind: "assigned",
      adminUserId: "staff-1",
    });

    const { fetchStaffTimelineAction } = await import("@/app/admin/reports/actions");

    const res = await fetchStaffTimelineAction("staff1@klicseo.com", "2026-08-27");
    expect(res.ok).toBe(true);
  });

  it("fetchDailyReportAction enforces assignedAdminUserId for staff regardless of incoming filter", async () => {
    mockRequirePermission.mockResolvedValueOnce({
      email: "staff1@klicseo.com",
      role: "staff",
      permissions: ["leads.view"],
    });
    mockResolveScope.mockResolvedValueOnce({
      kind: "assigned",
      adminUserId: "staff-1",
    });

    const { fetchDailyReportAction } = await import("@/app/admin/reports/actions");

    // Even if filter tries to pass undefined or another user's id
    const res = await fetchDailyReportAction({
      date: "2026-08-27",
      assignedAdminUserId: "staff-2",
    });

    expect(res.ok).toBe(true);
    expect(res.summary?.staffMetrics.length).toBe(1);
    expect(res.summary?.staffMetrics[0].email).toBe("staff1@klicseo.com");
  });
});
