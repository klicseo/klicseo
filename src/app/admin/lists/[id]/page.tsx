import { databaseLeadReadsEnabled } from "@/lib/lead-query";
import { listServiceCounts } from "@/lib/leads";
import { redirect, notFound } from "next/navigation";
import AdminShell from "../../AdminShell";
import AdminError from "../../AdminError";
import { getLeadList, getLeadsInList } from "@/lib/leadLists";
import type { LeadListRow } from "@/lib/leadLists-shared";
import { getSiteSettings } from "@/lib/site-settings";
import LeadListDetailClient from "./LeadListDetailClient";
import { currentAdmin, resolveScope } from "@/lib/admin-auth";
import { listAssignableAdminUsers } from "@/lib/admin-users";

export default async function LeadListPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const me = await currentAdmin();
  if (!me) redirect("/admin/login");
  if (!me.permissions.includes("leads.view")) notFound();

  let list: LeadListRow | null = null;
  let leads: Awaited<ReturnType<typeof getLeadsInList>> = [];
  let adminUsers: { id: string; email: string; name: string }[] = [];
  let notFoundError = false;
  let leadStatuses = undefined;
  let services: Array<{service: string; count: number}> = [];

  try {
    const [fetchedList, siteSettings] = await Promise.all([
      getLeadList(id),
      getSiteSettings().catch(() => null),
    ]);
    list = fetchedList;
    leadStatuses = siteSettings?.leadStatuses;
    if (!list) notFoundError = true;

    // Scope guard: non-super-admins may only view lists assigned to them.
    if (list && me && me.role !== "super_admin") {
      const scope = (await resolveScope(me)) ?? { kind: "all" as const };
      if (scope.kind === "assigned" && list.assigned_admin_user_id !== scope.adminUserId) {
        notFoundError = true;
      }
    }

    const isSuperAdmin = me?.role === "super_admin";

    const leadScope = await resolveScope(me);
    if (list && !notFoundError) {
      const [fetchedLeads, assignableUsers, fetchedServices] = await Promise.all([
        getLeadsInList(id, { limit: databaseLeadReadsEnabled() ? 50 : undefined, assignedAdminUserId: leadScope?.kind === "assigned" ? leadScope.adminUserId : undefined }),
        isSuperAdmin ? listAssignableAdminUsers().catch(() => []) : Promise.resolve([]),
        databaseLeadReadsEnabled() ? listServiceCounts({ folder: id, assignedAdminUserId: leadScope?.kind === "assigned" ? leadScope.adminUserId : undefined }) : Promise.resolve([]),
      ]);
      leads = fetchedLeads;
      services = fetchedServices;
      adminUsers = assignableUsers.map((u) => ({ id: u.id, email: u.email, name: u.name }));
    }
  } catch (err) {
    return (
      <AdminShell require="leads.view">
        <AdminError err={err} />
      </AdminShell>
    );
  }

  if (notFoundError) notFound();
  if (!list) return null;
  if (list.is_custom_folder) redirect(`/admin?folder=${encodeURIComponent(list.id)}`);

  return (
    <AdminShell require="leads.view">
      <LeadListDetailClient
        list={list}
        initialLeads={leads}
        serverPagination={databaseLeadReadsEnabled()}
        initialServices={services}
        adminUsers={adminUsers}
        isSuperAdmin={me?.role === "super_admin"}
        leadStatuses={leadStatuses}
        canManage={me.permissions.includes("leads.manage")}
      />
    </AdminShell>
  );
}

