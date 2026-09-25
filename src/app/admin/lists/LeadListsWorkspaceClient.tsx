"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  ClipboardList,
  Zap,
  Users,
  Plus,
  Pencil,
  UploadCloud,
  Search,
  ArrowRight,
  User,
  Clock,
  MapPin,
  Car,
  RotateCcw,
  Calendar,
  CheckCircle2,
  AlertCircle,
  XCircle,
} from "lucide-react";
import type { LeadListRow } from "@/lib/leadLists-shared";
import type {
  LeadAllocationSchedule,
  StaffWorkloadSummary,
} from "@/lib/lead-routing-shared";
import DeleteLeadListButton from "./DeleteLeadListButton";
import LeadAllocationModal from "./LeadAllocationModal";
import StaffReallocationModal from "./StaffReallocationModal";
import RecycleLeadsModal from "./RecycleLeadsModal";
import StaffDatewiseLeadListsView from "../my-lists/StaffDatewiseLeadListsView";
import {
  cancelScheduledAllocationAction,
  pauseScheduledAllocationAction,
  resumeScheduledAllocationAction,
  deleteScheduledAllocationAction,
} from "./routing-actions";
import {
  Play,
  Pause,
  Trash2,
} from "lucide-react";

interface Props {
  initialLists: LeadListRow[];
  initialSchedules: LeadAllocationSchedule[];
  initialStaffWorkload: StaffWorkloadSummary[];
  adminUsers: { id: string; email: string; name: string }[];
  currentUser?: { id: string; email: string; name: string; role: string };
  availableAreas?: string[];
  searchQuery?: string;
}

type WorkspaceTab = "campaigns" | "schedules" | "workload";

export default function LeadListsWorkspaceClient({
  initialLists,
  initialSchedules,
  initialStaffWorkload,
  adminUsers,
  currentUser,
  availableAreas,
  searchQuery = "",
}: Props) {
  const router = useRouter();
  const [tab, setTab] = useState<WorkspaceTab>("campaigns");
  const [isPending, startTransition] = useTransition();

  // Modals state
  const [allocateModalOpen, setAllocateModalOpen] = useState(false);
  const [reallocateModalOpen, setReallocateModalOpen] = useState(false);
  const [recycleModalConfig, setRecycleModalConfig] = useState<{
    isOpen: boolean;
    sourceAdminUserId?: string;
    sourceStaffName?: string;
  }>({ isOpen: false });
  const [bannerMessage, setBannerMessage] = useState<string | null>(null);

  const handleCancelSchedule = (id: string) => {
    if (!confirm("Are you sure you want to cancel this scheduled release?")) return;
    startTransition(async () => {
      await cancelScheduledAllocationAction(id);
      router.refresh();
    });
  };

  const handlePauseSchedule = (id: string) => {
    if (!confirm("Pause this recurring automation rule?")) return;
    startTransition(async () => {
      await pauseScheduledAllocationAction(id);
      router.refresh();
    });
  };

  const handleResumeSchedule = (id: string) => {
    startTransition(async () => {
      await resumeScheduledAllocationAction(id);
      router.refresh();
    });
  };

  const handleDeleteSchedule = (id: string) => {
    if (!confirm("Delete this rule permanently? It will be removed from your dispatches list.")) return;
    startTransition(async () => {
      await deleteScheduledAllocationAction(id);
      router.refresh();
    });
  };

  const handleSuccess = (msg: string) => {
    setBannerMessage(msg);
    router.refresh();
    setTimeout(() => setBannerMessage(null), 6000);
  };

  return (
    <div className="space-y-6">
      {/* Top Banner Message */}
      {bannerMessage && (
        <div className="p-4 rounded-2xl bg-emerald-500/15 border border-emerald-500/30 text-emerald-300 text-xs font-semibold flex items-center justify-between animate-in fade-in">
          <div className="flex items-center gap-2">
            <CheckCircle2 size={16} className="shrink-0" />
            <span>{bannerMessage}</span>
          </div>
          <button
            onClick={() => setBannerMessage(null)}
            className="p-1 rounded-lg hover:bg-emerald-500/20"
          >
            ✕
          </button>
        </div>
      )}

      {/* Top Header */}
      <div className="flex items-center justify-between gap-4 flex-wrap border-b border-white/[0.08] pb-5">
        <div>
          <h1
            className="text-2xl md:text-3xl font-bold tracking-tight text-white"
            style={{ fontFamily: "var(--font-playfair)" }}
          >
            Lead Lists & Staff Allocation
          </h1>
          <p className="text-xs text-white/50 mt-0.5">
            Organize campaigns, allocate lead batches by conditions, and schedule team distributions.
          </p>
        </div>

        {/* Global Action Buttons */}
        <div className="flex items-center gap-2.5 flex-wrap">
          <Link
            href="/admin/upload"
            className="px-3 py-2 rounded-xl bg-white/[0.04] border border-white/10 text-white/80 hover:text-white hover:bg-white/[0.08] hover:border-[#C9A84C]/40 text-xs font-semibold transition-all inline-flex items-center gap-1.5"
          >
            <UploadCloud size={14} className="text-[#C9A84C]" />
            <span>Upload Leads</span>
          </Link>

          <button
            type="button"
            onClick={() => setAllocateModalOpen(true)}
            className="px-3.5 py-2 rounded-xl bg-[#C9A84C]/15 border border-[#C9A84C]/30 text-[#E8CC7A] hover:bg-[#C9A84C]/25 text-xs font-semibold transition-all inline-flex items-center gap-1.5 shadow-sm"
          >
            <Zap size={14} />
            <span>Allocate & Schedule Leads</span>
          </button>

          <Link
            href="/admin/lists/new"
            className="px-4 py-2 rounded-xl bg-gradient-to-r from-[#C9A84C] to-[#E8CC7A] text-[#050E21] text-xs font-bold hover:brightness-105 transition-all inline-flex items-center gap-1.5 shadow-md shadow-[#C9A84C]/20"
          >
            <Plus size={14} />
            <span>Create List</span>
          </Link>
        </div>
      </div>

      {/* 3-Tab Workspace Navigation */}
      <div className="flex items-center gap-2 p-1.5 rounded-2xl bg-[#071228] border border-white/[0.08] text-xs font-semibold">
        <button
          type="button"
          onClick={() => setTab("campaigns")}
          className={`flex items-center gap-2 px-4 py-2 rounded-xl transition-all ${
            tab === "campaigns"
              ? "bg-[#C9A84C] text-[#050E21] font-bold shadow-md"
              : "text-white/60 hover:text-white hover:bg-white/5"
          }`}
        >
          <ClipboardList size={14} />
          <span>Campaign Lists</span>
          <span className="text-[10px] px-1.5 py-0.2 rounded-full bg-white/20">
            {initialLists.length}
          </span>
        </button>

        <button
          type="button"
          onClick={() => setTab("schedules")}
          className={`flex items-center gap-2 px-4 py-2 rounded-xl transition-all ${
            tab === "schedules"
              ? "bg-[#C9A84C] text-[#050E21] font-bold shadow-md"
              : "text-white/60 hover:text-white hover:bg-white/5"
          }`}
        >
          <Clock size={14} />
          <span>Scheduled Dispatches & History</span>
          <span className="text-[10px] px-1.5 py-0.2 rounded-full bg-white/20">
            {initialSchedules.length}
          </span>
        </button>

        <button
          type="button"
          onClick={() => setTab("workload")}
          className={`flex items-center gap-2 px-4 py-2 rounded-xl transition-all ${
            tab === "workload"
              ? "bg-[#C9A84C] text-[#050E21] font-bold shadow-md"
              : "text-white/60 hover:text-white hover:bg-white/5"
          }`}
        >
          <Users size={14} />
          <span>Team Workload</span>
          <span className="text-[10px] px-1.5 py-0.2 rounded-full bg-white/20">
            {initialStaffWorkload.length}
          </span>
        </button>
      </div>

      {/* TAB 1: CAMPAIGN LISTS (Staff -> Datewise -> Batch Leads) */}
      {tab === "campaigns" && (
        <StaffDatewiseLeadListsView
          lists={initialLists}
          currentUser={currentUser ?? { id: "super_admin", email: "admin@klicseo.com", name: "Super Admin", role: "super_admin" }}
          isSuperAdmin={true}
          adminUsers={adminUsers}
        />
      )}

      {/* TAB 2: SCHEDULED DISPATCHES & ALLOCATION HISTORY */}
      {tab === "schedules" && (
        <div className="space-y-4">
          <div className="flex items-center justify-between gap-4 flex-wrap">
            <div>
              <h3 className="text-sm font-bold text-white">Lead Dispatches & Scheduled Releases</h3>
              <p className="text-xs text-white/40">
                Track upcoming scheduled lead releases and past distributions.
              </p>
            </div>

            <button
              type="button"
              onClick={() => setAllocateModalOpen(true)}
              className="px-4 py-2 rounded-xl bg-[#C9A84C] text-[#050E21] font-bold text-xs hover:bg-[#E8CC7A] transition-all inline-flex items-center gap-1.5 shadow-md shadow-[#C9A84C]/20"
            >
              <Zap size={14} />
              <span>New Allocation / Schedule</span>
            </button>
          </div>

          {initialSchedules.length === 0 ? (
            <div className="rounded-3xl border border-white/[0.08] bg-[#071228] p-12 text-center space-y-3">
              <div className="mx-auto grid h-12 w-12 place-items-center rounded-2xl bg-[#C9A84C]/10 text-[#C9A84C]">
                <Clock size={24} />
              </div>
              <h3 className="text-sm font-semibold text-white">No lead dispatches recorded</h3>
              <p className="text-xs text-white/40 max-w-sm mx-auto">
                Allocate a batch of leads now or schedule an upcoming release for tomorrow morning.
              </p>
              <div className="pt-2">
                <button
                  type="button"
                  onClick={() => setAllocateModalOpen(true)}
                  className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl bg-[#C9A84C] text-xs font-bold text-[#050E21]"
                >
                  <Zap size={14} /> Allocate Leads Now
                </button>
              </div>
            </div>
          ) : (
            <div className="space-y-3">
              {initialSchedules.map((item, idx) => {
                const targetNames = (item.assignee_ids ?? [])
                  .map((id) => adminUsers.find((u) => u.id === id)?.name)
                  .filter(Boolean);

                const isPendingSchedule = item.status === "pending";

                return (
                  <div
                    key={`sched-${item.id || idx}`}
                    className={`rounded-2xl border p-5 transition-all shadow-md space-y-3 ${
                      isPendingSchedule
                        ? "border-[#C9A84C]/30 bg-[#071228]"
                        : "border-white/[0.06] bg-[#071228]/60"
                    }`}
                  >
                    {/* Top Row: Title, Status, Mode, Timing */}
                    <div className="flex items-start justify-between gap-4 flex-wrap">
                      <div className="space-y-1">
                        <div className="flex items-center gap-2.5 flex-wrap">
                          <h4 className="text-sm font-bold text-white flex items-center gap-1.5">
                            {item.schedule_mode === "daily_recurring" && (
                              <span className="text-emerald-400">🔁 Everyday: {item.lead_count} leads at {item.recurring_time} IST</span>
                            )}
                            {item.schedule_mode === "queue_replenish" && (
                              <span className="text-purple-400">🔄 Auto-Refill: {item.lead_count} leads (Queue ≤ {item.replenish_threshold})</span>
                            )}
                            {item.schedule_mode === "once_scheduled" && (
                              <span>⏰ Scheduled: {item.lead_count} Leads</span>
                            )}
                            {item.schedule_mode === "once_now" && (
                              <span>⚡ {item.lead_count} Leads Batch</span>
                            )}
                          </h4>

                          <span
                            className={`text-[10px] font-bold px-2.5 py-0.5 rounded-full border uppercase ${
                              item.status === "completed"
                                ? "bg-emerald-500/15 border-emerald-500/30 text-emerald-300"
                                : item.status === "active_recurring"
                                ? "bg-emerald-500/20 border-emerald-500/40 text-emerald-300 animate-pulse"
                                : item.status === "paused"
                                ? "bg-amber-500/15 border-amber-500/30 text-amber-300"
                                : item.status === "pending"
                                ? "bg-sky-500/15 border-sky-500/30 text-sky-300 animate-pulse"
                                : "bg-rose-500/15 border-rose-500/30 text-rose-300"
                            }`}
                          >
                            {item.status === "completed" && "✓ Completed"}
                            {item.status === "active_recurring" && "● Active Automation"}
                            {item.status === "paused" && "⏸ Paused"}
                            {item.status === "pending" && "⏳ Scheduled (Pending)"}
                            {item.status === "cancelled" && "✕ Cancelled"}
                          </span>

                          {item.schedule_mode === "once_scheduled" && (
                            <span className="text-[11px] text-white/50 font-mono">
                              Scheduled for: {new Date(item.scheduled_for).toLocaleString("en-IN")}
                            </span>
                          )}
                        </div>
                      </div>

                      {/* Schedule Actions: Pause / Resume / Cancel / Delete */}
                      <div className="flex items-center gap-1.5">
                        {item.status === "active_recurring" && (
                          <button
                            type="button"
                            onClick={() => handlePauseSchedule(item.id)}
                            disabled={isPending}
                            className="px-3 py-1 rounded-xl bg-amber-500/10 border border-amber-500/30 text-amber-300 hover:bg-amber-500/20 text-xs font-semibold transition-all inline-flex items-center gap-1"
                          >
                            <Pause size={12} /> Pause
                          </button>
                        )}

                        {item.status === "paused" && (
                          <button
                            type="button"
                            onClick={() => handleResumeSchedule(item.id)}
                            disabled={isPending}
                            className="px-3 py-1 rounded-xl bg-emerald-500/10 border border-emerald-500/30 text-emerald-300 hover:bg-emerald-500/20 text-xs font-semibold transition-all inline-flex items-center gap-1"
                          >
                            <Play size={12} /> Resume
                          </button>
                        )}

                        {item.status === "pending" && (
                          <button
                            type="button"
                            onClick={() => handleCancelSchedule(item.id)}
                            disabled={isPending}
                            className="px-3 py-1 rounded-xl bg-rose-500/10 border border-rose-500/30 text-rose-300 hover:bg-rose-500/20 text-xs font-semibold transition-all inline-flex items-center gap-1"
                          >
                            <XCircle size={12} /> Cancel
                          </button>
                        )}

                        <button
                          type="button"
                          onClick={() => handleDeleteSchedule(item.id)}
                          disabled={isPending}
                          title="Delete rule permanently"
                          className="p-1.5 rounded-xl text-white/40 hover:text-rose-300 hover:bg-rose-500/10 border border-transparent hover:border-rose-500/20 transition-all inline-flex items-center justify-center"
                        >
                          <Trash2 size={13} />
                        </button>
                      </div>
                    </div>

                    {/* Filter Tags */}
                    <div className="flex items-center gap-2 flex-wrap text-xs pt-1 border-t border-white/[0.04]">
                      <span className="text-[10px] text-white/40 uppercase font-bold">Filters:</span>

                      {item.conditions.include_assigned && <span className="text-xs text-purple-300">Includes already-assigned leads · status preserved · once per rule</span>}
                      {item.conditions.areas && item.conditions.areas.length > 0 && (
                        <div className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-sky-500/10 border border-sky-500/20 text-sky-300 text-[11px]">
                          <MapPin size={10} /> {item.conditions.areas.join(", ")}
                        </div>
                      )}

                      {item.conditions.pincodes && item.conditions.pincodes.length > 0 && (
                        <div className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-purple-500/10 border border-purple-500/20 text-purple-300 text-[11px] font-mono">
                          PIN {item.conditions.pincodes.join(", ")}
                        </div>
                      )}

                      {item.conditions.services && item.conditions.services.length > 0 && (
                        <div className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-[#C9A84C]/10 border border-[#C9A84C]/20 text-[#E8CC7A] text-[11px]">
                          <Car size={10} /> {item.conditions.services.join(", ")}
                        </div>
                      )}

                      {item.conditions.min_price != null && (
                        <div className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-emerald-500/10 border border-emerald-500/20 text-emerald-300 text-[11px] font-semibold">
                          ≥ ₹{item.conditions.min_price.toLocaleString("en-IN")}
                        </div>
                      )}

                      {!item.conditions.areas?.length &&
                        !item.conditions.pincodes?.length &&
                        !item.conditions.services?.length &&
                        item.conditions.min_price == null && (
                          <span className="text-white/40 italic text-[11px]">
                            All available candidate leads
                          </span>
                        )}
                    </div>

                    {/* Assigned Team Members */}
                    <div className="flex items-center justify-between gap-4 text-xs pt-1 border-t border-white/[0.04] flex-wrap">
                      <div className="flex items-center gap-2">
                        <span className="text-white/40">Assigned Telecallers:</span>
                        {targetNames.length > 0 ? (
                          <div className="flex items-center gap-1.5 flex-wrap">
                            {targetNames.map((name, nIdx) => (
                              <span
                                key={`telecaller-${name}-${nIdx}`}
                                className="px-2 py-0.5 rounded-md bg-white/5 border border-white/10 text-white/90 text-[11px] font-medium"
                              >
                                {name}
                              </span>
                            ))}
                          </div>
                        ) : (
                          <span className="text-white/30 italic">Direct Campaign List</span>
                        )}
                      </div>

                      {item.target_list && (
                        <div className="flex items-center gap-1.5 text-white/60">
                          <ClipboardList size={12} className="text-[#C9A84C]" />
                          <span>Campaign List:</span>
                          <strong className="text-[#E8CC7A]">{item.target_list.name}</strong>
                        </div>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* TAB 3: TEAM WORKLOAD */}
      {tab === "workload" && (
        <div className="space-y-4">
          <div className="flex items-center justify-between gap-4 flex-wrap">
            <div>
              <h3 className="text-sm font-bold text-white">Telecaller Workload & Roster</h3>
              <p className="text-xs text-white/40">
                View active lead queues, individual campaign list breakdowns, and total lead loads per telecaller.
              </p>
            </div>

            <button
              type="button"
              onClick={() => setReallocateModalOpen(true)}
              className="px-4 py-2 rounded-xl bg-[#C9A84C] text-[#050E21] font-bold text-xs hover:bg-[#E8CC7A] transition-all inline-flex items-center gap-1.5 shadow-md shadow-[#C9A84C]/20"
            >
              <RotateCcw size={14} />
              <span>Transfer Leads / Lists</span>
            </button>
          </div>

          {/* Info Card on Auto-Refill on Completion */}
          <div className="p-3.5 rounded-2xl bg-purple-500/10 border border-purple-500/25 text-purple-200 text-xs flex items-start gap-2.5">
            <span className="text-base">💡</span>
            <div className="space-y-0.5">
              <span className="font-bold text-purple-100">How "Auto-Refill on Completion" Works:</span>
              <p className="text-[11px] text-purple-200/75 leading-relaxed">
                Auto-refill monitors each telecaller's <strong>Total Active Leads</strong>. When a telecaller contacts/completes their leads and their remaining uncontacted queue drops below your set threshold (e.g. ≤ 5 leads), fresh matching leads are automatically assigned into their queue.
              </p>
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {initialStaffWorkload.map((staff, sIdx) => {
              const isAllDone = staff.totalLeadsCount > 0 && staff.overallCompletionRate === 100;
              const isHighOutput = staff.overallCompletionRate >= 75 && !isAllDone;

              return (
                <div
                  key={`workload-${staff.adminUserId || sIdx}`}
                  className="rounded-2xl border border-white/[0.08] bg-[#071228] p-5 space-y-4 shadow-lg flex flex-col justify-between"
                >
                  <div className="space-y-3.5">
                    {/* Top: Name, Email, Role & Motivation Badge */}
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2 flex-wrap">
                          <h4 className="font-bold text-sm text-white truncate">{staff.name}</h4>
                          {isAllDone && (
                            <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-emerald-500/20 text-emerald-300 border border-emerald-500/40 shrink-0 whitespace-nowrap">
                              🎉 100% Done
                            </span>
                          )}
                          {isHighOutput && (
                            <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-amber-500/20 text-amber-300 border border-amber-500/40 shrink-0 whitespace-nowrap">
                              🔥 On Track
                            </span>
                          )}
                        </div>
                        <p className="text-[11px] text-white/40 truncate">{staff.email}</p>
                      </div>

                      <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-[#C9A84C]/15 text-[#E8CC7A] border border-[#C9A84C]/30 uppercase shrink-0 whitespace-nowrap">
                        {staff.role}
                      </span>
                    </div>

                    {/* Overall Staff Motivation Progress Bar */}
                    <div className="p-3.5 rounded-xl bg-white/[0.02] border border-white/[0.05] space-y-2">
                      <div className="flex items-center justify-between text-xs">
                        <span className="text-white/70 font-semibold">Overall Lead Progress</span>
                        <span className="font-bold font-mono text-[#E8CC7A]">
                          {staff.completedLeadsCount} / {staff.totalLeadsCount} leads ({staff.overallCompletionRate}%)
                        </span>
                      </div>

                      <div className="h-2.5 w-full bg-white/10 rounded-full overflow-hidden p-0.5 border border-white/5">
                        <div
                          className="h-full rounded-full transition-all duration-500 bg-gradient-to-r from-[#C9A84C] via-[#E8CC7A] to-emerald-400 shadow-sm"
                          style={{ width: `${Math.min(100, Math.max(0, staff.overallCompletionRate))}%` }}
                        />
                      </div>

                      <div className="flex justify-between text-[11px] pt-0.5">
                        <span className="text-emerald-400/90 font-medium">✓ {staff.completedLeadsCount} contacted</span>
                        <span className="text-white/40 font-medium">⏳ {staff.pendingLeadsCount} remaining</span>
                      </div>
                    </div>

                    {/* Summary Metric Counters */}
                    <div className="grid grid-cols-2 gap-2 text-xs">
                      <div className="p-2.5 rounded-xl bg-white/[0.02] border border-white/[0.04] space-y-0.5">
                        <span className="text-[10px] text-white/40 uppercase font-semibold">Total Lead Pool</span>
                        <div className="font-bold text-white text-base tabular-nums">
                          {staff.totalLeadsCount} <span className="text-xs font-normal text-white/50">{staff.totalLeadsCount === 1 ? "lead" : "leads"}</span>
                        </div>
                      </div>

                      <div className="p-2.5 rounded-xl bg-white/[0.02] border border-white/[0.04] space-y-0.5">
                        <span className="text-[10px] text-white/40 uppercase font-semibold">Assigned Lists</span>
                        <div className="font-bold text-[#E8CC7A] text-base tabular-nums">
                          {staff.assignedListsCount} <span className="text-xs font-normal text-[#E8CC7A]/60">{staff.assignedListsCount === 1 ? "list" : "lists"}</span>
                        </div>
                      </div>
                    </div>

                    {/* Assigned Lists Breakdown with Progress Bars */}
                    <div className="space-y-2 pt-2 border-t border-white/[0.06]">
                      <div className="flex items-center justify-between">
                        <span className="text-[10px] text-white/40 uppercase font-semibold">
                          Campaign Lists Breakdown ({staff.assignedListsCount}):
                        </span>
                      </div>

                      {staff.assignedLists && staff.assignedLists.length > 0 ? (
                        <div className="space-y-2 max-h-48 overflow-y-auto pr-1">
                          {staff.assignedLists.map((l, lIdx) => (
                            <Link
                              key={`assigned-list-${l.id || lIdx}`}
                              href={`/admin/lists/${l.id}`}
                              className="group/item block p-2.5 rounded-xl bg-white/[0.02] border border-white/5 hover:bg-white/[0.05] hover:border-[#C9A84C]/30 transition-all text-xs space-y-1.5"
                            >
                              <div className="flex items-center justify-between gap-2">
                                <span className="text-white/90 group-hover/item:text-[#E8CC7A] truncate font-semibold">
                                  📋 {l.name}
                                </span>
                                <span className="font-mono text-xs font-bold text-white/80 shrink-0">
                                  {l.completedLeads}/{l.totalLeads} leads
                                </span>
                              </div>

                              {/* Mini Progress bar per list */}
                              <div className="h-1.5 w-full bg-white/10 rounded-full overflow-hidden">
                                <div
                                  className={`h-full rounded-full transition-all duration-300 ${
                                    l.completionRate === 100
                                      ? "bg-emerald-400"
                                      : l.completionRate >= 50
                                      ? "bg-[#C9A84C]"
                                      : "bg-sky-400"
                                  }`}
                                  style={{ width: `${Math.min(100, Math.max(0, l.completionRate))}%` }}
                                />
                              </div>

                              <div className="flex items-center justify-between text-[10px] text-white/40">
                                <span className="font-semibold text-white/60">{l.completionRate}% complete</span>
                                <span className="text-white/30 group-hover/item:text-[#E8CC7A] transition-colors font-medium">
                                  Open list ➔
                                </span>
                              </div>
                            </Link>
                          ))}
                        </div>
                      ) : (
                        <div className="text-[11px] text-white/30 italic p-3 rounded-xl bg-white/[0.01] text-center">
                          No campaign lists assigned yet
                        </div>
                      )}
                    </div>
                  </div>

                  {/* Recycle Non-Positive Leads Button */}
                  <div className="pt-3 border-t border-white/[0.06]">
                    <button
                      type="button"
                      onClick={() =>
                        setRecycleModalConfig({
                          isOpen: true,
                          sourceAdminUserId: staff.adminUserId,
                          sourceStaffName: staff.name,
                        })
                      }
                      className="w-full py-2 px-3 rounded-xl bg-purple-500/15 border border-purple-500/30 text-purple-300 hover:bg-purple-500/25 text-xs font-bold transition-all flex items-center justify-center gap-1.5 shadow-sm"
                    >
                      <RotateCcw size={13} />
                      <span>Recycle Unbooked Leads</span>
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Modals */}
      <LeadAllocationModal
        lists={initialLists}
        adminUsers={adminUsers}
        availableAreas={availableAreas}
        isOpen={allocateModalOpen}
        onClose={() => setAllocateModalOpen(false)}
        onSuccess={handleSuccess}
      />

      <StaffReallocationModal
        isOpen={reallocateModalOpen}
        onClose={() => setReallocateModalOpen(false)}
        adminUsers={adminUsers}
        onTransferred={() => router.refresh()}
      />

      {recycleModalConfig.isOpen && (
        <RecycleLeadsModal
          isOpen={recycleModalConfig.isOpen}
          onClose={() => setRecycleModalConfig({ isOpen: false })}
          sourceAdminUserId={recycleModalConfig.sourceAdminUserId}
          sourceStaffName={recycleModalConfig.sourceStaffName}
          adminUsers={adminUsers}
          onSuccess={handleSuccess}
        />
      )}
    </div>
  );
}
