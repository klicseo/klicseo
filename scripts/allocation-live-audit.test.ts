// Opt-in, read-only verification against the configured database.
// KLICSEO_LIVE_AUDIT=1 node --env-file=.env node_modules/vitest/vitest.mjs run scripts/allocation-live-audit.test.ts
import { expect, it } from "vitest";
import { supabase } from "../src/lib/supabase";
import { readAllRows } from "../src/lib/db-pagination";
import { getAllAssignedLeadIds } from "../src/lib/lead-assignments";
import { countMatchingLeads } from "../src/lib/lead-routing";
import { listPaginatedLeads, listLeadStatusSummary } from "../src/lib/leads";
import { listAreasWithCounts } from "../src/lib/area";

it.skipIf(process.env.KLICSEO_LIVE_AUDIT !== "1")("live allocation pools, custom folders, and staff scopes agree with stored membership", async () => {
  const db = supabase();
  const [lists, assignments, folders, leads] = await Promise.all([
    readAllRows(db.from("lead_lists").select("id,is_custom_folder,assigned_admin_user_id").order("id")),
    readAllRows(db.from("lead_list_items").select("list_id,lead_id").order("lead_id")),
    readAllRows(db.from("lead_folder_items").select("list_id,lead_id").order("lead_id")),
    readAllRows(db.from("leads").select("id,status").order("id")),
  ]);
  const byList = new Map(lists.map((list) => [list.id, list]));
  const leadIds = new Set(leads.map((lead) => lead.id));
  const assigned = new Set(assignments.map((item) => item.lead_id));
  expect(assigned.size).toBe(assignments.length);
  expect(new Set(folders.map((item) => item.lead_id)).size).toBe(folders.length);
  expect(assignments.every((item) => byList.get(item.list_id)?.is_custom_folder === false && leadIds.has(item.lead_id))).toBe(true);
  expect(folders.every((item) => byList.get(item.list_id)?.is_custom_folder === true && leadIds.has(item.lead_id))).toBe(true);
  expect((await getAllAssignedLeadIds({ fresh: true })).size).toBe(assigned.size);
  const eligible = leads.filter((lead) => !assigned.has(lead.id));
  expect((await countMatchingLeads({})).count).toBe(eligible.length);
  const all = await listLeadStatusSummary({});
  expect(all.total).toBe(leads.length);
  expect(all.assigned).toBe(assigned.size);
  expect(all.unassigned).toBe(leads.length - assigned.size);
  for (const folder of lists.filter((list) => list.is_custom_folder)) {
    const members = new Set(folders.filter((item) => item.list_id === folder.id).map((item) => item.lead_id));
    const [rows, summary, preview, areas] = await Promise.all([
      listPaginatedLeads({ folder: folder.id, pageSize: 1 }),
      listLeadStatusSummary({ folder: folder.id }),
      countMatchingLeads({ folder: folder.id }),
      listAreasWithCounts({ folder: folder.id }),
    ]);
    expect(rows.totalCount).toBe(members.size);
    expect(summary.total).toBe(members.size);
    expect(preview.count).toBe(eligible.filter((lead) => members.has(lead.id)).length);
    expect(areas.reduce((sum, area) => sum + area.count, 0)).toBe(members.size);
  }
  const owners = [...new Set(lists.map((list) => list.assigned_admin_user_id).filter((id): id is string => !!id))];
  for (const owner of owners) {
    const owned = new Set(assignments.filter((item) => byList.get(item.list_id)?.assigned_admin_user_id === owner).map((item) => item.lead_id));
    const [rows, summary] = await Promise.all([
      listPaginatedLeads({ assignedAdminUserId: owner, pageSize: 100 }),
      listLeadStatusSummary({ assignedAdminUserId: owner }),
    ]);
    expect(rows.totalCount).toBe(owned.size);
    expect(summary.total).toBe(owned.size);
    expect(rows.leads.every((lead) => owned.has(lead.id))).toBe(true);
  }
  console.log(JSON.stringify({ leads: leads.length, assigned: assigned.size, unassigned: leads.length - assigned.size, eligible: eligible.length, customFolders: lists.filter((list) => list.is_custom_folder).length, folderMemberships: folders.length, checkedOwners: owners.length }));
}, 120_000);
