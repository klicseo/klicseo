import { notFound } from "next/navigation";
import AdminShell from "../../../AdminShell";
import AdminError from "../../../AdminError";
import AdminBackButton from "@/components/AdminBackButton";
import EmployeeForm from "../../EmployeeForm";
import { updateEmployeeAction } from "../../actions";
import { getEmployee, assertEmployeeInScope } from "@/lib/employees";
import { listJobs } from "@/lib/jobs";
import { listAssignableAdminUsers } from "@/lib/admin-users";
import { currentAdmin, resolveScope } from "@/lib/admin-auth";

export default async function EditEmployeePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const me = await currentAdmin();
  if (!me?.permissions.includes("employees.manage")) notFound();

  let employee;
  try {
    employee = await getEmployee(id);
    if (!employee) notFound();
    if (me) {
      const scope = (await resolveScope(me)) ?? { kind: "all" as const };
      await assertEmployeeInScope(id, scope);
    }
  } catch (err) {
    return (
      <AdminShell require="employees.manage" section="employees">
        <AdminError err={err} />
      </AdminShell>
    );
  }

  const [jobs, adminUsers] = await Promise.all([listJobs(), listAssignableAdminUsers()]);

  return (
    <AdminShell require="employees.manage" section="employees">
      <div className="max-w-5xl">
        <AdminBackButton
          fallbackHref={`/admin/employees/${id}`}
          label="Back to employee"
          className="inline-flex items-center gap-1.5 text-xs text-white/60 hover:text-white mb-4"
        />
        <h1 className="text-2xl font-bold mb-1" style={{ fontFamily: "var(--font-playfair)" }}>
          Edit Employee
        </h1>
        <p className="text-white/45 text-sm mb-6">Update details, schedule, and compensation.</p>
        <EmployeeForm
          action={updateEmployeeAction}
          initial={employee}
          hiddenId={employee.id}
          submitLabel="Save changes"
          pendingLabel="Saving…"
          jobs={jobs}
          adminUsers={adminUsers.filter((user) => me.role === "super_admin" || user.email === me.email)}
        />
      </div>
    </AdminShell>
  );
}
