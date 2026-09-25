import type { ReactNode } from "react";
import styles from "./AdminSkeleton.module.css";

type Layout = "folders" | "campaigns" | "batches" | "table" | "analytics" | "reports" | "detail" | "form" | "auth";
const panel = "rounded-2xl border border-white/[0.08] bg-[#071228]";

function Bone({ className = "h-3 w-24" }: { className?: string }) {
  return <div className={`rounded-md bg-white/[0.07] ${className}`} />;
}

function Surface({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <div className={`${styles.surface} ${className}`}>{children}</div>;
}

function Header() {
  return <Surface className="flex flex-wrap items-center justify-between gap-4">
    <div className="min-w-0 space-y-3"><Bone className="h-3 w-20" /><Bone className="h-8 w-56 max-w-full" /><Bone className="h-3 w-72 max-w-full" /></div>
    <div className="flex gap-2"><Bone className="h-10 w-24 rounded-xl" /><Bone className="h-10 w-32 rounded-xl bg-[#C9A84C]/15" /></div>
  </Surface>;
}

function Filters() {
  return <Surface className={`${panel} flex flex-wrap gap-3 p-4`}>
    <Bone className="h-10 w-full rounded-xl sm:w-64" />
    {[0, 1, 2].map(i => <Bone key={i} className="h-10 min-w-24 flex-1 rounded-xl" />)}
  </Surface>;
}

function Stats({ count = 4 }: { count?: number }) {
  return <div className={`grid grid-cols-2 gap-3.5 ${count === 6 ? "lg:grid-cols-6" : "lg:grid-cols-4"}`}>
    {Array.from({ length: count }, (_, i) => <Surface key={i} className={`${panel} space-y-4 p-4`}>
      <div className="flex items-center justify-between gap-2"><Bone className="h-3 w-20" /><Bone className="h-7 w-7 shrink-0 rounded-lg bg-[#C9A84C]/10" /></div>
      <Bone className="h-7 w-16" /><Bone className="h-2 w-24 max-w-full" />
    </Surface>)}
  </div>;
}

function Cards({ staff = false }: { staff?: boolean }) {
  return <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
    {Array.from({ length: 6 }, (_, i) => <Surface key={i} className={`${panel} space-y-5 rounded-3xl p-5`}>
      <div className="flex items-center gap-3"><Bone className={`h-11 w-11 shrink-0 ${staff ? "rounded-full" : "rounded-xl bg-[#C9A84C]/10"}`} /><div className="space-y-2"><Bone className="h-4 w-28" /><Bone className="h-2.5 w-36" /></div></div>
      <div className="grid grid-cols-3 gap-3">{[0, 1, 2].map(j => <div key={j} className="space-y-2"><Bone className="h-5 w-10" /><Bone className="h-2 w-full" /></div>)}</div>
      <Bone className="h-1.5 w-full rounded-full" />
      <div className="flex justify-between border-t border-white/[0.06] pt-4"><Bone className="h-3 w-20" /><Bone className="h-3 w-16" /></div>
    </Surface>)}
  </div>;
}

/** Content-only version can also be used inside an existing shell or Suspense boundary. */
export function LeadTableSkeleton() {
  return <>
    <div className="space-y-3 sm:hidden">
      {Array.from({ length: 4 }, (_, i) => <Surface key={i} className={`${panel} space-y-4 p-4`}>
        <div className="flex justify-between gap-3"><Bone className="h-4 w-32" /><Bone className="h-6 w-20 rounded-full" /></div>
        <Bone className="h-3 w-44" /><Bone className="h-3 w-28" />
        <div className="flex gap-2 border-t border-white/[0.06] pt-3"><Bone className="h-9 flex-1 rounded-xl bg-[#C9A84C]/10" /><Bone className="h-9 flex-1 rounded-xl" /></div>
      </Surface>)}
    </div>
    <Surface className={`${panel} hidden overflow-hidden sm:block`}>
    <div className="grid grid-cols-[24px_1fr_100px] gap-4 border-b border-white/10 bg-white/[0.02] px-4 py-4 sm:grid-cols-[24px_2fr_1fr_1fr_1fr]">
      <Bone className="h-4 w-4" />{[0, 1, 2, 3].map(i => <Bone key={i} className={`h-3 w-16 ${i > 1 ? "hidden sm:block" : ""}`} />)}
    </div>
    {Array.from({ length: 8 }, (_, i) => <div key={i} className="grid grid-cols-[24px_1fr_100px] items-center gap-4 border-b border-white/[0.05] px-4 py-4 sm:grid-cols-[24px_2fr_1fr_1fr_1fr]">
      <Bone className="h-4 w-4" /><div className="space-y-2"><Bone className={`h-3 ${i % 2 ? "w-24" : "w-32"} max-w-full`} /><Bone className="h-2 w-20" /></div>
      <Bone className="h-6 w-20 rounded-full" /><Bone className="hidden h-3 w-20 sm:block" /><Bone className="hidden h-3 w-16 sm:block" />
    </div>)}
    <div className="flex items-center justify-between gap-4 p-4"><Bone className="h-3 w-28" /><div className="flex gap-2"><Bone className="h-8 w-8" /><Bone className="h-8 w-8" /><Bone className="h-8 w-8" /></div></div>
  </Surface></>;
}

function Form({ detail = false }: { detail?: boolean }) {
  return <div className={detail ? "grid gap-5 lg:grid-cols-[2fr_1fr]" : "max-w-3xl"}>
    <Surface className={`${panel} space-y-6 p-5 sm:p-6`}>
      <Bone className="h-5 w-36" />
      <div className="grid gap-5 sm:grid-cols-2">{Array.from({ length: 6 }, (_, i) => <div key={i} className="space-y-2"><Bone className="h-3 w-20" /><Bone className="h-11 w-full rounded-xl" /></div>)}</div>
      <Bone className="h-24 w-full rounded-xl" /><Bone className="h-10 w-32 rounded-xl bg-[#C9A84C]/15" />
    </Surface>
    {detail && <Surface className={`${panel} h-fit space-y-6 p-5`}><Bone className="h-5 w-28" />{[0, 1, 2, 3].map(i => <div key={i} className="flex gap-3"><Bone className="h-8 w-8 shrink-0 rounded-full" /><div className="flex-1 space-y-3"><Bone className="h-3 w-full" /><Bone className="h-2 w-2/3" /></div></div>)}</Surface>}
  </div>;
}

function Content({ layout }: { layout: Layout }) {
  if (layout === "form" || layout === "detail") return <><Header /><Form detail={layout === "detail"} /></>;
  if (layout === "analytics") return <><Header /><Filters /><Stats count={6} /><div className="grid gap-5 lg:grid-cols-3"><Surface className={`${panel} space-y-6 p-5 lg:col-span-2`}><Bone className="h-4 w-40" /><div className="flex h-52 items-end justify-between gap-3 border-b border-white/10 pt-6">{[45, 70, 55, 90, 60, 80, 65, 95].map((height, i) => <div key={i} className="flex-1 rounded-t-lg bg-white/[0.07]" style={{ height: `${height}%` }} />)}</div></Surface><Surface className={`${panel} flex min-h-72 items-center justify-center p-5`}><div className="h-40 w-40 rounded-full border-[22px] border-white/[0.07]" /></Surface></div></>;
  if (layout === "reports") return <><Header /><Filters /><Stats count={6} /><LeadTableSkeleton /></>;
  if (layout === "batches") return <><Filters /><Header />{[0, 1].map(i => <Surface key={i} className={`${panel} space-y-5 rounded-3xl p-5`}><div className="flex items-center gap-3"><Bone className="h-10 w-10 rounded-xl bg-[#C9A84C]/15" /><Bone className="h-4 w-40" /></div><div className="grid gap-3 sm:grid-cols-3">{[0, 1, 2].map(j => <div key={j} className="space-y-4 rounded-xl border border-white/[0.06] p-4"><Bone className="h-4 w-28" /><Bone className="h-3 w-20" /><Bone className="h-2 w-full" /></div>)}</div></Surface>)}</>;
  if (layout === "campaigns") return <><Header /><Surface className="flex flex-wrap gap-2 rounded-2xl border border-white/10 p-2">{[0, 1, 2].map(i => <Bone key={i} className="h-9 w-40 rounded-xl" />)}</Surface><Filters /><Cards staff /></>;
  return <><Header /><Stats /><Filters />{layout === "table" ? <LeadTableSkeleton /> : <Cards />}</>;
}

export default function AdminSkeleton({ layout = "folders", label = "Loading workspace" }: { layout?: Layout; label?: string }) {
  return <div role="status" aria-live="polite" aria-busy="true" className="min-h-screen bg-[#050E21] text-white">
    <span className="sr-only">{label}</span>
    <div aria-hidden="true">
      {layout === "auth" ? <div className="mx-auto flex min-h-screen max-w-md items-center px-4"><Surface className={`${panel} w-full space-y-7 p-8`}><Bone className="mx-auto h-12 w-12 rounded-2xl bg-[#C9A84C]/15" /><Bone className="mx-auto h-7 w-40" /><Bone className="h-11 w-full rounded-xl" /><Bone className="h-11 w-full rounded-xl" /><Bone className="h-11 w-full rounded-xl bg-[#C9A84C]/15" /></Surface></div> : <>
        <Surface className="fixed inset-y-0 left-0 hidden w-64 flex-col border-r border-white/[0.08] bg-[#071228] md:flex">
          <div className="flex h-20 items-center gap-3 border-b border-white/[0.08] px-5"><Bone className="h-8 w-8 rounded-xl bg-[#C9A84C]/20" /><Bone className="h-4 w-28" /></div>
          <div className="flex-1 space-y-7 px-5 py-6">{[5, 3, 4].map((count, i) => <div key={i} className="space-y-4"><Bone className="h-2 w-16" />{Array.from({ length: count }, (_, j) => <div key={j} className="flex items-center gap-3"><Bone className="h-4 w-4" /><Bone className={`h-3 ${j % 2 ? "w-24" : "w-32"}`} /></div>)}</div>)}</div>
          <div className="space-y-3 border-t border-white/10 p-5"><Bone className="h-3 w-32" /><Bone className="h-8 w-full rounded-xl" /></div>
        </Surface>
        <Surface className="fixed inset-x-0 top-0 z-30 flex h-14 items-center justify-between border-b border-white/10 bg-[#071228] px-4 md:hidden"><Bone className="h-9 w-9 rounded-xl" /><Bone className="h-3 w-24" /><Bone className="h-9 w-9 rounded-xl" /></Surface>
        <div className="md:pl-64"><div className="mx-auto w-full max-w-7xl min-w-0 space-y-6 px-3 py-4 pt-18 sm:px-4 sm:py-6 sm:pt-18 md:px-8 md:py-8"><Content layout={layout} /></div></div>
      </>}
    </div>
  </div>;
}
