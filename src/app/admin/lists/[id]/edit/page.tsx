import { redirect, notFound } from "next/navigation";
import AdminShell from "../../../AdminShell";
import AdminError from "../../../AdminError";
import AdminBackButton from "@/components/AdminBackButton";
import { getLeadList } from "@/lib/leadLists";
import { updateLeadListAction } from "../../actions";
import { listAssignableAdminUsers } from "@/lib/admin-users";
import type { LeadListRow } from "@/lib/leadLists-shared";
import LeadListForm from "../../LeadListForm";
import { assertListAccess } from "@/lib/lead-access";
import { currentAdmin } from "@/lib/admin-auth";

export default async function EditLeadListPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const me = await currentAdmin();
  if (!me?.permissions.includes("leads.manage")) notFound();
  await assertListAccess(me, id);

  let list: LeadListRow | null = null;
  let employees: { id: string; name: string }[] = [];
  try {
    const [listResult, adminUsers] = await Promise.all([
      getLeadList(id),
      me.role === "super_admin" ? listAssignableAdminUsers() : Promise.resolve([]),
    ]);
    list = listResult;
    employees = adminUsers.map((user) => ({ id: user.id, name: user.name }));
  } catch (err) {
    return (
      <AdminShell require="leads.manage">
        <AdminError err={err} />
      </AdminShell>
    );
  }

  if (!list) {
    redirect("/admin/lists");
  }


  return (
    <AdminShell require="leads.manage">
      <div className="max-w-5xl">
        <AdminBackButton
          fallbackHref={`/admin/lists/${id}`}
          label="Back to list"
          className="inline-flex items-center gap-1.5 text-xs text-white/60 hover:text-white mb-4"
        />
        <h1 className="text-2xl font-bold mb-1" style={{ fontFamily: "var(--font-playfair)" }}>
          Edit Lead List
        </h1>
        <p className="text-white/45 text-sm mb-6">
          Edit the lead list &quot;{list.name}&quot;. Changes will be saved immediately.
        </p>
        <LeadListForm
          employees={employees}
          initial={list}
          action={updateLeadListAction}
          submitLabel="Save Changes"
          pendingLabel="Saving..."
        />
      </div>
    </AdminShell>
  );
}
