"use client";

import { useActionState, useEffect } from "react";
import type { LeadListRow } from "@/lib/leadLists-shared";

// Local types for the form action and state returned by `useActionState`.
type Action = (prev: State, payload: FormData) => State | Promise<State>;
type State = { error?: string; redirectTo?: string };
export default function LeadListForm({
  employees,
  initial,
  action,
  submitLabel,
  pendingLabel,
}: {
  employees: { id: string; name: string }[];
  initial?: LeadListRow | null;
  action: Action;
  submitLabel: string;
  pendingLabel: string;
}) {
  const [state, formAction, pending] = useActionState<State, FormData>(action, {});

  useEffect(() => {
    if (state.redirectTo) {
      window.location.href = state.redirectTo;
    }
  }, [state.redirectTo]);

  return (
    <form action={formAction} className="space-y-6">
      {initial?.id && <input type="hidden" name="id" value={initial.id} />}

      <div>
        <label className="text-[10px] font-semibold text-white/40 uppercase tracking-widest mb-1 block">
          List Name
        </label>
        <input
          type="text"
          name="name"
          defaultValue={initial?.name ?? ""}
          className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:border-[#C9A84C]"
          required
        />
      </div>

      {employees.length > 0 && <div>
        <label className="text-[10px] font-semibold text-white/40 uppercase tracking-widest mb-1 block">
          Assign to admin team member (optional)
        </label>
        <select
          name="assigned_admin_user_id"
          defaultValue={initial?.assigned_admin_user_id ?? ""}
          className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:border-[#C9A84C]"
        >
          <option value="">- Unassigned -</option>
          {employees.map((emp) => (
            <option key={emp.id} value={emp.id}>
              {emp.name}
            </option>
          ))}
        </select>
      </div>}

      <div>
        {state.error && <p className="text-[12px] text-red-300">{state.error}</p>}
        <button
          type="submit"
          disabled={pending}
          className="w-full py-3.5 rounded-xl font-bold text-sm text-[#050E21] disabled:opacity-60"
          style={{ background: "linear-gradient(135deg,#9C7A2A,#C9A84C,#E8CC7A)" }}
        >
          {pending ? pendingLabel : submitLabel}
        </button>
      </div>
    </form>
  );
}
