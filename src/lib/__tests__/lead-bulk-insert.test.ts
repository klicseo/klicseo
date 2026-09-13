import { describe, it, expect, vi, beforeEach } from "vitest";

process.env.APP_ENCRYPTION_KEY = "cdc8893a7e928c9173069c12b6c9006955777fae69688b36e7e41f89ba0cb223";

// Mock supabase client
const mockInsert = vi.fn();
const mockSelect = vi.fn();
const mockUpdate = vi.fn();
const mockUpsert = vi.fn();
const mockIn = vi.fn();
const mockEq = vi.fn();

vi.mock("@/lib/supabase", () => ({
  supabase: () => ({
    from: (table: string) => {
      if (table === "lead_lists") return { select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: { is_custom_folder: false }, error: null }) }) }) };
      if (table === "leads") {
        return {
          insert: (data: unknown) => {
            mockInsert(data);
            return {
              select: () => Promise.resolve({
                data: Array.isArray(data) ? data.map((_, idx) => ({ id: `new-lead-${idx + 1}` })) : [{ id: "new-lead-1" }],
                error: null,
              }),
            };
          },
          select: (cols: string) => ({
            in: (field: string, values: string[]) => {
              mockIn(field, values);
              return Promise.resolve({
                data: values.includes("f140a7296664726e21821432610d481e428d0214162acc0cf2f16a5b4332240c")
                  ? [{ id: "existing-lead-1", phone_hash: "f140a7296664726e21821432610d481e428d0214162acc0cf2f16a5b4332240c" }]
                  : [],
                error: null,
              });
            },
          }),
          update: (data: unknown) => ({
            eq: (field: string, val: string) => {
              mockUpdate(data, val);
              return Promise.resolve({ error: null });
            },
          }),
        };
      }

      if (table === "lead_list_items") {
        return {
          delete: () => ({
            in: () => Promise.resolve({ error: null }),
          }),
          insert: (data: unknown) => {
            mockInsert(data);
            return Promise.resolve({ error: null });
          },
          upsert: (data: unknown, opts: unknown) => {
            mockUpsert(data, opts);
            return Promise.resolve({ error: null });
          },
        };
      }

      if (table === "pincode_areas") {
        return {
          select: () => ({
            eq: (field: string, val: string) => Promise.resolve({
              data: val === "600042" ? { area: "Velachery" } : null,
              error: null,
            }),
          }),
        };
      }

      return {};
    },
  }),
}));

import { bulkInsertLeads } from "../leads";

describe("bulkInsertLeads", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("inserts new leads and attaches to listId", async () => {
    const res = await bulkInsertLeads(
      [
        {
          name: "Test User 1",
          phone: "9884504450",
          car_number: "TN09DL3663",
          pincode: "600042",
          car_brand: "Nissan",
          car_model: "Magnite",
          vehicle_type: "Motor Car",
          address: "Velachery, Chennai",
          custom_fields: { "Fuel Type": "PETROL" },
          status: "new",
          source: "admin",
          interior_add_on: false,
          gate_access_consent: false,
          parking_location: null,
          car_cover_choice: null,
          gate_access_notes: null,
          shift: null,
          callback_date: null,
          callback_time: null,
          latitude: null,
          longitude: null,
          price_total: null,
          discount_percent: null,
          notes: null,
          service: null,
          service_option: null,
          map_link: null,
          area: null,
        },
      ],
      { listId: "test-list-123", duplicateStrategy: "skip" },
    );

    expect(res.total).toBe(1);
    expect(res.inserted).toBe(1);
    expect(res.skipped).toBe(0);
    expect(mockUpsert).toHaveBeenCalledWith(
      expect.arrayContaining([
        expect.objectContaining({ list_id: "test-list-123", lead_id: "new-lead-1" }),
      ]),
      { onConflict: "lead_id" },
    );
  });
});
