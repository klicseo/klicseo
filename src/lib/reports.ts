import "server-only";
import { readAllRows } from "./db-pagination";
import { isCompletedLeadStatus } from "./leads-shared";
import { supabase } from "./supabase";
import { listAdminUsers } from "./admin-users";
import { unsealFields, unseal, isSealed } from "./crypto";
import { ENCRYPTED_LEAD_FIELDS, type LeadStatus, type LeadRow } from "./leads";
import type {
  DailyReportFilter,
  DailyReportSummary,
  StaffDailyMetric,
  StaffTimelineEvent,
} from "./reports-shared";

/**
 * Returns today's date in IST formatted as YYYY-MM-DD
 */
export function getTodayIST(): string {
  const now = new Date();
  // Adjust for IST (+5:30)
  const istOffset = 5.5 * 60 * 60 * 1000;
  const istDate = new Date(now.getTime() + istOffset);
  return istDate.toISOString().slice(0, 10);
}

/**
 * Converts an IST date string (YYYY-MM-DD) into UTC ISO range [start, end]
 */
export function istDateToUtcRange(dateStr: string): { startUtc: string; endUtc: string } {
  const [year, month, day] = dateStr.split("-").map((n) => parseInt(n, 10));
  
  // IST 00:00:00 is previous day 18:30:00 UTC
  const startDate = new Date(Date.UTC(year, month - 1, day, 0, 0, 0, 0));
  startDate.setMinutes(startDate.getMinutes() - 330); // minus 5 hrs 30 mins

  // IST 23:59:59.999 is same day 18:29:59.999 UTC
  const endDate = new Date(Date.UTC(year, month - 1, day, 23, 59, 59, 999));
  endDate.setMinutes(endDate.getMinutes() - 330);

  return {
    startUtc: startDate.toISOString(),
    endUtc: endDate.toISOString(),
  };
}

/**
 * Converts an IST date range (start YYYY-MM-DD, end YYYY-MM-DD) into UTC ISO range
 */
export function istRangeToUtcRange(
  startDateStr: string,
  endDateStr: string,
): { startUtc: string; endUtc: string } {
  const start = istDateToUtcRange(startDateStr).startUtc;
  const end = istDateToUtcRange(endDateStr).endUtc;
  return { startUtc: start, endUtc: end };
}

/**
 * Decrypts sealed metadata in audit log rows
 */
export function unsealAuditMetadata<T extends { metadata: any }>(log: T): T {
  const m = log.metadata as { __sealed?: unknown } | null;
  if (m && isSealed(m.__sealed)) {
    try {
      const json = unseal(m.__sealed as string);
      const parsed = json ? (JSON.parse(json) as Record<string, unknown>) : null;
      return { ...log, metadata: parsed };
    } catch {
      return log;
    }
  }
  return log;
}

/**
 * Parses the target lead status from an audit log summary, metadata or diff
 */
function extractStatusFromAudit(rawLog: { action: string; summary: string | null; metadata: any }): LeadStatus | null {
  const log = unsealAuditMetadata(rawLog);
  const valid: LeadStatus[] = [
    "new",
    "contacted",
    "follow_up",
    "call_not_responded",
    "booked",
    "cancelled",
    "draft",
  ];

  const meta = log.metadata;
  if (meta?.status && typeof meta.status === "string") {
    const s = meta.status.toLowerCase().trim() as LeadStatus;
    if (valid.includes(s)) return s;
  }
  if (meta?.after?.status && typeof meta.after.status === "string") {
    const s = meta.after.status.toLowerCase().trim() as LeadStatus;
    if (valid.includes(s)) return s;
  }
  if (meta?.diff?.status?.to && typeof meta.diff.status.to === "string") {
    const s = meta.diff.status.to.toLowerCase().trim() as LeadStatus;
    if (valid.includes(s)) return s;
  }
  if (meta?.diff?.status?.after && typeof meta.diff.status.after === "string") {
    const s = meta.diff.status.after.toLowerCase().trim() as LeadStatus;
    if (valid.includes(s)) return s;
  }

  if (log.summary) {
    const match =
      log.summary.match(/→\s*([a-zA-Z_]+)/i) ||
      log.summary.match(/status\s*:\s*([a-zA-Z_]+)/i) ||
      log.summary.match(/to\s+([a-zA-Z_]+)/i);
    if (match && match[1]) {
      const raw = match[1].toLowerCase().trim() as LeadStatus;
      if (valid.includes(raw)) {
        return raw;
      }
    }
  }
  return null;
}

/**
 * Get daily progress report for all staff for a specific date, date range, or all-time.
 */
export async function getDailyStaffReport(
  filter?: DailyReportFilter,
): Promise<DailyReportSummary> {
  const today = getTodayIST();
  const isAllTime = Boolean(filter?.isAllTime || filter?.preset === "all_time");
  const primaryDate = filter?.date || today;
  const startDate = filter?.startDate || primaryDate;
  const endDate = filter?.endDate || primaryDate;
  const isSingleDay = !isAllTime && startDate === endDate;

  // Compute UTC timestamp bounds for query if not all-time
  const { startUtc, endUtc } = isAllTime
    ? { startUtc: "", endUtc: "" }
    : isSingleDay
    ? istDateToUtcRange(startDate)
    : istRangeToUtcRange(startDate, endDate);

  // 1. Fetch active staff / admin users
  const adminUsers = await listAdminUsers().catch(() => []);
  const activeStaff = adminUsers.filter(
    (u) => u.status === "active" && (!filter?.assignedAdminUserId || u.id === filter.assignedAdminUserId),
  );

  // Map of email → AdminUser
  const staffByEmail = new Map<string, (typeof activeStaff)[0]>();
  for (const s of activeStaff) {
    staffByEmail.set(s.email.toLowerCase(), s);
  }

  // 2. Fetch queue stats & exact status breakdown per staff
  let queueQuery = supabase()
    .from("lead_list_items")
    .select(`
      list_id,
      lead_id,
      lead_lists!inner(assigned_admin_user_id),
      leads:lead_id (status)
    `);

  if (filter?.assignedAdminUserId) {
    queueQuery = queueQuery.eq("lead_lists.assigned_admin_user_id", filter.assignedAdminUserId);
  }

  const queueItems = await readAllRows(queueQuery.order("lead_id"));

  const assignedCountByStaff = new Map<string, number>();
  const pendingCountByStaff = new Map<string, number>();
  const queueStatusByStaff = new Map<
    string,
    {
      new: number;
      draft: number;
      booked: number;
      contacted: number;
      follow_up: number;
      call_not_responded: number;
      cancelled: number;
    }
  >();

  for (const item of queueItems ?? []) {
    const adminId = (item.lead_lists as any)?.assigned_admin_user_id;
    if (!adminId) continue;

    assignedCountByStaff.set(adminId, (assignedCountByStaff.get(adminId) ?? 0) + 1);

    if (!queueStatusByStaff.has(adminId)) {
      queueStatusByStaff.set(adminId, {
        new: 0,
        draft: 0,
        booked: 0,
        contacted: 0,
        follow_up: 0,
        call_not_responded: 0,
        cancelled: 0,
      });
    }

    const lead: any = Array.isArray(item.leads) ? item.leads[0] : item.leads;
    const status = ((lead?.status ?? "new") as string).toLowerCase().trim() as LeadStatus;
    const breakdown = queueStatusByStaff.get(adminId)!;

    if (status === "booked") breakdown.booked += 1;
    else if (status === "contacted") breakdown.contacted += 1;
    else if (status === "follow_up") breakdown.follow_up += 1;
    else if (status === "call_not_responded") breakdown.call_not_responded += 1;
    else if (status === "cancelled") breakdown.cancelled += 1;
    else if (status === "draft") breakdown.draft += 1;
    else breakdown.new += 1;

    if (!isCompletedLeadStatus(status)) {
      pendingCountByStaff.set(adminId, (pendingCountByStaff.get(adminId) ?? 0) + 1);
    }
  }

  // 3. Fetch audit logs in the date window for lead actions
  let auditQuery = supabase()
    .from("audit_logs")
    .select("id, created_at, actor_email, action, entity, entity_id, summary, metadata")
    .in("action", ["lead.status", "lead.create", "lead.notes", "lead.update"]);

  if (!isAllTime && startUtc && endUtc) {
    auditQuery = auditQuery.gte("created_at", startUtc).lte("created_at", endUtc);
  }

  if (filter?.assignedAdminUserId && activeStaff.length === 1) {
    auditQuery = auditQuery.ilike("actor_email", activeStaff[0].email);
  }

  const logs = await readAllRows(auditQuery.order("created_at", { ascending: true }).order("id"));

  // 4. Aggregate metrics per staff
  type MetricAccumulator = {
    totalCalls: number;
    bookedCount: number;
    contactedCount: number;
    followUpCount: number;
    notRespondedCount: number;
    cancelledCount: number;
    draftCount: number;
    newCount: number;
  };

  const activityByEmail = new Map<string, MetricAccumulator>();

  for (const log of logs ?? []) {
    if (!log.actor_email) continue;
    const email = log.actor_email.toLowerCase();

    if (!activityByEmail.has(email)) {
      activityByEmail.set(email, {
        totalCalls: 0,
        bookedCount: 0,
        contactedCount: 0,
        followUpCount: 0,
        notRespondedCount: 0,
        cancelledCount: 0,
        draftCount: 0,
        newCount: 0,
      });
    }

    const acc = activityByEmail.get(email)!;

    if (log.action === "lead.status" || log.action === "lead.update") {
      const metadata = unsealAuditMetadata(log).metadata;
      const unchangedEdit = log.action === "lead.update" && metadata?.before?.status !== undefined && metadata.before.status === metadata?.after?.status;
      const status = unchangedEdit ? null : extractStatusFromAudit(log);
      if (status) {
        acc.totalCalls += 1;
        if (status === "booked") acc.bookedCount += 1;
        else if (status === "contacted") acc.contactedCount += 1;
        else if (status === "follow_up") acc.followUpCount += 1;
        else if (status === "call_not_responded") acc.notRespondedCount += 1;
        else if (status === "cancelled") acc.cancelledCount += 1;
        else if (status === "draft") acc.draftCount += 1;
        else if (status === "new") acc.newCount += 1;
      }
    }
  }

  // 5. Build StaffDailyMetric array
  const staffMetrics: StaffDailyMetric[] = [];
  let summaryTotalCalls = 0;
  let summaryTotalBooked = 0;
  let summaryTotalFollowUp = 0;
  let summaryTotalContacted = 0;
  let summaryTotalNotResponded = 0;
  let summaryTotalCancelled = 0;

  for (const staff of activeStaff) {
    const email = staff.email.toLowerCase();
    const act = activityByEmail.get(email) ?? {
      totalCalls: 0,
      bookedCount: 0,
      contactedCount: 0,
      followUpCount: 0,
      notRespondedCount: 0,
      cancelledCount: 0,
      draftCount: 0,
      newCount: 0,
    };

    const connectedCalls =
      act.contactedCount + act.bookedCount + act.followUpCount + act.cancelledCount;

    const connectivityRate =
      act.totalCalls > 0 ? Math.round((connectedCalls / act.totalCalls) * 100) : 0;

    const conversionRate =
      connectedCalls > 0 ? Math.round((act.bookedCount / connectedCalls) * 100) : 0;

    const name = staff.employees?.name || staff.email.split("@")[0];
    const totalAssigned = assignedCountByStaff.get(staff.id) ?? 0;
    const pendingCount = pendingCountByStaff.get(staff.id) ?? 0;
    const qb = queueStatusByStaff.get(staff.id) ?? {
      new: 0,
      draft: 0,
      booked: 0,
      contacted: 0,
      follow_up: 0,
      call_not_responded: 0,
      cancelled: 0,
    };
    const completedCount = Math.max(0, totalAssigned - pendingCount);

    staffMetrics.push({
      adminUserId: staff.id,
      email: staff.email,
      name,
      role: staff.role,
      totalCalls: act.totalCalls,
      bookedCount: act.bookedCount,
      contactedCount: act.contactedCount,
      followUpCount: act.followUpCount,
      notRespondedCount: act.notRespondedCount,
      cancelledCount: act.cancelledCount,
      draftCount: act.draftCount,
      newCount: act.newCount,
      connectivityRate,
      conversionRate,
      totalAssignedLeads: totalAssigned,
      pendingUncalledLeads: pendingCount,
      queueBreakdown: {
        total: totalAssigned,
        pending: pendingCount,
        completed: completedCount,
        booked: qb.booked,
        contacted: qb.contacted,
        follow_up: qb.follow_up,
        not_responded: qb.call_not_responded,
        cancelled: qb.cancelled,
      },
      targetCalls: 35, // Daily calling goal benchmark
    });

    summaryTotalCalls += act.totalCalls;
    summaryTotalBooked += act.bookedCount;
    summaryTotalFollowUp += act.followUpCount;
    summaryTotalContacted += act.contactedCount;
    summaryTotalNotResponded += act.notRespondedCount;
    summaryTotalCancelled += act.cancelledCount;
  }

  // Sort staff: most bookings first, then most calls, then highest conversion rate
  staffMetrics.sort((a, b) => {
    if (b.bookedCount !== a.bookedCount) return b.bookedCount - a.bookedCount;
    if (b.totalCalls !== a.totalCalls) return b.totalCalls - a.totalCalls;
    return b.conversionRate - a.conversionRate;
  });

  const totalConnected =
    summaryTotalContacted + summaryTotalBooked + summaryTotalFollowUp + summaryTotalCancelled;

  const overallConnectivityRate =
    summaryTotalCalls > 0 ? Math.round((totalConnected / summaryTotalCalls) * 100) : 0;

  const overallConversionRate =
    totalConnected > 0 ? Math.round((summaryTotalBooked / totalConnected) * 100) : 0;

  const activeStaffCount = staffMetrics.filter((s) => s.totalCalls > 0).length;

  return {
    date: primaryDate,
    startDate,
    endDate,
    isSingleDay,
    isAllTime,
    totalCalls: summaryTotalCalls,
    totalBookings: summaryTotalBooked,
    totalFollowUps: summaryTotalFollowUp,
    totalContacted: summaryTotalContacted,
    totalNotResponded: summaryTotalNotResponded,
    totalCancelled: summaryTotalCancelled,
    activeStaffCount,
    overallConnectivityRate,
    overallConversionRate,
    staffMetrics,
  };
}

/**
 * Get detailed chronological call timeline of a staff member for a given date, range, or all time.
 */
export async function getStaffTimeline(
  actorEmail: string,
  options?: {
    date?: string;
    startDate?: string;
    endDate?: string;
    isAllTime?: boolean;
  },
): Promise<StaffTimelineEvent[]> {
  const isAllTime = Boolean(options?.isAllTime);
  const primaryDate = options?.date || getTodayIST();
  const startDate = options?.startDate || primaryDate;
  const endDate = options?.endDate || primaryDate;
  const isSingleDay = !isAllTime && startDate === endDate;

  const { startUtc, endUtc } = isAllTime
    ? { startUtc: "", endUtc: "" }
    : isSingleDay
    ? istDateToUtcRange(startDate)
    : istRangeToUtcRange(startDate, endDate);

  let query = supabase()
    .from("audit_logs")
    .select("id, created_at, action, entity, entity_id, summary, metadata")
    .ilike("actor_email", actorEmail);

  if (!isAllTime && startUtc && endUtc) {
    query = query.gte("created_at", startUtc).lte("created_at", endUtc);
  }

  const logs = await readAllRows(query.order("created_at", { ascending: false }).order("id"));
  if (!logs || logs.length === 0) return [];

  // Collect lead ids to fetch contextual lead info
  const leadIds = Array.from(
    new Set(logs.filter((l) => l.entity === "lead" && l.entity_id).map((l) => l.entity_id!)),
  );

  const leadMap = new Map<string, LeadRow>();
  if (leadIds.length > 0) {
    const { data: leadsData } = await supabase()
      .from("leads")
      .select("id, name, phone, area, service")
      .in("id", leadIds);

    for (const raw of leadsData ?? []) {
      const unsealed = unsealFields(raw as LeadRow, ENCRYPTED_LEAD_FIELDS);
      if (unsealed) leadMap.set(unsealed.id, unsealed as LeadRow);
    }
  }

  const events: StaffTimelineEvent[] = logs.map((rawLog) => {
    const l = unsealAuditMetadata(rawLog);
    const lead = l.entity_id ? leadMap.get(l.entity_id) : undefined;
    const statusTo = extractStatusFromAudit(l);

    // Format IST time
    const d = new Date(l.created_at);
    const timeFormatted = d.toLocaleTimeString("en-IN", {
      timeZone: "Asia/Kolkata",
      hour: "2-digit",
      minute: "2-digit",
      hour12: true,
    });

    return {
      id: l.id,
      timestamp: l.created_at,
      timeFormatted,
      action: l.action,
      leadId: l.entity_id ?? "",
      leadName: lead?.name || null,
      leadPhone: lead?.phone || null,
      leadArea: lead?.area || null,
      leadService: lead?.service || null,
      statusTo,
      summary: l.summary,
      notes: (l.metadata?.notes as string) || null,
    };
  });

  return events;
}

/**
 * Backward compatible alias for single date timeline
 */
export async function getStaffTimelineForDate(
  actorEmail: string,
  dateStr: string,
): Promise<StaffTimelineEvent[]> {
  return getStaffTimeline(actorEmail, { date: dateStr });
}
