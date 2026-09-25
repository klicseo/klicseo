import { Suspense } from "react";
import NotificationBell from "./NotificationBell";
import { redirect } from "next/navigation";
import { currentAdmin, resolveScope } from "@/lib/admin-auth";
import { type Permission } from "@/lib/admin-users-shared";
import { listCallReminders } from "@/lib/leads";
import { listEmployeeCallReminders } from "@/lib/employees";
import type { CallReminder } from "@/lib/leads-shared";
import Sidebar, { type NavGroup } from "./Sidebar";
import AuthSessionGuard from "./AuthSessionGuard";

async function ReminderBell({ reminders, align }: { reminders: Promise<CallReminder[]>; align: "left" | "right" }) {
  return <NotificationBell items={await reminders} align={align} />;
}

export default async function AdminShell({
  children,
  require,
  section = "leads",
}: {
  children: React.ReactNode;
  require?: Permission | Permission[];
  section?: "leads" | "employees";
}) {
  const me = await currentAdmin();
  if (!me) redirect("/admin/login");

  const can = (p: Permission) => me.permissions.includes(p);
  const canManageAccess = me.role === "super_admin" || me.role === "admin";
  const isSuperAdmin = me.role === "super_admin";
  const denied = require != null && (Array.isArray(require) ? !require.some(can) : !can(require));

  // Resolve scope once for the whole shell
  const scope = (await resolveScope(me)) ?? { kind: "all" as const };
  const assignedAdminUserId = scope.kind === "assigned" ? scope.adminUserId : undefined;

  // Build nav groups
  const groups: NavGroup[] = [];

  const leadsItems = [
    canManageAccess && can("leads.view") && { href: "/admin", label: "All Leads", icon: "Inbox" as const, exact: true },
    canManageAccess && can("leads.view") && { href: "/admin/analytics", label: "Analytics", icon: "TrendingUp" as const },
    isSuperAdmin && can("leads.view") && { href: "/admin/lists", label: "Lead Lists", icon: "ClipboardList" as const },
    !isSuperAdmin && can("leads.view") && { href: "/admin/my-lists", label: "My Leads", icon: "Inbox" as const },
    can("leads.view") && { href: "/admin/reports", label: "Daily Reports", icon: "BarChart3" as const },
    can("leads.manage") && { href: "/admin/new", label: "Add Lead", icon: "PlusCircle" as const },
    can("leads.manage") && { href: "/admin/upload", label: "Upload Leads", icon: "UploadCloud" as const },
    can("payments.view") && { href: "/admin/payments", label: "Payments", icon: "Wallet" as const },
  ].filter(Boolean) as NavGroup["items"];
  if (leadsItems.length) groups.push({ title: "Leads", items: leadsItems });

  const employeeItems = [
    isSuperAdmin && can("employees.view") && { href: "/admin/employees", label: "All Employees", icon: "Users" as const },
    can("employees.view") && { href: "/admin/my-employees", label: "My Employees", icon: "Users" as const },
    can("employees.manage") && { href: "/admin/employees/new", label: "Add Employee", icon: "UserPlus" as const },
    can("employees.manage") && { href: "/admin/employees/upload", label: "Upload Employees", icon: "UploadCloud" as const },
  ].filter(Boolean) as NavGroup["items"];
  if (employeeItems.length) groups.push({ title: "Employees", items: employeeItems });

  if (canManageAccess) {
    const empGroup = groups.find((g) => g.title === "Employees");
    if (empGroup) empGroup.items.push({ href: "/admin/jobs", label: "Jobs", icon: "Briefcase" });
    else groups.push({ title: "Employees", items: [{ href: "/admin/jobs", label: "Jobs", icon: "Briefcase" }] });

    groups.push({
      title: "Settings",
      items: [
        { href: "/admin/cars", label: "Cars", icon: "Car" },
        { href: "/admin/discount", label: "Discount", icon: "Tag" },
        { href: "/admin/booking", label: "Booking", icon: "ClipboardList" },
        { href: "/admin/settings", label: "Site", icon: "Settings2" },
        { href: "/admin/access", label: "Team", icon: "UserCog" },
        { href: "/admin/logs", label: "Audit logs", icon: "ScrollText" },
      ],
    });
  }

  const bellPermission: Permission = section === "employees" ? "employees.view" : "leads.view";
  // Both responsive bells share one scoped request, outside the page's critical path.
  const reminders = can(bellPermission)
    ? (section === "employees"
      ? listEmployeeCallReminders({ assignedAdminUserId })
      : listCallReminders({ assignedAdminUserId })).catch(() => [] as CallReminder[])
    : Promise.resolve([] as CallReminder[]);
  const notificationSlot = (align: "left" | "right") => (
    <Suspense fallback={<span className="block h-9 w-9 animate-pulse rounded-xl bg-white/5" role="status" aria-label="Loading notifications" />}>
      <ReminderBell reminders={reminders} align={align} />
    </Suspense>
  );

  return (
    <div className="min-h-screen bg-[#050E21] text-white selection:bg-[#C9A84C]/30 selection:text-[#E8CC7A] overflow-x-clip">
      <AuthSessionGuard />
      <Sidebar
        groups={groups}
        email={me.email}
        role={me.role}
        desktopNotifications={notificationSlot("left")}
        mobileNotifications={notificationSlot("right")}
        showBell={can(bellPermission)}
      />

      <div className="md:pl-64 flex flex-col min-h-screen min-w-0">
        <main className="flex-1 px-3 sm:px-4 md:px-8 py-4 sm:py-6 md:py-8 pt-18 md:pt-8 max-w-7xl w-full mx-auto min-w-0">
          {denied ? (
            <div className="mx-auto max-w-md text-center py-24 rounded-2xl border border-white/10 bg-[#071228] p-8">
              <h1 className="text-xl font-bold mb-2 text-white" style={{ fontFamily: "var(--font-playfair)" }}>
                Access Restricted
              </h1>
              <p className="text-white/45 text-xs">
                Your role does not have permission to access this view. Contact an administrator for assistance.
              </p>
            </div>
          ) : (
            children
          )}
        </main>
      </div>
    </div>
  );
}
