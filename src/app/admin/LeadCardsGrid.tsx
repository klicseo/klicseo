"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import {
  Phone,
  MessageSquare,
  MapPin,
  Car,
  Folder,
  FolderPlus,
  Globe,
  Flame,
  Clock,
  IndianRupee,
  ExternalLink,
  ChevronDown,
  Check,
  Loader2,
  Copy,
  Sparkles,
} from "lucide-react";
import type { LeadForTable } from "./LeadBulkListTable";
import type { CustomLeadStatus } from "@/lib/site-settings-shared";
import type { LeadListRow } from "@/lib/leadLists-shared";
import LeadStatusControl from "./LeadStatusControl";
import WhatsAppLink from "@/components/WhatsAppLink";
import { formatPhone } from "@/lib/phone-shared";
import { moveLeadToFolderAction } from "./folder-actions";

interface Props {
  leads: LeadForTable[];
  configuredStatuses: CustomLeadStatus[];
  leadListNames?: Map<string, string[]>;
  leadLists?: LeadListRow[];
  canManage?: boolean;
}

export default function LeadCardsGrid({
  leads,
  configuredStatuses,
  leadListNames = new Map(),
  leadLists = [],
  canManage = true,
}: Props) {
  const [movingLeadId, setMovingLeadId] = useState<string | null>(null);
  const [activeFolderDropdown, setActiveFolderDropdown] = useState<string | null>(null);
  const [copiedPhoneId, setCopiedPhoneId] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  if (leads.length === 0) {
    return (
      <div className="p-12 text-center rounded-3xl bg-[#071228] border border-white/[0.08] space-y-3 shadow-xl">
        <div className="w-12 h-12 rounded-2xl bg-white/[0.04] border border-white/10 flex items-center justify-center mx-auto text-white/40">
          <Folder size={24} />
        </div>
        <h3 className="text-base font-bold text-white">No Leads Found</h3>
        <p className="text-xs text-white/50 max-w-md mx-auto">
          No leads match the selected folder, status, or search filters. Try switching folders or clearing filters.
        </p>
      </div>
    );
  }

  const handleCopyPhone = (leadId: string, phone: string | null) => {
    if (!phone) return;
    navigator.clipboard.writeText(phone);
    setCopiedPhoneId(leadId);
    setTimeout(() => setCopiedPhoneId(null), 2000);
  };

  const handleMoveToFolder = (leadId: string, listId: string) => {
    setMovingLeadId(leadId);
    setActiveFolderDropdown(null);
    startTransition(async () => {
      await moveLeadToFolderAction(leadId, listId);
      setMovingLeadId(null);
    });
  };

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
      {leads.map((lead) => {
        const assignedLists = leadListNames.get(lead.id) ?? [];
        const isWebsite = lead.source === "wizard";
        const formattedPhone = formatPhone(lead.phone);
        const rawPhone = lead.phone?.replace(/\D/g, "") ?? "";
        const locality = lead.area || "Chennai";

        return (
          <div
            key={lead.id}
            className="group rounded-3xl bg-[#071228] border border-white/[0.08] hover:border-white/20 transition-all shadow-lg hover:shadow-2xl overflow-hidden flex flex-col justify-between"
          >
            {/* 1. Header Section */}
            <div className="p-4 pb-3 border-b border-white/[0.06] space-y-2.5">
              <div className="flex items-start justify-between gap-2">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <Link
                      href={`/admin/${lead.id}`}
                      className="text-sm font-bold text-white hover:text-[#E8CC7A] transition-colors truncate block"
                    >
                      {lead.name || "Unnamed Customer"}
                    </Link>
                  </div>
                  <div className="flex items-center gap-1.5 text-[11px] text-white/40 mt-0.5">
                    <Clock size={11} />
                    <span>
                      {lead.created_at
                        ? new Date(lead.created_at).toLocaleDateString("en-IN", {
                            day: "numeric",
                            month: "short",
                            year: "numeric",
                          })
                        : "Recent"}
                    </span>
                  </div>
                </div>

                {/* Source Tag */}
                {isWebsite ? (
                  <span className="px-2 py-0.5 rounded-full bg-sky-500/15 text-sky-300 border border-sky-500/30 text-[10px] font-semibold inline-flex items-center gap-1 shrink-0">
                    <Globe size={10} />
                    <span>Website Form</span>
                  </span>
                ) : (
                  <span className="px-2 py-0.5 rounded-full bg-amber-500/15 text-amber-300 border border-amber-500/30 text-[10px] font-semibold inline-flex items-center gap-1 shrink-0">
                    <Flame size={10} />
                    <span>Hot Lead</span>
                  </span>
                )}
              </div>

              {/* Phone & Direct 1-Click Action Buttons */}
              <div className="flex items-center justify-between gap-2 p-2 rounded-2xl bg-[#050E21] border border-white/[0.06]">
                <div className="flex items-center gap-1.5 min-w-0">
                  <Phone size={13} className="text-emerald-400 shrink-0" />
                  <span className="text-xs font-mono font-semibold text-white/90 truncate">
                    {formattedPhone || "No Phone"}
                  </span>
                </div>

                {rawPhone && (
                  <div className="flex items-center gap-1 shrink-0">
                    <a
                      href={`tel:${rawPhone}`}
                      className="p-1.5 rounded-xl bg-emerald-500/15 hover:bg-emerald-500/25 text-emerald-300 border border-emerald-500/30 transition-all"
                      title="Direct Phone Call"
                    >
                      <Phone size={12} />
                    </a>

                    <WhatsAppLink
                      phone={lead.phone}
                      className="p-1.5 rounded-xl bg-emerald-500/15 hover:bg-emerald-500/25 text-emerald-300 border border-emerald-500/30 transition-all"
                    />

                    <button
                      type="button"
                      onClick={() => handleCopyPhone(lead.id, lead.phone)}
                      className="p-1.5 rounded-xl bg-white/[0.04] hover:bg-white/10 text-white/60 hover:text-white border border-white/10 transition-all"
                      title="Copy Phone Number"
                    >
                      {copiedPhoneId === lead.id ? (
                        <Check size={12} className="text-emerald-400" />
                      ) : (
                        <Copy size={12} />
                      )}
                    </button>
                  </div>
                )}
              </div>
            </div>

            {/* 2. Middle Content Section */}
            <div className="p-4 py-3 space-y-3 text-xs">
              {/* Service & Price */}
              <div className="flex items-center justify-between gap-2">
                <div className="flex-1 min-w-0">
                  <div className="font-semibold text-white truncate">
                    {lead.service || "General Inquiry"}
                  </div>
                  {lead.service_option && (
                    <div className="text-[11px] text-white/40 truncate">
                      {lead.service_option}
                    </div>
                  )}
                </div>

                {lead.price_total != null && lead.price_total > 0 && (
                  <div className="px-2.5 py-1 rounded-xl bg-[#C9A84C]/10 border border-[#C9A84C]/30 text-[#E8CC7A] font-bold text-xs tabular-nums shrink-0">
                    ₹{lead.price_total.toLocaleString("en-IN")}
                  </div>
                )}
              </div>

              {/* Vehicle Specs */}
              {(lead.car_brand || lead.car_model || lead.vehicle_type) && (
                <div className="flex items-center gap-2 p-2 rounded-xl bg-white/[0.02] border border-white/[0.04]">
                  <Car size={14} className="text-[#C9A84C] shrink-0" />
                  <div className="flex-1 min-w-0 text-[11px] text-white/70 truncate">
                    <span className="font-semibold text-white">
                      {[lead.car_brand, lead.car_model].filter(Boolean).join(" ")}
                    </span>
                    {lead.car_number && (
                      <span className="ml-1.5 font-mono text-white/40 uppercase">
                        ({lead.car_number})
                      </span>
                    )}
                  </div>
                  {lead.vehicle_type && (
                    <span className="text-[10px] px-1.5 py-0.5 rounded bg-white/5 text-white/50 border border-white/5 uppercase">
                      {lead.vehicle_type}
                    </span>
                  )}
                </div>
              )}

              {/* Location & Permanent Address */}
              <div className="space-y-1">
                <div className="flex items-center gap-1.5">
                  <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-lg bg-sky-500/10 text-sky-300 border border-sky-500/20 text-[11px] font-semibold">
                    <MapPin size={11} />
                    <span>{locality}</span>
                  </span>
                  {lead.pincode && (
                    <span className="text-[10px] font-mono text-white/40">
                      PIN {lead.pincode}
                    </span>
                  )}
                </div>
                {lead.address && (
                  <p className="text-[11px] text-white/50 line-clamp-1 pl-0.5">
                    {lead.address}
                  </p>
                )}
              </div>

              {/* Notes Snippet */}
              {lead.notes && (
                <div className="p-2 rounded-xl bg-white/[0.02] border border-white/[0.04] text-[11px] text-white/60 italic line-clamp-2">
                  &ldquo;{lead.notes}&rdquo;
                </div>
              )}
            </div>

            {/* 3. Bottom Footer Strip: Status Control & Folder Assignment */}
            <div className="p-4 pt-3 border-t border-white/[0.06] bg-white/[0.01] flex items-center justify-between gap-2">
              {/* Interactive Status Dropdown */}
              <div className="flex-1 min-w-0">
                <LeadStatusControl
                  id={lead.id}
                  status={lead.status}
                  customStatuses={configuredStatuses}
                />
              </div>

              {/* Folder Assignment Badge & Dropdown */}
              {canManage && (
                <div className="relative">
                  <button
                    type="button"
                    onClick={() =>
                      setActiveFolderDropdown(
                        activeFolderDropdown === lead.id ? null : lead.id,
                      )
                    }
                    disabled={movingLeadId === lead.id}
                    className={`px-2.5 py-1.5 rounded-xl border text-[11px] font-semibold transition-all inline-flex items-center gap-1.5 ${
                      assignedLists.length > 0
                        ? "bg-emerald-500/10 border-emerald-500/30 text-emerald-300 hover:bg-emerald-500/20"
                        : "bg-amber-500/10 border-amber-500/30 text-amber-300 hover:bg-amber-500/20"
                    }`}
                    title="Assign to List / Telecaller"
                  >
                    {movingLeadId === lead.id ? (
                      <Loader2 size={12} className="animate-spin text-amber-400" />
                    ) : (
                      <Folder size={12} />
                    )}
                    <span className="truncate max-w-[90px]">
                      {assignedLists.length > 0 ? assignedLists[0] : "⚡ Unassigned"}
                    </span>
                    <ChevronDown size={11} className="opacity-50" />
                  </button>

                  {/* Folder Dropdown Menu */}
                  {activeFolderDropdown === lead.id && (
                    <>
                      <div
                        className="fixed inset-0 z-40"
                        onClick={() => setActiveFolderDropdown(null)}
                      />
                      <div className="absolute right-0 bottom-full mb-1 w-52 bg-[#050E21] border border-white/15 rounded-2xl shadow-2xl z-50 p-1.5 space-y-1 animate-in fade-in">
                        <div className="px-2.5 py-1 text-[10px] font-bold uppercase tracking-wider text-[#C9A84C]">
                          Move to Folder
                        </div>
                        <div className="max-h-48 overflow-y-auto space-y-0.5">
                          {leadLists.filter((list) => list.is_custom_folder).map((list) => {
                            const isAssigned = assignedLists.includes(list.name);
                            return (
                              <button
                                key={list.id}
                                type="button"
                                onClick={() => handleMoveToFolder(lead.id, list.id)}
                                className={`w-full px-2.5 py-1.5 rounded-xl text-left text-xs font-semibold flex items-center justify-between transition-colors ${
                                  isAssigned
                                    ? "bg-emerald-500/20 text-emerald-300 font-bold"
                                    : "text-white/70 hover:text-white hover:bg-white/[0.06]"
                                }`}
                              >
                                <span className="truncate">{list.name}</span>
                                {isAssigned && <Check size={12} className="shrink-0" />}
                              </button>
                            );
                          })}
                        </div>
                      </div>
                    </>
                  )}
                </div>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}
