"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  Folder,
  FolderPlus,
  Globe,
  Flame,
  Calendar,
  Layers,
  FileSpreadsheet,
  Search,
  User,
  ArrowRight,
  Sparkles,
  CheckCircle2,
  Users,
} from "lucide-react";
import type { FolderSummary } from "@/lib/leads";
import CreateFolderModal from "./CreateFolderModal";
import DeleteLeadListButton from "./lists/DeleteLeadListButton";

interface Props {
  systemFolders: FolderSummary[];
  customFolders: FolderSummary[];
  totalLeads: number;
  adminUsers?: { id: string; email: string; name: string }[];
  canManage?: boolean;
  canDelete?: boolean;
}

export default function FolderExplorerView({
  systemFolders,
  customFolders,
  totalLeads,
  adminUsers = [],
  canManage = true,
  canDelete = false,
}: Props) {
  const router = useRouter();
  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");

  const websiteFolder = systemFolders.find((f) => f.id === "website_form");
  const hotLeadsFolder = systemFolders.find((f) => f.id === "hot_leads");
  const yearFolders = systemFolders.filter((f) => f.type === "system_year");

  // Client-side search filtering across folders
  const q = searchQuery.toLowerCase().trim();
  const filteredCustomFolders = customFolders.filter(
    (f) =>
      !q ||
      f.name.toLowerCase().includes(q) ||
      (f.assignedStaffName && f.assignedStaffName.toLowerCase().includes(q)),
  );

  const handleCreatedFolder = (newFolderId: string) => {
    router.push(`/admin?folder=${newFolderId}`);
  };

  return (
    <div className="space-y-8 animate-in fade-in duration-150">
      {/* 1. Header Command Strip */}
      <div className="flex items-center justify-between gap-4 flex-wrap pb-1 border-b border-white/[0.06]">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-2xl bg-[#C9A84C]/10 border border-[#C9A84C]/30 flex items-center justify-center text-[#C9A84C] shadow-md shadow-[#C9A84C]/10">
            <Layers size={20} />
          </div>
          <div>
            <h2 className="text-lg font-bold text-white tracking-tight flex items-center gap-2">
              <span>Lead Folders & Category Directory</span>
            </h2>
            <p className="text-xs text-white/50">
              Browse leads by channel, year, or folders you create.
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2.5 flex-wrap">
          <form action="/admin" className="flex items-center gap-2">
            <input type="hidden" name="folder" value="all_master" />
            <input type="search" name="q" aria-label="Search leads" placeholder="Search leads: name, phone, car…" className="w-64 max-w-full bg-[#050E21] border border-white/10 rounded-xl px-3 py-1.5 text-xs" />
            <button type="submit" className="text-xs text-[#E8CC7A]">Search</button>
          </form>
          {/* Quick Search across folders */}
          <div className="relative">
            <Search size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-white/40" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Filter folders..."
              className="w-44 md:w-56 bg-[#050E21] border border-white/10 rounded-xl pl-8 pr-3 py-1.5 text-xs text-white placeholder:text-white/30 focus:outline-none focus:border-[#C9A84C]"
            />
          </div>

          {canManage && (
            <button
              type="button"
              onClick={() => setIsCreateOpen(true)}
              className="px-3.5 py-1.5 rounded-xl bg-gradient-to-r from-[#C9A84C] to-[#E8CC7A] text-[#050E21] text-xs font-bold hover:brightness-105 transition-all shadow-md shadow-[#C9A84C]/20 inline-flex items-center gap-1.5"
            >
              <FolderPlus size={14} />
              <span>+ New Folder</span>
            </button>
          )}

          <Link
            href="/admin?folder=all_master"
            className="px-3.5 py-1.5 rounded-xl bg-white/[0.04] border border-white/10 hover:bg-white/[0.08] text-xs font-semibold text-white/80 hover:text-white transition-all inline-flex items-center gap-1.5 shadow-sm"
          >
            <FileSpreadsheet size={14} className="text-[#C9A84C]" />
            <span>Master Sheet (All {totalLeads.toLocaleString("en-IN")})</span>
          </Link>
        </div>
      </div>

      {/* 2. Section: Channel & Intent Source Folders */}
      <div className="space-y-3">
        <div className="flex items-center gap-2">
          <Sparkles size={14} className="text-[#C9A84C]" />
          <h3 className="text-xs font-bold uppercase tracking-wider text-[#E8CC7A]">
            1. Core Capture Channel Folders
          </h3>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {/* Website Form Folder Card */}
          {websiteFolder && (
            <Link
              href="/admin?folder=website_form"
              className="group p-5 rounded-3xl bg-[#071228] border border-white/[0.08] hover:border-sky-500/50 hover:bg-sky-500/[0.03] transition-all shadow-lg hover:shadow-2xl flex flex-col justify-between"
            >
              <div>
                <div className="flex items-center justify-between mb-3">
                  <div className="w-11 h-11 rounded-2xl bg-sky-500/10 border border-sky-500/25 flex items-center justify-center text-sky-400">
                    <Globe size={22} />
                  </div>
                  <span className="px-2.5 py-1 rounded-full bg-sky-500/15 text-sky-300 border border-sky-500/30 text-xs font-bold">
                    {websiteFolder.count.toLocaleString("en-IN")} Leads
                  </span>
                </div>
                <h4 className="text-base font-bold text-white group-hover:text-sky-300 transition-colors">
                  🌐 Website Form Leads
                </h4>
                <p className="text-xs text-white/50 mt-1">
                  Inquiries submitted directly by clients through the online booking wizard.
                </p>
              </div>

              <div className="mt-5 pt-3.5 border-t border-white/[0.06] flex items-center justify-between text-xs">
                <span className="text-white/40 flex items-center gap-1">
                  <CheckCircle2 size={13} className="text-emerald-400" />
                  <span className="text-emerald-400 font-semibold">{websiteFolder.bookedCount}</span> booked
                </span>
                <span className="font-semibold text-sky-400 group-hover:translate-x-0.5 transition-transform inline-flex items-center gap-1">
                  <span>Open Excel Sheet</span>
                  <ArrowRight size={13} />
                </span>
              </div>
            </Link>
          )}

          {/* Hot Leads (Admin Added) Folder Card */}
          {hotLeadsFolder && (
            <Link
              href="/admin?folder=hot_leads"
              className="group p-5 rounded-3xl bg-[#071228] border border-white/[0.08] hover:border-amber-500/50 hover:bg-amber-500/[0.03] transition-all shadow-lg hover:shadow-2xl flex flex-col justify-between"
            >
              <div>
                <div className="flex items-center justify-between mb-3">
                  <div className="w-11 h-11 rounded-2xl bg-amber-500/10 border border-amber-500/25 flex items-center justify-center text-amber-400">
                    <Flame size={22} />
                  </div>
                  <span className="px-2.5 py-1 rounded-full bg-amber-500/15 text-amber-300 border border-amber-500/30 text-xs font-bold">
                    {hotLeadsFolder.count.toLocaleString("en-IN")} Leads
                  </span>
                </div>
                <h4 className="text-base font-bold text-white group-hover:text-amber-300 transition-colors">
                  🔥 Hot Leads (Admin Added)
                </h4>
                <p className="text-xs text-white/50 mt-1">
                  Manually created leads added directly by administrators and staff.
                </p>
              </div>

              <div className="mt-5 pt-3.5 border-t border-white/[0.06] flex items-center justify-between text-xs">
                <span className="text-white/40 flex items-center gap-1">
                  <CheckCircle2 size={13} className="text-emerald-400" />
                  <span className="text-emerald-400 font-semibold">{hotLeadsFolder.bookedCount}</span> booked
                </span>
                <span className="font-semibold text-amber-400 group-hover:translate-x-0.5 transition-transform inline-flex items-center gap-1">
                  <span>Open Excel Sheet</span>
                  <ArrowRight size={13} />
                </span>
              </div>
            </Link>
          )}
        </div>
      </div>

      {/* 3. Section: Year-Wise Lead Folders */}
      <div className="space-y-3">
        <div className="flex items-center gap-2">
          <Calendar size={14} className="text-purple-400" />
          <h3 className="text-xs font-bold uppercase tracking-wider text-purple-300">
            2. Year-Wise Lead Folders (2024, 2025, 2026...)
          </h3>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {yearFolders.map((yrFolder) => (
            <Link
              key={yrFolder.id}
              href={`/admin?folder=${yrFolder.id}`}
              className="group p-4 rounded-3xl bg-[#071228] border border-white/[0.08] hover:border-purple-500/50 hover:bg-purple-500/[0.03] transition-all shadow-lg hover:shadow-2xl flex flex-col justify-between"
            >
              <div>
                <div className="flex items-center justify-between mb-3">
                  <div className="w-10 h-10 rounded-2xl bg-purple-500/10 border border-purple-500/25 flex items-center justify-center text-purple-400">
                    <Folder size={20} />
                  </div>
                  <span className="px-2.5 py-0.5 rounded-full bg-purple-500/15 text-purple-300 border border-purple-500/30 text-xs font-bold tabular-nums">
                    {yrFolder.count.toLocaleString("en-IN")} Leads
                  </span>
                </div>
                <h4 className="text-sm font-bold text-white group-hover:text-purple-300 transition-colors">
                  📁 {yrFolder.name}
                </h4>
                <p className="text-[11px] text-white/50 mt-0.5">
                  All customer inquiries received during {yrFolder.year}
                </p>
              </div>

              <div className="mt-4 pt-3 border-t border-white/[0.06] flex items-center justify-between text-xs">
                <span className="text-white/40 text-[11px]">
                  {yrFolder.bookedCount} booked
                </span>
                <span className="font-semibold text-purple-300 group-hover:translate-x-0.5 transition-transform inline-flex items-center gap-1 text-[11px]">
                  <span>Open Folder</span>
                  <ArrowRight size={12} />
                </span>
              </div>
            </Link>
          ))}
        </div>
      </div>

      {/* 4. Section: Custom Admin Campaign Folders (Manual Cards) */}
      <div className="space-y-3">
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <Folder size={14} className="text-emerald-400" />
            <h3 className="text-xs font-bold uppercase tracking-wider text-emerald-300">
              3. Custom Folders
            </h3>
            <span className="text-[10px] px-2 py-0.5 rounded-full bg-white/[0.06] text-white/50 font-medium">
              {customFolders.length} Folders
            </span>
          </div>

          {canManage && (
            <button
              type="button"
              onClick={() => setIsCreateOpen(true)}
              className="text-xs font-bold text-emerald-400 hover:text-white bg-emerald-500/10 hover:bg-emerald-500/20 border border-emerald-500/30 px-3 py-1 rounded-xl transition-all inline-flex items-center gap-1.5 shadow-sm"
            >
              <FolderPlus size={13} />
              <span>+ Create Folder</span>
            </button>
          )}
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
          {filteredCustomFolders.map((folder) => (
            <div
              key={folder.id}
              className="group p-4 rounded-3xl bg-[#071228] border border-white/[0.08] hover:border-emerald-500/50 hover:bg-emerald-500/[0.03] transition-all shadow-lg hover:shadow-2xl flex flex-col justify-between"
            >
              <Link href={`/admin?folder=${folder.id}`} className="flex flex-1 flex-col justify-between">
              <div>
                <div className="flex items-center justify-between mb-3">
                  <div className="w-10 h-10 rounded-2xl bg-emerald-500/10 border border-emerald-500/25 flex items-center justify-center text-emerald-400">
                    <Folder size={20} />
                  </div>
                  {folder.assignedStaffName && (
                    <span className="text-[10px] font-medium px-2 py-0.5 rounded-lg bg-sky-500/15 text-sky-300 border border-sky-500/20 inline-flex items-center gap-1 truncate max-w-[110px]">
                      <User size={10} />
                      <span>{folder.assignedStaffName}</span>
                    </span>
                  )}
                </div>
                <h4 className="text-sm font-bold text-white group-hover:text-emerald-300 transition-colors truncate">
                  📁 {folder.name}
                </h4>
                <p className="text-[11px] text-white/50 mt-0.5">
                  Custom Campaign Folder
                </p>
              </div>

              <div className="mt-4 pt-3 border-t border-white/[0.06] flex items-center justify-between text-xs">
                <span className="text-emerald-400 font-bold tabular-nums">
                  {folder.count.toLocaleString("en-IN")} <span className="text-[11px] font-normal text-white/40">leads</span>
                </span>
                <span className="font-semibold text-emerald-300 group-hover:translate-x-0.5 transition-transform inline-flex items-center gap-1 text-[11px]">
                  <span>Open Folder</span>
                  <ArrowRight size={12} />
                </span>
              </div>
              </Link>
              {canDelete && (
                <div className="mt-3 flex justify-end">
                  <DeleteLeadListButton id={folder.id} name={folder.name} kind="folder" returnTo="/admin" />
                </div>
              )}
            </div>
          ))}

          {/* Quick "+ New Folder" Action Tile */}
          {canManage && (
            <button
              type="button"
              onClick={() => setIsCreateOpen(true)}
              className="p-4 rounded-3xl border border-dashed border-white/15 hover:border-[#C9A84C]/60 hover:bg-[#C9A84C]/5 text-white/50 hover:text-white transition-all flex flex-col items-center justify-center gap-2 min-h-[140px] group shadow-sm"
            >
              <div className="w-10 h-10 rounded-2xl bg-white/[0.04] group-hover:bg-[#C9A84C]/20 border border-white/10 group-hover:border-[#C9A84C]/40 flex items-center justify-center text-white/60 group-hover:text-[#E8CC7A] transition-all">
                <FolderPlus size={20} />
              </div>
              <span className="text-xs font-bold group-hover:text-[#E8CC7A] transition-colors">
                + Create Custom Folder
              </span>
            </button>
          )}
        </div>
      </div>

      <CreateFolderModal
        isOpen={isCreateOpen}
        onClose={() => setIsCreateOpen(false)}
        adminUsers={adminUsers}
        onSuccess={handleCreatedFolder}
      />
    </div>
  );
}
