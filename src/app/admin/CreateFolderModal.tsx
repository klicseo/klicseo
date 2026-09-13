"use client";

import { useState, useTransition } from "react";
import { X, FolderPlus, Loader2, User, Folder } from "lucide-react";
import { createFolderAction } from "./folder-actions";

interface Props {
  isOpen: boolean;
  onClose: () => void;
  adminUsers?: { id: string; email: string; name: string }[];
  onSuccess?: (folderId: string, folderName: string) => void;
}

export default function CreateFolderModal({
  isOpen,
  onClose,
  adminUsers = [],
  onSuccess,
}: Props) {
  const [isPending, startTransition] = useTransition();
  const [folderName, setFolderName] = useState("");
  const [assignedAdminUserId, setAssignedAdminUserId] = useState("");
  const [error, setError] = useState<string | null>(null);

  if (!isOpen) return null;

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = folderName.trim();
    if (!trimmed) {
      setError("Please enter a folder name.");
      return;
    }

    setError(null);
    startTransition(async () => {
      try {
        const res = await createFolderAction({
          name: trimmed,
          assignedAdminUserId: assignedAdminUserId || null,
        });

        if (res.ok && res.folderId) {
          setFolderName("");
          setAssignedAdminUserId("");
          if (onSuccess) onSuccess(res.folderId, trimmed);
          onClose();
        } else {
          setError(res.error || "Failed to create folder.");
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to create folder. Please try again.");
      }
    });
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm animate-in fade-in duration-150">
      <div className="relative w-full max-w-md bg-[#071228] border border-white/[0.12] rounded-2xl shadow-2xl overflow-hidden flex flex-col text-white">
        {/* Header */}
        <div className="px-5 py-4 border-b border-white/[0.08] flex items-center justify-between bg-white/[0.02]">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-xl bg-amber-500/10 border border-amber-500/20 flex items-center justify-center text-[#C9A84C]">
              <FolderPlus size={18} />
            </div>
            <div>
              <h2 className="text-sm font-bold tracking-tight text-white">
                Create Lead Folder Card
              </h2>
              <p className="text-[11px] text-white/50">
                Organize leads into dedicated campaigns or queues
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-1 rounded-lg text-white/40 hover:text-white hover:bg-white/10 transition-colors"
          >
            <X size={16} />
          </button>
        </div>

        {/* Form Body */}
        <form onSubmit={handleSubmit} className="p-5 space-y-4">
          {error && (
            <div className="p-3 rounded-xl bg-rose-500/10 border border-rose-500/20 text-rose-300 text-xs flex items-center gap-2">
              <span>{error}</span>
            </div>
          )}

          <div className="space-y-1.5">
            <label className="text-xs font-semibold text-white/80 flex items-center gap-1.5">
              <Folder size={13} className="text-[#C9A84C]" />
              <span>Folder Name</span>
              <span className="text-rose-400">*</span>
            </label>
            <input
              type="text"
              required
              autoFocus
              value={folderName}
              onChange={(e) => setFolderName(e.target.value)}
              placeholder="e.g. VIP Ceramic Leads, Velachery Batch..."
              className="w-full bg-[#050E21] border border-white/15 rounded-xl px-3.5 py-2 text-sm text-white placeholder:text-white/30 focus:outline-none focus:border-[#C9A84C]"
            />
          </div>

          {adminUsers.length > 0 && (
            <div className="space-y-1.5">
              <label className="text-xs font-semibold text-white/80 flex items-center gap-1.5">
                <User size={13} className="text-sky-400" />
                <span>Folder Owner (Optional)</span>
              </label>
              <select
                value={assignedAdminUserId}
                onChange={(e) => setAssignedAdminUserId(e.target.value)}
                className="w-full bg-[#050E21] border border-white/15 rounded-xl px-3.5 py-2 text-sm text-white focus:outline-none focus:border-[#C9A84C]"
              >
                <option value="">Unassigned (Shared / Admin Pool)</option>
                {adminUsers.map((u) => (
                  <option key={u.id} value={u.id}>
                    {u.name} ({u.email})
                  </option>
                ))}
              </select>
              <p className="text-xs text-white/50">Organizes the folder. Allocate its leads separately to give staff access.</p>
            </div>
          )}

          {/* Footer Actions */}
          <div className="pt-2 flex items-center justify-end gap-2.5">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 rounded-xl bg-white/[0.04] border border-white/10 hover:bg-white/[0.08] text-xs font-semibold text-white/80 transition-colors"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={isPending || !folderName.trim()}
              className="px-5 py-2 rounded-xl bg-gradient-to-r from-[#C9A84C] to-[#E8CC7A] text-[#050E21] text-xs font-bold hover:brightness-105 transition-all shadow-md shadow-[#C9A84C]/20 disabled:opacity-50 inline-flex items-center gap-2"
            >
              {isPending && <Loader2 size={13} className="animate-spin" />}
              <span>Create Folder Card</span>
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
