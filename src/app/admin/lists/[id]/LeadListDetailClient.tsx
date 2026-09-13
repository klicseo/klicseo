"use client";

import { useState, useTransition, useMemo, useRef, useEffect } from "react";
import Link from "next/link";
import { matchesLeadSearch } from "@/lib/lead-search-shared";
import { ArrowLeft, Check, Edit, Plus, Trash2, UploadCloud, RotateCcw, CheckCircle2, MapPin, PhoneCall } from "lucide-react";
import AdminBackButton from "@/components/AdminBackButton";
import { useHighlightedLead, markLeadViewed } from "@/lib/useHighlightedLead";
import LeadStatusControl from "../../LeadStatusControl";
import DeleteLeadListButton from "../DeleteLeadListButton";
import RecycleLeadsModal from "../RecycleLeadsModal";
import WhatsAppLink from "@/components/WhatsAppLink";
import PhoneCell from "@/components/PhoneCell";
import ColumnVisibilityPicker from "@/components/ColumnVisibilityPicker";
import { useColumnPreferences, type ColumnDefinition } from "@/lib/useColumnPreferences";
import { LEAD_STATUS_COLOR, LEAD_STATUSES, LEAD_STATUS_LABEL, type LeadStatus } from "@/lib/leads-shared";
import { DEFAULT_LEAD_STATUS_ITEMS, type CustomLeadStatus } from "@/lib/site-settings-shared";
import type { LeadListRow } from "@/lib/leadLists-shared";
import {
  addLeadsToListAction,
  removeLeadFromListAction,
  searchLeadsForListAction,
} from "../actions";

type LeadForList = {
  id: string;
  name: string | null;
  phone: string | null;
  service: string | null;
  service_option: string | null;
  add_on_labels: string[] | null;
  vehicle_type: string | null;
  car_brand: string | null;
  car_model: string | null;
  car_number: string | null;
  area?: string | null;
  pincode?: string | null;
  address?: string | null;
  status: LeadStatus;
  currentListNames?: string[];
};

const LIST_DETAIL_COLUMNS: ColumnDefinition[] = [
  { key: "name", label: "Customer Name", required: true },
  { key: "phone", label: "Phone & WhatsApp", defaultVisible: true },
  { key: "location", label: "Location / Locality", defaultVisible: true },
  { key: "service", label: "Service & Options", defaultVisible: true },
  { key: "vehicle", label: "Vehicle Info", defaultVisible: true },
  { key: "status", label: "Lead Status", defaultVisible: true },
  { key: "actions", label: "Actions", defaultVisible: true },
];

export default function LeadListDetailClient({
  list,
  initialLeads,
  adminUsers = [],
  isSuperAdmin,
  leadStatuses,
  canManage = false,
}: {
  list: LeadListRow;
  initialLeads: LeadForList[];
  adminUsers?: { id: string; email: string; name: string }[];
  isSuperAdmin: boolean;
  leadStatuses?: CustomLeadStatus[];
  canManage?: boolean;
}) {
  const [leads, setLeads] = useState<LeadForList[]>(initialLeads);
  const [previousInitialLeads, setPreviousInitialLeads] = useState(initialLeads);
  if (previousInitialLeads !== initialLeads) {
    setPreviousInitialLeads(initialLeads);
    setLeads(initialLeads);
  }
  const [filterQuery, setFilterQuery] = useState("");
  const highlightedLeadId = useHighlightedLead();
  const [recycleModalOpen, setRecycleModalOpen] = useState(false);
  const [bannerMessage, setBannerMessage] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState<LeadForList[]>([]);
  const [selectedLeadsToAdd, setSelectedLeadsToAdd] = useState<Set<string>>(new Set());
  const [lastSelectedIndex, setLastSelectedIndex] = useState<number | null>(null);
  const [selectionMode, setSelectionMode] = useState(false); // when true, taps add/remove instead of single-select
  const selectingRef = useRef(false);
  const startIndexRef = useRef<number | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [ariaLiveMessage, setAriaLiveMessage] = useState("");
  const prevSelectedCountRef = useRef<number>(0);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const [statusFilter, setStatusFilter] = useState<LeadStatus | "all">("all");
  const [serviceFilter, setServiceFilter] = useState<string>("all");
  const [pageSize, setPageSize] = useState<number | "all">(50);
  const [currentPage, setCurrentPage] = useState(1);

  const colPrefs = useColumnPreferences(
    "klicseo_lead_list_detail_columns_v1",
    LIST_DETAIL_COLUMNS,
  );

  const configuredStatuses = useMemo(() => {
    return leadStatuses && leadStatuses.length > 0
      ? leadStatuses
      : DEFAULT_LEAD_STATUS_ITEMS;
  }, [leadStatuses]);

  const statusLabelMap = useMemo(() => {
    const map: Record<string, string> = { ...LEAD_STATUS_LABEL };
    for (const s of configuredStatuses) {
      map[s.id] = s.label;
    }
    return map;
  }, [configuredStatuses]);

  const statusColorMap = useMemo(() => {
    const map: Record<string, string> = { ...LEAD_STATUS_COLOR };
    for (const s of configuredStatuses) {
      map[s.id] = s.color;
    }
    return map;
  }, [configuredStatuses]);

  // Derive unique services from the leads in this list
  const services = useMemo(() => {
    const set = new Set<string>();
    for (const l of leads) {
      if (l.service) set.add(l.service);
    }
    return Array.from(set).sort();
  }, [leads]);

  // Filter leads by status + service
  const filteredLeads = useMemo(() => {
    return leads.filter((l) => {
      if (!matchesLeadSearch(l, filterQuery)) return false;
      if (statusFilter !== "all" && l.status !== statusFilter) return false;
      if (serviceFilter !== "all" && l.service !== serviceFilter) return false;
      return true;
    });
  }, [leads, statusFilter, serviceFilter, filterQuery]);

  const totalPages = useMemo(() => {
    if (pageSize === "all") return 1;
    return Math.max(1, Math.ceil(filteredLeads.length / pageSize));
  }, [filteredLeads.length, pageSize]);

  const paginatedLeads = useMemo(() => {
    if (pageSize === "all") return filteredLeads;
    const start = (currentPage - 1) * pageSize;
    return filteredLeads.slice(start, start + pageSize);
  }, [filteredLeads, currentPage, pageSize]);

  // Counts per status
  const statusCounts = useMemo(() => {
    const counts = new Map<LeadStatus | "all", number>();
    counts.set("all", leads.length);
    for (const l of leads) {
      counts.set(l.status, (counts.get(l.status) ?? 0) + 1);
    }
    return counts;
  }, [leads]);

  // Counts per service
  const serviceCounts = useMemo(() => {
    const counts = new Map<string, number>();
    counts.set("all", leads.length);
    for (const l of leads) {
      if (l.service) counts.set(l.service, (counts.get(l.service) ?? 0) + 1);
    }
    return counts;
  }, [leads]);

  useEffect(() => {
    setCurrentPage(1);
  }, [statusFilter, serviceFilter, filterQuery]);

  useEffect(() => {
    // Announce selection mode changes
    setAriaLiveMessage(selectionMode ? "Multi-select mode enabled" : "Multi-select mode disabled");
  }, [selectionMode]);

  useEffect(() => {
    // Vibrate and announce when selection count changes
    const prev = prevSelectedCountRef.current;
    const current = selectedLeadsToAdd.size;
    if (current !== prev) {
      try {
        // small vibration feedback on supported devices
        (navigator as any).vibrate?.(10);
      } catch {}
      setAriaLiveMessage(`${current} lead${current === 1 ? "" : "s"} selected`);
      prevSelectedCountRef.current = current;
    }
  }, [selectedLeadsToAdd]);

  function handleSearch() {
    const query = searchQuery.trim();
    if (!query) {
      setSearchResults([]);
      setLastSelectedIndex(null);
      return;
    }

    setError(null);
    setLastSelectedIndex(null);
    startTransition(async () => {
      const results = await searchLeadsForListAction(query);
      setSearchResults(results);
    });
  }

  // helper to set a contiguous range selection between indices (inclusive)
  function setSelectionRange(from: number, to: number) {
    setSelectedLeadsToAdd((prev) => {
      const next = new Set(prev);
      const start = Math.min(from, to);
      const end = Math.max(from, to);
      for (let i = start; i <= end; i++) {
        const id = searchResults[i]?.id;
        if (id && !leads.some((l) => l.id === id)) next.add(id);
      }
      return next;
    });
  }

  function handlePointerDown(e: any, index: number) {
    // begin pointer-based selection (touch or pen)
    selectingRef.current = true;
    startIndexRef.current = index;
    // capture pointer so we receive move/up events even if finger drifts
    try {
      (e.currentTarget as Element).setPointerCapture?.(e.pointerId);
    } catch {}

    const id = searchResults[index]?.id;
    if (!id || leads.some((l) => l.id === id)) return;

    if (selectionMode) {
      // toggle in selection mode
      setSelectedLeadsToAdd((prev) => {
        const next = new Set(prev);
        if (next.has(id)) next.delete(id);
        else next.add(id);
        return next;
      });
    } else {
      // single select (clear others)
      setSelectedLeadsToAdd(new Set([id]));
    }
    setLastSelectedIndex(index);
  }

  function handlePointerMove(e: any) {
    if (!selectingRef.current) return;
    const x = e.clientX;
    const y = e.clientY;
    const el = document.elementFromPoint(x, y) as HTMLElement | null;
    if (!el) return;
    const row = el.closest("button[data-index]") as HTMLElement | null;
    if (!row) return;
    const idx = Number(row.getAttribute("data-index"));
    if (Number.isFinite(idx) && startIndexRef.current !== null) {
      setSelectionRange(startIndexRef.current, idx);
      setLastSelectedIndex(idx);
    }
  }

  function handlePointerUp(e: any) {
    selectingRef.current = false;
    startIndexRef.current = null;
    try {
      (e.currentTarget as Element).releasePointerCapture?.(e.pointerId);
    } catch {}
  }

  function handleLeadSelection(leadId: string, index: number, event: React.MouseEvent) {
    const isShiftClick = event.shiftKey;
    const isCtrlOrCmdClick = event.ctrlKey || event.metaKey;

    setSelectedLeadsToAdd((prev) => {
      const next = new Set(prev);
      const alreadyInList = leads.some((item) => item.id === leadId);

      if (alreadyInList) {
        return prev; // Can't select leads already in list
      }

      if (isShiftClick && lastSelectedIndex !== null) {
        // Range select: select all items from last selected to current
        const start = Math.min(lastSelectedIndex, index);
        const end = Math.max(lastSelectedIndex, index);
        for (let i = start; i <= end; i++) {
          const item = searchResults[i];
          if (!leads.some((l) => l.id === item.id)) {
            next.add(item.id);
          }
        }
      } else if (isCtrlOrCmdClick) {
        // Toggle individual item
        if (next.has(leadId)) {
          next.delete(leadId);
        } else {
          next.add(leadId);
        }
      } else {
        // Single select: clear and select only this item
        next.clear();
        next.add(leadId);
      }

      return next;
    });

    setLastSelectedIndex(index);
  }

  function handleRemoveLead(leadId: string) {
    if (!confirm("Remove this lead from the list?")) return;

    const previous = leads;
    setLeads((current) => current.filter((lead) => lead.id !== leadId));
    setError(null);

    startTransition(async () => {
      const formData = new FormData();
      formData.append("listId", list.id);
      formData.append("leadId", leadId);
      const result = await removeLeadFromListAction(formData);
      if (result.error) {
        setLeads(previous);
        setError(result.error);
      }
    });
  }

  function handleAddSelectedLeads() {
    const selectedIds = Array.from(selectedLeadsToAdd);
    if (selectedIds.length === 0) return;

    setError(null);
    startTransition(async () => {
      const formData = new FormData();
      formData.append("listId", list.id);
      selectedIds.forEach((leadId) => formData.append("leadIds", leadId));

      const result = await addLeadsToListAction(formData);
      if (result.error) {
        setError(result.error);
        return;
      }

      const byId = new Map(leads.map((lead) => [lead.id, lead]));
      searchResults
        .filter((lead) => selectedLeadsToAdd.has(lead.id))
        .forEach((lead) => byId.set(lead.id, lead));
      setLeads(Array.from(byId.values()));
      setSelectedLeadsToAdd(new Set());
      setSearchResults([]);
      setSearchQuery("");
      setLastSelectedIndex(null);
    });
  }

  // Status breakdown map for modal
  const statusBreakdownObj = useMemo(() => {
    const obj: Record<string, number> = {};
    for (const l of leads) {
      obj[l.status] = (obj[l.status] ?? 0) + 1;
    }
    return obj;
  }, [leads]);

  return (
    <>
      {bannerMessage && (
        <div className="p-4 rounded-2xl bg-emerald-500/15 border border-emerald-500/30 text-emerald-300 text-xs font-semibold flex items-center justify-between mb-4 animate-in fade-in">
          <div className="flex items-center gap-2">
            <CheckCircle2 size={16} className="shrink-0" />
            <span>{bannerMessage}</span>
          </div>
          <button onClick={() => setBannerMessage(null)} className="p-1 rounded-lg hover:bg-emerald-500/20">
            ✕
          </button>
        </div>
      )}

      <AdminBackButton
        fallbackHref={isSuperAdmin ? "/admin/lists" : "/admin/my-lists"}
        label={isSuperAdmin ? "Back to all lists" : "Back to my leads"}
        className="inline-flex items-center gap-1.5 text-xs text-white/60 hover:text-white mb-4"
      />

      <div className="flex items-end justify-between mb-4 gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold" style={{ fontFamily: "var(--font-playfair)" }}>
            {list.name}
          </h1>
          <p className="text-white/45 text-sm">
            {filteredLeads.length === leads.length
              ? `${leads.length} leads`
              : `${filteredLeads.length} of ${leads.length} leads`}
            {" | Assigned to: "}{list.assigned_admin_user?.name || "-"}
          </p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          {isSuperAdmin && leads.length > 0 && (
            <button
              type="button"
              onClick={() => setRecycleModalOpen(true)}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold bg-gradient-to-r from-purple-500/20 to-indigo-500/20 border border-purple-500/40 text-purple-300 hover:bg-purple-500/30 transition-all shadow-sm"
            >
              <RotateCcw size={13} /> Recycle Leads
            </button>
          )}

          {canManage && <Link
            href={`/admin/upload?listId=${list.id}`}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold bg-[#C9A84C]/15 border border-[#C9A84C]/30 text-[#E8CC7A] hover:bg-[#C9A84C]/25 transition-all"
          >
            <UploadCloud size={14} /> Upload Leads
          </Link>}
          {canManage && (
            <Link
              href={`/admin/lists/${list.id}/edit`}
              className="inline-flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs font-semibold border border-white/15 text-white/80 hover:text-white hover:border-white/30"
            >
              <Edit size={12} /> Edit
            </Link>
          )}
          {isSuperAdmin && <DeleteLeadListButton id={list.id} name={list.name} />}
        </div>
      </div>

      {recycleModalOpen && (
        <RecycleLeadsModal
          isOpen={recycleModalOpen}
          onClose={() => setRecycleModalOpen(false)}
          sourceListId={list.id}
          sourceListName={list.name}
          sourceAdminUserId={list.assigned_admin_user_id ?? undefined}
          sourceStaffName={list.assigned_admin_user?.name ?? undefined}
          adminUsers={adminUsers}
          statusBreakdown={statusBreakdownObj}
          onSuccess={(msg) => {
            setBannerMessage(msg);
            setTimeout(() => setBannerMessage(null), 6000);
            if (typeof window !== "undefined") {
              window.location.reload();
            }
          }}
        />
      )}

      {/* Filter pills */}
      <div className="space-y-3 mb-5 p-3 rounded-2xl bg-white/[0.02] border border-white/[0.05]">
        <div className="flex gap-2 flex-wrap items-center">
          <span className="text-[10px] uppercase tracking-wider text-white/40 font-bold mr-1">Filter by Status:</span>
          <button
            type="button"
            onClick={() => setStatusFilter("all")}
            className={`px-3 py-1 rounded-xl text-xs font-semibold transition-all ${
              statusFilter === "all"
                ? "bg-[#C9A84C] text-[#050E21] shadow-sm"
                : "bg-white/[0.04] text-white/60 hover:text-white hover:bg-white/10"
            }`}
          >
            All Leads <span className={statusFilter === "all" ? "text-[#050E21]/70 font-bold" : "text-white/40"}>({statusCounts.get("all") ?? 0})</span>
          </button>
          {configuredStatuses.map((s) => {
            const count = statusCounts.get(s.id as any) ?? 0;
            if (count === 0) return null;
            const isSelected = statusFilter === s.id;
            return (
              <button
                key={s.id}
                type="button"
                onClick={() => setStatusFilter(s.id as any)}
                className={`px-3 py-1 rounded-xl text-xs font-semibold transition-all flex items-center gap-1.5 ${
                  isSelected
                    ? "bg-[#C9A84C] text-[#050E21] shadow-sm"
                    : "bg-white/[0.04] text-white/70 hover:text-white hover:bg-white/10"
                }`}
              >
                <span
                  className="h-2 w-2 rounded-full"
                  style={{ backgroundColor: s.color }}
                />
                <span>{s.label}</span>
                <span className={isSelected ? "text-[#050E21]/70 font-bold" : "text-white/40"}>
                  ({count})
                </span>
              </button>
            );
          })}
        </div>

        {services.length > 1 && (
          <div className="flex gap-2 flex-wrap items-center pt-2 border-t border-white/[0.04]">
            <span className="text-[10px] uppercase tracking-wider text-white/40 font-bold mr-1">Service:</span>
            <button
              type="button"
              onClick={() => setServiceFilter("all")}
              className={`px-2.5 py-0.5 rounded-lg text-[11px] font-semibold transition-all ${
                serviceFilter === "all" ? "bg-white/20 text-white" : "bg-white/[0.04] text-white/55 hover:bg-white/10"
              }`}
            >
              All <span className="text-white/40">({serviceCounts.get("all") ?? 0})</span>
            </button>
            {services.map((s) => (
              <button
                key={s}
                type="button"
                onClick={() => setServiceFilter(s)}
                className={`px-2.5 py-0.5 rounded-lg text-[11px] font-semibold transition-all ${
                  serviceFilter === s ? "bg-[#C9A84C]/20 border border-[#C9A84C]/40 text-[#E8CC7A]" : "bg-white/[0.04] text-white/55 hover:bg-white/10"
                }`}
              >
                {s} <span className="text-white/40">({serviceCounts.get(s) ?? 0})</span>
              </button>
            ))}
          </div>
        )}

        {statusFilter !== "all" && (
          <div className="text-[11px] text-amber-300/90 bg-amber-500/10 border border-amber-500/20 px-3 py-1.5 rounded-xl flex items-center justify-between">
            <span>
              Showing <strong>{filteredLeads.length} {LEAD_STATUS_LABEL[statusFilter]}</strong> {filteredLeads.length === 1 ? "lead" : "leads"} (out of {leads.length} total leads in this list).
            </span>
            <button
              type="button"
              onClick={() => setStatusFilter("all")}
              className="text-[#E8CC7A] hover:underline font-bold text-xs"
            >
              Show All Leads
            </button>
          </div>
        )}
      </div>

      <input type="search" aria-label="Search this list" placeholder="Search this list by name, phone, car, area…"
        value={filterQuery} onChange={(event) => setFilterQuery(event.target.value)}
        className="mb-4 w-full rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm" />
      {error && <p className="mb-4 text-[12px] text-red-300">{error}</p>}

      {canManage && <div className="mb-6">
        <h2 className="text-[11px] font-bold text-[#C9A84C] uppercase tracking-widest mb-2">
          Add Leads to This List
        </h2>
        <div className="space-y-4">
          <div className="flex gap-2">
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") handleSearch();
              }}
              placeholder="Search leads by name, phone, or service..."
              className="flex-1 bg-white/5 border border-white/10 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:border-[#C9A84C]"
            />
            <button
              type="button"
              onClick={handleSearch}
              disabled={pending}
              className="inline-flex items-center gap-2 px-4 py-2.5 rounded-lg text-sm font-semibold bg-[#C9A84C] text-[#050E21] hover:bg-[#B0903C] disabled:opacity-60"
            >
              <Plus size={14} /> {pending ? "Searching..." : "Search"}
            </button>
          </div>

          {searchResults.length > 0 && (
            <div className="border border-white/10 rounded-lg">
              <div className="px-3 py-2 text-[10px] font-semibold text-white/40 uppercase tracking-widest border-b border-white/5 flex items-center justify-between">
                <div>
                  Search Results ({searchResults.length} found) — <span className="text-white/30 font-normal">Click to select • Shift+Click for range • Ctrl+Click to toggle</span>
                </div>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    aria-pressed={selectionMode}
                    onClick={() => setSelectionMode((s) => !s)}
                    className="inline-flex items-center gap-2 px-2 py-1 rounded text-[11px] font-semibold bg-white/5 hover:bg-white/7"
                  >
                    {selectionMode ? "Multi-select: On" : "Multi-select: Off"}
                  </button>
                </div>
                <div aria-live="polite" className="sr-only">
                  {ariaLiveMessage}
                </div>
              </div>
              <div className="max-h-48 overflow-y-auto">
                {searchResults.map((lead, index) => {
                  const isSelected = selectedLeadsToAdd.has(lead.id);
                  const alreadyInList = leads.some((item) => item.id === lead.id);
                  return (
                    <button
                      type="button"
                      key={lead.id}
                      data-index={index}
                      disabled={alreadyInList}
                      className={`w-full flex items-center px-3 py-2 border-t border-white/5 text-left ${
                        isSelected ? "bg-white/[0.05]" : ""
                      } ${alreadyInList ? "opacity-45 cursor-not-allowed" : "hover:bg-white/[0.03] cursor-pointer"}`}
                      onPointerDown={(e) => handlePointerDown(e, index)}
                      onPointerMove={handlePointerMove}
                      onPointerUp={handlePointerUp}
                      onClick={(e) => handleLeadSelection(lead.id, index, e)}
                    >
                      <span className="h-4 w-4 inline-flex items-center justify-center rounded border border-white/20 text-[#C9A84C]">
                        {alreadyInList || isSelected ? <Check size={12} /> : null}
                      </span>
                      <span className="flex-1 ml-3">
                        <div className="flex items-center justify-between gap-2">
                          <span className="block text-white/80 font-medium">{lead.name ?? "(unnamed)"}</span>
                          {alreadyInList ? (
                            <span className="text-[9px] text-white/40 italic">(In this list)</span>
                          ) : lead.currentListNames && lead.currentListNames.length > 0 ? (
                            <span className="text-[9px] px-1.5 py-0.5 rounded bg-amber-500/10 border border-amber-500/25 text-amber-300">
                              In &quot;{lead.currentListNames[0]}&quot; (will move)
                            </span>
                          ) : (
                            <span className="text-[9px] text-white/30">Unassigned</span>
                          )}
                        </div>
                        <span className="block text-white/50 text-[10px]">
                          {lead.phone ?? "-"} | {lead.service ?? "-"} | {lead.vehicle_type ?? "-"}
                        </span>
                      </span>
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          {selectedLeadsToAdd.size > 0 && (
            <div className="mt-3">
              <p className="text-white/45 text-[10px]">
                {selectedLeadsToAdd.size} lead{selectedLeadsToAdd.size === 1 ? "" : "s"} selected
              </p>
              <button
                type="button"
                onClick={handleAddSelectedLeads}
                disabled={pending}
                className="w-full py-3.5 rounded-xl font-bold text-sm text-[#050E21] disabled:opacity-60"
                style={{ background: "linear-gradient(135deg,#9C7A2A,#C9A84C,#E8CC7A)" }}
              >
                {pending ? "Adding..." : "Add Selected Leads to List"}
              </button>
            </div>
          )}
        </div>
      </div>}

      {filteredLeads.length === 0 ? (
        <div className="text-center py-12 text-white/40">
          {leads.length === 0 ? "No leads in this list yet. Add leads using the search above." : "No leads match the current filters."}
        </div>
      ) : (
        <div className="space-y-2">
          <div className="flex items-center justify-between px-1 text-xs">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="text-white/60">
                Showing <strong className="text-white tabular-nums">{filteredLeads.length}</strong> of <strong className="text-white tabular-nums">{leads.length}</strong> total leads in this list
                {statusFilter !== "all" && (
                  <span className="ml-1 text-[#E8CC7A]">
                    (Status: <strong>{statusLabelMap[statusFilter] || statusFilter}</strong>)
                  </span>
                )}
              </span>
              {statusFilter !== "all" && (
                <button
                  type="button"
                  onClick={() => setStatusFilter("all")}
                  className="text-[#E8CC7A] hover:underline font-bold text-xs"
                >
                  Show All {leads.length} Leads ➔
                </button>
              )}
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

          {/* MOBILE CALLING CARDS VIEW (Clean, high-velocity calling on phones) */}
          <div className="block sm:hidden space-y-3">
            {paginatedLeads.map((lead, index) => {
              const isHighlighted = lead.id === highlightedLeadId;
              const globalIndex = pageSize === "all" ? index + 1 : (currentPage - 1) * pageSize + index + 1;
              const vehicle = [lead.car_brand, lead.car_model].filter(Boolean).join(" ") || lead.vehicle_type;

              return (
                <div
                  key={`mobile-lead-${lead.id}`}
                  id={`mobile-lead-card-${lead.id}`}
                  className={`rounded-2xl border p-4 space-y-3 transition-all ${
                    isHighlighted
                      ? "bg-[#C9A84C]/15 border-[#C9A84C]/60 shadow-[0_0_15px_rgba(201,168,76,0.2)]"
                      : "bg-[#071228] border-white/[0.08]"
                  }`}
                >
                  {/* Top Info */}
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="text-[11px] font-mono px-1.5 py-0.5 rounded bg-white/10 text-white/50 shrink-0 font-bold">
                          #{globalIndex}
                        </span>
                        <Link
                          href={`/admin/${lead.id}?returnTo=${encodeURIComponent(`/admin/lists/${list.id}`)}&fromListName=${encodeURIComponent(list.name)}`}
                          onClick={() => markLeadViewed(lead.id)}
                          className="font-bold text-white hover:text-[#E8CC7A] text-sm truncate"
                        >
                          {lead.name ?? "(unnamed)"}
                        </Link>
                      </div>

                      {(lead.area || lead.service || vehicle) && (
                        <div className="flex items-center gap-1.5 flex-wrap mt-1.5 text-[11px] text-white/50">
                          {lead.area && (
                            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-sky-500/10 border border-sky-500/20 text-sky-300 text-[10px] font-medium">
                              <MapPin size={10} className="shrink-0" />
                              <span>{lead.area}</span>
                            </span>
                          )}
                          {lead.service && (
                            <span className="px-1.5 py-0.5 rounded bg-white/5 text-white/70 text-[10px]">
                              {lead.service}
                            </span>
                          )}
                          {vehicle && (
                            <span className="text-[10px] text-white/40">
                              • {vehicle}
                            </span>
                          )}
                        </div>
                      )}
                    </div>

                    {isSuperAdmin && (
                      <button
                        type="button"
                        onClick={() => handleRemoveLead(lead.id)}
                        disabled={pending}
                        className="grid h-8 w-8 place-items-center rounded-xl bg-white/5 text-white/40 hover:text-red-300 hover:bg-red-500/20 active:bg-red-500/30 transition-colors shrink-0"
                        title="Remove from list"
                      >
                        <Trash2 size={13} />
                      </button>
                    )}
                  </div>

                  {/* 1-Tap Quick Action Buttons */}
                  {lead.phone && (
                    <div className="grid grid-cols-2 gap-2 pt-1">
                      <a
                        href={`tel:${lead.phone.replace(/\s+/g, "")}`}
                        onClick={(e) => {
                          e.stopPropagation();
                          markLeadViewed(lead.id);
                        }}
                        className="py-2.5 px-3 rounded-xl bg-gradient-to-r from-emerald-500 to-teal-600 text-white font-bold text-xs flex items-center justify-center gap-2 shadow-md shadow-emerald-500/15 active:scale-98 transition-all min-h-[42px]"
                      >
                        <PhoneCall size={14} />
                        <span>Call Now</span>
                      </a>

                      <WhatsAppLink
                        phone={lead.phone}
                        label="WhatsApp"
                        size={14}
                        className="!w-full !h-auto !py-2.5 !px-3 !rounded-xl !bg-emerald-600/20 !border !border-emerald-500/40 !text-emerald-300 !text-xs !font-bold !flex !items-center !justify-center !gap-2 !min-h-[42px]"
                      />
                    </div>
                  )}

                  {/* Status Disposition Picker */}
                  <div className="pt-2 border-t border-white/5 flex items-center justify-between gap-2">
                    <span className="text-[10px] uppercase font-bold text-white/40 tracking-wider shrink-0">
                      Status:
                    </span>
                    <LeadStatusControl
                        canManage={canManage}
                        onSaved={(status) => setLeads((rows) => rows.map((row) => row.id === lead.id ? { ...row, status } : row))}
                      id={lead.id}
                      status={lead.status}
                      color={statusColorMap[lead.status] || "#C9A84C"}
                      customStatuses={configuredStatuses}
                      className="flex-1 max-w-[200px]"
                    />
                  </div>
                </div>
              );
            })}
          </div>

          {/* DESKTOP & TABLET TABLE VIEW */}
          <div className="hidden sm:block overflow-x-auto rounded-xl border border-white/10">
            <table className="w-full text-sm">
            <thead className="bg-white/[0.03] text-white/50 text-[11px] uppercase tracking-wider">
              <tr>
                <th className="sticky left-0 bg-[#071228] z-20 px-3 py-2 text-left font-semibold w-12 min-w-[48px] border-r border-white/[0.04]">#</th>
                <th className="px-3 py-2 text-left font-semibold">Name</th>
                {colPrefs.isVisible("phone") && <th className="px-3 py-2 text-left font-semibold">Phone</th>}
                {colPrefs.isVisible("location") && <th className="px-3 py-2 text-left font-semibold">Location / Locality</th>}
                {colPrefs.isVisible("service") && <th className="px-3 py-2 text-left font-semibold">Service</th>}
                {colPrefs.isVisible("vehicle") && <th className="px-3 py-2 text-left font-semibold">Vehicle</th>}
                {colPrefs.isVisible("status") && <th className="px-3 py-2 text-left font-semibold">Status</th>}
                {canManage && colPrefs.isVisible("actions") && <th className="px-3 py-2 text-center font-semibold">Actions</th>}
              </tr>
            </thead>
            <tbody>
              {paginatedLeads.map((lead, index) => {
                const isHighlighted = lead.id === highlightedLeadId;
                const globalIndex = pageSize === "all" ? index + 1 : (currentPage - 1) * pageSize + index + 1;
                return (
                  <tr
                    key={lead.id}
                    id={`lead-row-${lead.id}`}
                    className={`group border-t border-white/5 transition-all duration-700 ${
                      isHighlighted
                        ? "bg-[#C9A84C]/20 ring-1 ring-[#C9A84C]/60 shadow-[0_0_15px_rgba(201,168,76,0.25)]"
                        : "hover:bg-white/[0.02]"
                    }`}
                  >
                    <td className={`sticky left-0 z-10 w-12 min-w-[48px] px-3 py-2 text-white/40 text-xs tabular-nums border-r border-white/[0.04] transition-colors ${
                      isHighlighted ? "bg-[#252015]" : "bg-[#071228] group-hover:bg-[#0c1a36]"
                    }`}>
                      {globalIndex}
                    </td>
                    <td className="px-3 py-2">
                      <Link
                        href={`/admin/${lead.id}?returnTo=${encodeURIComponent(`/admin/lists/${list.id}`)}&fromListName=${encodeURIComponent(list.name)}`}
                        onClick={() => markLeadViewed(lead.id)}
                        className="hover:text-[#C9A84C] hover:underline font-medium text-white"
                      >
                        {lead.name ?? "(unnamed)"}
                      </Link>
                    </td>

                  {colPrefs.isVisible("phone") && (
                    <td className="px-3 py-2">
                      <PhoneCell phone={lead.phone} name={lead.name} compact={true} />
                    </td>
                  )}

                  {colPrefs.isVisible("location") && (
                    <td className="px-3 py-2">
                      {lead.area ? (
                        <div className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-sky-500/10 border border-sky-500/20 text-sky-300 text-xs font-medium">
                          <MapPin size={11} className="shrink-0" />
                          <span>{lead.area}</span>
                        </div>
                      ) : lead.pincode ? (
                        <span className="font-mono text-xs text-white/60">PIN {lead.pincode}</span>
                      ) : (
                        <span className="text-white/30 text-xs">—</span>
                      )}
                    </td>
                  )}

                  {colPrefs.isVisible("service") && (
                    <td className="px-3 py-2">
                      <div>{lead.service ?? "-"}</div>
                      <div className="text-[11px] text-white/45">
                        {[lead.service_option, ...(lead.add_on_labels ?? []).map((label) => `+ ${label}`)]
                          .filter(Boolean)
                          .join(" | ")}
                      </div>
                    </td>
                  )}

                  {colPrefs.isVisible("vehicle") && (
                    <td className="px-3 py-2">
                      <div>{[lead.car_brand, lead.car_model].filter(Boolean).join(" ") || lead.vehicle_type || "-"}</div>
                      <div className="text-[11px] text-white/45">
                        {[lead.vehicle_type, lead.car_number].filter(Boolean).join(" | ")}
                      </div>
                    </td>
                  )}

                  {colPrefs.isVisible("status") && (
                    <td className="px-3 py-2">
                      <LeadStatusControl
                        canManage={canManage}
                        onSaved={(status) => setLeads((rows) => rows.map((row) => row.id === lead.id ? { ...row, status } : row))}
                        id={lead.id}
                        status={lead.status}
                        color={statusColorMap[lead.status] || "#C9A84C"}
                        customStatuses={configuredStatuses}
                      />
                    </td>
                  )}

                  {canManage && colPrefs.isVisible("actions") && (
                    <td className="px-3 py-2 text-center">
                      <button
                        type="button"
                        onClick={() => handleRemoveLead(lead.id)}
                        disabled={pending}
                        className="text-xs px-2 py-1 rounded bg-white/10 text-red-300 hover:bg-red-500/20 disabled:opacity-50"
                        title="Remove from list"
                      >
                        <Trash2 size={12} />
                      </button>
                    </td>
                  )}
                </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        {/* Pagination Bar */}
        {filteredLeads.length > 0 && (
          <div className="flex items-center justify-between gap-4 flex-wrap pt-3 pb-4 px-1 text-xs">
            <div className="text-white/50">
              Showing <span className="font-semibold text-white">
                {pageSize === "all" ? 1 : Math.min((currentPage - 1) * pageSize + 1, filteredLeads.length)}
              </span>–<span className="font-semibold text-white">
                {pageSize === "all" ? filteredLeads.length : Math.min(currentPage * pageSize, filteredLeads.length)}
              </span> of <span className="font-semibold text-white">{filteredLeads.length}</span> leads
            </div>

            <div className="flex items-center gap-3">
              {/* Per page switcher */}
              <div className="flex items-center gap-1.5 bg-white/[0.03] border border-white/10 rounded-xl px-2.5 py-1">
                <span className="text-[11px] text-white/40">Per page:</span>
                {([25, 50, 100, "all"] as const).map((size) => (
                  <button
                    key={size}
                    type="button"
                    onClick={() => {
                      setPageSize(size);
                      setCurrentPage(1);
                    }}
                    className={`px-2 py-0.5 rounded-lg text-xs font-semibold transition-all ${
                      pageSize === size
                        ? "bg-[#C9A84C] text-[#050E21]"
                        : "text-white/60 hover:text-white hover:bg-white/10"
                    }`}
                  >
                    {size === "all" ? "All" : size}
                  </button>
                ))}
              </div>

              {/* Page buttons */}
              {pageSize !== "all" && totalPages > 1 && (
                <div className="flex items-center gap-1.5">
                  <button
                    type="button"
                    onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
                    disabled={currentPage === 1}
                    className="px-3 py-1.5 rounded-xl border border-white/10 bg-white/[0.04] text-white font-medium hover:bg-white/10 disabled:opacity-30 disabled:pointer-events-none transition-all"
                  >
                    ‹ Prev
                  </button>
                  <span className="px-2 text-white/60 text-xs">
                    Page <strong className="text-white">{currentPage}</strong> of <strong className="text-white">{totalPages}</strong>
                  </span>
                  <button
                    type="button"
                    onClick={() => setCurrentPage((p) => Math.min(totalPages, p + 1))}
                    disabled={currentPage === totalPages}
                    className="px-3 py-1.5 rounded-xl border border-white/10 bg-white/[0.04] text-white font-medium hover:bg-white/10 disabled:opacity-30 disabled:pointer-events-none transition-all"
                  >
                    Next ›
                  </button>
                </div>
              )}
            </div>
          </div>
        )}
      </div>
      )}
    </>
  );
}
