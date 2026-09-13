import { redirect } from "next/navigation";
import { UploadCloud } from "lucide-react";
import AdminShell from "../AdminShell";
import AdminBackButton from "@/components/AdminBackButton";
import { currentAdmin } from "@/lib/admin-auth";
import { listLeadLists } from "@/lib/leadLists";
import { getAdminUser, listAdminUsers } from "@/lib/admin-users";
import LeadUploadClient from "./LeadUploadClient";

export const dynamic = "force-dynamic";

export default async function LeadUploadPage({
  searchParams,
}: {
  searchParams: Promise<{ listId?: string }>;
}) {
  const me = await currentAdmin();
  if (!me) redirect("/admin/login");
  if (!me.permissions.includes("leads.manage")) redirect("/admin");

  const { listId } = await searchParams;
  const adminRow = me.email ? await getAdminUser(me.email) : null;
  const isStaff = me.role !== "super_admin";

  const [leadLists, adminUsers] = await Promise.all([
    listLeadLists(isStaff && adminRow?.id ? { assignedAdminUserId: adminRow.id } : undefined),
    isStaff ? Promise.resolve([]) : listAdminUsers(),
  ]);

  const activeAdmins = adminUsers.filter((u) => u.status === "active");
  const fallbackHref = listId ? `/admin/lists/${listId}` : "/admin";
  const backLabel = listId ? "Back to list" : "Back to Leads";

  return (
    <AdminShell require="leads.manage">
      <div className="space-y-6">
        <div className="flex items-center justify-between gap-4 flex-wrap">
          <AdminBackButton
            fallbackHref={fallbackHref}
            label={backLabel}
            className="inline-flex items-center gap-1.5 text-xs text-white/50 hover:text-white transition-colors"
          />
        </div>

        <div className="flex items-start gap-3.5">
          <div className="grid h-12 w-12 shrink-0 place-items-center rounded-2xl bg-[#C9A84C]/15 ring-1 ring-[#C9A84C]/25 text-[#C9A84C]">
            <UploadCloud size={24} />
          </div>
          <div>
            <h1
              className="text-2xl font-bold leading-tight text-white"
              style={{ fontFamily: "var(--font-playfair)" }}
            >
              Upload Leads
            </h1>
            <p className="text-white/50 text-xs mt-0.5">
              Bulk import leads from Excel (.xlsx, .xls) or CSV files. Automatically detects columns,
              normalizes mobile numbers, encrypts sensitive data, and associates with lead lists.
            </p>
          </div>
        </div>

        <LeadUploadClient
          existingLists={leadLists}
          assignableAdmins={activeAdmins}
          preselectedListId={listId}
        />
      </div>
    </AdminShell>
  );
}
