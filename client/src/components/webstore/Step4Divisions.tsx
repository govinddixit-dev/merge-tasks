import { useState } from "react";
import { Plus, Pencil, Trash2, X, GripVertical, Building2 } from "lucide-react";
import { useWebstore, type WebstoreDivision } from "./WebstoreContext";

interface Step4DivisionsProps {
  companyName: string;
  /**
   * Called when the user clicks "Skip for now". Clears divisions,
   * preserves the multi-division toggle, and advances the wizard —
   * all handled by the parent wizard so this component stays lean.
   */
  onSkip?: () => void;
}

function newId() {
  try {
    return crypto.randomUUID();
  } catch {
    return `d-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
  }
}

export default function Step4Divisions({ companyName, onSkip }: Step4DivisionsProps) {
  const { state, dispatch } = useWebstore();
  const enabled = state.multiDivisionEnabled;
  const divisions = state.divisions;
  const hasSso = state.ssoProvider !== "none" && state.ssoProvider !== "";

  // Multi-division routing requires SSO — if SSO is off, keep the step in
  // the flow but guide the user back to the SSO step instead of letting
  // them configure divisions that can't be routed.
  if (!hasSso) {
    const display = companyName || "this client";
    return (
      <div>
        <h2 className="text-xl font-bold text-mt-ink mb-1">How is {display} organized?</h2>
        <p className="text-[13px] text-mt-ink-3 mb-5">
          Divisions are routed by SSO. Once you pick an SSO provider on the previous step,
          you&rsquo;ll be able to set up divisions here.
        </p>
        <div className="flex items-start gap-3 p-4 rounded-md bg-mt-surface border border-mt-border">
          <Building2 size={18} className="text-mt-ink-3 mt-0.5 flex-shrink-0" />
          <div className="text-[13px] text-mt-ink-2">
            <p className="font-semibold text-mt-ink">Multi-division is disabled</p>
            <p className="text-mt-ink-3 mt-0.5">
              Go back and enable SSO (Microsoft, Google, or Okta) to turn on division routing.
            </p>
          </div>
        </div>
      </div>
    );
  }

  const [adding, setAdding] = useState(false);
  const [newName, setNewName] = useState("");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [deptDraft, setDeptDraft] = useState<Record<string, string>>({});
  const [dragId, setDragId] = useState<string | null>(null);

  const setDivisions = (next: WebstoreDivision[]) =>
    dispatch({ type: "SET_DIVISIONS", divisions: next });

  const setEnabled = (v: boolean) =>
    dispatch({ type: "SET_MULTI_DIVISION_ENABLED", enabled: v });

  const addDivision = () => {
    const name = newName.trim();
    if (!name) return;
    setDivisions([...divisions, { id: newId(), name, departments: [], pocEmail: "" }]);
    setNewName("");
    setAdding(false);
  };

  const setPocEmail = (id: string, pocEmail: string) => {
    setDivisions(divisions.map(d => d.id === id ? { ...d, pocEmail } : d));
  };

  const renameDivision = (id: string, name: string) => {
    setDivisions(divisions.map((d) => (d.id === id ? { ...d, name } : d)));
  };

  const removeDivision = (id: string) => {
    setDivisions(divisions.filter((d) => d.id !== id));
  };

  const addDepartment = (id: string) => {
    const name = (deptDraft[id] || "").trim();
    if (!name) return;
    setDivisions(
      divisions.map((d) =>
        d.id === id && !d.departments.includes(name)
          ? { ...d, departments: [...d.departments, name] }
          : d
      )
    );
    setDeptDraft({ ...deptDraft, [id]: "" });
  };

  const removeDepartment = (id: string, dept: string) => {
    setDivisions(
      divisions.map((d) =>
        d.id === id ? { ...d, departments: d.departments.filter((x) => x !== dept) } : d
      )
    );
  };

  const onDragStart = (id: string) => setDragId(id);
  const onDragOver = (e: React.DragEvent) => e.preventDefault();
  const onDrop = (overId: string) => {
    if (!dragId || dragId === overId) return;
    const from = divisions.findIndex((d) => d.id === dragId);
    const to = divisions.findIndex((d) => d.id === overId);
    if (from < 0 || to < 0) return;
    const next = [...divisions];
    const [moved] = next.splice(from, 1);
    next.splice(to, 0, moved);
    setDivisions(next);
    setDragId(null);
  };

  const display = companyName || "this client";

  return (
    <div>
      <h2 className="text-xl font-bold text-mt-ink mb-1">How is {display} organized?</h2>
      <p className="text-[13px] text-mt-ink-3 mb-3">
        Each division will see their own products and manage their own budget. Employees are assigned to divisions automatically via SSO.
      </p>
      <div className="mb-6 p-3 rounded-md bg-mt-brand-light/60 border border-primary/20 text-[12px] text-mt-ink-2">
        <strong className="text-primary">Divisions require SSO</strong> — your SSO configuration will automatically assign
        employees to their division via group or email attribute.
      </div>

      {/* Enable toggle */}
      <div className="flex items-center justify-between p-5 bg-white border border-mt-border rounded-lg mb-6">
        <div>
          <p className="text-[14px] font-semibold text-mt-ink">This client has multiple divisions</p>
          <p className="text-[12px] text-mt-ink-3 mt-0.5">
            Organize the store by division so each team has its own departments and approval flow.
          </p>
        </div>
        <button
          type="button"
          role="switch"
          aria-checked={enabled}
          onClick={() => setEnabled(!enabled)}
          className={`relative inline-flex h-6 w-11 flex-shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ${
            enabled ? "bg-primary" : "bg-[#D1D5DB]"
          }`}
        >
          <span
            aria-hidden="true"
            className={`pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow transition duration-200 ${
              enabled ? "translate-x-5" : "translate-x-0"
            }`}
          />
        </button>
      </div>

      {!enabled && (
        <div className="p-6 bg-mt-surface border border-mt-border rounded-lg text-center">
          <p className="text-[13px] text-mt-ink-3">
            A single default division will be created automatically. You can add more later from the store
            management page.
          </p>
        </div>
      )}

      {enabled && (
        <div>
          {/* Division cards */}
          {divisions.length === 0 && !adding && (
            <div className="flex flex-col items-center justify-center py-10 border border-dashed border-mt-border rounded-lg bg-white mb-4">
              <div className="w-12 h-12 rounded-full bg-mt-surface-2 flex items-center justify-center mb-3">
                <Building2 size={20} className="text-mt-ink-4" />
              </div>
              <p className="text-[13px] font-semibold text-mt-ink mb-0.5">No divisions yet</p>
              <p className="text-[12px] text-mt-ink-3">Add your first division to get started</p>
            </div>
          )}

          <div className="space-y-3">
            {divisions.map((d) => {
              const isEditing = editingId === d.id;
              return (
                <div
                  key={d.id}
                  draggable
                  onDragStart={() => onDragStart(d.id)}
                  onDragOver={onDragOver}
                  onDrop={() => onDrop(d.id)}
                  className="bg-white border border-[#E5E7EB] rounded-lg p-5 transition-all"
                  style={{ boxShadow: "0 1px 3px rgba(0,0,0,0.06)" }}
                >
                  <div className="flex items-center gap-3">
                    <button
                      type="button"
                      className="cursor-grab text-mt-ink-4 hover:text-mt-ink-2"
                      title="Drag to reorder"
                      aria-label="Drag to reorder"
                    >
                      <GripVertical size={16} />
                    </button>
                    {isEditing ? (
                      <input
                        autoFocus
                        value={d.name}
                        onChange={(e) => renameDivision(d.id, e.target.value)}
                        onBlur={() => setEditingId(null)}
                        onKeyDown={(e) => {
                          if (e.key === "Enter" || e.key === "Escape") setEditingId(null);
                        }}
                        className="flex-1 text-[15px] font-semibold text-mt-ink border-b border-primary bg-transparent outline-none"
                      />
                    ) : (
                      <h3 className="flex-1 text-[15px] font-semibold text-mt-ink">{d.name}</h3>
                    )}
                    <button
                      type="button"
                      onClick={() => setEditingId(isEditing ? null : d.id)}
                      className="p-1.5 text-mt-ink-4 hover:text-mt-ink-2 rounded transition-colors"
                      aria-label="Rename division"
                    >
                      <Pencil size={14} />
                    </button>
                    <button
                      type="button"
                      onClick={() => removeDivision(d.id)}
                      className="p-1.5 text-mt-ink-4 hover:text-red-500 rounded transition-colors"
                      aria-label="Delete division"
                    >
                      <Trash2 size={14} />
                    </button>
                  </div>

                  {/* POC Email */}
                  <div className="mt-4 pl-7">
                    <label className="block text-[11px] font-semibold text-mt-ink-2 uppercase tracking-wide mb-1.5">POC Email</label>
                    <input
                      type="email"
                      value={d.pocEmail || ""}
                      onChange={(e) => setPocEmail(d.id, e.target.value)}
                      placeholder="poc@client.com"
                      className={`w-full text-[13px] px-3 py-2 bg-white border rounded-md focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary transition-all ${
                        d.pocEmail && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(d.pocEmail) ? "border-red-400" : "border-mt-border"
                      }`}
                    />
                    <p className="text-[11px] text-mt-ink-4 mt-1">Receives a branded invite to manage this division's budget, users, and approvals.</p>
                  </div>

                  {/* Departments */}
                  <div className="mt-4 pl-7">
                    {d.departments.length > 0 && (
                      <div className="flex flex-wrap gap-2 mb-3">
                        {d.departments.map((dept) => (
                          <span
                            key={dept}
                            className="group inline-flex items-center gap-1.5 text-[12px] font-medium px-2.5 py-1 bg-[#F3F4F6] text-[#374151] rounded-md"
                          >
                            {dept}
                            <button
                              type="button"
                              onClick={() => removeDepartment(d.id, dept)}
                              className="opacity-0 group-hover:opacity-100 transition-opacity text-[#6B7280] hover:text-red-500"
                              aria-label={`Remove ${dept}`}
                            >
                              <X size={12} />
                            </button>
                          </span>
                        ))}
                      </div>
                    )}
                    <div className="flex items-center gap-2">
                      <input
                        type="text"
                        value={deptDraft[d.id] || ""}
                        onChange={(e) => setDeptDraft({ ...deptDraft, [d.id]: e.target.value })}
                        onKeyDown={(e) => {
                          if (e.key === "Enter") {
                            e.preventDefault();
                            addDepartment(d.id);
                          }
                        }}
                        placeholder="e.g. Marketing, Operations, HR, Manufacturing"
                        className="flex-1 text-[12px] px-3 py-2 bg-white border border-mt-border rounded-md focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary transition-all"
                      />
                      <button
                        type="button"
                        onClick={() => addDepartment(d.id)}
                        className="text-[12px] font-semibold text-primary hover:underline px-2 py-2"
                      >
                        Add
                      </button>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>

          {/* Add division row */}
          {adding ? (
            <div className="mt-3 bg-white border border-primary rounded-lg p-4 flex items-center gap-2">
              <input
                autoFocus
                type="text"
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    addDivision();
                  } else if (e.key === "Escape") {
                    setAdding(false);
                    setNewName("");
                  }
                }}
                placeholder="Division name (e.g. North America, EMEA, Field Operations)"
                className="flex-1 text-[13px] px-3 py-2 border border-mt-border rounded-md focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary"
              />
              <button
                type="button"
                onClick={addDivision}
                className="text-[12px] font-semibold text-white bg-primary rounded-md px-3 py-2"
              >
                Add
              </button>
              <button
                type="button"
                onClick={() => { setAdding(false); setNewName(""); }}
                className="text-[12px] font-semibold text-mt-ink-3 px-2 py-2"
              >
                Cancel
              </button>
            </div>
          ) : (
            <button
              type="button"
              onClick={() => setAdding(true)}
              className="mt-3 w-full flex items-center justify-center gap-2 border border-dashed border-primary/40 text-primary text-[13px] font-semibold rounded-lg py-3 hover:bg-mt-brand-light transition-colors"
            >
              <Plus size={14} /> Add Division
            </button>
          )}

          {onSkip && (
            <div className="mt-4 text-center">
              <button
                type="button"
                onClick={onSkip}
                className="text-[12px] text-mt-ink-3 hover:text-mt-ink-2 underline-offset-2 hover:underline focus:outline-none"
              >
                Skip for now &mdash; set up divisions in Store Management
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
