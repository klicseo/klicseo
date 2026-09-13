// Client-safe lead constants. No "server-only" guard so client components
// (status dropdown, notification bell) can import the labels/colors. DB access
// lives in lib/leads.ts (server-only), which re-exports everything here.

// "draft" is for in-progress booking-wizard captures — partial data saved
// before the user reached the final submit. Everything else is a completed
// lead. Drafts are excluded from the default admin tabs and only show on
// their own tab so they don't drown out actionable leads.
export type LeadStatus =
  | "draft"
  | "new"
  | "contacted"
  | "follow_up"
  | "call_not_responded"
  | "booked"
  | "cancelled";

export const LEAD_STATUSES: LeadStatus[] = [
  "draft",
  "new",
  "contacted",
  "follow_up",
  "call_not_responded",
  "booked",
  "cancelled",
];

export const LEAD_STATUS_LABEL: Record<LeadStatus, string> = {
  draft: "Draft",
  new: "New",
  contacted: "Contacted",
  follow_up: "Follow up",
  call_not_responded: "Call not responded",
  booked: "Booked",
  cancelled: "Cancelled",
};

export const LEAD_STATUS_COLOR: Record<LeadStatus, string> = {
  draft: "#8B5CF6", // violet — partial / unconfirmed
  new: "#3B82F6", // blue
  contacted: "#C9A84C", // gold
  follow_up: "#06B6D4", // cyan — active follow up
  call_not_responded: "#F97316", // orange — needs a retry
  booked: "#10b981", // green
  cancelled: "#EF4444", // red
};

// Lead Source Metadata (Website Booking vs Excel Upload vs Admin Manual)
export type LeadSource = "wizard" | "admin" | "upload";

export interface LeadSourceInfo {
  key: LeadSource;
  label: string;
  shortLabel: string;
  description: string;
  badgeBg: string;
  textColor: string;
  iconType: "globe" | "upload" | "user";
  fileName?: string | null;
}

export function getLeadSourceInfo(lead: {
  source?: string | null;
  notes?: string | null;
  custom_fields?: Record<string, string> | null;
}): LeadSourceInfo {
  const notes = lead.notes ?? "";
  const custom = lead.custom_fields ?? {};

  // Detect spreadsheet uploads (either source='upload', or notes with file info, or custom_fields)
  const isUpload =
    lead.source === "upload" ||
    notes.startsWith("Imported from") ||
    notes.includes("uploaded via spreadsheet") ||
    Boolean(custom["upload_file"] || custom["Upload Source"]);

  if (isUpload) {
    const fileMatch = notes.match(/Imported from (.+)/);
    const fileName = fileMatch ? fileMatch[1].trim() : custom["upload_file"] || null;
    return {
      key: "upload",
      label: fileName ? `Spreadsheet (${fileName})` : "Spreadsheet Upload",
      shortLabel: "Excel Upload",
      description: fileName
        ? `Imported via spreadsheet file: "${fileName}"`
        : "Imported via spreadsheet batch upload",
      badgeBg: "bg-purple-500/10 border-purple-500/30",
      textColor: "text-purple-300",
      iconType: "upload",
      fileName,
    };
  }

  if (lead.source === "wizard") {
    return {
      key: "wizard",
      label: "Website Booking Form",
      shortLabel: "Website Form",
      description: "Submitted online by the customer through the public website booking wizard",
      badgeBg: "bg-emerald-500/10 border-emerald-500/30",
      textColor: "text-emerald-300",
      iconType: "globe",
    };
  }

  return {
    key: "admin",
    label: "Admin Manual Entry",
    shortLabel: "Admin Added",
    description: "Created manually by an admin user from the dashboard",
    badgeBg: "bg-amber-500/10 border-amber-500/30",
    textColor: "text-amber-300",
    iconType: "user",
  };
}

export function isWebsiteFormLead(lead: { source?: string | null }): boolean {
  return lead.source === "wizard";
}

export function isHotLead(lead: {
  source?: string | null;
  isBulkUpload?: boolean | null;
  notes?: string | null;
  custom_fields?: Record<string, string> | null;
}): boolean {
  if (lead.source === "wizard") return false;
  if (lead.isBulkUpload) return false;
  const notes = lead.notes ?? "";
  const custom = lead.custom_fields ?? {};
  const isUpload =
    lead.source === "upload" ||
    notes.startsWith("Imported from") ||
    notes.includes("uploaded via spreadsheet") ||
    Boolean(custom["upload_file"] || custom["Upload Source"]);
  if (isUpload) return false;
  return lead.source === "admin" || lead.source === "manual";
}

export function isYearLead(
  lead: {
    source?: string | null;
    isBulkUpload?: boolean | null;
    notes?: string | null;
    custom_fields?: Record<string, any> | null;
    year?: string | null;
    created_at?: string | null;
  },
  targetYear?: string | null
): boolean {
  if (isWebsiteFormLead(lead)) return false;
  if (isHotLead(lead)) return false;
  const yr = lead.year || (lead.created_at ? new Date(lead.created_at).getFullYear().toString() : "2026");
  if (!targetYear || targetYear === "all") return true;
  return yr === targetYear;
}

// A lead OR employee surfaced as a "call reminder" in the notification bell.
//   due     → a scheduled callback whose date+time has arrived
//   new     → a fresh, uncontacted lead with no scheduled callback
//   applied → a new job application awaiting review
export type ReminderKind = "due" | "new" | "applied";

export interface CallReminder {
  id: string;
  name: string | null;
  phone: string | null;
  reason: string;
  kind: ReminderKind;
  /** Detail-page URL — `/admin/<id>` for leads, `/admin/employees/<id>` for employees. */
  href: string;
}

/** A contacted outcome completes the first calling task; unanswered/custom statuses stay pending. */
export function isCompletedLeadStatus(status: string | null | undefined): boolean {
  return ["contacted", "booked", "cancelled", "follow_up"].includes(status ?? "new");
}
