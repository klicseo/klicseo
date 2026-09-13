import { redirect } from "next/navigation";
import AdminShell from "../../AdminShell";
import { currentAdmin } from "@/lib/admin-auth";
import { listAssignableAdminUsers } from "@/lib/admin-users";
import { listJobs } from "@/lib/jobs";
import EmployeeUploadClient from "./EmployeeUploadClient";

export default async function EmployeeUploadPage() {
  const me = await currentAdmin();
  if (!me) redirect("/admin/login");

  if (!me.permissions.includes("employees.manage")) {
    redirect("/admin/employees");
  }

  const [adminUsers, jobs] = await Promise.all([
    listAssignableAdminUsers(),
    listJobs({ activeOnly: true }),
  ]);

  return (
    <AdminShell require="employees.manage" section="employees">
      <EmployeeUploadClient
        adminUsers={adminUsers.filter((user) => me.role === "super_admin" || user.email === me.email)}
        availableJobs={jobs.map((j) => ({ slug: j.slug, title: j.title }))}
      />
    </AdminShell>
  );
}
