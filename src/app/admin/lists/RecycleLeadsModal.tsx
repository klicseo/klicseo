"use client";

import { useState, useTransition, useEffect, useRef } from "react";
import {
  X,
  Zap,
  RotateCcw,
  Users,
  User,
  ShieldCheck,
  CheckCircle2,
  AlertCircle,
  Loader2,
  Check,
  ArrowRight,
  PhoneCall,
  Calendar,
} from "lucide-react";
import type { LeadStatus } from "@/lib/leads-shared";
import { LEAD_STATUS_LABEL, LEAD_STATUS_COLOR } from "@/lib/leads-shared";
import { recycleLeadsAction, previewRecyclingAction } from "./routing-actions";

interface Props {
  isOpen: boolean;
  onClose: () => void;
  sourceListId?: string;
  sourceListName?: string;
  sourceAdminUserId?: string;
  sourceStaffName?: string;
  adminUsers: { id: string; email: string; name: string }[];
  statusBreakdown?: Record<string, number>;
  onSuccess?: (msg: string) => void;
}

export default function RecycleLeadsModal({
  isOpen,
  onClose,
  sourceListId,
  sourceListName,
  sourceAdminUserId,
  sourceStaffName,
  adminUsers,
  statusBreakdown,
  onSuccess,
}: Props) {
  const [isPending, startTransition] = useTransition();

  // Selected statuses to recycle (Defaults to non-positive leads)
  const [selectedStatuses, setSelectedStatuses] = useState<LeadStatus[]>([
    "call_not_responded",
    "contacted",
    "cancelled",
    "draft",
  ]);

  // Selected target telecallers
  const [targetStaffIds, setTargetStaffIds] = useState<string[]>([]);
  const [resetStatusToNew, setResetStatusToNew] = useState(true);
  const [customListName, setCustomListName] = useState("");
  const [reason, setReason] = useState("2nd attempt pitch / Lead recycling");
  const [error, setError] = useState<string | null>(null);


  // Filter available target staff (exclude source telecaller if applicable, fallback to all if needed)
  const filteredStaff = adminUsers.filter(
    (u) => !sourceAdminUserId || u.id !== sourceAdminUserId,
  );
  const availableTargetStaff = filteredStaff.length > 0 ? filteredStaff : adminUsers;

  const toggleStatus = (status: LeadStatus) => {
    if (selectedStatuses.includes(status)) {
      setSelectedStatuses(selectedStatuses.filter((s) => s !== status));
    } else {
      setSelectedStatuses([...selectedStatuses, status]);
    }
  };

  const toggleStaff = (id: string) => {
    if (targetStaffIds.includes(id)) {
      setTargetStaffIds(targetStaffIds.filter((s) => s !== id));
    } else {
      setTargetStaffIds([...targetStaffIds, id]);
    }
  };

  const selectAllStaff = () => {
    if (targetStaffIds.length === availableTargetStaff.length) {
      setTargetStaffIds([]);
    } else {
      setTargetStaffIds(availableTargetStaff.map((u) => u.id));
    }
  };

  const requestRef = useRef<{ key: string; id: string } | null>(null);
  const [preview, setPreview] = useState<{ count: number; totalMatchingCount: number; error?: string } | null>(null);
  useEffect(() => {
    if (!isOpen) return;
    let cancelled = false;
    setPreview(null);
    const timer = setTimeout(async () => {
      try {
        const result = await previewRecyclingAction({ source_list_id: sourceListId, source_admin_user_id: sourceAdminUserId,
          target_admin_user_ids: targetStaffIds, include_statuses: selectedStatuses });
        if (!cancelled) setPreview(result);
      } catch {
        if (!cancelled) setPreview({ count: 0, totalMatchingCount: 0, error: "Could not load the recycling pool." });
      }
    }, 250);
    return () => { cancelled = true; clearTimeout(timer); };
  }, [isOpen, sourceListId, sourceAdminUserId, targetStaffIds, selectedStatuses]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (selectedStatuses.length === 0) {
      setError("Please select at least one lead status to recycle.");
      return;
    }
    if (targetStaffIds.length === 0) {
      setError("Please select at least one target telecaller to receive the leads.");
      return;
    }

    setError(null);
    startTransition(async () => {
      const request = {
        source_list_id: sourceListId,
        source_admin_user_id: sourceAdminUserId,
        target_admin_user_ids: targetStaffIds,
        include_statuses: selectedStatuses,
        reset_status_to_new: resetStatusToNew,
        create_new_list_name: customListName.trim() || undefined,
        reason,
      };
      const key = JSON.stringify(request);
      if (requestRef.current?.key !== key) requestRef.current = { key, id: crypto.randomUUID() };
      const res = await recycleLeadsAction({ ...request, request_id: requestRef.current.id });

      if (res.ok && res.result) {
        requestRef.current = null;
        onSuccess?.(
          res.result.recycledCount === 0 ? "No eligible leads are available for this destination and these filters." :
          `Recycled ${res.result.recycledCount} leads across ${res.result.assignedStaffCount} telecaller(s). ${res.result.waitingCount ?? 0} leads are waiting for a later round. ${res.result.roundComplete ? "This round is complete; the next request can start another round among eligible leads." : ""}`,
        );
        onClose();
      } else {
        setError(res.error || "Failed to recycle leads.");
      }
    });
  };


  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm animate-in fade-in">
      <div className="relative w-full max-w-2xl bg-[#071228] border border-white/15 rounded-3xl p-6 sm:p-7 shadow-2xl space-y-6 max-h-[92vh] overflow-y-auto">
        {/* Header */}
        <div className="flex items-start justify-between gap-4 border-b border-white/[0.08] pb-4">
          <div className="space-y-1">
            <div className="flex items-center gap-2">
              <div className="grid h-8 w-8 place-items-center rounded-xl bg-purple-500/20 text-purple-300 border border-purple-500/30">
                <RotateCcw size={16} />
              </div>
              <h3
                className="text-lg sm:text-xl font-bold text-white tracking-tight"
                style={{ fontFamily: "var(--font-playfair)" }}
              >
                Recycle & Reassign Leads
              </h3>
            </div>
            <p className="text-xs text-white/50">
              Move non-converted leads from{" "}
              <strong className="text-white">
                {sourceListName || sourceStaffName || "Selected Source"}
              </strong>{" "}
              to other telecallers, rotating least-recycled leads first.
            </p>
          </div>

          <button
            type="button"
            onClick={onClose}
            className="p-1.5 rounded-xl text-white/40 hover:text-white hover:bg-white/10 transition-colors"
          >
            <X size={18} />
          </button>
        </div>

        {error && (
          <div className="p-3.5 rounded-2xl bg-rose-500/10 border border-rose-500/30 text-rose-300 text-xs font-semibold flex items-center gap-2 animate-in fade-in">
            <AlertCircle size={15} className="shrink-0" />
            <span>{error}</span>
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-6">
          {/* Section 1: Select Statuses to Recycle */}
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <label className="text-xs font-bold text-white uppercase tracking-wider">
                1. Select Lead Statuses to Recycle
              </label>
              <span className="text-[11px] text-white/40">
                Booked & Follow-ups are protected by default
              </span>
            </div>

            {/* Candidates for Retry */}
            <div className="grid grid-cols-2 sm:grid-cols-5 gap-2">
              {(["call_not_responded", "contacted", "cancelled", "draft", "new"] as LeadStatus[]).map(
                (status) => {
                  const isChecked = selectedStatuses.includes(status);
                  const count = statusBreakdown?.[status];

                  return (
                    <button
                      type="button"
                      key={status}
                      onClick={() => toggleStatus(status)}
                      className={`p-2.5 rounded-2xl border text-left transition-all flex flex-col justify-between space-y-2 ${
                        isChecked
                          ? "bg-purple-500/15 border-purple-500/40 ring-1 ring-purple-500/20"
                          : "bg-white/[0.02] border-white/[0.06] hover:bg-white/[0.05]"
                      }`}
                    >
                      <div className="flex items-center justify-between">
                        <span
                          className="h-2 w-2 rounded-full"
                          style={{ backgroundColor: LEAD_STATUS_COLOR[status] }}
                        />
                        <span
                          className={`h-3.5 w-3.5 rounded border flex items-center justify-center text-[9px] ${
                            isChecked
                              ? "bg-purple-500 text-white border-purple-400 font-bold"
                              : "border-white/20 text-transparent"
                          }`}
                        >
                          <Check size={9} />
                        </span>
                      </div>
                      <div>
                        <div className="text-[11px] font-bold text-white leading-tight">
                          {LEAD_STATUS_LABEL[status]}
                        </div>
                        {count != null && (
                          <div className="text-[10px] text-white/40 tabular-nums">
                            {count} {count === 1 ? "lead" : "leads"}
                          </div>
                        )}
                      </div>
                    </button>
                  );
                },
              )}
            </div>

            {/* Protected Statuses (Booked & Follow Up) */}
            <div className="rounded-2xl border border-emerald-500/20 bg-emerald-500/5 p-3.5 space-y-2">
              <div className="flex items-center gap-1.5 text-xs font-bold text-emerald-300">
                <ShieldCheck size={14} />
                <span>Protected Statuses (Untouched by Default):</span>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                {(["booked", "follow_up"] as LeadStatus[]).map((status) => {
                  const isChecked = selectedStatuses.includes(status);
                  const count = statusBreakdown?.[status];

                  return (
                    <button
                      type="button"
                      key={status}
                      onClick={() => toggleStatus(status)}
                      className={`p-2.5 rounded-xl border text-left transition-all flex items-center justify-between ${
                        isChecked
                          ? "bg-amber-500/20 border-amber-500/40 text-amber-200"
                          : "bg-white/[0.02] border-emerald-500/20 text-white/70 hover:bg-white/[0.04]"
                      }`}
                    >
                      <div className="flex items-center gap-2">
                        <span
                          className="h-2.5 w-2.5 rounded-full"
                          style={{ backgroundColor: LEAD_STATUS_COLOR[status] }}
                        />
                        <div>
                          <div className="text-xs font-semibold">
                            {LEAD_STATUS_LABEL[status]}
                            {!isChecked && (
                              <span className="ml-1 text-[10px] text-emerald-400 font-normal">
                                (🔒 Protected)
                              </span>
                            )}
                          </div>
                          {count != null && (
                            <div className="text-[10px] text-white/40">
                              {count} {count === 1 ? "lead" : "leads"}
                            </div>
                          )}
                        </div>
                      </div>

                      <span
                        className={`h-4 w-4 rounded border flex items-center justify-center text-[10px] ${
                          isChecked
                            ? "bg-amber-500 text-black border-amber-400 font-bold"
                            : "border-white/20 text-transparent"
                        }`}
                      >
                        <Check size={10} />
                      </span>
                    </button>
                  );
                })}
              </div>
            </div>
          </div>

          <div className="p-3.5 rounded-2xl bg-white/[0.03] text-xs text-white/70" role="status">
            {!preview ? "Checking this round…" : preview.error ? preview.error :
              `${preview.count} leads available this round · ${preview.totalMatchingCount} matching leads`}
            <p className="mt-2">Least-recycled leads go first. The next round starts on a later request.</p>
          </div>

          {/* Section 2: Target Telecallers */}
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <label className="text-xs font-bold text-white uppercase tracking-wider">
                2. Select Target Telecaller(s)
              </label>
              {availableTargetStaff.length > 1 && (
                <button
                  type="button"
                  onClick={selectAllStaff}
                  className="text-xs text-[#E8CC7A] hover:underline font-semibold"
                >
                  {targetStaffIds.length === availableTargetStaff.length
                    ? "Deselect All"
                    : "Select All"}
                </button>
              )}
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5 max-h-48 overflow-y-auto pr-1">
              {availableTargetStaff.map((u) => {
                const isSelected = targetStaffIds.includes(u.id);

                return (
                  <button
                    type="button"
                    key={u.id}
                    onClick={() => toggleStaff(u.id)}
                    className={`p-3 rounded-2xl border text-left transition-all flex items-center justify-between ${
                      isSelected
                        ? "bg-[#C9A84C]/15 border-[#C9A84C]/40 ring-1 ring-[#C9A84C]/20"
                        : "bg-white/[0.02] border-white/[0.06] hover:bg-white/[0.04]"
                    }`}
                  >
                    <div className="flex items-center gap-2.5">
                      <div className="grid h-7 w-7 place-items-center rounded-xl bg-white/5 text-white/60">
                        <User size={13} />
                      </div>
                      <div>
                        <div className="text-xs font-bold text-white">{u.name}</div>
                        <div className="text-[10px] text-white/40">{u.email}</div>
                      </div>
                    </div>

                    <span
                      className={`h-4 w-4 rounded border flex items-center justify-center text-[10px] ${
                        isSelected
                          ? "bg-[#C9A84C] text-[#050E21] border-[#C9A84C] font-bold"
                          : "border-white/20 text-transparent"
                      }`}
                    >
                      <Check size={10} />
                    </span>
                  </button>
                );
              })}
            </div>

            {targetStaffIds.length > 1 && (
              <p className="text-[11px] text-[#E8CC7A]/90 bg-[#C9A84C]/10 border border-[#C9A84C]/20 p-2.5 rounded-xl">
                💡 Recycled leads will be split evenly across{" "}
                <strong>{targetStaffIds.length} telecallers</strong>.
              </p>
            )}
          </div>

          {/* Section 3: Options */}
          <div className="space-y-3 pt-2 border-t border-white/[0.06]">
            <label className="text-xs font-bold text-white uppercase tracking-wider">
              3. Recycling Options
            </label>

            <div className="space-y-2">
              <label className="flex items-start gap-2.5 p-3 rounded-2xl bg-white/[0.02] border border-white/[0.06] cursor-pointer hover:bg-white/[0.04] transition-colors">
                <input
                  type="checkbox"
                  checked={resetStatusToNew}
                  onChange={(e) => setResetStatusToNew(e.target.checked)}
                  className="mt-0.5 rounded border-white/20 bg-white/10 text-purple-500 focus:ring-0"
                />
                <div>
                  <div className="text-xs font-bold text-white">
                    Reset lead status to &ldquo;New&rdquo; (Recommended)
                  </div>
                  <div className="text-[11px] text-white/45">
                    Leads appear fresh at the top of the new telecaller&apos;s queue for a clean retry.
                  </div>
                </div>
              </label>
            </div>

            {/* Custom List Name (Optional) */}
            <div className="space-y-1 pt-1">
              <label className="text-[11px] text-white/50">Custom List Name (Optional)</label>
              <input
                type="text"
                value={customListName}
                onChange={(e) => setCustomListName(e.target.value)}
                placeholder={`Recycled Leads (${new Date().toLocaleDateString("en-IN")})`}
                className="w-full bg-white/5 border border-white/10 rounded-xl px-3.5 py-2.5 text-xs text-white placeholder:text-white/30 focus:outline-none focus:border-purple-400"
              />
            </div>
          </div>

          {/* Footer Actions */}
          <div className="flex items-center justify-end gap-3 pt-4 border-t border-white/[0.08]">
            <button
              type="button"
              onClick={onClose}
              disabled={isPending}
              className="px-4 py-2.5 rounded-xl text-xs font-semibold text-white/60 hover:text-white hover:bg-white/10 transition-colors"
            >
              Cancel
            </button>

            <button
              type="submit"
              disabled={isPending || targetStaffIds.length === 0 || selectedStatuses.length === 0}
              className="px-5 py-2.5 rounded-xl text-xs font-bold bg-gradient-to-r from-purple-500 to-indigo-500 text-white hover:brightness-110 disabled:opacity-50 transition-all flex items-center gap-1.5 shadow-lg shadow-purple-500/20"
            >
              {isPending ? (
                <>
                  <Loader2 size={14} className="animate-spin" />
                  <span>Recycling Leads...</span>
                </>
              ) : (
                <>
                  <Zap size={14} />
                  <span>Recycle &amp; Reassign Leads ➔</span>
                </>
              )}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
