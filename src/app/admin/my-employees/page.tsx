import Link from "next/link";
import { ArrowRight, Users } from "lucide-react";
import AdminShell from "../AdminShell";
import AdminError from "../AdminError";
import { currentAdmin } from "@/lib/admin-auth";
import { getAdminUser } from "@/lib/admin-users";
import { listEmployees, listJobCounts } from "@/lib/employees";
import type { EmployeeRow } from "@/lib/employees-shared";
import { jobTitleMap } from "@/lib/jobs";
import type { EmployeeStatus } from "@/lib/employees-shared";

const STATUS_TABS: { id: EmployeeStatus | "all"; label: string }[] = [
  { id: "all", label: "All" },
  { id: "applied", label: "Applied" },
  { id: "screening", label: "Screening" },
  { id: "hired", label: "Hired" },
  { id: "active", label: "Active" },
  { id: "resigned", label: "Resigned" },
  { id: "rejected", label: "Rejected" },
];

function buildMyEmployeesHref(args: { status?: EmployeeStatus | "all"; role?: string | undefined }): string {
  const params = new URLSearchParams();
  if (args.status && args.status !== "all") params.set("status", args.status);
  if (args.role) params.set("role", args.role);
  const s = params.toString();
  return `/admin/my-employees${s ? `?${s}` : ""}`;
}

export default async function MyEmployeesPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string; role?: string }>;
}) {
  const me = await currentAdmin();
  const user = me ? await getAdminUser(me.email) : null;

  if (!user) {
    return (
      <AdminShell require="employees.view" section="employees">
        <div className="max-w-xl rounded-xl border border-white/10 bg-white/[0.02] p-6 text-center">
          <div className="mx-auto mb-3 grid h-11 w-11 place-items-center rounded-xl bg-[#C9A84C]/15 text-[#C9A84C]">
            <Users size={22} />
          </div>
          <h1 className="text-xl font-bold mb-2" style={{ fontFamily: "var(--font-playfair)" }}>
            No admin account
          </h1>
          <p className="text-sm text-white/45">You must be signed in with an admin account to see your employees.</p>
        </div>
      </AdminShell>
    );
  }

  const { status, role } = await searchParams;
  const statusFilter = (STATUS_TABS.find((t) => t.id === status)?.id ?? "all") as EmployeeStatus | "all";
  const roleFilter = role && role !== "all" ? role : undefined;

  let employees: EmployeeRow[] = [];
  let roleLabel: Record<string, string> = {};
  let jobCounts: Array<{ job_role: string; count: number }> = [];
  try {
    [employees, roleLabel, jobCounts] = await Promise.all([
      listEmployees({ assignedAdminUserId: user.id, jobRole: roleFilter }),
      jobTitleMap(),
      listJobCounts({ assignedAdminUserId: user.id }),
    ]);
  } catch (err) {
    return (
      <AdminShell require="employees.view" section="employees">
        <AdminError err={err} />
      </AdminShell>
    );
  }

  // Build status counts from jobCounts data (already scoped)
  const statusCounts = new Map<EmployeeStatus | "all", number>();
  statusCounts.set("all", employees.length);
  for (const e of employees) {
    statusCounts.set(e.status, (statusCounts.get(e.status) ?? 0) + 1);
  }

  const visibleEmployees = statusFilter === "all" ? employees : employees.filter((employee) => employee.status === statusFilter);

  return (
    <AdminShell require="employees.view" section="employees">
      <div className="flex items-end justify-between mb-4 gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold" style={{ fontFamily: "var(--font-playfair)" }}>
            My Employees
          </h1>
          <p className="text-white/45 text-sm">{employees.length} assigned to {user.employees?.name ?? "you"}</p>
        </div>
      </div>

      <div className="flex gap-2 mb-4 flex-wrap">
        {STATUS_TABS.map((t) => {
          const active = statusFilter === t.id;
          const count = t.id === "all" ? employees.length : (statusCounts.get(t.id as EmployeeStatus) ?? 0);
          return (
            <Link
              key={t.id}
              href={buildMyEmployeesHref({ status: t.id, role: roleFilter })}
              className={`px-3 py-1.5 rounded-full text-xs font-semibold transition-all ${
                active ? "bg-[#C9A84C] text-[#050E21]" : "bg-white/5 text-white/60 hover:bg-white/10"
              }`}
            >
              {t.label} <span className={active ? "text-[#050E21]/60" : "text-white/35"}>{count}</span>
            </Link>
          );
        })}
      </div>

      {jobCounts && jobCounts.length > 0 && (
        <div className="flex gap-2 mb-4 flex-wrap items-center">
          <span className="text-[10px] uppercase tracking-wider text-white/35 mr-1">Role</span>
          <Link href={buildMyEmployeesHref({ status: statusFilter })} className={`px-2.5 py-1 rounded-full text-[11px] font-semibold transition-all ${!roleFilter ? "bg-white/15 text-white" : "bg-white/[0.04] text-white/55 hover:bg-white/10"}`}>
            All <span className="text-white/35">·</span> {jobCounts.reduce((n, a) => n + a.count, 0)}
          </Link>
          {jobCounts.slice(0, 20).map((a) => {
            const active = roleFilter === a.job_role;
            return (
              <Link
                key={a.job_role}
                href={buildMyEmployeesHref({ status: statusFilter, role: a.job_role })}
                className={`px-2.5 py-1 rounded-full text-[11px] font-semibold transition-all ${
                  active ? "bg-[#C9A84C] text-[#050E21]" : "bg-white/[0.04] text-white/55 hover:bg-white/10"
                }`}
              >
                {roleLabel[a.job_role] ?? a.job_role} <span className={active ? "text-[#050E21]/60" : "text-white/35"}>{a.count}</span>
              </Link>
            );
          })}
        </div>
      )}

      {visibleEmployees.length === 0 ? (
        <div className="text-center py-16 text-white/40 text-sm">No employees match this filter.</div>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-white/10">
          <table className="w-full text-sm">
            <thead className="bg-white/[0.03] text-white/50 text-[11px] uppercase tracking-wider">
              <tr>
                <th className="sticky left-0 bg-[#071228] z-20 px-3 py-2 text-left font-semibold w-12 min-w-[48px] border-r border-white/[0.04]">#</th>
                <th className="px-3 py-2 text-left font-semibold">Name</th>
                <th className="px-3 py-2 text-left font-semibold">Phone</th>
                <th className="px-3 py-2 text-left font-semibold">Role</th>
                <th className="px-3 py-2 text-left font-semibold">Open</th>
              </tr>
            </thead>
            <tbody>
              {visibleEmployees.map((e, i) => (
                <tr key={e.id} className="group border-t border-white/5 hover:bg-white/[0.02]">
                  <td className="sticky left-0 z-10 w-12 min-w-[48px] bg-[#050E21] group-hover:bg-[#091733] border-r border-white/[0.04] px-3 py-2 text-white/40 text-xs tabular-nums">{i + 1}</td>
                  <td className="px-3 py-2">
                    <Link href={`/admin/employees/${e.id}`} className="hover:text-[#C9A84C] hover:underline">
                      {e.name}
                    </Link>
                  </td>
                  <td className="px-3 py-2">{e.phone}</td>
                  <td className="px-3 py-2 text-xs">{e.job_role}</td>
                  <td className="px-3 py-2 text-center">
                    <Link
                      href={`/admin/employees/${e.id}`}
                      className="inline-flex items-center gap-1 text-xs px-2 py-1 rounded bg-white/10 text-white/70 hover:text-white hover:bg-white/15"
                    >
                      Open <ArrowRight size={12} />
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </AdminShell>
  );
}
