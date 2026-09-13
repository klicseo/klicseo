"use client";

import { useMemo, useState, useTransition, type ChangeEvent } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useHighlightedLead, markLeadViewed } from "@/lib/useHighlightedLead";
import {
  ListPlus,
  Phone,
  MessageSquare,
  MapPin,
  ExternalLink,
  CheckCircle2,
  Clock,
  Car,
  Check,
  AlertCircle,
  X,
  FileSpreadsheet,
  Globe,
  User,
  Plus,
  Loader2,
  Users,
} from "lucide-react";
import LeadStatusControl from "./LeadStatusControl";
import WhatsAppLink from "@/components/WhatsAppLink";
import PhoneCell from "@/components/PhoneCell";
import ColumnVisibilityPicker from "@/components/ColumnVisibilityPicker";
import { useColumnPreferences, type ColumnDefinition } from "@/lib/useColumnPreferences";
import { formatPhone } from "@/lib/phone-shared";
import { addLeadsToListAction, createListAndAssignLeadsAction } from "./lists/actions";
import { getLeadSourceInfo, type LeadStatus } from "@/lib/leads-shared";
import type { CustomLeadStatus } from "@/lib/site-settings-shared";
import type { LeadListRow } from "@/lib/leadLists-shared";

export type LeadForTable = {
  id: string;
  created_at: string;
  submitted_at?: string | null;
  client_timezone?: string | null;
  name: string | null;
  phone: string | null;
  service: string | null;
  service_option: string | null;
  add_on_labels: string[] | null;
  vehicle_type: string | null;
  car_brand: string | null;
  car_model: string | null;
  car_number: string | null;
  pincode: string | null;
  area?: string | null;
  address?: string | null;
  callback_date: string | null;
  callback_time: string | null;
  shift: string | null;
  map_link: string | null;
  latitude: number | null;
  longitude: number | null;
  price_total: number | null;
  source: string;
  notes?: string | null;
  custom_fields?: Record<string, string> | null;
  status: LeadStatus;
};

const MASTER_LEAD_COLUMNS: ColumnDefinition[] = [
  { key: "customer", label: "Customer & Vehicle", required: true },
  { key: "contact", label: "Contact & Actions", defaultVisible: true },
  { key: "location", label: "Location / Locality", defaultVisible: true },
  { key: "service", label: "Service & Price", defaultVisible: true },
  { key: "lists", label: "List / Tags", defaultVisible: true },
  { key: "status", label: "Lead Status", defaultVisible: true },
  { key: "date", label: "Date / Time", defaultVisible: false },
  { key: "notes", label: "Internal Notes", defaultVisible: false },
];

export default function LeadBulkListTable({
  leads,
  lists,
  adminUsers = [],
  statusColor,
  canManageLists,
  leadListNames,
  customStatuses,
}: {
  leads: LeadForTable[];
  lists: LeadListRow[];
  adminUsers?: { id: string; email: string; name: string }[];
  statusColor: Record<string, string>;
  canManageLists: boolean;
  leadListNames: Map<string, string[]>;
  customStatuses?: CustomLeadStatus[];
}) {
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [targetListId, setTargetListId] = useState<string>("");
  const [isCreateListOpen, setIsCreateListOpen] = useState<boolean>(false);
  const [newListName, setNewListName] = useState<string>("");
  const [newListStaffId, setNewListStaffId] = useState<string>("");
  const [lastCheckedIndex, setLastCheckedIndex] = useState<number | null>(null);
  const [isPending, startTransition] = useTransition();
  const [message, setMessage] = useState<{ kind: "ok" | "err"; text: string } | null>(null);

  const searchParams = useSearchParams();
  const highlightedLeadId = useHighlightedLead();
  const returnToParam = useMemo(() => {
    const q = searchParams ? searchParams.toString() : "";
    const returnUrl = q ? `/admin?${q}` : "/admin";
    return `?returnTo=${encodeURIComponent(returnUrl)}`;
  }, [searchParams]);

  const colPrefs = useColumnPreferences(
    "klicseo_master_leads_columns_v1",
    MASTER_LEAD_COLUMNS,
  );

  const allSelected = useMemo(
    () => leads.length > 0 && selected.size === leads.length,
    [leads.length, selected.size],
  );

  const toggleAll = () => {
    if (allSelected) {
      setSelected(new Set());
    } else {
      setSelected(new Set(leads.map((l) => l.id)));
    }
  };

  const toggleLead = (id: string, index: number, e: ChangeEvent<HTMLInputElement>) => {
    const nativeEvent = e.nativeEvent as MouseEvent;
    const isShift = nativeEvent.shiftKey;

    setSelected((prev) => {
      const next = new Set(prev);
      const willBeChecked = !next.has(id);

      if (isShift && lastCheckedIndex !== null) {
        const start = Math.min(lastCheckedIndex, index);
        const end = Math.max(lastCheckedIndex, index);
        for (let i = start; i <= end; i++) {
          const targetId = leads[i]?.id;
          if (targetId) {
            if (willBeChecked) next.add(targetId);
            else next.delete(targetId);
          }
        }
      } else {
        if (willBeChecked) next.add(id);
        else next.delete(id);
      }
      return next;
    });

    setLastCheckedIndex(index);
  };

  const handleAddToList = () => {
    if (!targetListId || selected.size === 0) return;
    const leadIds = Array.from(selected);

    startTransition(async () => {
      const fd = new FormData();
      fd.append("listId", targetListId);
      for (const id of leadIds) {
        fd.append("leadIds", id);
      }

      const res = await addLeadsToListAction(fd);

      if (!res?.error) {
        const targetList = lists.find((l) => l.id === targetListId);
        setMessage({
          kind: "ok",
          text: `Added ${leadIds.length} lead${leadIds.length === 1 ? "" : "s"} to list "${targetList?.name || "List"}".`,
        });
        setSelected(new Set());
        setTargetListId("");
      } else {
        setMessage({ kind: "err", text: res.error || "Failed to add leads to list." });
      }
    });
  };

  const handleCreateNewList = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newListName.trim() || selected.size === 0) return;
    const leadIds = Array.from(selected);

    startTransition(async () => {
      const fd = new FormData();
      fd.append("name", newListName.trim());
      if (newListStaffId) {
        fd.append("assigned_admin_user_id", newListStaffId);
      }
      for (const id of leadIds) {
        fd.append("leadIds", id);
      }

      const res = await createListAndAssignLeadsAction(fd);

      if (res?.ok) {
        const assignedStaff = adminUsers.find((u) => u.id === newListStaffId)?.name;
        setMessage({
          kind: "ok",
          text: `Created list "${res.listName}" ${assignedStaff ? `(assigned to ${assignedStaff})` : ""} with ${leadIds.length} leads.`,
        });
        setSelected(new Set());
        setIsCreateListOpen(false);
        setNewListName("");
        setNewListStaffId("");
      } else {
        setMessage({ kind: "err", text: res?.error || "Failed to create list." });
      }
    });
  };

  return (
    <div className="space-y-3 relative">
      {/* Toast Feedback */}
      {message && (
        <div
          className={`flex items-center justify-between gap-2 px-4 py-2.5 rounded-xl text-xs font-medium border ${
            message.kind === "ok"
              ? "bg-emerald-500/10 border-emerald-500/30 text-emerald-300"
              : "bg-rose-500/10 border-rose-500/30 text-rose-300"
          }`}
        >
          <div className="flex items-center gap-2">
            {message.kind === "ok" ? <Check size={14} /> : <AlertCircle size={14} />}
            <span>{message.text}</span>
          </div>
          <button
            type="button"
            onClick={() => setMessage(null)}
            className="text-white/40 hover:text-white"
          >
            <X size={13} />
          </button>
        </div>
      )}

      {/* Toolbar with Table Controls & Column Visibility Picker */}
      <div className="flex items-center justify-between gap-3 px-1">
        <div className="text-xs text-white/50">
          Showing <span className="text-white font-semibold tabular-nums">{leads.length}</span> leads
        </div>
        <ColumnVisibilityPicker
          columns={colPrefs.columns}
          isVisible={colPrefs.isVisible}
          toggleColumn={colPrefs.toggleColumn}
          showAll={colPrefs.showAll}
          resetToDefault={colPrefs.resetToDefault}
          visibleCount={colPrefs.visibleCount}
          totalCount={colPrefs.totalCount}
        />
      </div>

      {/* Main Table Container */}
      <div className="rounded-2xl border border-white/[0.08] bg-[#071228] overflow-hidden shadow-xl">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs border-collapse">
            <thead>
              <tr className="border-b border-white/[0.08] bg-white/[0.02] text-white/40 text-[10px] font-bold uppercase tracking-[0.15em]">
                {canManageLists && (
                  <th className="sticky left-0 bg-[#071228] z-20 px-4 py-3.5 w-12 min-w-[48px] text-center border-r border-white/[0.04]">
                    <input
                      type="checkbox"
                      checked={allSelected}
                      onChange={toggleAll}
                      className="h-4 w-4 rounded border-white/20 bg-white/5 text-[#C9A84C] accent-[#C9A84C] cursor-pointer"
                      aria-label="Select all leads"
                    />
                  </th>
                )}
                <th className={`${canManageLists ? "sticky left-12" : "sticky left-0"} bg-[#071228] z-20 px-3 py-3.5 w-12 min-w-[48px] border-r border-white/[0.04]`}>#</th>
                <th className="px-4 py-3.5">Customer & Vehicle</th>
                {colPrefs.isVisible("contact") && <th className="px-4 py-3.5">Contact & Actions</th>}
                {colPrefs.isVisible("location") && <th className="px-4 py-3.5">Location / Locality</th>}
                {colPrefs.isVisible("service") && <th className="px-4 py-3.5">Service & Price</th>}
                {colPrefs.isVisible("lists") && <th className="px-4 py-3.5">List / Tags</th>}
                {colPrefs.isVisible("date") && <th className="px-4 py-3.5">Date</th>}
                {colPrefs.isVisible("notes") && <th className="px-4 py-3.5">Notes</th>}
                {colPrefs.isVisible("status") && <th className="px-4 py-3.5 text-right">Status</th>}
              </tr>
            </thead>

            <tbody className="divide-y divide-white/[0.04]">
              {leads.map((lead, i) => {
                const isSelected = selected.has(lead.id);
                const vehicleSummary =
                  [lead.car_brand, lead.car_model].filter(Boolean).join(" ") ||
                  lead.vehicle_type ||
                  "";
                const dateStr = new Date(lead.submitted_at ?? lead.created_at).toLocaleDateString(
                  "en-IN",
                  {
                    day: "2-digit",
                    month: "short",
                    timeZone: "Asia/Kolkata",
                  },
                );

                const sourceInfo = getLeadSourceInfo(lead);

                const isHighlighted = lead.id === highlightedLeadId;

                return (
                  <tr
                    key={lead.id}
                    id={`lead-row-${lead.id}`}
                    className={`group transition-all duration-700 ${
                      isHighlighted
                        ? "bg-[#C9A84C]/20 ring-1 ring-[#C9A84C]/60 shadow-[0_0_15px_rgba(201,168,76,0.25)]"
                        : isSelected
                        ? "bg-[#C9A84C]/10"
                        : "hover:bg-white/[0.02]"
                    }`}
                  >
                    {/* Checkbox */}
                    {canManageLists && (
                      <td className={`sticky left-0 z-10 w-12 min-w-[48px] px-4 py-3 text-center border-r border-white/[0.04] transition-colors ${
                        isHighlighted
                          ? "bg-[#252015]"
                          : isSelected
                          ? "bg-[#1b1912]"
                          : "bg-[#071228] group-hover:bg-[#0c1a36]"
                      }`}>
                        <input
                          type="checkbox"
                          checked={isSelected}
                          onChange={(e) => toggleLead(lead.id, i, e)}
                          className="h-4 w-4 rounded border-white/20 bg-white/5 text-[#C9A84C] accent-[#C9A84C] cursor-pointer"
                        />
                      </td>
                    )}

                    {/* Row Index */}
                    <td className={`${canManageLists ? "sticky left-12" : "sticky left-0"} z-10 w-12 min-w-[48px] px-3 py-3 text-white/30 text-[11px] font-mono tabular-nums border-r border-white/[0.04] transition-colors ${
                      isHighlighted
                        ? "bg-[#252015]"
                        : isSelected
                        ? "bg-[#1b1912]"
                        : "bg-[#071228] group-hover:bg-[#0c1a36]"
                    }`}>
                      {i + 1}
                    </td>

                    {/* Customer & Vehicle */}
                    <td className="px-4 py-3 min-w-[200px]">
                      <div className="flex items-center gap-2">
                        <Link
                          href={`/admin/${lead.id}${returnToParam}`}
                          onClick={() => markLeadViewed(lead.id)}
                          className="font-semibold text-white group-hover:text-[#E8CC7A] transition-colors text-sm"
                        >
                          {lead.name || "(Unnamed Lead)"}
                        </Link>

                        {lead.status === "draft" && (
                          <span className="text-[9px] px-1.5 py-0.2 rounded bg-white/10 text-white/50 uppercase">
                            Draft
                          </span>
                        )}
                      </div>

                      <div className="flex items-center gap-2 mt-0.5 text-[11px] text-white/50">
                        {vehicleSummary ? (
                          <span className="flex items-center gap-1 text-white/70">
                            <Car size={11} className="text-[#C9A84C]" />
                            {vehicleSummary}
                          </span>
                        ) : (
                          <span>No vehicle</span>
                        )}

                        {lead.car_number && (
                          <span className="font-mono text-[10px] px-1.5 py-0.2 rounded bg-white/5 text-[#E8CC7A] uppercase border border-white/10">
                            {lead.car_number}
                          </span>
                        )}
                      </div>
                    </td>

                    {/* Contact & Inline Actions */}
                    {colPrefs.isVisible("contact") && (
                      <td className="px-4 py-3 min-w-[170px]">
                        {lead.phone ? (
                          <div className="space-y-1">
                            <PhoneCell
                              phone={lead.phone}
                              name={lead.name}
                              showCallButton={true}
                              showCopyButton={true}
                              showWhatsApp={true}
                            />
                            {lead.map_link && (
                              <div className="pt-0.5">
                                <a
                                  href={lead.map_link}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-md bg-white/5 hover:bg-sky-500/20 text-sky-400 text-[10px] transition-colors border border-white/5"
                                  title="Open Google Maps Location"
                                >
                                  <MapPin size={10} /> Maps
                                </a>
                              </div>
                            )}
                          </div>
                        ) : (
                          <span className="text-white/30">—</span>
                        )}
                      </td>
                    )}

                    {/* Locality & Location */}
                    {colPrefs.isVisible("location") && (
                      <td className="px-4 py-3 min-w-[150px]">
                        {lead.area ? (
                          <div className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-sky-500/10 border border-sky-500/20 text-sky-300 text-[10px] font-medium">
                            <MapPin size={10} /> {lead.area}
                          </div>
                        ) : lead.pincode ? (
                          <span className="font-mono text-xs text-white/60">PIN {lead.pincode}</span>
                        ) : (
                          <span className="text-white/30 text-[11px]">Chennai</span>
                        )}

                        <div className="flex items-center gap-1.5 text-[10px] text-white/40 mt-1 flex-wrap">
                          <span>{dateStr}</span>
                          <span>•</span>

                          {/* Interactive Source Tooltip Badge */}
                          <div className="relative group/tip inline-flex items-center">
                            <span
                              className={`inline-flex items-center gap-1 px-1.5 py-0.2 rounded border text-[10px] font-semibold cursor-help transition-all hover:brightness-125 ${sourceInfo.badgeBg} ${sourceInfo.textColor}`}
                            >
                              {sourceInfo.iconType === "upload" && <FileSpreadsheet size={10} />}
                              {sourceInfo.iconType === "globe" && <Globe size={10} />}
                              {sourceInfo.iconType === "user" && <User size={10} />}
                              <span>{sourceInfo.shortLabel}</span>
                            </span>

                            {/* Floating Astryx Tooltip Box */}
                            <div className="pointer-events-none absolute bottom-full left-1/2 -translate-x-1/2 mb-2 hidden group-hover/tip:flex flex-col items-center z-50 whitespace-nowrap drop-shadow-2xl">
                              <div className="bg-[#050E21] border border-white/20 text-white text-[11px] px-3 py-2 rounded-xl shadow-2xl space-y-0.5 text-left min-w-[190px]">
                                <div className="font-bold text-[#E8CC7A] flex items-center gap-1.5">
                                  {sourceInfo.iconType === "upload" && <FileSpreadsheet size={12} />}
                                  {sourceInfo.iconType === "globe" && <Globe size={12} />}
                                  {sourceInfo.iconType === "user" && <User size={12} />}
                                  <span>{sourceInfo.label}</span>
                                </div>
                                <div className="text-[10px] text-white/70">
                                  {sourceInfo.description}
                                </div>
                              </div>
                              <div className="w-2 h-2 -mt-1 rotate-45 bg-[#050E21] border-r border-b border-white/20" />
                            </div>
                          </div>
                        </div>
                      </td>
                    )}

                    {/* Service & Price */}
                    {colPrefs.isVisible("service") && (
                      <td className="px-4 py-3 min-w-[160px]">
                        <div className="font-medium text-white/90 text-xs">
                          {lead.service || <span className="text-white/30">Unspecified Service</span>}
                        </div>

                        <div className="flex items-center gap-2 mt-0.5 text-[11px] text-white/40">
                          {lead.service_option && <span>{lead.service_option}</span>}
                          {lead.price_total != null && (
                            <span className="font-semibold text-[#E8CC7A]">
                              ₹{lead.price_total.toLocaleString("en-IN")}
                            </span>
                          )}
                        </div>
                      </td>
                    )}

                    {/* Lead List Tags */}
                    {colPrefs.isVisible("lists") && (
                      <td className="px-4 py-3 min-w-[130px]">
                        {leadListNames.has(lead.id) && leadListNames.get(lead.id)!.length > 0 ? (
                          <div className="flex flex-wrap gap-1">
                            {leadListNames.get(lead.id)!.map((name) => (
                              <span
                                key={name}
                                className="text-[10px] font-medium px-2 py-0.5 rounded-md bg-[#C9A84C]/15 text-[#E8CC7A] border border-[#C9A84C]/25 whitespace-nowrap"
                              >
                                {name}
                              </span>
                            ))}
                          </div>
                        ) : (
                          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-amber-500/10 text-amber-300 border border-amber-500/20 text-[10px] font-semibold">
                            ⚡ Unassigned
                          </span>
                        )}
                      </td>
                    )}

                    {/* Submitted Date (Optional column) */}
                    {colPrefs.isVisible("date") && (
                      <td className="px-4 py-3 text-white/50 text-[11px] tabular-nums whitespace-nowrap">
                        {dateStr}
                      </td>
                    )}

                    {/* Notes (Optional column) */}
                    {colPrefs.isVisible("notes") && (
                      <td className="px-4 py-3 max-w-[180px] text-white/70 text-xs truncate" title={lead.notes || ""}>
                        {lead.notes || <span className="text-white/20">—</span>}
                      </td>
                    )}

                    {/* Status Dropdown */}
                    {colPrefs.isVisible("status") && (
                      <td className="px-4 py-3 text-right">
                        <LeadStatusControl
                          id={lead.id}
                          status={lead.status}
                          color={statusColor[lead.status] || "#C9A84C"}
                          customStatuses={customStatuses}
                        />
                      </td>
                    )}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {/* Floating Bottom Dock for Bulk Actions */}
      {selected.size > 0 && canManageLists && (
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-40 flex items-center gap-3 bg-[#071228]/95 backdrop-blur-md border border-[#C9A84C]/40 rounded-2xl px-5 py-3 shadow-2xl animate-in fade-in slide-in-from-bottom-4 duration-200 flex-wrap justify-center">
          <div className="flex items-center gap-2 text-xs text-white font-medium pr-2 border-r border-white/10">
            <span className="grid h-5 w-5 place-items-center rounded-full bg-[#C9A84C] text-[#050E21] font-bold text-[10px]">
              {selected.size}
            </span>
            <span>selected</span>
          </div>

          <div className="flex items-center gap-2 flex-wrap">
            <select
              value={targetListId}
              onChange={(e) => setTargetListId(e.target.value)}
              className="bg-[#050E21] border border-white/15 rounded-xl px-3 py-1.5 text-xs text-white focus:outline-none focus:border-[#C9A84C] max-w-[220px] truncate cursor-pointer"
            >
              <option value="">— Choose Folder or Staff List —</option>
              {lists.map((l) => {
                const staffName = l.assigned_admin_user?.name || l.assigned_admin_user?.email;
                return (
                  <option key={l.id} value={l.id}>
                    {l.is_custom_folder ? "Folder: " : "Staff list: "}{l.name} {staffName ? `(${staffName})` : "(Unassigned)"}
                  </option>
                );
              })}
            </select>

            <button
              type="button"
              disabled={!targetListId || isPending}
              onClick={handleAddToList}
              className="px-3.5 py-1.5 rounded-xl bg-gradient-to-r from-[#C9A84C] to-[#E8CC7A] text-[#050E21] text-xs font-bold hover:brightness-105 transition-all disabled:opacity-50 inline-flex items-center gap-1.5 shadow-md shadow-[#C9A84C]/20 cursor-pointer whitespace-nowrap"
            >
              {isPending ? <Loader2 size={13} className="animate-spin text-[#050E21]" /> : <ListPlus size={13} />}
              <span>{isPending ? "Assigning…" : "Add to List"}</span>
            </button>

            <div className="h-4 w-px bg-white/15 mx-0.5" />

            <button
              type="button"
              onClick={() => {
                setNewListName(`Leads Batch — ${new Date().toLocaleDateString("en-IN", { month: "short", day: "numeric" })}`);
                setIsCreateListOpen(true);
              }}
              className="px-3 py-1.5 rounded-xl bg-white/[0.08] hover:bg-white/[0.14] border border-white/15 text-white text-xs font-semibold transition-all inline-flex items-center gap-1.5 cursor-pointer whitespace-nowrap"
              title="Create a new list assigned to staff and add selected leads to it"
            >
              <Plus size={13} className="text-[#C9A84C]" />
              <span>Create New List</span>
            </button>

            <button
              type="button"
              onClick={() => setSelected(new Set())}
              className="p-1.5 rounded-lg text-white/40 hover:text-white hover:bg-white/5 transition-colors cursor-pointer"
              title="Deselect all"
            >
              <X size={14} />
            </button>
          </div>
        </div>
      )}

      {/* Create New List Modal */}
      {isCreateListOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm animate-in fade-in">
          <div
            className="fixed inset-0"
            onClick={() => !isPending && setIsCreateListOpen(false)}
          />
          <div className="relative w-full max-w-md bg-[#071228] border border-white/15 rounded-3xl p-6 shadow-2xl space-y-4 z-10 animate-in zoom-in-95">
            <div className="flex items-center justify-between pb-3 border-b border-white/[0.08]">
              <div className="flex items-center gap-2.5">
                <div className="w-8 h-8 rounded-xl bg-[#C9A84C]/15 border border-[#C9A84C]/30 flex items-center justify-center text-[#C9A84C]">
                  <Plus size={16} />
                </div>
                <div>
                  <h3 className="text-sm font-bold text-white">Create List & Assign Leads</h3>
                  <p className="text-[11px] text-white/50">
                    Assign {selected.size} selected leads to a new list
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setIsCreateListOpen(false)}
                disabled={isPending}
                className="text-white/40 hover:text-white p-1 rounded-lg hover:bg-white/5"
              >
                <X size={16} />
              </button>
            </div>

            <form onSubmit={handleCreateNewList} className="space-y-4">
              <div>
                <label className="block text-xs font-semibold text-white/80 mb-1.5">
                  List Name <span className="text-rose-400">*</span>
                </label>
                <input
                  type="text"
                  required
                  value={newListName}
                  onChange={(e) => setNewListName(e.target.value)}
                  placeholder="e.g. Velachery Follow-ups"
                  className="w-full bg-[#050E21] border border-white/15 rounded-xl px-3.5 py-2 text-xs text-white placeholder:text-white/30 focus:outline-none focus:border-[#C9A84C]"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-white/80 mb-1.5 flex items-center justify-between">
                  <span>Assign to Staff Member (Telecaller)</span>
                  <span className="text-[10px] text-white/40 font-normal">Optional</span>
                </label>
                <select
                  value={newListStaffId}
                  onChange={(e) => setNewListStaffId(e.target.value)}
                  className="w-full bg-[#050E21] border border-white/15 rounded-xl px-3.5 py-2 text-xs text-white focus:outline-none focus:border-[#C9A84C] cursor-pointer"
                >
                  <option value="">— Leave Unassigned (General Pool) —</option>
                  {adminUsers.map((u) => (
                    <option key={u.id} value={u.id}>
                      👤 {u.name} ({u.email})
                    </option>
                  ))}
                </select>
                <p className="text-[10px] text-white/40 mt-1">
                  The selected team member will immediately see this list under their assigned workspace.
                </p>
              </div>

              <div className="pt-2 flex items-center justify-end gap-2 border-t border-white/[0.08]">
                <button
                  type="button"
                  onClick={() => setIsCreateListOpen(false)}
                  disabled={isPending}
                  className="px-4 py-2 rounded-xl text-xs font-semibold text-white/60 hover:text-white hover:bg-white/5 transition-colors"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={isPending || !newListName.trim()}
                  className="px-4 py-2 rounded-xl bg-[#C9A84C] hover:bg-[#E8CC7A] text-[#050E21] font-bold text-xs transition-all disabled:opacity-50 inline-flex items-center gap-1.5 shadow-lg shadow-[#C9A84C]/25"
                >
                  {isPending && <Loader2 size={13} className="animate-spin text-[#050E21]" />}
                  <span>{isPending ? "Creating & Assigning…" : `Create & Assign (${selected.size} Leads)`}</span>
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
