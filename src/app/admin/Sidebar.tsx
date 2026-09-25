"use client";

import { useState, useMemo } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  Inbox,
  PlusCircle,
  Users,
  UserPlus,
  UserCog,
  Tag,
  Car,
  Settings2,
  Briefcase,
  ClipboardList,
  Wallet,
  ScrollText,
  UploadCloud,
  LogOut,
  Menu,
  X,
  Sparkles,
  BarChart3,
  TrendingUp,
  PieChart,
} from "lucide-react";
import { ROLE_LABEL, type AdminRole } from "@/lib/admin-users-shared";
import type { CallReminder } from "@/lib/leads-shared";
import NotificationBell from "./NotificationBell";

export interface NavItem {
  href: string;
  label: string;
  icon: keyof typeof ICONS;
  exact?: boolean;
}

export interface NavGroup {
  title: string;
  items: NavItem[];
}

const ICONS = {
  Inbox,
  PlusCircle,
  UploadCloud,
  Users,
  UserPlus,
  UserCog,
  Tag,
  Car,
  Settings2,
  Briefcase,
  ClipboardList,
  Wallet,
  ScrollText,
  BarChart3,
  TrendingUp,
  PieChart,
} as const;

export default function Sidebar({
  groups,
  email,
  role,
  reminders = [],
  showBell = false,
  desktopNotifications,
  mobileNotifications,
}: {
  groups: NavGroup[];
  email: string;
  role: AdminRole;
  reminders?: CallReminder[];
  showBell?: boolean;
  desktopNotifications?: React.ReactNode;
  mobileNotifications?: React.ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const pathname = usePathname();

  // Find the single best matching active item:
  const activeItemHref = useMemo(() => {
    const allHrefs = groups.flatMap((g) => g.items.map((i) => i.href));

    // 1. Strict exact match
    for (const href of allHrefs) {
      if (pathname === href) return href;
    }

    // 2. Prefix match (e.g. /admin/employees/[id] matches /admin/employees)
    // Only match if no other more specific menu item matches pathname
    const prefixCandidates = allHrefs.filter((href) => {
      if (!pathname.startsWith(href + "/")) return false;
      const hasMoreSpecificMatch = allHrefs.some(
        (other) =>
          other !== href &&
          other.length > href.length &&
          (pathname === other || pathname.startsWith(other + "/")),
      );
      return !hasMoreSpecificMatch;
    });

    return prefixCandidates[0] || null;
  }, [groups, pathname]);

  const initials = email.slice(0, 2).toUpperCase();

  const renderNav = () => (
    <div className="flex h-full flex-col bg-[#071228] text-white">
      {/* Brand Header */}
      <div className="px-5 py-5 border-b border-white/[0.08] flex items-center justify-between">
        <Link
          href="/admin"
          onClick={() => setOpen(false)}
          className="flex items-center gap-2.5 group"
        >
          <div className="grid h-8 w-8 place-items-center rounded-xl bg-gradient-to-br from-[#9C7A2A] via-[#C9A84C] to-[#E8CC7A] text-[#050E21] font-bold text-xs shadow-md shadow-[#C9A84C]/20 group-hover:scale-105 transition-transform">
            K
          </div>
          <div>
            <div
              className="text-sm font-bold tracking-[0.18em] uppercase text-white group-hover:text-[#E8CC7A] transition-colors"
              style={{ fontFamily: "var(--font-playfair)" }}
            >
              Klicseo<span className="text-[#C9A84C]">.</span>
            </div>
            <p className="text-[9px] uppercase tracking-[0.25em] text-white/35 font-medium -mt-0.5">
              Backoffice
            </p>
          </div>
        </Link>

        {showBell && (desktopNotifications ?? <NotificationBell items={reminders} align="left" />)}
      </div>

      {/* Navigation Groups */}
      <nav className="flex-1 overflow-y-auto px-3 py-4 space-y-6">
        {groups.map((group) => (
          <div key={group.title}>
            <p className="px-3 mb-2 text-[10px] font-bold uppercase tracking-[0.2em] text-white/30">
              {group.title}
            </p>
            <ul className="space-y-1">
              {group.items.map((item) => {
                const Icon = ICONS[item.icon];
                const active = activeItemHref === item.href;
                return (
                  <li key={item.href}>
                    <Link
                      href={item.href}
                      onClick={() => setOpen(false)}
                      className={`group relative flex items-center gap-3 rounded-xl px-3.5 py-3 md:py-2.5 text-xs transition-all min-h-[44px] md:min-h-[38px] ${
                        active
                          ? "bg-gradient-to-r from-[#C9A84C]/20 to-[#C9A84C]/5 text-[#E8CC7A] font-semibold border border-[#C9A84C]/30 shadow-sm"
                          : "text-white/60 hover:text-white hover:bg-white/[0.04] active:bg-white/[0.08]"
                      }`}
                    >
                      {active && (
                        <span className="absolute left-0 top-2 bottom-2 w-1 rounded-r-full bg-[#C9A84C]" />
                      )}
                      <Icon
                        size={17}
                        className={`transition-colors shrink-0 ${
                          active
                            ? "text-[#C9A84C]"
                            : "text-white/40 group-hover:text-white/80"
                        }`}
                      />
                      <span className="truncate font-medium">{item.label}</span>
                    </Link>
                  </li>
                );
              })}
            </ul>
          </div>
        ))}
      </nav>

      {/* User Card Footer */}
      <div className="border-t border-white/[0.08] p-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] bg-white/[0.01]">
        <div className="flex items-center gap-3 rounded-xl p-2 bg-white/[0.02] border border-white/5">
          <div className="grid h-8 w-8 shrink-0 place-items-center rounded-lg text-[10px] font-bold text-[#050E21] bg-gradient-to-br from-[#9C7A2A] via-[#C9A84C] to-[#E8CC7A]">
            {initials}
          </div>
          <div className="min-w-0 flex-1">
            <p className="truncate text-xs font-medium text-white">{email}</p>
            <p className="text-[9px] uppercase tracking-wider text-[#C9A84C] font-semibold">
              {ROLE_LABEL[role]}
            </p>
          </div>
          <form action="/api/admin/logout" method="post">
            <button
              type="submit"
              title="Sign out"
              className="grid h-8 w-8 place-items-center rounded-lg text-white/40 hover:bg-white/10 hover:text-rose-400 transition-colors"
            >
              <LogOut size={14} />
            </button>
          </form>
        </div>
      </div>
    </div>
  );

  const homeHref = role === "staff" ? "/admin/my-lists" : "/admin";

  return (
    <>
      {/* Mobile Top Bar */}
      <div className="md:hidden fixed top-0 left-0 right-0 z-30 flex h-14 items-center justify-between border-b border-white/10 bg-[#071228]/95 px-4 backdrop-blur-md">
        <button
          onClick={() => setOpen(true)}
          type="button"
          aria-label="Open Navigation Menu"
          className="grid h-9 w-9 place-items-center rounded-xl bg-white/5 text-white/70 hover:bg-white/10 active:scale-95 transition-all"
        >
          <Menu size={19} />
        </button>

        <Link
          href={homeHref}
          className="text-xs font-bold tracking-[0.2em] uppercase"
          style={{ fontFamily: "var(--font-playfair)" }}
        >
          Klicseo<span className="text-[#C9A84C]">.</span>
        </Link>

        {showBell ? (mobileNotifications ?? <NotificationBell items={reminders} align="right" />) : <div className="w-9" />}
      </div>

      {/* Mobile Drawer Overlay */}
      {open && (
        <div className="md:hidden fixed inset-0 z-50 flex animate-in fade-in duration-200">
          <div className="fixed inset-0 bg-black/75 backdrop-blur-sm" onClick={() => setOpen(false)} />
          <div className="relative z-10 w-72 max-w-[85vw] h-full shadow-2xl animate-in slide-in-from-left duration-250">
            <button
              onClick={() => setOpen(false)}
              type="button"
              aria-label="Close menu"
              className="absolute top-4 right-4 z-20 grid h-8 w-8 place-items-center rounded-xl bg-white/10 text-white/70 hover:bg-white/20 active:scale-95 transition-all"
            >
              <X size={16} />
            </button>
            {renderNav()}
          </div>
        </div>
      )}

      {/* Desktop Fixed Left Sidebar Rail */}
      <aside className="hidden md:block fixed inset-y-0 left-0 z-30 w-64 border-r border-white/[0.08] shadow-xl">
        {renderNav()}
      </aside>
    </>
  );
}
