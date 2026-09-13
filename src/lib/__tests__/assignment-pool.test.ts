import { beforeEach, expect, it, vi } from "vitest";
const { range, order } = vi.hoisted(() => ({ range: vi.fn(), order: vi.fn() }));
vi.mock("../supabase", () => ({ supabase: () => ({ from: () => ({ select: () => ({ order: (...args: unknown[]) => { order(...args); return { range }; } }) }) }) }));
import { getAllAssignedLeadIds, invalidateAssignedLeadsCache, setAssignedLeadsCache } from "../lead-assignments";
beforeEach(() => { vi.clearAllMocks(); invalidateAssignedLeadsCache(); });
it("loads every membership in deterministic pages beyond the response cap", async () => {
  const rows = Array.from({ length: 1251 }, (_, i) => ({ lead_id: `lead-${i}` }));
  range.mockImplementation(async (from: number, to: number) => ({ data: rows.slice(from, to + 1), error: null }));
  expect((await getAllAssignedLeadIds()).size).toBe(1251);
  expect(order).toHaveBeenCalledWith("lead_id");
  expect(range.mock.calls).toEqual([[0,499], [500,999], [1000,1499]]);
});
it("rejects a failed membership read and retries instead of caching an empty pool", async () => {
  range.mockResolvedValueOnce({ data: null, error: new Error("Unavailable") });
  await expect(getAllAssignedLeadIds()).rejects.toThrow("Unavailable");
  range.mockResolvedValueOnce({ data: [{ lead_id: "owned" }], error: null });
  expect(await getAllAssignedLeadIds()).toEqual(new Set(["owned"]));
});
it("an old in-flight read cannot overwrite a newer cache after a mutation", async () => {
  let complete!: (value: { data: { lead_id: string }[]; error: null }) => void;
  range.mockImplementationOnce(() => new Promise((resolve) => { complete = resolve; }));
  const pending = getAllAssignedLeadIds();
  setAssignedLeadsCache(new Set(["new-assignment"]));
  complete({ data: [], error: null });
  await pending;
  expect(await getAllAssignedLeadIds()).toEqual(new Set(["new-assignment"]));
});
