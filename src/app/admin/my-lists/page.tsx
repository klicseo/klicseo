import Link from "next/link";
import { listLeads } from "@/lib/leads";
import { formatPhone } from "@/lib/phone-shared";
import AdminShell from "../AdminShell";
import AdminError from "../AdminError";
import { currentAdmin } from "@/lib/admin-auth";
import { getAdminUser, listAssignableAdminUsers } from "@/lib/admin-users";
import { listLeadLists } from "@/lib/leadLists";
import type { LeadListRow } from "@/lib/leadLists-shared";
import StaffDatewiseLeadListsView from "./StaffDatewiseLeadListsView";

export default async function MyListsPage({ searchParams }: { searchParams: Promise<{ q?: string }> }) {
  const { q = "" } = await searchParams;
  const me = await currentAdmin();
  const user = me ? await getAdminUser(me.email) : null;

  if (!user) {
    return (
      <AdminShell require="leads.view">
        <div className="max-w-xl mx-auto rounded-2xl border border-white/10 bg-[#071228] p-8 text-center space-y-3">
          <h1 className="text-xl font-bold text-white" style={{ fontFamily: "var(--font-playfair)" }}>
            No admin account found
          </h1>
          <p className="text-xs text-white/45">You must be signed in with an admin account to access your assigned lists.</p>
        </div>
      </AdminShell>
    );
  }

  const isSuperAdmin = me?.role === "super_admin";

  let lists: LeadListRow[] = [];
  let adminUsers: { id: string; email: string; name: string }[] = [];

  try {
    if (isSuperAdmin) {
      const [allLists, users] = await Promise.all([
        listLeadLists(),
        listAssignableAdminUsers(),
      ]);
      lists = allLists;
      adminUsers = users.map((u) => ({ id: u.id, email: u.email, name: u.name }));
    } else {
      lists = await listLeadLists({ assignedAdminUserId: user.id });
    }
  } catch (err) {
    return (
      <AdminShell require="leads.view">
        <AdminError err={err} />
      </AdminShell>
    );
  }

  const matches = q.trim() && me?.permissions.includes("leads.view")
    ? await listLeads({ search: q, assignedAdminUserId: isSuperAdmin ? undefined : user.id, limit: 100 })
    : [];

  const currentUserData = {
    id: user.id,
    email: user.email,
    name: user.employees?.name || user.email.split("@")[0],
    role: me?.role || "staff",
  };

  return (
    <AdminShell require="leads.view">
      <div className="mb-5 flex flex-wrap gap-3">
        <form className="flex flex-1 gap-2">
          <input name="q" type="search" aria-label="Search my leads" defaultValue={q} placeholder="Search my leads: name, phone, car…" className="flex-1 rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm" />
          <button className="text-sm text-[#E8CC7A]">Search</button>
        </form>
        {me?.permissions.includes("leads.manage") && <Link href="/admin/lists/new" className="text-sm text-[#E8CC7A]">Create folder</Link>}
      </div>
      {q.trim() ? <div className="space-y-3">
        <p className="text-sm">{matches.length} matching leads{matches.length === 100 ? " (first 100)" : ""}</p>
        <Link href="/admin/my-lists" className="text-sm text-[#E8CC7A]">Clear search</Link>
        {matches.map((lead) => <Link key={lead.id} href={`/admin/${lead.id}`} className="block rounded-lg border border-white/10 p-3 text-sm">{lead.name || "Unnamed lead"} · {formatPhone(lead.phone)} · {lead.area || ""}</Link>)}
      </div> : <StaffDatewiseLeadListsView
        lists={lists}
        currentUser={currentUserData}
        isSuperAdmin={isSuperAdmin}
        adminUsers={adminUsers}
      />}
    </AdminShell>
  );
}
