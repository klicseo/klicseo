// Client-safe lead lists constants. No "server-only" guard so client components
// can import the types.

export interface LeadListRow {
  id: string;
  name: string;
  is_custom_folder?: boolean;
  created_at: string;
  created_by: string | null; // admin user id who created the list
  assigned_admin_user_id: string | null; // admin user id assigned to this list
  assigned_admin_user?: { email: string | null; name?: string | null } | null;
  assigned_employee_id?: string | null; // legacy employee id, kept for backward compatibility
  lead_count?: number; // total leads in batch
  completed_count?: number; // total called/completed leads
  pending_count?: number; // leads pending to call
  completion_rate?: number; // percentage 0-100
  status_counts?: Record<string, number>; // breakdown by lead status
  admin_users?: { email: string | null } | null;
  employees?: { name: string | null } | null;
}

export interface NewLeadList {
  name: string;
  is_custom_folder?: boolean;
  created_by?: string | null; // optional, will be set from current admin on server
  assigned_admin_user_id?: string | null;
}

export interface LeadListItem {
  list_id: string;
  lead_id: string;
  added_at: string;
}
