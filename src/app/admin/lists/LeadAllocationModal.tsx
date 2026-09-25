"use client";

import { useState, useEffect, useTransition } from "react";
import {
  X,
  Zap,
  Clock,
  MapPin,
  Car,
  Check,
  CheckCircle2,
  AlertCircle,
  Loader2,
  Calendar,
  Sparkles,
  Hash,
  RotateCcw,
  IndianRupee,
  Repeat,
  Layers,
  ArrowRight,
} from "lucide-react";
import {
  getAllocationFilterOptionsAction,
  previewMatchingLeadsAction,
  submitLeadAllocationAction,
} from "./routing-actions";
import type { LeadListRow } from "@/lib/leadLists-shared";
import type { ScheduleMode } from "@/lib/lead-routing-shared";

interface Props {
  lists: LeadListRow[];
  adminUsers: { id: string; email: string; name: string }[];
  availableAreas?: string[];
  defaultFolder?: string;
  defaultArea?: string;
  folderName?: string;
  allFolders?: Array<{ id: string; name: string; count: number }>;
  initialCount?: number;
  isOpen: boolean;
  onClose: () => void;
  onSuccess: (message: string) => void;
}

const ALL_STATUS_OPTIONS = [
  { id: "new", label: "New Leads", color: "from-blue-500/20 to-blue-500/5 text-blue-300 border-blue-500/40" },
  { id: "draft", label: "Draft", color: "from-amber-500/20 to-amber-500/5 text-amber-300 border-amber-500/40" },
  { id: "call_not_responded", label: "Call Not Responded", color: "from-orange-500/20 to-orange-500/5 text-orange-300 border-orange-500/40" },
  { id: "follow_up", label: "Follow Up", color: "from-purple-500/20 to-purple-500/5 text-purple-300 border-purple-500/40" },
  { id: "contacted", label: "Contacted", color: "from-teal-500/20 to-teal-500/5 text-teal-300 border-teal-500/40" },
  { id: "booked", label: "Booked", color: "from-emerald-500/20 to-emerald-500/5 text-emerald-300 border-emerald-500/40" },
  { id: "cancelled", label: "Cancelled", color: "from-rose-500/20 to-rose-500/5 text-rose-300 border-rose-500/40" },
];

const COMMON_AREAS = [
  "Puzhuthivakkam",
  "Velachery",
  "Madipakkam",
  "Nanganallur",
  "Adambakkam",
  "Tambaram",
  "Adyar",
  "Anna Nagar",
  "OMR",
  "Guindy",
  "Porur",
  "T. Nagar",
  "Medavakkam",
  "Perungudi",
];

const PRICE_PRESETS = [3000, 5000, 10000, 15000];

export default function LeadAllocationModal({
  lists,
  adminUsers,
  availableAreas,
  defaultFolder,
  defaultArea,
  folderName,
  allFolders,
  initialCount,
  isOpen,
  onClose,
  onSuccess,
}: Props) {
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  // 0. Folder Scoping
  const [selectedFolder, setSelectedFolder] = useState<string>(defaultFolder || "all");

  // 1. Lead Count (Instant initial display with 0ms delay)
  const [leadCount, setLeadCount] = useState<number>(20);
  const [availableCount, setAvailableCount] = useState<number | null>(initialCount ?? null);
  const [totalUnallocatedPool, setTotalUnallocatedPool] = useState<number | null>(initialCount ?? null);
  const [isCounting, setIsCounting] = useState(false);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [statusOptions, setStatusOptions] = useState(ALL_STATUS_OPTIONS);
  const [serviceOptions, setServiceOptions] = useState<string[]>([]);
  const [filterOptionsError, setFilterOptionsError] = useState<string | null>(null);
  useEffect(() => {
    if (!isOpen) return;
    let cancelled = false;
    setFilterOptionsError(null);
    getAllocationFilterOptionsAction().then((options) => {
      if (cancelled) return;
      setStatusOptions(options.statuses.map((status) => ({ ...status, color: ALL_STATUS_OPTIONS.find((item) => item.id === status.id)?.color ?? "from-slate-500/20 to-slate-500/5 text-slate-300 border-slate-500/40" })));
      setServiceOptions(options.services);
    }).catch(() => {
      if (!cancelled) setFilterOptionsError("Could not load service and status options. Close and reopen to retry.");
    });
    return () => { cancelled = true; };
  }, [isOpen]);

  // 2. Conditions
  const [includeAssigned, setIncludeAssigned] = useState(false);
  const [poolBreakdown, setPoolBreakdown] = useState<{ assigned: number; unassigned: number } | null>(null);
  const [selectedStatuses, setSelectedStatuses] = useState<string[]>([]);

  const [selectedAreas, setSelectedAreas] = useState<string[]>(defaultArea ? [defaultArea] : []);
  const [customAreaInput, setCustomAreaInput] = useState("");

  const [selectedPincodes, setSelectedPincodes] = useState<string[]>([]);
  const [pincodeInput, setPincodeInput] = useState("");

  const [selectedServices, setSelectedServices] = useState<string[]>([]);
  const [minPrice, setMinPrice] = useState<string>("");

  // Sync defaultFolder and defaultArea when modal opens
  useEffect(() => {
    if (isOpen) {
      setIncludeAssigned(false);
      setSelectedFolder(defaultFolder || "all");
      if (defaultArea) {
        setSelectedAreas((prev) => (prev.includes(defaultArea) ? prev : [...prev, defaultArea]));
      }
      if (initialCount != null) {
        setAvailableCount((prev) => prev ?? initialCount);
        setTotalUnallocatedPool((prev) => prev ?? initialCount);
      }
    }
  }, [isOpen, defaultFolder, defaultArea, initialCount]);

  // 3. Assignees
  const [selectedAssigneeIds, setSelectedAssigneeIds] = useState<string[]>([]);
  const [targetListId, setTargetListId] = useState<string>("");

  // 4. Scheduling Mode
  const [scheduleMode, setScheduleMode] = useState<ScheduleMode>("once_now");
  const [scheduleDate, setScheduleDate] = useState("");
  const [scheduleTime, setScheduleTime] = useState("09:30");
  const [recurringTime, setRecurringTime] = useState("09:30");
  const [replenishThreshold, setReplenishThreshold] = useState<number>(5);
  const [notes, setNotes] = useState("");

  // Live query available matching leads count (folder-aware + location-scoped)
  useEffect(() => {
    if (!isOpen) return;
    let cancelled = false;
    setIsCounting(true);
    setPreviewError(null);

    const timer = setTimeout(async () => {
      try {
        const res = await previewMatchingLeadsAction({
          include_assigned: includeAssigned,
          folder: selectedFolder !== "all" ? selectedFolder : undefined,
          statuses: selectedStatuses.length > 0 ? selectedStatuses : undefined,
          areas: selectedAreas.length > 0 ? selectedAreas : undefined,
          pincodes: selectedPincodes.length > 0 ? selectedPincodes : undefined,
          services: selectedServices.length > 0 ? selectedServices : undefined,
          min_price: minPrice ? Number(minPrice) : null,
        }, { assignee_ids: selectedAssigneeIds, target_list_id: targetListId || null });
        if (cancelled) return;
        if (res.error) throw new Error(res.error);
        setPoolBreakdown({ assigned: res.assignedCount ?? 0, unassigned: res.unassignedCount ?? res.count });
        setAvailableCount(res.count);
        setTotalUnallocatedPool(res.totalUnallocated);
      } catch (err) {
        if (!cancelled) {
          setAvailableCount(null);
          setTotalUnallocatedPool(null);
          setPreviewError(err instanceof Error ? err.message : "Could not load the available leads.");
        }
      } finally {
        if (!cancelled) setIsCounting(false);
      }
    }, 50);

    return () => { cancelled = true; clearTimeout(timer); };
  }, [isOpen, selectedFolder, selectedStatuses, selectedAreas, selectedPincodes, selectedServices, minPrice, includeAssigned, selectedAssigneeIds, targetListId]);

  if (!isOpen) return null;

  // Handlers for Status
  const toggleStatus = (statusId: string) => {
    setSelectedStatuses((prev) =>
      prev.includes(statusId) ? prev.filter((s) => s !== statusId) : [...prev, statusId],
    );
  };

  // Handlers for Area
  const toggleArea = (area: string) => {
    setSelectedAreas((prev) =>
      prev.includes(area) ? prev.filter((a) => a !== area) : [...prev, area],
    );
  };

  const removeArea = (areaToRemove: string) => {
    setSelectedAreas((prev) => prev.filter((a) => a !== areaToRemove));
  };

  const handleAddCustomArea = () => {
    const trimmed = customAreaInput.trim();
    if (!trimmed) return;
    if (!selectedAreas.some((a) => a.toLowerCase() === trimmed.toLowerCase())) {
      setSelectedAreas((prev) => [...prev, trimmed]);
    }
    setCustomAreaInput("");
  };

  // Handlers for Pincode
  const handleAddPincode = () => {
    const cleanPin = pincodeInput.replace(/\D/g, "").slice(0, 6);
    if (!cleanPin) return;
    if (!selectedPincodes.includes(cleanPin)) {
      setSelectedPincodes((prev) => [...prev, cleanPin]);
    }
    setPincodeInput("");
  };

  const removePincode = (pinToRemove: string) => {
    setSelectedPincodes((prev) => prev.filter((p) => p !== pinToRemove));
  };

  // Handlers for Service
  const toggleService = (srv: string) => {
    setSelectedServices((prev) =>
      prev.includes(srv) ? prev.filter((s) => s !== srv) : [...prev, srv],
    );
  };

  const removeService = (srvToRemove: string) => {
    setSelectedServices((prev) => prev.filter((s) => s !== srvToRemove));
  };

  // Handlers for Assignee
  const toggleAssignee = (userId: string) => {
    setTargetListId("");
    setSelectedAssigneeIds((prev) =>
      prev.includes(userId) ? prev.filter((id) => id !== userId) : [...prev, userId],
    );
  };

  const selectAllAssignees = () => {
    setTargetListId("");
    if (selectedAssigneeIds.length === adminUsers.length) {
      setSelectedAssigneeIds([]);
    } else {
      setSelectedAssigneeIds(adminUsers.map((u) => u.id));
    }
  };

  // Clear All Filters
  const clearAllFilters = () => {
    setSelectedStatuses([]);
    setSelectedAreas([]);
    setSelectedPincodes([]);
    setSelectedServices([]);
    setMinPrice("");
  };

  const hasActiveFilters =
    selectedStatuses.length > 0 ||
    selectedAreas.length > 0 ||
    selectedPincodes.length > 0 ||
    selectedServices.length > 0 ||
    Boolean(minPrice);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!leadCount || leadCount <= 0) {
      setError("Please specify how many leads to allocate.");
      return;
    }

    if (selectedAssigneeIds.length === 0 && !targetListId) {
      setError("Please select at least one telecaller or destination campaign list.");
      return;
    }

    let scheduledForIso: string | null = null;
    if (scheduleMode === "once_scheduled") {
      if (!scheduleDate || !scheduleTime) {
        setError("Please choose both date and time for scheduled allocation.");
        return;
      }
      scheduledForIso = new Date(`${scheduleDate}T${scheduleTime}:00+05:30`).toISOString();
    }

    setError(null);

    startTransition(async () => {
      const res = await submitLeadAllocationAction({
        schedule_mode: scheduleMode,
        lead_count: Number(leadCount),
        conditions: {
          include_assigned: includeAssigned,
          folder: selectedFolder !== "all" ? selectedFolder : undefined,
          statuses: selectedStatuses.length > 0 ? selectedStatuses : undefined,
          areas: selectedAreas.length > 0 ? selectedAreas : undefined,
          pincodes: selectedPincodes.length > 0 ? selectedPincodes : undefined,
          services: selectedServices.length > 0 ? selectedServices : undefined,
          min_price: minPrice ? Number(minPrice) : null,
        },
        assignee_ids: selectedAssigneeIds,
        target_list_id: targetListId || null,
        scheduled_for: scheduledForIso,
        recurring_time: recurringTime,
        replenish_threshold: Number(replenishThreshold),
        notes: notes.trim() || null,
      });

      if (res.ok) {
        const notifySuccess = (message: string) => onSuccess([message, ...(res.reassignedCount != null ? [`${res.unassignedCount ?? 0} newly assigned; ${res.reassignedCount} reassigned.`] : []), ...(res.warnings ?? [])].join(" "));
        if (res.mode === "daily_recurring") {
          notifySuccess(`Configured everyday schedule: ${leadCount} leads at ${recurringTime} IST`);
        } else if (res.mode === "queue_replenish") {
          notifySuccess(`Initial batch: ${res.allocatedCount ?? 0} leads. Saved auto-refill rule for ${leadCount} leads when the queue reaches or falls below ${replenishThreshold}.`);
        } else if (res.mode === "once_scheduled") {
          notifySuccess(`Scheduled ${leadCount} leads for ${scheduleDate} at ${scheduleTime} IST`);
        } else {
          notifySuccess(`Successfully allocated ${res.allocatedCount} leads to your team!`);
        }
        onClose();
      } else {
        setError(res.error || "Failed to configure lead allocation.");
      }
    });
  };

  const leadsPerStaff =
    selectedAssigneeIds.length > 0 ? Math.ceil(leadCount / selectedAssigneeIds.length) : 0;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm animate-in fade-in duration-150">
      <div className="relative w-full max-w-2xl bg-[#071228] border border-white/[0.12] rounded-3xl shadow-2xl overflow-hidden flex flex-col text-white max-h-[92vh]">
        {/* Header */}
        <div className="px-6 py-5 border-b border-white/[0.08] flex items-center justify-between bg-white/[0.02]">
          <div className="flex items-center gap-3">
            <div className="grid h-10 w-10 place-items-center rounded-xl bg-gradient-to-br from-[#C9A84C]/20 to-[#E8CC7A]/5 text-[#C9A84C] border border-[#C9A84C]/30 shadow-md">
              <Zap size={20} />
            </div>
            <div>
              <h2 className="text-base font-bold text-white">Allocate & Schedule Leads</h2>
              <p className="text-xs text-white/40">
                {selectedFolder !== "all"
                  ? `Assigning leads strictly scoped to ${folderName || selectedFolder}`
                  : "Immediate distribution, daily recurring schedules, or queue-based auto-replenishment."}
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg text-white/40 hover:text-white hover:bg-white/10 transition-colors"
          >
            <X size={16} />
          </button>
        </div>

        {/* Body */}
        <form onSubmit={handleSubmit} className="p-6 space-y-6 text-xs overflow-y-auto flex-1">
          {error && (
            <div className="p-3.5 rounded-xl bg-rose-500/10 border border-rose-500/30 text-rose-300 text-xs flex items-center gap-2">
              <AlertCircle size={15} className="shrink-0" />
              <span>{error}</span>
            </div>
          )}

          {/* DUAL-SCOPING BANNER: Folder + Locality Indicator */}
          <div className="p-3.5 rounded-2xl bg-gradient-to-r from-[#0B1E3D] via-[#07142A] to-[#0B1E3D] border border-[#C9A84C]/30 shadow-inner flex flex-wrap items-center justify-between gap-2.5">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="text-[11px] font-bold text-[#E8CC7A] uppercase tracking-wider flex items-center gap-1">
                <Layers size={13} /> Scoping:
              </span>

              {/* Folder Pill / Dropdown */}
              {allFolders && allFolders.length > 0 ? (
                <select
                  value={selectedFolder}
                  onChange={(e) => setSelectedFolder(e.target.value)}
                  className="bg-[#050E21] border border-[#C9A84C]/40 text-[#E8CC7A] font-bold rounded-lg px-2 py-1 text-xs outline-none focus:border-[#E8CC7A]"
                >
                  <option value="all">📁 All Folders Combined</option>
                  {allFolders.map((f) => (
                    <option key={f.id} value={f.id}>
                      📁 {f.name} ({f.count.toLocaleString()} leads)
                    </option>
                  ))}
                </select>
              ) : (
                <span className="px-2.5 py-1 rounded-lg bg-[#C9A84C]/20 border border-[#C9A84C]/40 text-[#E8CC7A] font-bold text-xs flex items-center gap-1.5 shadow-sm">
                  <span>📁 {folderName || (selectedFolder !== "all" ? selectedFolder : "All Folders")}</span>
                </span>
              )}

              {/* Active Territory Pill */}
              {selectedAreas.length > 0 && (
                <span className="px-2.5 py-1 rounded-lg bg-sky-500/20 border border-sky-500/40 text-sky-300 font-bold text-xs flex items-center gap-1 shadow-sm">
                  <MapPin size={12} />
                  <span>📍 {selectedAreas.join(", ")}</span>
                </span>
              )}
            </div>

            {/* Quick Scope Reset */}
            {(selectedFolder !== "all" || selectedAreas.length > 0) && (
              <button
                type="button"
                onClick={() => {
                  setSelectedFolder("all");
                  setSelectedAreas([]);
                }}
                className="text-[10px] text-white/50 hover:text-white underline transition-colors cursor-pointer"
              >
                Clear Scoping
              </button>
            )}
          </div>

          {filterOptionsError && <p role="alert" className="text-xs text-rose-300">{filterOptionsError}</p>}
          {/* Section 1: Lead Count & Live Pool Indicator */}
          <div className="p-4 rounded-2xl bg-[#050E21] border border-white/10 space-y-3">
            <div className="flex items-center justify-between flex-wrap gap-2">
              <label className="text-white font-bold text-xs uppercase tracking-wider text-[#E8CC7A]">
                1. Number of Leads to Allocate {scheduleMode === "daily_recurring" ? "Per Day" : scheduleMode === "queue_replenish" ? "Per Refill" : ""}
              </label>

              <div className="flex items-center gap-2 text-xs bg-white/[0.03] px-3 py-1.5 rounded-xl border border-white/5">
                <span className="text-white/40">
                  {includeAssigned ? "Eligible Lead Pool:" : hasActiveFilters ? "Matching Filter Pool:" : "Total Unallocated Pool:"}
                </span>
                {isCounting ? (
                  <Loader2 size={12} className="animate-spin text-[#C9A84C]" />
                ) : previewError ? (
                  <span role="alert" className="text-rose-300">{previewError}</span>
                ) : (
                  <div className="flex items-center gap-1.5">
                    <strong
                      className={`font-mono ${
                        (availableCount ?? 0) > 0 ? "text-emerald-400" : "text-amber-400"
                      }`}
                    >
                      {availableCount ?? 0} leads
                    </strong>
                    {includeAssigned && poolBreakdown && <span className="text-white/60 text-[11px]">({poolBreakdown.unassigned} unassigned + {poolBreakdown.assigned} already assigned)</span>}
                    {!includeAssigned && hasActiveFilters && totalUnallocatedPool != null && (
                      <span className="text-white/40 text-[11px]">
                        (out of {totalUnallocatedPool} total unallocated)
                      </span>
                    )}
                  </div>
                )}
              </div>
            </div>

            <label className="flex items-start gap-3 rounded-xl border border-purple-400/30 bg-purple-500/10 p-3 text-sm text-white">
              <input type="checkbox" checked={includeAssigned} onChange={(event) => setIncludeAssigned(event.target.checked)} />
              <span>Include already-assigned leads
                <span className="block text-xs text-white/60 mt-1">Move matching leads from their current assignment. Their status stays unchanged. Leads already with the selected team are excluded. Recurring rules use each lead only once.</span>
              </span>
            </label>
            <div className="flex items-center gap-3 flex-wrap">
              <input
                type="number"
                min={1}
                max={500}
                required
                value={leadCount}
                onChange={(e) => setLeadCount(Number(e.target.value))}
                className="w-28 bg-[#071228] border border-white/15 rounded-xl px-3.5 py-2 text-white font-bold text-sm font-mono focus:outline-none focus:border-[#C9A84C]"
              />

              <div className="flex gap-1.5 flex-wrap">
                {[10, 25, 50, 100].map((n) => (
                  <button
                    key={n}
                    type="button"
                    onClick={() => setLeadCount(n)}
                    className={`px-3 py-1.5 rounded-xl border text-xs font-semibold transition-all ${
                      leadCount === n
                        ? "bg-[#C9A84C] text-[#050E21] border-[#C9A84C] shadow-sm"
                        : "bg-white/5 border-white/10 text-white/70 hover:text-white hover:bg-white/10"
                    }`}
                  >
                    {n} leads
                  </button>
                ))}
              </div>
            </div>

            {availableCount !== null && leadCount > availableCount && (
              <div className="text-[11px] text-amber-300/80 bg-amber-500/10 border border-amber-500/20 px-3 py-1.5 rounded-xl flex items-center gap-1.5">
                <AlertCircle size={13} className="shrink-0" />
                <span>
                  You requested {leadCount} leads, but only {availableCount} matching leads are available. Up to {availableCount} can be allocated; availability is checked again when the allocation runs.
                </span>
              </div>
            )}
          </div>

          {/* Section 2: Filter Conditions */}
          <div className="p-4 rounded-2xl bg-[#050E21] border border-white/10 space-y-4">
            <div className="flex items-center justify-between">
              <div>
                <h3 className="text-xs font-bold uppercase tracking-wider text-[#E8CC7A]">
                  2. Filter Conditions (Optional)
                </h3>
                <p className="text-[11px] text-white/40">
                  Target leads by location, pincode, service, or ticket value.
                </p>
              </div>

              {hasActiveFilters && (
                <button
                  type="button"
                  onClick={clearAllFilters}
                  className="text-[11px] text-rose-400/90 hover:text-rose-300 font-semibold inline-flex items-center gap-1 hover:underline"
                >
                  <RotateCcw size={11} /> Clear all filters
                </button>
              )}
            </div>

            {/* A. Lead Statuses (Default: All) */}
            <div className="space-y-2 pt-1 border-t border-white/[0.04]">
              <div className="flex items-center justify-between">
                <label className="text-white/70 font-semibold flex items-center gap-1.5 text-xs">
                  <CheckCircle2 size={12} className="text-emerald-400" />
                  <span>Lead Statuses</span>
                </label>
                <div className="flex items-center gap-2">
                  <span className="text-[10px] text-emerald-400 font-semibold">
                    {selectedStatuses.length ? `${selectedStatuses.length} selected` : "All statuses"}
                  </span>
                  <button
                    type="button"
                    onClick={() => setSelectedStatuses([])}
                    className="text-[10px] text-white/40 hover:text-white underline"
                  >
                    All statuses
                  </button>
                </div>
              </div>

              <p className="text-[11px] text-white/50">{includeAssigned ? "Matching assigned and unassigned leads are eligible." : "All unassigned leads are eligible by default."} Select statuses to narrow the pool; allocation keeps each lead’s current status.</p>
              {/* Status Option Chips */}
              <div className="flex flex-wrap gap-1.5">
                {statusOptions.map((status) => {
                  const isSelected = selectedStatuses.includes(status.id);
                  return (
                    <button
                      key={status.id}
                      type="button"
                      onClick={() => toggleStatus(status.id)}
                      className={`px-2.5 py-1 rounded-lg border text-xs font-medium transition-all ${
                        isSelected
                          ? `bg-gradient-to-br ${status.color} shadow-sm ring-1 ring-white/10 font-semibold`
                          : "bg-white/[0.03] border-white/10 text-white/50 hover:text-white hover:bg-white/[0.06]"
                      }`}
                    >
                      {isSelected ? `✓ ${status.label}` : `+ ${status.label}`}
                    </button>
                  );
                })}
              </div>
            </div>

            {/* B. Areas / Localities */}
            <div className="space-y-2 pt-2 border-t border-white/[0.04]">
              <div className="flex items-center justify-between">
                <label className="text-white/70 font-semibold flex items-center gap-1.5">
                  <MapPin size={12} className="text-[#C9A84C]" />
                  <span>Chennai Localities / Areas</span>
                </label>
                {selectedAreas.length > 0 && (
                  <span className="text-[10px] text-sky-400 font-semibold">
                    {selectedAreas.length} selected
                  </span>
                )}
              </div>

              {/* Active Selected Area Tags */}
              {selectedAreas.length > 0 && (
                <div className="flex flex-wrap gap-1.5 p-2 rounded-xl bg-sky-500/5 border border-sky-500/20">
                  {selectedAreas.map((area) => (
                    <span
                      key={area}
                      className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-sky-500/20 border border-sky-500/30 text-sky-200 text-xs font-semibold animate-in fade-in"
                    >
                      <span>📍 {area}</span>
                      <button
                        type="button"
                        onClick={() => removeArea(area)}
                        className="hover:text-white p-0.5 rounded hover:bg-sky-500/30"
                        title="Remove area"
                      >
                        <X size={11} />
                      </button>
                    </span>
                  ))}
                </div>
              )}

              {/* Quick Area Preset Chips */}
              <div className="flex flex-wrap gap-1.5 max-h-36 overflow-y-auto pr-1">
                {(availableAreas && availableAreas.length > 0
                  ? Array.from(new Set([...availableAreas, ...COMMON_AREAS]))
                  : COMMON_AREAS
                )
                  .slice(0, 18)
                  .map((area) => {
                    const isSelected = selectedAreas.includes(area);
                    return (
                      <button
                        key={area}
                        type="button"
                        onClick={() => toggleArea(area)}
                        className={`px-2.5 py-1 rounded-lg border text-[11px] font-medium transition-all ${
                          isSelected
                            ? "bg-sky-500/20 border-sky-500/40 text-sky-300 font-semibold"
                            : "bg-white/[0.03] border-white/10 text-white/60 hover:text-white hover:bg-white/[0.06]"
                        }`}
                      >
                        {isSelected ? `✓ ${area}` : `+ ${area}`}
                      </button>
                    );
                  })}
              </div>

              {/* Custom Area Input with Autocomplete Datalist */}
              <div className="flex items-center gap-2 pt-1">
                <input
                  type="text"
                  list="available-areas-list"
                  value={customAreaInput}
                  onChange={(e) => setCustomAreaInput(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      e.preventDefault();
                      handleAddCustomArea();
                    }
                  }}
                  placeholder="Select or type any captured area (e.g. Sholinganallur)..."
                  className="flex-1 bg-[#071228] border border-white/15 rounded-xl px-3 py-1.5 text-xs text-white placeholder:text-white/30 focus:outline-none focus:border-[#C9A84C]"
                />
                <datalist id="available-areas-list">
                  {(availableAreas && availableAreas.length > 0
                    ? Array.from(new Set([...availableAreas, ...COMMON_AREAS]))
                    : COMMON_AREAS
                  ).map((a) => (
                    <option key={a} value={a} />
                  ))}
                </datalist>
                <button
                  type="button"
                  onClick={handleAddCustomArea}
                  className="px-3.5 py-1.5 rounded-xl bg-white/10 hover:bg-white/15 text-xs font-semibold text-white/90"
                >
                  Add Area
                </button>
              </div>
            </div>

            {/* B. Pincodes */}
            <div className="space-y-2 pt-2 border-t border-white/[0.04]">
              <div className="flex items-center justify-between">
                <label className="text-white/70 font-semibold flex items-center gap-1.5">
                  <Hash size={12} className="text-purple-400" />
                  <span>Target Pincodes</span>
                </label>
                {selectedPincodes.length > 0 && (
                  <span className="text-[10px] text-purple-300 font-semibold">
                    {selectedPincodes.length} pincodes added
                  </span>
                )}
              </div>

              {/* Active Selected Pincode Tags */}
              {selectedPincodes.length > 0 && (
                <div className="flex flex-wrap gap-1.5 p-2 rounded-xl bg-purple-500/5 border border-purple-500/20">
                  {selectedPincodes.map((pin) => (
                    <span
                      key={pin}
                      className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-purple-500/20 border border-purple-500/30 text-purple-200 text-xs font-mono font-semibold animate-in fade-in"
                    >
                      <span>PIN {pin}</span>
                      <button
                        type="button"
                        onClick={() => removePincode(pin)}
                        className="hover:text-white p-0.5 rounded hover:bg-purple-500/30"
                        title="Remove pincode"
                      >
                        <X size={11} />
                      </button>
                    </span>
                  ))}
                </div>
              )}

              {/* Pincode Input */}
              <div className="flex items-center gap-2">
                <input
                  type="text"
                  maxLength={6}
                  value={pincodeInput}
                  onChange={(e) => setPincodeInput(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      e.preventDefault();
                      handleAddPincode();
                    }
                  }}
                  placeholder="Enter 6-digit PIN (e.g. 600042)..."
                  className="w-56 bg-[#071228] border border-white/15 rounded-xl px-3 py-1.5 text-xs text-white font-mono placeholder:text-white/30 focus:outline-none focus:border-purple-400"
                />
                <button
                  type="button"
                  onClick={handleAddPincode}
                  className="px-3.5 py-1.5 rounded-xl bg-purple-500/20 border border-purple-500/30 text-purple-200 hover:bg-purple-500/30 text-xs font-semibold"
                >
                  + Add PIN
                </button>
              </div>
            </div>

            {/* C. Service Category */}
            <div className="space-y-2 pt-2 border-t border-white/[0.04]">
              <div className="flex items-center justify-between">
                <label className="text-white/70 font-semibold flex items-center gap-1.5">
                  <Car size={12} className="text-[#C9A84C]" />
                  <span>Service Category</span>
                </label>
                {selectedServices.length > 0 && (
                  <span className="text-[10px] text-[#E8CC7A] font-semibold">
                    {selectedServices.length} selected
                  </span>
                )}
              </div>

              {/* Active Selected Services Tags */}
              {selectedServices.length > 0 && (
                <div className="flex flex-wrap gap-1.5 p-2 rounded-xl bg-[#C9A84C]/5 border border-[#C9A84C]/20">
                  {selectedServices.map((srv) => (
                    <span
                      key={srv}
                      className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-[#C9A84C]/20 border border-[#C9A84C]/30 text-[#E8CC7A] text-xs font-semibold animate-in fade-in"
                    >
                      <span>🚗 {srv}</span>
                      <button
                        type="button"
                        onClick={() => removeService(srv)}
                        className="hover:text-white p-0.5 rounded hover:bg-[#C9A84C]/30"
                        title="Remove service"
                      >
                        <X size={11} />
                      </button>
                    </span>
                  ))}
                </div>
              )}

              {/* Quick Service Chips */}
              <div className="flex flex-wrap gap-1.5">
                {serviceOptions.map((srv) => {
                  const isSelected = selectedServices.includes(srv);
                  return (
                    <button
                      key={srv}
                      type="button"
                      onClick={() => toggleService(srv)}
                      className={`px-2.5 py-1 rounded-lg border text-[11px] font-medium transition-all ${
                        isSelected
                          ? "bg-[#C9A84C]/20 border-[#C9A84C]/40 text-[#E8CC7A] font-semibold"
                          : "bg-white/[0.03] border-white/10 text-white/60 hover:text-white hover:bg-white/[0.06]"
                      }`}
                    >
                      {isSelected ? `✓ ${srv}` : `+ ${srv}`}
                    </button>
                  );
                })}
              </div>
            </div>

            {/* D. Minimum Order Value */}
            <div className="space-y-2 pt-2 border-t border-white/[0.04]">
              <div className="flex items-center justify-between">
                <label className="text-white/70 font-semibold flex items-center gap-1.5">
                  <IndianRupee size={12} className="text-emerald-400" />
                  <span>Minimum Order Value (₹)</span>
                </label>
                {minPrice && (
                  <button
                    type="button"
                    onClick={() => setMinPrice("")}
                    className="text-[10px] text-white/40 hover:text-white"
                  >
                    Clear
                  </button>
                )}
              </div>

              <div className="flex items-center gap-2 flex-wrap">
                <div className="relative">
                  <span className="absolute left-3 top-1/2 -translate-y-1/2 text-white/40 font-mono text-xs">
                    ₹
                  </span>
                  <input
                    type="number"
                    value={minPrice}
                    onChange={(e) => setMinPrice(e.target.value)}
                    placeholder="e.g. 5000"
                    className="w-36 bg-[#071228] border border-white/15 rounded-xl pl-7 pr-3 py-1.5 text-white font-mono text-xs focus:outline-none focus:border-emerald-400"
                  />
                </div>

                <div className="flex gap-1">
                  {PRICE_PRESETS.map((p) => (
                    <button
                      key={p}
                      type="button"
                      onClick={() => setMinPrice(String(p))}
                      className={`px-2 py-1 rounded-lg border text-[11px] font-mono transition-all ${
                        minPrice === String(p)
                          ? "bg-emerald-500/20 border-emerald-500/40 text-emerald-300 font-bold"
                          : "bg-white/[0.03] border-white/10 text-white/60 hover:text-white"
                      }`}
                    >
                      ≥ ₹{p.toLocaleString("en-IN")}
                    </button>
                  ))}
                </div>
              </div>
            </div>
          </div>

          {/* Section 3: Staff Selection & Distribution */}
          <div className="p-4 rounded-2xl bg-[#050E21] border border-white/10 space-y-3">
            <div className="flex items-center justify-between flex-wrap gap-2">
              <div>
                <h3 className="text-xs font-bold uppercase tracking-wider text-[#E8CC7A]">
                  3. Assign to Telecallers / Campaign List
                </h3>
                {selectedAssigneeIds.length > 0 && (
                  <span className="text-[11px] text-emerald-400 font-semibold">
                    ~{leadsPerStaff} leads per telecaller
                  </span>
                )}
              </div>

              <button
                type="button"
                onClick={selectAllAssignees}
                className="text-[11px] text-[#E8CC7A] hover:underline font-semibold"
              >
                {selectedAssigneeIds.length === adminUsers.length ? "Deselect All" : "Select All Staff"}
              </button>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 max-h-40 overflow-y-auto p-2 rounded-xl bg-[#071228] border border-white/10">
              {adminUsers.map((u) => {
                const isChecked = selectedAssigneeIds.includes(u.id);
                return (
                  <button
                    key={u.id}
                    type="button"
                    onClick={() => toggleAssignee(u.id)}
                    className={`flex items-center gap-2.5 p-2 rounded-lg border text-left transition-all ${
                      isChecked
                        ? "bg-[#C9A84C]/15 border-[#C9A84C]/40 text-white font-medium"
                        : "bg-white/[0.02] border-white/5 text-white/60 hover:text-white"
                    }`}
                  >
                    <div
                      className={`h-4 w-4 rounded flex items-center justify-center border ${
                        isChecked
                          ? "bg-[#C9A84C] border-[#C9A84C] text-[#050E21]"
                          : "border-white/20"
                      }`}
                    >
                      {isChecked && <Check size={12} className="stroke-[3]" />}
                    </div>
                    <div className="truncate text-xs">
                      <div className="font-semibold text-white truncate">{u.name}</div>
                      <div className="text-[10px] text-white/40 truncate">{u.email}</div>
                    </div>
                  </button>
                );
              })}
            </div>

            <div className="pt-1">
              <label className="text-white/50 text-[11px]">
                Or add directly into existing Campaign List:
              </label>
              <select
                value={targetListId}
                onChange={(e) => { setTargetListId(e.target.value); setSelectedAssigneeIds([]); }}
                className="w-full bg-[#071228] border border-white/10 rounded-xl px-3 py-1.5 text-white text-xs mt-1"
              >
                <option value="">— Auto-create Staff Lead Lists (Default) —</option>
                {lists.filter((l) => !l.is_custom_folder).map((l) => (
                  <option key={l.id} value={l.id}>
                    {l.name}
                  </option>
                ))}
              </select>
            </div>
          </div>

          {/* Section 4: Advanced Dispatch Timing & Automation */}
          <div className="p-4 rounded-2xl bg-[#050E21] border border-white/10 space-y-4">
            <div>
              <h3 className="text-xs font-bold uppercase tracking-wider text-[#E8CC7A] flex items-center gap-1.5">
                <Clock size={13} />
                <span>4. Dispatch Timing & Advanced Automation</span>
              </h3>
              <p className="text-[11px] text-white/40">
                Choose when and how leads are distributed to your team.
              </p>
            </div>

            {/* 4 Dispatch Mode Cards */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
              {/* Mode A: Once Now */}
              <button
                type="button"
                onClick={() => setScheduleMode("once_now")}
                className={`p-3 rounded-xl border text-left transition-all space-y-1 ${
                  scheduleMode === "once_now"
                    ? "bg-[#C9A84C]/15 border-[#C9A84C] text-white"
                    : "bg-[#071228] border-white/10 text-white/60 hover:text-white"
                }`}
              >
                <div className="flex items-center justify-between">
                  <span className="font-bold text-xs text-white flex items-center gap-1">
                    <Zap size={13} className="text-[#C9A84C]" /> Allocate Now
                  </span>
                  {scheduleMode === "once_now" && (
                    <span className="h-2 w-2 rounded-full bg-[#C9A84C]" />
                  )}
                </div>
                <p className="text-[10px] text-white/40">
                  Instantly distribute {leadCount} leads right now.
                </p>
              </button>

              {/* Mode B: Once Scheduled */}
              <button
                type="button"
                onClick={() => setScheduleMode("once_scheduled")}
                className={`p-3 rounded-xl border text-left transition-all space-y-1 ${
                  scheduleMode === "once_scheduled"
                    ? "bg-[#C9A84C]/15 border-[#C9A84C] text-white"
                    : "bg-[#071228] border-white/10 text-white/60 hover:text-white"
                }`}
              >
                <div className="flex items-center justify-between">
                  <span className="font-bold text-xs text-white flex items-center gap-1">
                    <Calendar size={13} className="text-sky-400" /> One-Time Schedule
                  </span>
                  {scheduleMode === "once_scheduled" && (
                    <span className="h-2 w-2 rounded-full bg-[#C9A84C]" />
                  )}
                </div>
                <p className="text-[10px] text-white/40">
                  Release on a specific date & time.
                </p>
              </button>

              {/* Mode C: Daily Recurring */}
              <button
                type="button"
                onClick={() => setScheduleMode("daily_recurring")}
                className={`p-3 rounded-xl border text-left transition-all space-y-1 ${
                  scheduleMode === "daily_recurring"
                    ? "bg-[#C9A84C]/15 border-[#C9A84C] text-white"
                    : "bg-[#071228] border-white/10 text-white/60 hover:text-white"
                }`}
              >
                <div className="flex items-center justify-between">
                  <span className="font-bold text-xs text-white flex items-center gap-1">
                    <Repeat size={13} className="text-emerald-400" /> Everyday at Set Time
                  </span>
                  {scheduleMode === "daily_recurring" && (
                    <span className="h-2 w-2 rounded-full bg-[#C9A84C]" />
                  )}
                </div>
                <p className="text-[10px] text-white/40">
                  Automatically allocate {leadCount} leads every morning.
                </p>
              </button>

              {/* Mode D: Queue Auto-Refill */}
              <button
                type="button"
                onClick={() => setScheduleMode("queue_replenish")}
                className={`p-3 rounded-xl border text-left transition-all space-y-1 ${
                  scheduleMode === "queue_replenish"
                    ? "bg-[#C9A84C]/15 border-[#C9A84C] text-white"
                    : "bg-[#071228] border-white/10 text-white/60 hover:text-white"
                }`}
              >
                <div className="flex items-center justify-between">
                  <span className="font-bold text-xs text-white flex items-center gap-1">
                    <Layers size={13} className="text-purple-400" /> Auto-Refill on Completion
                  </span>
                  {scheduleMode === "queue_replenish" && (
                    <span className="h-2 w-2 rounded-full bg-[#C9A84C]" />
                  )}
                </div>
                <p className="text-[10px] text-white/40">
                  Refill leads whenever staff completes their queue.
                </p>
              </button>
            </div>

            {/* Sub-panels based on selected mode */}
            {scheduleMode === "once_scheduled" && (
              <div className="grid grid-cols-2 gap-3 p-3 rounded-xl bg-[#071228] border border-white/10 animate-in fade-in">
                <div className="space-y-1">
                  <label className="text-white/60 text-[11px] font-semibold">Date</label>
                  <input
                    type="date"
                    required
                    value={scheduleDate}
                    onChange={(e) => setScheduleDate(e.target.value)}
                    className="w-full bg-[#050E21] border border-white/15 rounded-lg px-2.5 py-1.5 text-white text-xs"
                  />
                </div>

                <div className="space-y-1">
                  <label className="text-white/60 text-[11px] font-semibold">Time (IST)</label>
                  <input
                    type="time"
                    required
                    value={scheduleTime}
                    onChange={(e) => setScheduleTime(e.target.value)}
                    className="w-full bg-[#050E21] border border-white/15 rounded-lg px-2.5 py-1.5 text-white text-xs"
                  />
                </div>
              </div>
            )}

            {scheduleMode === "daily_recurring" && (
              <div className="p-3 rounded-xl bg-[#071228] border border-emerald-500/30 space-y-2 animate-in fade-in">
                <div className="flex items-center justify-between flex-wrap gap-2">
                  <div className="space-y-0.5">
                    <span className="text-white font-semibold text-xs flex items-center gap-1.5">
                      <Repeat size={13} className="text-emerald-400" />
                      <span>Everyday Morning Dispatch Time</span>
                    </span>
                    <p className="text-[10px] text-white/40">
                      System will release {leadCount} matching leads every day (Mon–Sat) to selected staff.
                    </p>
                  </div>

                  <div className="flex items-center gap-2">
                    <input
                      type="time"
                      value={recurringTime}
                      onChange={(e) => setRecurringTime(e.target.value)}
                      className="bg-[#050E21] border border-white/15 rounded-lg px-3 py-1.5 text-white font-mono text-xs"
                    />
                    <span className="text-white/40 text-xs">IST</span>
                  </div>
                </div>
              </div>
            )}

            {scheduleMode === "queue_replenish" && (
              <div className="p-3 rounded-xl bg-[#071228] border border-purple-500/30 space-y-2 animate-in fade-in">
                <div className="space-y-1">
                  <span className="text-white font-semibold text-xs flex items-center gap-1.5">
                    <Layers size={13} className="text-purple-400" />
                    <span>Queue Auto-Refill Threshold</span>
                  </span>
                  <p className="text-[10px] text-white/40">
                    Whenever a telecaller has fewer than <strong>{replenishThreshold} active leads</strong> remaining, automatically assign <strong>{leadCount} fresh leads</strong> from the pool.
                  </p>
                </div>

                <div className="flex items-center gap-2 pt-1">
                  <span className="text-white/60 text-xs">Refill when active queue drops below:</span>
                  <input
                    type="number"
                    min={1}
                    max={20}
                    value={replenishThreshold}
                    onChange={(e) => setReplenishThreshold(Number(e.target.value))}
                    className="w-20 bg-[#050E21] border border-white/15 rounded-lg px-2.5 py-1 text-white font-mono text-xs font-bold"
                  />
                  <span className="text-white/40 text-xs">leads</span>
                </div>
              </div>
            )}
          </div>

          {/* Footer */}
          <div className="flex items-center justify-end gap-3 pt-3 border-t border-white/[0.08]">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 rounded-xl bg-white/5 hover:bg-white/10 text-xs font-semibold text-white/70 transition-colors"
            >
              Cancel
            </button>

            <button
              type="submit"
              disabled={isPending}
              className="px-6 py-2.5 rounded-xl bg-gradient-to-r from-[#C9A84C] to-[#E8CC7A] text-[#050E21] text-xs font-bold hover:brightness-105 transition-all shadow-md shadow-[#C9A84C]/20 inline-flex items-center gap-1.5 disabled:opacity-50"
            >
              {isPending ? (
                <>
                  <Loader2 size={13} className="animate-spin" />
                  <span>Processing…</span>
                </>
              ) : (
                <>
                  <Zap size={14} />
                  <span>
                    {scheduleMode === "once_now" && `Allocate ${leadCount} Leads Now`}
                    {scheduleMode === "once_scheduled" && "Schedule Lead Allocation"}
                    {scheduleMode === "daily_recurring" && `Enable Daily (${leadCount} leads/day)`}
                    {scheduleMode === "queue_replenish" && `Enable Auto-Refill (${leadCount} leads)`}
                  </span>
                </>
              )}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
