import React from "react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
const { preview, recycle } = vi.hoisted(() => ({ preview: vi.fn(), recycle: vi.fn() }));
vi.mock("./routing-actions", () => ({ previewRecyclingAction: preview, recycleLeadsAction: recycle }));
import RecycleLeadsModal from "./RecycleLeadsModal";
const props = { isOpen: true, onClose: vi.fn(), sourceListId: "source", adminUsers: [{ id: "target", name: "Agent", email: "agent@example.com" }] };
beforeEach(() => {
  vi.resetAllMocks();
  preview.mockResolvedValue({ count: 2, totalMatchingCount: 7 });
});
afterEach(cleanup);

it("shows round availability separately from the total matching pool", async () => {
  const view = render(<RecycleLeadsModal {...props} isOpen={false} />);
  view.rerender(<RecycleLeadsModal {...props} />);
  expect(await screen.findByText(/2 leads available this round · 7 matching leads/)).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: /Agent agent@example.com/ }));
  await waitFor(() => expect(preview).toHaveBeenLastCalledWith(expect.objectContaining({ source_list_id: "source", target_admin_user_ids: ["target"] })));
  view.rerender(<RecycleLeadsModal {...props} isOpen={false} />);
});

it("retains the request ID for an unchanged retry and explains round completion", async () => {
  recycle.mockResolvedValueOnce({ ok: false, error: "Retry request" }).mockResolvedValueOnce({ ok: true, result: {
    recycledCount: 2, assignedStaffCount: 1, protectedCount: 0, createdListIds: [], waitingCount: 5, roundComplete: true,
  } });
  const onSuccess = vi.fn();
  render(<RecycleLeadsModal {...props} onSuccess={onSuccess} />);
  fireEvent.click(screen.getByRole("button", { name: /Agent agent@example.com/ }));
  fireEvent.click(screen.getByRole("button", { name: /Recycle & Reassign Leads ➔/ }));
  expect(await screen.findByText("Retry request")).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: /Recycle & Reassign Leads ➔/ }));
  await waitFor(() => expect(onSuccess).toHaveBeenCalled());
  expect(recycle.mock.calls[0][0].request_id).toBeTruthy();
  expect(recycle.mock.calls[1][0].request_id).toBe(recycle.mock.calls[0][0].request_id);
  expect(onSuccess).toHaveBeenCalledWith(expect.stringContaining("This round is complete"));
});
