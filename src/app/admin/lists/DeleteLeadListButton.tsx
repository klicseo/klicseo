"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Trash2, Loader2 } from "lucide-react";
import { deleteLeadListAction } from "./actions";

export default function DeleteLeadListButton({
  id, name, kind = "list", returnTo = "/admin/lists",
}: { id: string; name: string; kind?: "folder" | "list"; returnTo?: string }) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const handleDelete = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (!confirm(`Delete ${kind} "${name}"? This cannot be undone. ${kind === "folder" ? "Its leads and staff assignments will be kept. Only the folder is removed." : "Its leads will be kept in All Leads and will become unassigned. Custom folder membership will be kept."}`)) return;
    setError(null);
    startTransition(async () => {
      try {
        const formData = new FormData();
        formData.append("id", id);
        const result = await deleteLeadListAction(formData);
        if (!result.ok) {
          setError(result.error || `Could not delete ${kind}. Please try again.`);
          return;
        }
        router.push(returnTo);
        router.refresh();
      } catch {
        setError(`Could not delete ${kind}. Please try again.`);
      }
    });
  };

  return (
    <div>
      <button
        type="button"
        onClick={handleDelete}
        disabled={isPending}
        title={`Delete ${kind}`}
        aria-label={`Delete ${kind} ${name}`}
        className="flex items-center gap-1.5 rounded-lg px-2 py-1.5 text-xs text-rose-300 bg-rose-500/10 hover:bg-rose-500/20 transition-colors disabled:opacity-60"
      >
        {isPending ? <Loader2 size={13} className="animate-spin" /> : <Trash2 size={13} />}
        {kind === "folder" && <span>{isPending ? "Deleting…" : "Delete folder"}</span>}
      </button>
      {error && <p role="alert" className="mt-2 text-xs text-rose-300">{error}</p>}
    </div>
  );
}
