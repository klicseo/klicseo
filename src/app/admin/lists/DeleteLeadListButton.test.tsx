import React from "react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
const { remove, push, refresh } = vi.hoisted(() => ({ remove: vi.fn(), push: vi.fn(), refresh: vi.fn() }));
vi.mock("./actions", () => ({ deleteLeadListAction: remove }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push, refresh }) }));
import DeleteLeadListButton from "./DeleteLeadListButton";
beforeEach(() => { vi.clearAllMocks(); vi.spyOn(window, "confirm").mockReturnValue(true); });
afterEach(() => { cleanup(); vi.restoreAllMocks(); });
const show = () => render(<DeleteLeadListButton id="folder-1" name="Instagram" kind="folder" returnTo="/admin" />);
it("requires confirmation and explains that leads are preserved", () => {
  vi.mocked(window.confirm).mockReturnValue(false);
  show();
  fireEvent.click(screen.getByRole("button", { name: "Delete folder Instagram" }));
  expect(window.confirm).toHaveBeenCalledWith(expect.stringContaining("leads and staff assignments will be kept"));
  expect(remove).not.toHaveBeenCalled();
});
it("shows a server refusal without navigating away", async () => {
  remove.mockResolvedValue({ ok: false, error: "Only the super admin can delete folders." });
  show();
  fireEvent.click(screen.getByRole("button"));
  expect((await screen.findByRole("alert")).textContent).toContain("Only the super admin");
  expect(push).not.toHaveBeenCalled();
});
it("refreshes the folder directory after successful deletion", async () => {
  remove.mockResolvedValue({ ok: true });
  show();
  fireEvent.click(screen.getByRole("button"));
  await waitFor(() => expect(refresh).toHaveBeenCalled());
  expect(remove.mock.calls[0][0].get("id")).toBe("folder-1");
  expect(push).toHaveBeenCalledWith("/admin");
});
