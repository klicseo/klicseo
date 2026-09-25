export default function AdminLoading() {
  return (
    <div role="status" aria-label="Loading admin page" className="min-h-screen bg-[#050E21] p-6 md:p-12 text-white">
      <p className="mb-6 text-sm text-white/60">Loading workspace…</p>
      <div aria-hidden="true" className="animate-pulse space-y-4">
        <div className="h-8 w-48 rounded-lg bg-white/10" />
        <div className="h-24 rounded-xl bg-white/5" />
        <div className="h-64 rounded-xl bg-white/5" />
      </div>
    </div>
  );
}
