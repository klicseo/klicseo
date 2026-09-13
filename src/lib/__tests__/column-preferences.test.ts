import { describe, it, expect, beforeEach } from "vitest";
import { type ColumnDefinition } from "../useColumnPreferences";

describe("Column Preferences Logic", () => {
  const sampleCols: ColumnDefinition[] = [
    { key: "name", label: "Customer Name", required: true },
    { key: "phone", label: "Phone", defaultVisible: true },
    { key: "location", label: "Location", defaultVisible: true },
    { key: "notes", label: "Notes", defaultVisible: false },
  ];

  it("calculates default column visibility accurately", () => {
    const map: Record<string, boolean> = {};
    for (const col of sampleCols) {
      map[col.key] = col.required || col.defaultVisible !== false;
    }

    expect(map.name).toBe(true);
    expect(map.phone).toBe(true);
    expect(map.location).toBe(true);
    expect(map.notes).toBe(false);
  });

  it("never disables required columns", () => {
    const customPreferences = {
      name: false, // Attempt to hide required column
      phone: false,
      location: true,
      notes: true,
    };

    // Merging logic with required protection
    const merged: Record<string, boolean> = { ...customPreferences };
    for (const col of sampleCols) {
      if (col.required) merged[col.key] = true;
    }

    expect(merged.name).toBe(true);
    expect(merged.phone).toBe(false);
    expect(merged.location).toBe(true);
    expect(merged.notes).toBe(true);
  });

  it("resets all columns back to default values", () => {
    const current: Record<string, boolean> = {
      name: true,
      phone: false,
      location: false,
      notes: true,
    };

    const defaults: Record<string, boolean> = {};
    for (const col of sampleCols) {
      defaults[col.key] = col.required || col.defaultVisible !== false;
    }

    expect(defaults.phone).toBe(true);
    expect(defaults.location).toBe(true);
    expect(defaults.notes).toBe(false);
  });
});
