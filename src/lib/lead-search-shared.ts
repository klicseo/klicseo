// Shared matching for hydrated (decrypted on the server) lead records.
export function matchesLeadSearch(lead: object, query: string): boolean {
  const q = query.trim().toLowerCase().replace(/\s+/g, " ");
  if (!q) return true;
  const row = lead as Record<string, unknown>;
  const fields = ["name", "phone", "car_number", "car_brand", "car_model", "area", "primaryLocality", "address", "pincode", "service", "service_option", "location", "job_role"];
  if (fields.some((field) => String(row[field] ?? "").toLowerCase().replace(/\s+/g, " ").includes(q))) return true;
  const compact = q.replace(/[^a-z0-9]/g, "");
  if (!compact) return false;
  return ["phone", "car_number"].some((field) =>
    String(row[field] ?? "").toLowerCase().replace(/[^a-z0-9]/g, "").includes(compact)
  );
}
