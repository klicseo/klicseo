"use client";

import { useState, useTransition, useEffect } from "react";
import { LEAD_STATUSES, LEAD_STATUS_LABEL, type LeadStatus } from "@/lib/leads-shared";
import type { CustomLeadStatus } from "@/lib/site-settings-shared";
import { setStatusAction } from "./actions";

export default function LeadStatusControl({
  id,
  status,
  color,
  customStatuses,
  className = "",
  canManage = true,
  onSaved,
}: {
  id: string;
  status: LeadStatus;
  color?: string;
  customStatuses?: CustomLeadStatus[];
  className?: string;
  canManage?: boolean;
  onSaved?: (status: LeadStatus) => void;
}) {
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const [currentStatus, setCurrentStatus] = useState<LeadStatus>(status);

  // Keep in sync if server props change externally
  useEffect(() => {
    setCurrentStatus(status);
  }, [status]);

  const activeColor =
    color ||
    customStatuses?.find((s) => s.id === currentStatus)?.color ||
    "#C9A84C";

  const options =
    customStatuses && customStatuses.length > 0
      ? customStatuses
      : LEAD_STATUSES.map((s) => ({
          id: s,
          label: LEAD_STATUS_LABEL[s] || s,
          color: activeColor,
        }));

  if (!canManage) return <span>{options.find((item) => item.id === currentStatus)?.label ?? currentStatus}</span>;

  return (
    <>
    <select
      value={currentStatus}
      disabled={pending}
      onChange={(e) => {
        const next = e.target.value as LeadStatus;
        setError(null);
        setCurrentStatus(next);
        const fd = new FormData();
        fd.append("id", id);
        fd.append("status", next);
        start(async () => {
          try {
            await setStatusAction(fd);
            onSaved?.(next);
          } catch (err) {
            setError(err instanceof Error ? err.message : "Could not update status.");
            setCurrentStatus(status); // Revert to previous status on failure
          }
        });
      }}
      className={`text-sm sm:text-xs font-semibold rounded-xl sm:rounded-md px-3 sm:px-2 py-2 sm:py-1 min-h-[38px] sm:min-h-[28px] bg-transparent border focus:outline-none cursor-pointer transition-opacity ${
        pending ? "opacity-60" : "opacity-100"
      } ${className}`}
      style={{ borderColor: `${activeColor}80`, color: activeColor }}
    >
      {options.map((s) => (
        <option key={s.id} value={s.id} className="bg-[#050E21] text-white">
          {s.label}
        </option>
      ))}
    </select>
    {error && <span role="alert" className="block text-xs text-red-300">{error}</span>}
    </>
  );
}
