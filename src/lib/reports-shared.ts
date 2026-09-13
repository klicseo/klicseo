import type { LeadStatus } from "./leads";

export interface StaffDailyMetric {
  adminUserId: string;
  email: string;
  name: string;
  role: string;
  avatarUrl?: string;
  // Activity / Call Dispositions for the selected date/range
  totalCalls: number;
  bookedCount: number;
  contactedCount: number;
  followUpCount: number;
  notRespondedCount: number;
  cancelledCount: number;
  draftCount: number;
  newCount: number;
  // Computed Rates
  connectivityRate: number; // (contacted + booked + follow_up + cancelled) / totalCalls * 100
  conversionRate: number;   // booked / (contacted + booked + follow_up + cancelled) * 100
  // Queue stats
  totalAssignedLeads: number;
  pendingUncalledLeads: number;
  queueBreakdown?: {
    total: number;
    pending: number;        // new, draft, unanswered, and custom pending statuses
    completed: number;      // total - pending
    booked: number;
    contacted: number;
    follow_up: number;
    not_responded: number;
    cancelled: number;
  };
  targetCalls: number; // Default daily goal e.g. 35
}

export interface DailyReportSummary {
  date: string;              // Primary display date (YYYY-MM-DD)
  startDate: string;         // Filter start ISO or YYYY-MM-DD
  endDate: string;           // Filter end ISO or YYYY-MM-DD
  isSingleDay: boolean;
  isAllTime?: boolean;
  totalCalls: number;
  totalBookings: number;
  totalFollowUps: number;
  totalContacted: number;
  totalNotResponded: number;
  totalCancelled: number;
  activeStaffCount: number;
  overallConnectivityRate: number;
  overallConversionRate: number;
  staffMetrics: StaffDailyMetric[];
}

export interface StaffTimelineEvent {
  id: string;
  timestamp: string; // ISO string
  timeFormatted: string; // e.g. "10:30 AM"
  action: string;
  leadId: string;
  leadName?: string | null;
  leadPhone?: string | null;
  leadArea?: string | null;
  leadService?: string | null;
  statusTo?: LeadStatus | null;
  summary?: string | null;
  notes?: string | null;
}

export interface DailyReportFilter {
  date?: string;             // YYYY-MM-DD for single day
  startDate?: string;        // YYYY-MM-DD for range start
  endDate?: string;          // YYYY-MM-DD for range end
  isAllTime?: boolean;
  preset?: "today" | "yesterday" | "last7days" | "thismonth" | "all_time" | "custom";
  assignedAdminUserId?: string;
}
