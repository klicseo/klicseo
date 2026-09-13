import { notFound } from "next/navigation";
import Link from "next/link";
import {
  ArrowLeft,
  Phone,
  MapPin,
  User,
  Car,
  Calendar,
  Sunrise,
  Sunset,
  Sparkles,
  Pencil,
  Wallet,
  Globe,
  ExternalLink,
  Shield,
  Layers,
  Clock,
  MessageSquare,
  Copy,
  FileSpreadsheet,
  UploadCloud,
  RotateCcw,
} from "lucide-react";
import AdminShell from "../AdminShell";
import AdminError from "../AdminError";
import AdminBackButton from "@/components/AdminBackButton";
import TrackViewedLead from "./TrackViewedLead";
import LeadStatusControl from "../LeadStatusControl";
import LeadNotesEditor from "./LeadNotesEditor";
import DeleteLeadButton from "./DeleteLeadButton";
import WhatsAppLink from "@/components/WhatsAppLink";
import PhoneCell from "@/components/PhoneCell";
import { formatPhone } from "@/lib/phone-shared";
import { getLead, assertLeadInScope } from "@/lib/leads";
import { getLeadAllocationHistory } from "@/lib/lead-routing";
import { LEAD_STATUS_COLOR, getLeadSourceInfo } from "@/lib/leads-shared";
import { getSiteSettings } from "@/lib/site-settings";
import { DEFAULT_LEAD_STATUS_ITEMS, type CustomLeadStatus } from "@/lib/site-settings-shared";
import { getCustomerPayments } from "@/lib/payments";
import { inr } from "@/lib/pricing";
import { currentAdmin, resolveScope } from "@/lib/admin-auth";
import type { Permission } from "@/lib/admin-users-shared";

const STATUS_COLOR = LEAD_STATUS_COLOR;

function isIST(tz: string | null | undefined): boolean {
  if (!tz) return true;
  try {
    const now = new Date();
    const fmt = (zone: string) =>
      new Intl.DateTimeFormat("en-US", {
        timeZone: zone,
        hour: "2-digit",
        minute: "2-digit",
        hour12: false,
      }).format(now);
    return fmt(tz) === fmt("Asia/Kolkata");
  } catch {
    return false;
  }
}

function callbackLocalToIST(
  dateStr: string | null,
  timeStr: string | null,
  fromTZ: string | null,
): string | null {
  if (!dateStr || !fromTZ || isIST(fromTZ)) return null;
  const dm = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateStr);
  if (!dm) return null;
  let wallH = 10;
  let wallM = 0;
  if (timeStr) {
    const tm = /^(\d{1,2}):(\d{2})\s*(AM|PM)?$/i.exec(timeStr.trim());
    if (tm) {
      wallH = Number(tm[1]) % 12;
      wallM = Number(tm[2]);
      if (tm[3]?.toUpperCase() === "PM") wallH += 12;
    }
  }
  try {
    const guess = new Date(Date.UTC(+dm[1], +dm[2] - 1, +dm[3], wallH, wallM));
    const parts = new Intl.DateTimeFormat("en-US", {
      timeZone: fromTZ,
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    }).formatToParts(guess);
    const gotH = parseInt(parts.find((p) => p.type === "hour")?.value ?? "0") % 24;
    const gotM = parseInt(parts.find((p) => p.type === "minute")?.value ?? "0");
    const offsetMs = ((gotH - wallH) * 60 + (gotM - wallM)) * 60 * 1000;
    const utcActual = new Date(guess.getTime() - offsetMs);
    return new Intl.DateTimeFormat("en-IN", {
      timeZone: "Asia/Kolkata",
      hour: "2-digit",
      minute: "2-digit",
      hour12: true,
    }).format(utcActual);
  } catch {
    return null;
  }
}

function fmt(value: string | number | boolean | null | undefined): string {
  if (value === null || value === undefined || value === "") return "—";
  if (typeof value === "boolean") return value ? "Yes" : "No";
  return String(value);
}

function DetailRow({
  label,
  value,
  mono = false,
}: {
  label: string;
  value: React.ReactNode;
  mono?: boolean;
}) {
  return (
    <div className="flex items-start justify-between gap-4 py-2.5 border-b border-white/[0.04] last:border-0 text-xs">
      <span className="text-white/40 font-medium">{label}</span>
      <span className={`text-right font-medium text-white ${mono ? "font-mono" : ""}`}>
        {value}
      </span>
    </div>
  );
}

export default async function LeadDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams?: Promise<{ returnTo?: string; fromListName?: string }>;
}) {
  const { id } = await params;
  const { returnTo, fromListName } = (await searchParams) ?? {};
  const me = await currentAdmin();
  if (!me?.permissions.includes("leads.view")) notFound();
  const canManage = me.permissions.includes("leads.manage");

  let lead;
  try {
    lead = await getLead(id);
    if (!lead) notFound();
    const scope = (await resolveScope(me)) ?? { kind: "all" as const };
    await assertLeadInScope(id, scope);
  } catch (err) {
    return (
      <AdminShell require="leads.view">
        <div className="max-w-3xl space-y-4">
          <AdminBackButton fallbackHref="/admin" label="Back" />
          <AdminError err={err} />
        </div>
      </AdminShell>
    );
  }

  const siteSettings = await getSiteSettings().catch(() => null);
  const configuredStatuses: CustomLeadStatus[] =
    siteSettings?.leadStatuses && siteSettings.leadStatuses.length > 0
      ? siteSettings.leadStatuses
      : DEFAULT_LEAD_STATUS_ITEMS;
  const statusColorMap = Object.fromEntries(configuredStatuses.map((s) => [s.id, s.color]));

  const canViewPayments = me != null && me.permissions.includes("payments.view" as Permission);
  const [paymentHistory, allocationHistory] = await Promise.all([
    canViewPayments ? getCustomerPayments(id).catch(() => []) : Promise.resolve([]),
    getLeadAllocationHistory(id).catch(() => []),
  ]);

  const ShiftIcon = lead.shift === "morning" ? Sunrise : Sunset;
  const shiftLabel =
    lead.shift === "morning"
      ? "Morning Shift (4 AM – 10 AM)"
      : lead.shift === "evening"
      ? "Evening Shift (8 PM – 11 PM)"
      : "—";

  const fallbackHref =
    returnTo && returnTo.startsWith("/admin")
      ? returnTo
      : me?.role === "super_admin"
      ? "/admin"
      : "/admin/my-lists";

  const backLabel =
    fromListName
      ? `Back to ${fromListName}`
      : returnTo?.includes("my-lists")
      ? "Back to My Leads"
      : returnTo?.includes("/lists/")
      ? "Back to List"
      : me?.role === "super_admin"
      ? "All Leads"
      : "My Leads";

  return (
    <AdminShell require="leads.view">
      <TrackViewedLead id={lead.id} />
      <div className="space-y-6">
        {/* Navigation & Header Toolbar */}
        <div className="flex items-center justify-between gap-4 flex-wrap">
          <AdminBackButton
            fallbackHref={fallbackHref}
            label={backLabel}
          />

          <div className="flex items-center gap-2.5">
            <LeadStatusControl
              canManage={canManage}
              id={lead.id}
              status={lead.status}
              color={statusColorMap[lead.status] || "#C9A84C"}
              customStatuses={configuredStatuses}
            />

            {canManage && <Link
              href={`/admin/${lead.id}/edit${returnTo ? `?returnTo=${encodeURIComponent(returnTo)}` : ""}`}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-semibold bg-white/5 border border-white/10 text-white/80 hover:text-white hover:bg-white/10 transition-all"
            >
              <Pencil size={13} /> Edit
            </Link>}

            {canManage && me.role !== "staff" && <DeleteLeadButton id={lead.id} returnTo={fallbackHref} />}
          </div>
        </div>

        {/* Lead Profile Header Card */}
        <div className="rounded-2xl border border-white/[0.08] bg-[#071228] p-4 sm:p-6 shadow-xl">
          <div className="flex items-start justify-between gap-4 flex-wrap">
            <div>
              <div className="flex items-center gap-2.5 flex-wrap">
                <h1
                  className="text-xl sm:text-2xl md:text-3xl font-bold text-white tracking-tight"
                  style={{ fontFamily: "var(--font-playfair)" }}
                >
                  {lead.name || "(Unnamed Lead)"}
                </h1>

                {lead.area && (
                  <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full bg-sky-500/15 border border-sky-500/30 text-sky-300 text-xs font-medium">
                    <MapPin size={12} /> {lead.area}
                  </span>
                )}
              </div>

              <div className="flex items-center gap-2.5 sm:gap-3 mt-2 text-xs text-white/50 flex-wrap">
                {lead.phone && (
                  <PhoneCell phone={lead.phone} name={lead.name} compact={true} />
                )}

                <span>•</span>
                {/* Source Pill with Floating Tooltip */}
                {(() => {
                  const src = getLeadSourceInfo(lead);
                  return (
                    <div className="relative group/tip inline-flex items-center">
                      <span
                        className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded-md border text-[11px] font-semibold cursor-help transition-all hover:brightness-125 ${src.badgeBg} ${src.textColor}`}
                      >
                        {src.iconType === "upload" && <FileSpreadsheet size={12} />}
                        {src.iconType === "globe" && <Globe size={12} />}
                        {src.iconType === "user" && <User size={12} />}
                        <span>{src.shortLabel}</span>
                      </span>

                      {/* Floating Tooltip Box */}
                      <div className="pointer-events-none absolute bottom-full left-1/2 -translate-x-1/2 mb-2 hidden group-hover/tip:flex flex-col items-center z-50 whitespace-nowrap drop-shadow-2xl">
                        <div className="bg-[#050E21] border border-white/20 text-white text-[11px] px-3 py-2 rounded-xl shadow-2xl space-y-0.5 text-left min-w-[200px]">
                          <div className="font-bold text-[#E8CC7A] flex items-center gap-1.5">
                            {src.iconType === "upload" && <FileSpreadsheet size={12} />}
                            {src.iconType === "globe" && <Globe size={12} />}
                            {src.iconType === "user" && <User size={12} />}
                            <span>{src.label}</span>
                          </div>
                          <div className="text-[10px] text-white/70">
                            {src.description}
                          </div>
                        </div>
                        <div className="w-2 h-2 -mt-1 rotate-45 bg-[#050E21] border-r border-b border-white/20" />
                      </div>
                    </div>
                  );
                })()}

                <span>•</span>
                <span>
                  Submitted:{" "}
                  <strong className="text-white/70">
                    {new Date(lead.submitted_at ?? lead.created_at).toLocaleString("en-IN", {
                      dateStyle: "medium",
                      timeStyle: "short",
                      timeZone: "Asia/Kolkata",
                    })}{" "}
                    IST
                  </strong>
                </span>
              </div>
            </div>

            {lead.price_total != null && (
              <div className="text-left sm:text-right w-full sm:w-auto mt-2 sm:mt-0 pt-2 sm:pt-0 border-t sm:border-t-0 border-white/5">
                <span className="text-[10px] text-white/40 uppercase tracking-wider block">
                  Total Deal Value
                </span>
                <span className="text-xl sm:text-2xl font-bold text-[#E8CC7A]">
                  ₹{lead.price_total.toLocaleString("en-IN")}
                </span>
              </div>
            )}
          </div>
        </div>

        {/* 2-Column Workspace Grid */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Left 2-Columns: Details & Vehicle Info */}
          <div className="lg:col-span-2 space-y-6">
            {/* Vehicle & Service Info Card */}
            <div className="rounded-2xl border border-white/[0.08] bg-[#071228] p-5 space-y-4 shadow-lg">
              <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-[#C9A84C] border-b border-white/[0.06] pb-3">
                <Car size={15} /> Vehicle & Service Configuration
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-6">
                <div>
                  <DetailRow label="Vehicle Maker / Brand" value={fmt(lead.car_brand)} />
                  <DetailRow label="Vehicle Model" value={fmt(lead.car_model)} />
                  <DetailRow
                    label="Registration Plate"
                    value={
                      lead.car_number ? (
                        <span className="font-mono text-[#E8CC7A] uppercase bg-white/5 px-2 py-0.5 rounded border border-white/10">
                          {lead.car_number}
                        </span>
                      ) : (
                        "—"
                      )
                    }
                  />
                  <DetailRow label="Vehicle Segment" value={fmt(lead.vehicle_type)} />
                </div>

                <div>
                  <DetailRow label="Service Package" value={fmt(lead.service)} />
                  <DetailRow label="Service Option" value={fmt(lead.service_option)} />
                  <DetailRow
                    label="Add-ons"
                    value={
                      lead.add_on_labels && lead.add_on_labels.length > 0
                        ? lead.add_on_labels.join(", ")
                        : lead.interior_add_on
                        ? "Interior Add-on"
                        : "—"
                    }
                  />
                  <DetailRow
                    label="Parking Location"
                    value={fmt(lead.parking_location)}
                  />
                </div>
              </div>
            </div>

            {/* Address & Location Card */}
            <div className="rounded-2xl border border-white/[0.08] bg-[#071228] p-5 space-y-4 shadow-lg">
              <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-[#C9A84C] border-b border-white/[0.06] pb-3">
                <MapPin size={15} /> Location & Address Details
              </div>

              <div className="space-y-3 text-xs">
                <div className="flex items-start justify-between gap-4">
                  <span className="text-white/40">Permanent Address</span>
                  <span className="text-right text-white max-w-md">
                    {lead.address || "—"}
                  </span>
                </div>

                <DetailRow
                  label="Locality / Derived Area"
                  value={lead.area || "—"}
                />
                <DetailRow
                  label="Postal PIN Code"
                  value={lead.pincode ? `PIN ${lead.pincode}` : "—"}
                  mono
                />

                {(lead.map_link || (lead.latitude != null && lead.longitude != null)) && (
                  <div className="pt-2">
                    <a
                      href={
                        lead.map_link ||
                        `https://www.google.com/maps?q=${lead.latitude},${lead.longitude}`
                      }
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-xl bg-sky-500/10 border border-sky-500/25 text-sky-300 hover:bg-sky-500/20 text-xs font-semibold transition-colors"
                    >
                      <MapPin size={13} /> Open Location in Google Maps <ExternalLink size={11} />
                    </a>
                  </div>
                )}
              </div>
            </div>

            {/* Automotive / RTO Custom Fields (if present) */}
            {lead.custom_fields && Object.keys(lead.custom_fields).length > 0 && (
              <div className="rounded-2xl border border-white/[0.08] bg-[#071228] p-5 space-y-4 shadow-lg">
                <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-[#C9A84C] border-b border-white/[0.06] pb-3">
                  <Layers size={15} /> RTO & Vehicle Specifications
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-6">
                  {Object.entries(lead.custom_fields).map(([k, v]) => (
                    <DetailRow key={k} label={k} value={String(v)} />
                  ))}
                </div>
              </div>
            )}

            {/* Payment Records (if permitted) */}
            {canViewPayments && (
              <div className="rounded-2xl border border-white/[0.08] bg-[#071228] p-5 space-y-4 shadow-lg">
                <div className="flex items-center justify-between border-b border-white/[0.06] pb-3">
                  <span className="flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-[#C9A84C]">
                    <Wallet size={15} /> Customer Payment History
                  </span>
                  <Link
                    href={`/admin/payments/new?leadId=${lead.id}`}
                    className="text-xs text-[#E8CC7A] hover:underline font-semibold"
                  >
                    + Record Payment
                  </Link>
                </div>

                {paymentHistory.length === 0 ? (
                  <p className="text-xs text-white/40 py-2">No payments recorded for this lead yet.</p>
                ) : (
                  <div className="divide-y divide-white/[0.04]">
                    {paymentHistory.map((p) => (
                      <div key={p.id} className="flex items-center justify-between py-2 text-xs">
                        <div>
                          <p className="font-semibold text-white">
                            ₹{p.amount != null ? p.amount.toLocaleString("en-IN") : "0"}
                          </p>
                          <p className="text-[10px] text-white/40">
                            {p.period} · {p.method || "Payment"} {p.paid_at ? `(${p.paid_at})` : ""}
                          </p>
                        </div>
                        <span className="text-[10px] uppercase font-bold px-2 py-0.5 rounded bg-emerald-500/10 text-emerald-300">
                          {p.status}
                        </span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Right Column: Telecaller Schedule & Notes */}
          <div className="space-y-6">
            {/* Follow-up Schedule */}
            <div className="rounded-2xl border border-white/[0.08] bg-[#071228] p-5 space-y-4 shadow-lg">
              <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-[#C9A84C] border-b border-white/[0.06] pb-3">
                <Clock size={15} /> Telecaller Follow-up
              </div>

              <div className="space-y-3 text-xs">
                <DetailRow
                  label="Follow-up Date"
                  value={lead.callback_date || <span className="text-white/30">Not scheduled</span>}
                />
                <DetailRow
                  label="Follow-up Time"
                  value={lead.callback_time || <span className="text-white/30">—</span>}
                />
                <DetailRow
                  label="Assigned Shift"
                  value={
                    lead.shift ? (
                      <span className="inline-flex items-center gap-1 font-semibold text-[#E8CC7A]">
                        <ShiftIcon size={13} /> {shiftLabel}
                      </span>
                    ) : (
                      "—"
                    )
                  }
                />
              </div>
            </div>

            {/* Internal Notes Editor */}
            <div className="rounded-2xl border border-white/[0.08] bg-[#071228] p-5 space-y-4 shadow-lg">
              <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-[#C9A84C] border-b border-white/[0.06] pb-3">
                <MessageSquare size={15} /> Internal Telecaller Notes
              </div>

              {canManage ? <LeadNotesEditor id={lead.id} initialNotes={lead.notes ?? ""} /> : <p className="text-sm whitespace-pre-wrap">{lead.notes || "No notes"}</p>}
            </div>

            {/* Campaign & Allocation History (Persistent across list recycling) */}
            <div className="rounded-2xl border border-white/[0.08] bg-[#071228] p-5 space-y-4 shadow-lg">
              <div className="flex items-center justify-between border-b border-white/[0.06] pb-3">
                <span className="flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-[#C9A84C]">
                  <RotateCcw size={15} /> Campaign & List History
                </span>
                <span className="text-[10px] px-2 py-0.5 rounded-full bg-white/10 text-white/60 font-semibold tabular-nums">
                  {allocationHistory.length} Record{allocationHistory.length === 1 ? "" : "s"}
                </span>
              </div>

              {allocationHistory.length === 0 ? (
                <p className="text-xs text-white/40 py-2">
                  No automated dispatches or recycling events recorded for this lead yet.
                </p>
              ) : (
                <div className="relative pl-4 space-y-4 before:absolute before:left-1.5 before:top-2 before:bottom-2 before:w-0.5 before:bg-white/10">
                  {allocationHistory.map((item, idx) => {
                    const isLatest = idx === 0;
                    return (
                      <div key={item.id} className="relative space-y-1 text-xs">
                        <div
                          className={`absolute -left-[19px] top-1.5 h-2.5 w-2.5 rounded-full border-2 ${
                            isLatest
                              ? "bg-[#C9A84C] border-[#071228] ring-2 ring-[#C9A84C]/40"
                              : "bg-white/30 border-[#071228]"
                          }`}
                        />
                        <div className="flex items-center justify-between gap-2">
                          <span className="font-semibold text-white">
                            {item.listName ? (
                              <Link
                                href={`/admin/lists/${item.listId}`}
                                className="hover:text-[#E8CC7A] hover:underline"
                              >
                                {item.listName}
                              </Link>
                            ) : (
                              "Campaign List"
                            )}
                          </span>
                          <span className="text-[10px] text-white/40 tabular-nums">
                            {new Date(item.created_at).toLocaleDateString("en-IN", {
                              day: "2-digit",
                              month: "short",
                              year: "numeric",
                              timeZone: "Asia/Kolkata",
                            })}
                          </span>
                        </div>

                        {item.staffName && (
                          <div className="text-[11px] text-white/60 flex items-center gap-1">
                            <span>Assigned to:</span>
                            <span className="text-[#E8CC7A] font-medium">{item.staffName}</span>
                          </div>
                        )}

                        <div className="text-[11px] text-white/50 bg-white/[0.02] p-2 rounded-lg border border-white/[0.04] leading-relaxed">
                          {item.reason}
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </AdminShell>
  );
}
