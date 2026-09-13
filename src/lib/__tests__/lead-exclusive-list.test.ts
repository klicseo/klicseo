import { describe, it, expect, vi, beforeEach } from "vitest";
const upsert = vi.fn();
const remove = vi.fn();
vi.mock("@/lib/supabase", () => ({ supabase: () => ({ from: () => ({ upsert, delete: remove, select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: { is_custom_folder: false }, error: null }) }) }) }) }) }));
import { addLeadsToList } from "../leadLists";

describe("Exclusive staff assignment moves", () => {
  beforeEach(() => { vi.clearAllMocks(); upsert.mockResolvedValue({ error: null }); });
  it("moves unique leads in one atomic statement", async () => {
    await addLeadsToList("target", ["one", "two", "one"]);
    expect(upsert).toHaveBeenCalledWith([
      { list_id: "target", lead_id: "one", added_at: expect.any(String) },
      { list_id: "target", lead_id: "two", added_at: expect.any(String) },
    ], { onConflict: "lead_id" });
    expect(remove).not.toHaveBeenCalled();
  });
  it("does not delete original membership when the destination write fails", async () => {
    upsert.mockResolvedValue({ error: new Error("Invalid destination") });
    await expect(addLeadsToList("missing", ["one"])).rejects.toThrow("Invalid destination");
    expect(remove).not.toHaveBeenCalled();
  });
});
