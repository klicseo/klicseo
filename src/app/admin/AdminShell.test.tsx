import React from "react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
const { reminders, employeeReminders, scope } = vi.hoisted(() => ({ reminders: vi.fn(), employeeReminders: vi.fn(), scope: vi.fn() }));
vi.mock("@/lib/admin-auth", () => ({
  currentAdmin: async () => ({ email: "staff@example.com", role: "staff", permissions: ["leads.view"] }),
  resolveScope: scope,
}));
vi.mock("@/lib/leads", () => ({ listCallReminders: reminders }));
vi.mock("@/lib/employees", () => ({ listEmployeeCallReminders: employeeReminders }));
vi.mock("./Sidebar", () => ({ default: () => null }));
vi.mock("./AuthSessionGuard", () => ({ default: () => null }));
import AdminShell from "./AdminShell";

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal("React", React);
  scope.mockResolvedValue({ kind: "assigned", adminUserId: "staff-id" });
});

afterEach(() => { vi.unstubAllGlobals(); });

it("returns page content while a single scoped notification request is still pending", async () => {
  reminders.mockReturnValue(new Promise(() => {}));
  const shell = await AdminShell({ children: <p>Workspace</p> });
  expect(shell).toBeTruthy();
  expect(reminders).toHaveBeenCalledTimes(1);
  expect(reminders).toHaveBeenCalledWith({ assignedAdminUserId: "staff-id" });
  expect(employeeReminders).not.toHaveBeenCalled();
});

it("does not fetch reminders without the section permission", async () => {
  await AdminShell({ children: <p>Workspace</p>, section: "employees" });
  expect(reminders).not.toHaveBeenCalled();
  expect(employeeReminders).not.toHaveBeenCalled();
});
