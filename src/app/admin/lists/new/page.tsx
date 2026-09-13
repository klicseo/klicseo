import { notFound } from "next/navigation";
import AdminShell from "../../AdminShell";
import AdminBackButton from "@/components/AdminBackButton";
import { createLeadListAction } from "../actions";
import LeadListForm from "../LeadListForm";
import { listAssignableAdminUsers } from "@/lib/admin-users";
import { currentAdmin } from "@/lib/admin-auth";

export default async function NewLeadListPage() {
  const me = await currentAdmin();
  if (!me?.permissions.includes("leads.manage")) notFound();

  let employees: { id: string; name: string }[] = [];
  try {
    const adminUsers = me.role === "super_admin" ? await listAssignableAdminUsers() : [];
    employees = adminUsers.map((user) => ({ id: user.id, name: user.name }));
  } catch (err) {
    console.warn("Failed to fetch employees for list assignment:", err);
  }

  return (
    <AdminShell require="leads.manage">
      <div className="max-w-5xl">
        <AdminBackButton
          fallbackHref="/admin/lists"
          label="Back to lists"
          className="inline-flex items-center gap-1.5 text-xs text-white/60 hover:text-white mb-4"
        />
        <h1 className="text-2xl font-bold mb-1" style={{ fontFamily: "var(--font-playfair)" }}>
          Create Lead List
        </h1>
        <p className="text-white/45 text-sm mb-6">Create a new list to group leads for assignment to staff.</p>
        <LeadListForm
          employees={employees}
          action={createLeadListAction}
          submitLabel="Create List"
          pendingLabel="Creating..."
        />
      </div>
    </AdminShell>
  );
}
