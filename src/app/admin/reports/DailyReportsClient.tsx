"use client";

import { useState, useTransition, useMemo } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import {
  Calendar,
  ChevronLeft,
  ChevronRight,
  Download,
  Search,
  Trophy,
  PhoneCall,
  CheckCircle2,
  Clock,
  PhoneOff,
  UserCheck,
  TrendingUp,
  Award,
  ArrowUpRight,
  Filter,
  BarChart3,
  RefreshCw,
} from "lucide-react";
import dynamic from "next/dynamic";
import { fetchDailyReportAction } from "./actions";
const StaffTimelineModal = dynamic(() => import("./StaffTimelineModal"), { ssr: false });
import type {
  DailyReportSummary,
  StaffDailyMetric,
  DailyReportFilter,
} from "@/lib/reports-shared";

interface Props {
  initialSummary: DailyReportSummary;
  currentUserRole?: string;
  isScopedStaff?: boolean;
  currentUserEmail?: string;
}

type ReportPreset = "today" | "yesterday" | "last7days" | "thismonth" | "all_time" | "custom";

export default function DailyReportsClient({
  initialSummary,
  currentUserRole = "super_admin",
  isScopedStaff = false,
  currentUserEmail = "",
}: Props) {
  const router = useRouter();
  const [summary, setSummary] = useState<DailyReportSummary>(initialSummary);
  const [filterMode, setFilterMode] = useState<"single" | "range">(
    initialSummary.isSingleDay ? "single" : "range",
  );
  const [selectedDate, setSelectedDate] = useState<string>(initialSummary.date);
  const [startDate, setStartDate] = useState<string>(initialSummary.startDate);
  const [endDate, setEndDate] = useState<string>(initialSummary.endDate);
  const [searchQuery, setSearchQuery] = useState("");
  const [isPending, startTransition] = useTransition();

  // Helper for today in IST
  const todayIST = useMemo(() => {
    const now = new Date();
    const istOffset = 5.5 * 60 * 60 * 1000;
    return new Date(now.getTime() + istOffset).toISOString().slice(0, 10);
  }, []);

  const yesterdayIST = useMemo(() => {
    const now = new Date();
    const istOffset = 5.5 * 60 * 60 * 1000;
    const y = new Date(now.getTime() + istOffset - 24 * 60 * 60 * 1000);
    return y.toISOString().slice(0, 10);
  }, []);

  // Explicit Preset State
  const [activePreset, setActivePreset] = useState<ReportPreset>(() => {
    if (initialSummary.isAllTime) return "all_time";
    if (initialSummary.isSingleDay) {
      if (initialSummary.date === todayIST) return "today";
      if (initialSummary.date === yesterdayIST) return "yesterday";
      return "custom";
    }
    return "custom";
  });

  // Selected staff for timeline drilldown modal
  const [selectedStaff, setSelectedStaff] = useState<StaffDailyMetric | null>(null);

  // Update report data
  const applyFilter = (filter: DailyReportFilter) => {
    startTransition(async () => {
      const res = await fetchDailyReportAction(filter);
      if (res.ok && res.summary) {
        setSummary(res.summary);
      }
    });
  };

  // Single Date Navigation Handlers
  const handleDateChange = (newDate: string) => {
    setSelectedDate(newDate);
    setStartDate(newDate);
    setEndDate(newDate);
    setFilterMode("single");
    if (newDate === todayIST) {
      setActivePreset("today");
    } else if (newDate === yesterdayIST) {
      setActivePreset("yesterday");
    } else {
      setActivePreset("custom");
    }
    applyFilter({ date: newDate, startDate: newDate, endDate: newDate });
  };

  const shiftDay = (deltaDays: number) => {
    const curr = new Date(selectedDate + "T00:00:00");
    curr.setDate(curr.getDate() + deltaDays);
    const newDateStr = curr.toISOString().slice(0, 10);
    if (newDateStr <= todayIST) {
      handleDateChange(newDateStr);
    }
  };

  // Quick Preset Handlers
  const handlePreset = (preset: ReportPreset) => {
    setActivePreset(preset);
    if (preset === "today") {
      handleDateChange(todayIST);
    } else if (preset === "yesterday") {
      handleDateChange(yesterdayIST);
    } else if (preset === "last7days") {
      const now = new Date();
      const istOffset = 5.5 * 60 * 60 * 1000;
      const s = new Date(now.getTime() + istOffset - 6 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
      setSelectedDate(todayIST);
      setStartDate(s);
      setEndDate(todayIST);
      setFilterMode("range");
      applyFilter({ startDate: s, endDate: todayIST, preset: "last7days" });
    } else if (preset === "thismonth") {
      const now = new Date();
      const istOffset = 5.5 * 60 * 60 * 1000;
      const istDate = new Date(now.getTime() + istOffset);
      const y = istDate.getFullYear();
      const m = String(istDate.getMonth() + 1).padStart(2, "0");
      const s = `${y}-${m}-01`;
      setSelectedDate(todayIST);
      setStartDate(s);
      setEndDate(todayIST);
      setFilterMode("range");
      applyFilter({ startDate: s, endDate: todayIST, preset: "thismonth" });
    } else if (preset === "all_time") {
      setFilterMode("range");
      applyFilter({ isAllTime: true, preset: "all_time" });
    }
  };

  // Custom Range Handler
  const handleCustomRangeSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!startDate || !endDate) return;
    setActivePreset("custom");
    setFilterMode("range");
    applyFilter({ startDate, endDate });
  };

  // CSV Export URL
  const exportUrl = summary.isAllTime
    ? `/api/admin/reports-export?allTime=true`
    : summary.isSingleDay
    ? `/api/admin/reports-export?date=${summary.date}`
    : `/api/admin/reports-export?startDate=${summary.startDate}&endDate=${summary.endDate}`;

  // Filtered staff list
  const filteredStaff = useMemo(() => {
    const q = searchQuery.toLowerCase().trim();
    if (!q) return summary.staffMetrics;
    return summary.staffMetrics.filter(
      (s) => s.name.toLowerCase().includes(q) || s.email.toLowerCase().includes(q),
    );
  }, [summary.staffMetrics, searchQuery]);

  const displayDateLabel = useMemo(() => {
    if (summary.isAllTime || activePreset === "all_time") {
      return "All-Time Progress Summary";
    }
    if (summary.isSingleDay) {
      if (summary.date === todayIST) return "Today's Progress";
      if (summary.date === yesterdayIST) return "Yesterday's Progress";
      return new Date(summary.date + "T00:00:00").toLocaleDateString("en-IN", {
        weekday: "short",
        day: "numeric",
        month: "short",
        year: "numeric",
      });
    }
    if (activePreset === "last7days") return `Last 7 Days (${summary.startDate} to ${summary.endDate})`;
    if (activePreset === "thismonth") return `This Month (${summary.startDate} to ${summary.endDate})`;
    return `${summary.startDate} to ${summary.endDate}`;
  }, [summary, activePreset, todayIST, yesterdayIST]);

  const myMetric = isScopedStaff ? summary.staffMetrics[0] : null;

  return (
    <div className="space-y-7">
      {/* Top Banner & Title */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <div className="grid h-9 w-9 place-items-center rounded-xl bg-amber-500/20 text-amber-300 border border-amber-500/30">
              <BarChart3 size={19} />
            </div>
            <h1
              className="text-2xl sm:text-3xl font-bold text-white tracking-tight"
              style={{ fontFamily: "var(--font-playfair)" }}
            >
              {isScopedStaff ? "My Daily Progress Report" : "Daily Staff Progress Reports"}
            </h1>
          </div>
          <p className="text-xs text-white/50 mt-1">
            {isScopedStaff
              ? "Your personal telecaller metrics, call disposition breakdowns, and daily target tracking."
              : "Live telecaller metrics, call disposition breakdowns, and team velocity."}
          </p>
        </div>

        <div className="flex items-center gap-3">
          <a
            href={exportUrl}
            className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl text-xs font-bold text-black bg-gradient-to-r from-[#9C7A2A] via-[#C9A84C] to-[#E8CC7A] hover:brightness-110 shadow-lg shadow-amber-500/10 transition-all"
          >
            <Download size={14} />
            <span>Export CSV</span>
          </a>
        </div>
      </div>

      {/* Date Controls & Filters */}
      <div className="p-4 sm:p-5 rounded-3xl bg-[#071228] border border-white/10 space-y-4 shadow-xl">
        <div className="flex flex-wrap items-center justify-between gap-3">
          {/* Quick Presets */}
          <div className="flex items-center gap-1.5 p-1 rounded-2xl bg-white/[0.04] border border-white/[0.08] overflow-x-auto no-scrollbar flex-nowrap sm:flex-wrap max-w-full">
            <button
              type="button"
              onClick={() => handlePreset("today")}
              className={`px-3 py-2 sm:py-1.5 rounded-xl text-xs font-semibold transition-all cursor-pointer whitespace-nowrap min-h-[36px] sm:min-h-0 ${
                activePreset === "today"
                  ? "bg-[#C9A84C] text-black shadow-md font-bold"
                  : "text-white/60 hover:text-white hover:bg-white/5"
              }`}
            >
              Today
            </button>
            <button
              type="button"
              onClick={() => handlePreset("yesterday")}
              className={`px-3 py-2 sm:py-1.5 rounded-xl text-xs font-semibold transition-all cursor-pointer whitespace-nowrap min-h-[36px] sm:min-h-0 ${
                activePreset === "yesterday"
                  ? "bg-[#C9A84C] text-black shadow-md font-bold"
                  : "text-white/60 hover:text-white hover:bg-white/5"
              }`}
            >
              Yesterday
            </button>
            <button
              type="button"
              onClick={() => handlePreset("last7days")}
              className={`px-3 py-2 sm:py-1.5 rounded-xl text-xs font-semibold transition-all cursor-pointer whitespace-nowrap min-h-[36px] sm:min-h-0 ${
                activePreset === "last7days"
                  ? "bg-[#C9A84C] text-black shadow-md font-bold"
                  : "text-white/60 hover:text-white hover:bg-white/5"
              }`}
            >
              Last 7 Days
            </button>
            <button
              type="button"
              onClick={() => handlePreset("thismonth")}
              className={`px-3 py-2 sm:py-1.5 rounded-xl text-xs font-semibold transition-all cursor-pointer whitespace-nowrap min-h-[36px] sm:min-h-0 ${
                activePreset === "thismonth"
                  ? "bg-[#C9A84C] text-black shadow-md font-bold"
                  : "text-white/60 hover:text-white hover:bg-white/5"
              }`}
            >
              This Month
            </button>
            <button
              type="button"
              onClick={() => handlePreset("all_time")}
              className={`px-3 py-2 sm:py-1.5 rounded-xl text-xs font-semibold transition-all cursor-pointer whitespace-nowrap min-h-[36px] sm:min-h-0 ${
                activePreset === "all_time"
                  ? "bg-[#C9A84C] text-black shadow-md font-bold"
                  : "text-white/60 hover:text-white hover:bg-white/5"
              }`}
            >
              All Time
            </button>
          </div>

          {/* Specific Date Day Navigator */}
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => shiftDay(-1)}
              title="Previous Day"
              className="p-2 rounded-xl bg-white/[0.04] border border-white/10 hover:bg-white/10 text-white/80 hover:text-white transition-colors cursor-pointer"
            >
              <ChevronLeft size={16} />
            </button>

            <div className="relative flex items-center">
              <input
                type="date"
                value={selectedDate}
                max={todayIST}
                onChange={(e) => {
                  if (e.target.value) handleDateChange(e.target.value);
                }}
                className="px-3.5 py-1.5 rounded-xl bg-white/[0.06] border border-white/15 text-xs text-white font-medium focus:outline-none focus:border-[#C9A84C] [color-scheme:dark] cursor-pointer"
              />
            </div>

            <button
              type="button"
              onClick={() => shiftDay(1)}
              disabled={selectedDate >= todayIST}
              title="Next Day"
              className="p-2 rounded-xl bg-white/[0.04] border border-white/10 hover:bg-white/10 text-white/80 hover:text-white transition-colors disabled:opacity-30 disabled:cursor-not-allowed cursor-pointer"
            >
              <ChevronRight size={16} />
            </button>
          </div>
        </div>

        {/* Custom Range Bar (if range mode active) */}
        {filterMode === "range" && activePreset !== "all_time" && (
          <form
            onSubmit={handleCustomRangeSubmit}
            className="flex flex-wrap items-center gap-3 pt-3 border-t border-white/[0.06]"
          >
            <span className="text-xs text-white/50 font-medium">Custom Range:</span>
            <input
              type="date"
              value={startDate}
              max={todayIST}
              onChange={(e) => setStartDate(e.target.value)}
              className="px-3 py-1.5 rounded-xl bg-white/[0.06] border border-white/15 text-xs text-white [color-scheme:dark]"
            />
            <span className="text-xs text-white/40">to</span>
            <input
              type="date"
              value={endDate}
              max={todayIST}
              onChange={(e) => setEndDate(e.target.value)}
              className="px-3 py-1.5 rounded-xl bg-white/[0.06] border border-white/15 text-xs text-white [color-scheme:dark]"
            />
            <button
              type="submit"
              className="px-4 py-1.5 rounded-xl bg-white/10 hover:bg-white/15 text-white text-xs font-semibold transition-colors cursor-pointer"
            >
              Apply Range
            </button>
          </form>
        )}
      </div>

      {/* KPI Metric Summary Ribbon */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
        {/* Total Booked */}
        <div className="p-4 rounded-3xl bg-gradient-to-br from-emerald-500/15 via-emerald-500/5 to-transparent border border-emerald-500/30 space-y-1">
          <div className="flex items-center justify-between text-emerald-300">
            <span className="text-[11px] font-bold uppercase tracking-wider">{isScopedStaff ? "My Bookings" : "Booked Deals"}</span>
            <Trophy size={16} />
          </div>
          <div className="text-2xl sm:text-3xl font-extrabold text-white tabular-nums">
            {summary.totalBookings}
          </div>
          <div className="text-[11px] text-emerald-400/80 font-medium">
            {summary.overallConversionRate}% conversion
          </div>
        </div>

        {/* Total Calls Made */}
        <div className="p-4 rounded-3xl bg-gradient-to-br from-purple-500/15 via-purple-500/5 to-transparent border border-purple-500/30 space-y-1">
          <div className="flex items-center justify-between text-purple-300">
            <span className="text-[11px] font-bold uppercase tracking-wider">{isScopedStaff ? "My Calls Made" : "Calls Logged"}</span>
            <PhoneCall size={16} />
          </div>
          <div className="text-2xl sm:text-3xl font-extrabold text-white tabular-nums">
            {summary.totalCalls}
          </div>
          <div className="text-[11px] text-purple-400/80 font-medium">
            {isScopedStaff
              ? `Target: ${myMetric?.targetCalls ?? 40} calls`
              : `Across ${summary.activeStaffCount} active staff`}
          </div>
        </div>

        {/* Connected / Contacted */}
        <div className="p-4 rounded-3xl bg-gradient-to-br from-sky-500/15 via-sky-500/5 to-transparent border border-sky-500/30 space-y-1">
          <div className="flex items-center justify-between text-sky-300">
            <span className="text-[11px] font-bold uppercase tracking-wider">Contacted</span>
            <CheckCircle2 size={16} />
          </div>
          <div className="text-2xl sm:text-3xl font-extrabold text-white tabular-nums">
            {summary.totalContacted}
          </div>
          <div className="text-[11px] text-sky-400/80 font-medium">
            {summary.overallConnectivityRate}% pickup rate
          </div>
        </div>

        {/* Follow Ups */}
        <div className="p-4 rounded-3xl bg-gradient-to-br from-amber-500/15 via-amber-500/5 to-transparent border border-amber-500/30 space-y-1">
          <div className="flex items-center justify-between text-amber-300">
            <span className="text-[11px] font-bold uppercase tracking-wider">Follow-ups Set</span>
            <Clock size={16} />
          </div>
          <div className="text-2xl sm:text-3xl font-extrabold text-white tabular-nums">
            {summary.totalFollowUps}
          </div>
          <div className="text-[11px] text-amber-400/80 font-medium">Scheduled follow-ups</div>
        </div>

        {/* Call Not Responded */}
        <div className="p-4 rounded-3xl bg-gradient-to-br from-rose-500/15 via-rose-500/5 to-transparent border border-rose-500/30 space-y-1">
          <div className="flex items-center justify-between text-rose-300">
            <span className="text-[11px] font-bold uppercase tracking-wider">No Answer</span>
            <PhoneOff size={16} />
          </div>
          <div className="text-2xl sm:text-3xl font-extrabold text-white tabular-nums">
            {summary.totalNotResponded}
          </div>
          <div className="text-[11px] text-rose-400/80 font-medium">Unanswered attempts</div>
        </div>

        {/* Active Staff / My Queue */}
        <div className="p-4 rounded-3xl bg-gradient-to-br from-indigo-500/15 via-indigo-500/5 to-transparent border border-indigo-500/30 space-y-1">
          <div className="flex items-center justify-between text-indigo-300">
            <span className="text-[11px] font-bold uppercase tracking-wider">{isScopedStaff ? "My Assigned Queue" : "Active Staff"}</span>
            <UserCheck size={16} />
          </div>
          <div className="text-2xl sm:text-3xl font-extrabold text-white tabular-nums">
            {isScopedStaff ? (
              <>
                <span className="text-amber-400">{myMetric?.pendingUncalledLeads ?? 0}</span>{" "}
                <span className="text-sm font-normal text-white/40">/ {myMetric?.totalAssignedLeads ?? 0}</span>
              </>
            ) : (
              <>
                {summary.activeStaffCount}{" "}
                <span className="text-sm font-normal text-white/40">/ {summary.staffMetrics.length}</span>
              </>
            )}
          </div>
          <div className="text-[11px] text-indigo-400/80 font-medium">
            {isScopedStaff
              ? myMetric?.queueBreakdown && myMetric.queueBreakdown.completed > 0
                ? `${myMetric.queueBreakdown.completed} processed (${[
                    myMetric.queueBreakdown.booked > 0 ? `${myMetric.queueBreakdown.booked} Booked` : null,
                    myMetric.queueBreakdown.contacted > 0 ? `${myMetric.queueBreakdown.contacted} Contacted` : null,
                    myMetric.queueBreakdown.follow_up > 0 ? `${myMetric.queueBreakdown.follow_up} Follow-up` : null,
                    myMetric.queueBreakdown.not_responded > 0 ? `${myMetric.queueBreakdown.not_responded} No Answer` : null,
                    myMetric.queueBreakdown.cancelled > 0 ? `${myMetric.queueBreakdown.cancelled} Cancelled` : null,
                  ].filter(Boolean).join(", ")})`
                : `${myMetric?.pendingUncalledLeads ?? 0} leads awaiting a call or retry`
              : "Calling on this date"}
          </div>
        </div>
      </div>

      {/* Staff Leaderboard & Table Card */}
      <div className="rounded-3xl bg-[#071228] border border-white/10 shadow-2xl overflow-hidden">
        {/* Table Header Controls */}
        <div className="p-5 sm:p-6 border-b border-white/[0.08] flex flex-col sm:flex-row sm:items-center justify-between gap-4 bg-white/[0.01]">
          <div>
            <h2 className="text-base sm:text-lg font-bold text-white flex items-center gap-2">
              <span>{displayDateLabel}</span>
              {isPending && <RefreshCw size={14} className="animate-spin text-amber-400" />}
            </h2>
            <p className="text-xs text-white/40">
              {isScopedStaff
                ? activePreset === "all_time"
                  ? "Your lifetime calling performance and disposition history"
                  : "Your personal calling activity for this date window (Assigned Queue reflects live status)"
                : activePreset === "all_time"
                ? "Team lifetime performance ranked by Bookings closed and Call volume"
                : "Team calling activity for this date window (Assigned Queue reflects live status)"}
            </p>
          </div>

          {!isScopedStaff && (
            <div className="relative max-w-xs w-full">
              <Search size={14} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-white/40" />
              <input
                type="text"
                placeholder="Search staff by name or email…"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="w-full pl-9 pr-3.5 py-2 rounded-2xl bg-white/[0.04] border border-white/10 text-xs text-white placeholder:text-white/30 focus:outline-none focus:border-[#C9A84C]"
              />
            </div>
          )}
        </div>

        {/* Table Content */}
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead>
              <tr className="border-b border-white/[0.08] bg-white/[0.02] text-white/40 font-bold text-[10px] uppercase tracking-wider">
                <th className="sticky left-0 bg-[#071228] z-20 py-3.5 pl-6 pr-3 min-w-[200px] border-r border-white/[0.04]">
                  {isScopedStaff ? "Staff Member" : "Staff / Telecaller"}
                </th>
                <th className="py-3.5 px-3">Calls Made</th>
                <th className="py-3.5 px-3 text-emerald-300">🏆 Booked</th>
                <th className="py-3.5 px-3 text-sky-300">🔄 Contacted</th>
                <th className="py-3.5 px-3 text-amber-300">📅 Follow-up</th>
                <th className="py-3.5 px-3 text-rose-300">📵 No Answer</th>
                <th className="py-3.5 px-3 text-purple-300">🔴 Cancelled</th>
                <th className="py-3.5 px-3 text-right">Pickup %</th>
                <th className="py-3.5 px-3 text-right">Conv %</th>
                <th className="py-3.5 px-3 min-w-[180px]">Assigned Queue</th>
                <th className="py-3.5 pr-6 pl-3 text-right">Action</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-white/[0.05]">
              {filteredStaff.length === 0 ? (
                <tr>
                  <td colSpan={11} className="py-12 text-center text-white/40 text-xs">
                    No staff records found for this period.
                  </td>
                </tr>
              ) : (
                filteredStaff.map((staff, idx) => {
                  const targetPercent = Math.min(
                    100,
                    Math.round((staff.totalCalls / staff.targetCalls) * 100),
                  );

                  return (
                    <tr
                      key={staff.adminUserId}
                      className="hover:bg-white/[0.02] transition-colors group cursor-pointer"
                      onClick={() => setSelectedStaff(staff)}
                    >
                      {/* Staff Name & Rank */}
                      <td className="sticky left-0 z-10 min-w-[200px] bg-[#071228] group-hover:bg-[#0c1a36] py-4 pl-6 pr-3 border-r border-white/[0.04] transition-colors">
                        <div className="flex items-center gap-3">
                          {!isScopedStaff && (
                            <span className="w-5 text-center font-extrabold text-sm tabular-nums text-white/30 group-hover:text-amber-400 transition-colors">
                              {idx === 0 ? "🥇" : idx === 1 ? "🥈" : idx === 2 ? "🥉" : `#${idx + 1}`}
                            </span>
                          )}
                          <div>
                            <div className="font-bold text-white text-xs group-hover:text-amber-300 transition-colors flex items-center gap-1.5">
                              <span>{staff.name}</span>
                              <span className="text-[10px] font-normal text-white/40 px-1.5 py-0.2 rounded bg-white/5 uppercase">
                                {staff.role}
                              </span>
                            </div>
                            <div className="text-[11px] text-white/40">{staff.email}</div>
                          </div>
                        </div>
                      </td>

                      {/* Calls Made with Mini Progress Bar */}
                      <td className="py-4 px-3">
                        <div className="space-y-1 w-28">
                          <div className="flex items-center justify-between text-xs font-bold text-white tabular-nums">
                            <span>{staff.totalCalls}</span>
                            <span className="text-[10px] font-normal text-white/40">
                              / {staff.targetCalls}
                            </span>
                          </div>
                          <div className="h-1.5 w-full rounded-full bg-white/10 overflow-hidden">
                            <div
                              className="h-full rounded-full bg-gradient-to-r from-amber-500 to-amber-300 transition-all"
                              style={{ width: `${targetPercent}%` }}
                            />
                          </div>
                        </div>
                      </td>

                      {/* Booked */}
                      <td className="py-4 px-3">
                        <span className="inline-flex items-center px-2 py-0.5 rounded-lg bg-emerald-500/10 border border-emerald-500/30 text-emerald-400 font-bold tabular-nums">
                          {staff.bookedCount}
                        </span>
                      </td>

                      {/* Contacted */}
                      <td className="py-4 px-3 tabular-nums font-semibold text-white/90">
                        {staff.contactedCount}
                      </td>

                      {/* Follow Up */}
                      <td className="py-4 px-3 tabular-nums font-semibold text-amber-300">
                        {staff.followUpCount}
                      </td>

                      {/* No Answer */}
                      <td className="py-4 px-3 tabular-nums text-rose-400 font-medium">
                        {staff.notRespondedCount}
                      </td>

                      {/* Cancelled */}
                      <td className="py-4 px-3 tabular-nums text-white/40">
                        {staff.cancelledCount}
                      </td>

                      {/* Connectivity Rate */}
                      <td className="py-4 px-3 text-right tabular-nums font-bold text-white/90">
                        {staff.connectivityRate}%
                      </td>

                      {/* Conversion Rate */}
                      <td className="py-4 px-3 text-right tabular-nums font-bold text-emerald-400">
                        {staff.conversionRate}%
                      </td>

                      {/* Queue Stats with Completed Breakdown */}
                      <td className="py-4 px-3">
                        <div className="space-y-1">
                          <div className="text-[11px] font-bold text-white tabular-nums flex items-center gap-1">
                            <span className="text-amber-400">{staff.pendingUncalledLeads} Pending</span>
                            <span className="text-white/30">/ {staff.totalAssignedLeads} Total</span>
                          </div>
                          {staff.queueBreakdown && staff.queueBreakdown.completed > 0 && (
                            <div className="text-[10px] text-white/50 flex flex-wrap gap-1 items-center">
                              <span className="text-emerald-400 font-semibold">{staff.queueBreakdown.completed} Done:</span>
                              {staff.queueBreakdown.booked > 0 && <span className="text-emerald-300 font-medium">{staff.queueBreakdown.booked} Booked</span>}
                              {staff.queueBreakdown.contacted > 0 && <span className="text-sky-300 font-medium">{staff.queueBreakdown.contacted} Contacted</span>}
                              {staff.queueBreakdown.follow_up > 0 && <span className="text-amber-300 font-medium">{staff.queueBreakdown.follow_up} Follow-up</span>}
                              {staff.queueBreakdown.not_responded > 0 && <span className="text-rose-300 font-medium">{staff.queueBreakdown.not_responded} No Answer</span>}
                              {staff.queueBreakdown.cancelled > 0 && <span className="text-purple-300 font-medium">{staff.queueBreakdown.cancelled} Cancelled</span>}
                            </div>
                          )}
                        </div>
                      </td>

                      {/* Action */}
                      <td className="py-4 pr-6 pl-3 text-right">
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            setSelectedStaff(staff);
                          }}
                          className="inline-flex items-center gap-1 px-3 py-1.5 rounded-xl bg-white/[0.05] hover:bg-white/10 border border-white/10 text-white/80 hover:text-white text-xs font-semibold transition-all group-hover:border-amber-400/40 cursor-pointer"
                        >
                          <span>Timeline</span>
                          <ArrowUpRight size={12} className="text-amber-400" />
                        </button>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Staff Timeline Drilldown Modal */}
      {selectedStaff && (
        <StaffTimelineModal
          isOpen={Boolean(selectedStaff)}
          onClose={() => setSelectedStaff(null)}
          staff={selectedStaff}
          date={summary.isSingleDay ? summary.date : undefined}
          startDate={summary.startDate}
          endDate={summary.endDate}
          isAllTime={summary.isAllTime}
          displayLabel={displayDateLabel}
        />
      )}
    </div>
  );
}
