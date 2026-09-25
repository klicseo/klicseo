// Explicit opt-in: writes only derived query metadata, never lead status or membership.
// KLICSEO_BACKFILL_LEAD_QUERY=1 node --env-file=.env node_modules/vitest/vitest.mjs run scripts/lead-query-backfill.test.ts
import { it, vi } from "vitest";
import { ensureLeadQueryMetadata } from "../src/lib/lead-query";
it.skipIf(process.env.KLICSEO_BACKFILL_LEAD_QUERY !== "1")("backfills persistent lead locality and year metadata", async () => {
  vi.stubEnv("LEAD_DATABASE_READS", "true");
  try { await ensureLeadQueryMetadata(); } finally { vi.unstubAllEnvs(); }
}, 600000);
