import { currentAdmin } from "@/lib/admin-auth";
import { notFound } from "next/navigation";
import AdminShell from "../../AdminShell";
import EmployeeForm from "../EmployeeForm";
import { createEmployeeAction } from "../actions";
import { listJobs } from "@/lib/jobs";
import { listAssignableAdminUsers } from "@/lib/admin-users";

export default async function NewEmployeePage() {
  const me = await currentAdmin();
  if (!me?.permissions.includes("employees.manage")) notFound();
  const [jobs, adminUsers] = await Promise.all([listJobs(), listAssignableAdminUsers()]);
  return (
    <AdminShell require="employees.manage" section="employees">
      <div className="max-w-5xl">
        <h1 className="text-2xl font-bold mb-1" style={{ fontFamily: "var(--font-playfair)" }}>
          Add Employee
        </h1>
        <p className="text-white/45 text-sm mb-6">Manually create a record for someone who didn&apos;t apply online.</p>
        <EmployeeForm
          action={createEmployeeAction}
          submitLabel="Save employee"
          pendingLabel="Saving…"
          jobs={jobs}
          adminUsers={adminUsers.filter((user) => me.role === "super_admin" || user.email === me.email)}
        />
      </div>
    </AdminShell>
  );
}
