import React from "react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
const { preview, filterOptions } = vi.hoisted(() => ({ preview: vi.fn(), filterOptions: vi.fn() }));
vi.mock("./routing-actions", () => ({ getAllocationFilterOptionsAction: filterOptions, previewMatchingLeadsAction: preview, submitLeadAllocationAction: vi.fn() }));
import LeadAllocationModal from "./LeadAllocationModal";
beforeEach(() => { vi.resetAllMocks(); filterOptions.mockResolvedValue({ statuses: [{ id: "new", label: "New Leads" }, { id: "draft", label: "Draft" }], services: [] }); });
afterEach(cleanup);
const show = () => render(<LeadAllocationModal lists={[]} adminUsers={[]} isOpen onClose={() => {}} onSuccess={() => {}} />);
it("keeps the latest filter count when an older request finishes later", async () => {
  let resolveOld!: (value: { count: number; totalUnallocated: number }) => void;
  let resolveNew!: (value: { count: number; totalUnallocated: number }) => void;
  preview.mockImplementationOnce(() => new Promise((resolve) => { resolveOld = resolve; }))
    .mockImplementationOnce(() => new Promise((resolve) => { resolveNew = resolve; }));
  show();
  await waitFor(() => expect(preview).toHaveBeenCalledTimes(1));
  fireEvent.click(screen.getByRole("button", { name: "+ Draft" }));
  await waitFor(() => expect(preview).toHaveBeenCalledTimes(2));
  await act(async () => { resolveNew({ count: 3, totalUnallocated: 3 }); });
  expect(screen.getByText("3 leads")).toBeTruthy();
  await act(async () => { resolveOld({ count: 99, totalUnallocated: 99 }); });
  expect(screen.getByText("3 leads")).toBeTruthy();
  expect(screen.queryByText("99 leads")).toBeNull();
});
it("shows preview failures instead of presenting a false zero-lead result", async () => {
  preview.mockResolvedValue({ count: 0, totalUnallocated: 0, error: "Database unavailable" });
  show();
  expect((await screen.findByRole("alert")).textContent).toContain("Database unavailable");
  expect(screen.queryByText("0 leads")).toBeNull();
});

it("uses configured custom statuses and real lead service names", async () => {
  preview.mockResolvedValue({ count: 1, totalUnallocated: 1 });
  filterOptions.mockResolvedValue({ statuses: [{ id: "interested", label: "Interested" }], services: ["Monthly Car Wash"] });
  show();
  expect(await screen.findByRole("button", { name: "+ Interested" })).toBeTruthy();
  expect(await screen.findByRole("button", { name: /Monthly Car Wash/ })).toBeTruthy();
  expect(screen.queryByRole("button", { name: /Ceramic Coating/ })).toBeNull();
});

it("defaults to all statuses and restores that default when filters are cleared", async () => {
  preview.mockResolvedValue({ count: 16, totalUnallocated: 16 });
  show();
  await waitFor(() => expect(preview).toHaveBeenCalledWith(expect.objectContaining({ statuses: undefined }), expect.any(Object)));
  fireEvent.click(screen.getByRole("button", { name: "+ Draft" }));
  await waitFor(() => expect(preview).toHaveBeenLastCalledWith(expect.objectContaining({ statuses: ["draft"] }), expect.any(Object)));
  fireEvent.click(screen.getByRole("button", { name: "All statuses" }));
  await waitFor(() => expect(preview).toHaveBeenLastCalledWith(expect.objectContaining({ statuses: undefined }), expect.any(Object)));
});

it("opts into assigned leads and displays the eligible pool breakdown", async () => {
  preview.mockResolvedValue({ count: 5, totalUnallocated: 2, unassignedCount: 2, assignedCount: 3 });
  show();
  const toggle = screen.getByRole("checkbox", { name: /Include already-assigned leads/ });
  expect((toggle as HTMLInputElement).checked).toBe(false);
  fireEvent.click(toggle);
  await waitFor(() => expect(preview).toHaveBeenLastCalledWith(expect.objectContaining({ include_assigned: true }), expect.any(Object)));
  expect(await screen.findByText(/2 unassigned \+ 3 already assigned/)).toBeTruthy();
});
