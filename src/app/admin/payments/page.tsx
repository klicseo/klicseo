import { redirect } from "next/navigation";
import Link from "next/link";
import { Wallet, ChevronLeft, ChevronRight, Download } from "lucide-react";
import AdminShell from "../AdminShell";
import AdminError from "../AdminError";
import { currentAdmin, resolveScope } from "@/lib/admin-auth";
import { listLeads } from "@/lib/leads";
import { listPeriodPayments, listPaymentsForLeads, currentPeriod, isValidPeriod, periodFromIso, periodsBetween } from "@/lib/payments";
import { isServiceOptionId, SERVICE_OPTIONS } from "@/lib/pricing";
import { getSiteSettings } from "@/lib/site-settings";
import PaymentsTable, { type PaymentItem } from "./PaymentsTable";
import MessageTemplatesEditor from "./MessageTemplatesEditor";

// The payments grid mutates frequently; always render fresh so a save is
// reflected on the next refresh without any caching window.
export const dynamic = "force-dynamic";

function monthLabel(period: string): string {
  const [y, m] = period.split("-").map(Number);
  return new Date(y, m - 1, 1).toLocaleString("en-IN", { month: "long", year: "numeric" });
}

function shiftMonth(period: string, delta: number): string {
  const [y, m] = period.split("-").map(Number);
  const d = new Date(y, m - 1 + delta, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

export default async function PaymentsPage({
  searchParams,
}: {
  searchParams: Promise<{ month?: string }>;
}) {
  const me = await currentAdmin();
  if (!me) redirect("/admin/login");
  if (!me.permissions.includes("payments.view")) redirect("/admin");

  const { month } = await searchParams;
  const period = month && isValidPeriod(month) ? month : currentPeriod();

  const scope = await resolveScope(me);
  if (!scope) redirect("/admin/login");
  const assignedAdminUserId = scope.kind === "assigned" ? scope.adminUserId : undefined;
  let customers, payments, settings;
  try {
    [customers, payments, settings] = await Promise.all([
      listLeads({ status: "booked", limit: 5000, assignedAdminUserId }),
      listPeriodPayments(period),
      getSiteSettings(),
    ]);
  } catch (err) {
    return (
      <AdminShell require="payments.view"><AdminError err={err} /></AdminShell>
    );
  }

  // Pull every payment for the booked customers so we can compute, per row,
  // how many months they haven't paid for (booking month → currently-viewed
  // period inclusive, minus paid months).
  const historyByLead = new Map<string, Set<string>>();
  try {
    const history = await listPaymentsForLeads(customers.map((c) => c.id));
    for (const p of history) {
      if (p.status !== "paid") continue;
      const set = historyByLead.get(p.lead_id) ?? new Set<string>();
      set.add(p.period);
      historyByLead.set(p.lead_id, set);
    }
  } catch {
    // Non-fatal: if the history fetch fails we just don't show the due chip.
  }

  // Only count due months for monthly-recurring services — one-time services
  // (Ceramic, OneTime washes) shouldn't show a "N months unpaid" chip.
  const isMonthlySubscription = (svc: string | null | undefined): boolean => {
    if (!svc) return false;
    if (isServiceOptionId(svc)) return SERVICE_OPTIONS[svc].recurring === "monthly";
    return false; // Admin-created non-legacy options: defer until catalog flag is plumbed in.
  };

  const payByLead = new Map(payments.map((p) => [p.lead_id, p]));
  const items: PaymentItem[] = customers.map((c) => {
    const startPeriod = periodFromIso(c.created_at) ?? period;
    const allPeriods = periodsBetween(startPeriod, period);
    const paidSet = historyByLead.get(c.id) ?? new Set<string>();
    const dueCount = isMonthlySubscription(c.service_option)
      ? allPeriods.filter((m) => !paidSet.has(m)).length
      : 0;
    return {
      customer: { id: c.id, name: c.name, phone: c.phone, service_option: c.service_option, price_total: c.price_total },
      payment: payByLead.get(c.id) ?? null,
      dueCount,
      dueUnit: c.price_total ?? 0,
    };
  });

  const navBtn = "grid h-9 w-9 place-items-center rounded-lg bg-white/5 text-white/60 hover:bg-white/10";

  return (
    <AdminShell require="payments.view">
      <div className="space-y-5 max-w-4xl">
        <div className="flex items-start gap-3">
          <div className="grid h-11 w-11 shrink-0 place-items-center rounded-2xl bg-[#C9A84C]/15 ring-1 ring-[#C9A84C]/25">
            <Wallet className="text-[#C9A84C]" size={22} />
          </div>
          <div>
            <h1 className="text-2xl font-bold leading-tight" style={{ fontFamily: "var(--font-playfair)" }}>Payments</h1>
            <p className="text-white/45 text-sm">Track monthly payments for booked customers.</p>
          </div>
        </div>

        {/* Month navigation */}
        <div className="flex items-center gap-2 flex-wrap">
          <Link href={`/admin/payments?month=${shiftMonth(period, -1)}`} aria-label="Previous month" className={navBtn}><ChevronLeft size={16} /></Link>
          <span className="text-sm font-semibold min-w-[150px] text-center">{monthLabel(period)}</span>
          <Link href={`/admin/payments?month=${shiftMonth(period, 1)}`} aria-label="Next month" className={navBtn}><ChevronRight size={16} /></Link>
          {period !== currentPeriod() && (
            <Link href="/admin/payments" className="text-xs px-3 py-2 rounded-lg bg-white/10 hover:bg-white/15">This month</Link>
          )}
          <form className="ml-auto flex items-center gap-2">
            <input type="month" name="month" defaultValue={period} className="bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-[#C9A84C]" />
            <button className="text-xs px-3 py-2 rounded-lg bg-white/10 hover:bg-white/15">Go</button>
          </form>
          <a
            href={`/api/admin/payments-export?month=${period}`}
            title={`Download ${monthLabel(period)} payments as CSV`}
            className="inline-flex items-center gap-1.5 text-xs px-3 py-2 rounded-lg bg-[#C9A84C]/15 text-[#E8CC7A] ring-1 ring-[#C9A84C]/25 hover:bg-[#C9A84C]/25"
          >
            <Download size={13} /> Download
          </a>
        </div>

        {/* super_admin and admin can rephrase the WhatsApp messages sent from each row. */}
        {(me.role === "super_admin" || me.role === "admin") && (
          <MessageTemplatesEditor initial={settings.messageTemplates} />
        )}

        <PaymentsTable period={period} periodLabel={monthLabel(period)} items={items} canManage={me.permissions.includes("payments.manage")} />
      </div>
    </AdminShell>
  );
}
