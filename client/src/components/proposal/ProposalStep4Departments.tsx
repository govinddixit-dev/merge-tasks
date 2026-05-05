/**
 * ProposalStep4Departments
 * Step 4 of the Create Proposal wizard — Department Routing (conditional)
 */

import { Plus, X, Edit3, Trash2, Check, ChevronRight } from "lucide-react";

export interface Department {
  id: string;
  name: string;
  desc: string;
  contact: string;
  email: string;
  isCustom?: boolean;
}

interface Props {
  departments: Department[];
  enabledDepts: Set<string>;
  deptOrder: string[];
  requireSequential: boolean;
  setRequireSequential: (v: boolean) => void;
  editingDept: string | null;
  editName: string; setEditName: (v: string) => void;
  editDesc: string; setEditDesc: (v: string) => void;
  editContact: string; setEditContact: (v: string) => void;
  editEmail: string; setEditEmail: (v: string) => void;
  showAddDept: boolean; setShowAddDept: (v: boolean) => void;
  newDeptName: string; setNewDeptName: (v: string) => void;
  newDeptDesc: string; setNewDeptDesc: (v: string) => void;
  newDeptContact: string; setNewDeptContact: (v: string) => void;
  newDeptEmail: string; setNewDeptEmail: (v: string) => void;
  onToggleDept: (id: string) => void;
  onStartEdit: (dept: Department) => void;
  onSaveEdit: () => void;
  onCancelEdit: () => void;
  onRemoveDept: (id: string) => void;
  onAddCustomDept: () => void;
}

export default function ProposalStep4Departments({
  departments, enabledDepts, deptOrder, requireSequential, setRequireSequential,
  editingDept, editName, setEditName, editDesc, setEditDesc, editContact, setEditContact, editEmail, setEditEmail,
  showAddDept, setShowAddDept, newDeptName, setNewDeptName, newDeptDesc, setNewDeptDesc,
  newDeptContact, setNewDeptContact, newDeptEmail, setNewDeptEmail,
  onToggleDept, onStartEdit, onSaveEdit, onCancelEdit, onRemoveDept, onAddCustomDept,
}: Props) {
  return (
    <div className="bg-white rounded-xl border border-mt-border p-8 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-[18px] font-bold text-mt-ink mb-1">Department Routing</h2>
          <p className="text-[13px] text-mt-ink-3">Select and configure which departments review this proposal</p>
        </div>
        <button onClick={() => setShowAddDept(true)} className="flex items-center gap-2 px-3 py-2 rounded-lg text-[12px] font-semibold border border-mt-border text-mt-ink-2 hover:bg-mt-surface">
          <Plus size={12} /> Add Department
        </button>
      </div>

      {showAddDept && (
        <div className="p-5 bg-mt-brand-light rounded-xl border border-primary/20 space-y-3">
          <div className="flex items-center justify-between mb-1">
            <p className="text-[13px] font-semibold text-primary">Add Custom Department</p>
            <button onClick={() => setShowAddDept(false)} className="text-mt-ink-4 hover:text-mt-ink-2"><X size={14} /></button>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-[10px] font-semibold text-mt-ink-2 mb-1">Department Name *</label>
              <input className="w-full px-3 py-2 text-[12px] border border-mt-border rounded-lg focus:border-primary outline-none bg-white" placeholder="e.g., Operations" value={newDeptName} onChange={(e) => setNewDeptName(e.target.value)} />
            </div>
            <div>
              <label className="block text-[10px] font-semibold text-mt-ink-2 mb-1">Description</label>
              <input className="w-full px-3 py-2 text-[12px] border border-mt-border rounded-lg focus:border-primary outline-none bg-white" placeholder="e.g., Logistics review" value={newDeptDesc} onChange={(e) => setNewDeptDesc(e.target.value)} />
            </div>
            <div>
              <label className="block text-[10px] font-semibold text-mt-ink-2 mb-1">Contact Person</label>
              <input className="w-full px-3 py-2 text-[12px] border border-mt-border rounded-lg focus:border-primary outline-none bg-white" placeholder="e.g., Jane Smith" value={newDeptContact} onChange={(e) => setNewDeptContact(e.target.value)} />
            </div>
            <div>
              <label className="block text-[10px] font-semibold text-mt-ink-2 mb-1">Contact Email</label>
              <input type="email" className="w-full px-3 py-2 text-[12px] border border-mt-border rounded-lg focus:border-primary outline-none bg-white" placeholder="e.g., jane@acme.com" value={newDeptEmail} onChange={(e) => setNewDeptEmail(e.target.value)} />
            </div>
          </div>
          <div className="flex justify-end">
            <button onClick={onAddCustomDept} disabled={!newDeptName.trim()} className="flex items-center gap-2 px-4 py-2 rounded-lg text-[12px] font-semibold text-white disabled:opacity-40" style={{ backgroundColor: 'var(--mt-brand)' }}>
              <Plus size={12} /> Add Department
            </button>
          </div>
        </div>
      )}

      <div className="flex items-center justify-between p-4 bg-mt-surface rounded-lg border border-mt-border">
        <div>
          <p className="text-[13px] font-semibold text-mt-ink">Sequential Approval</p>
          <p className="text-[11px] text-mt-ink-3">Departments must approve in order (vs. parallel)</p>
        </div>
        <button onClick={() => setRequireSequential(!requireSequential)} className={`relative w-11 h-6 rounded-full transition-colors ${requireSequential ? 'bg-primary' : 'bg-mt-border-2'}`}>
          <span className={`absolute top-0.5 left-0.5 w-5 h-5 bg-white rounded-full shadow transition-transform ${requireSequential ? 'translate-x-5' : 'translate-x-0'}`} />
        </button>
      </div>

      <div className="grid grid-cols-2 gap-3">
        {departments.map((dept) => {
          const isEnabled = enabledDepts.has(dept.id);
          const orderIdx = deptOrder.indexOf(dept.id);
          const isEditing = editingDept === dept.id;

          if (isEditing) {
            return (
              <div key={dept.id} className="p-4 rounded-xl border-2 border-primary bg-mt-brand-light/50 space-y-3">
                <div className="flex items-center justify-between">
                  <p className="text-[11px] font-semibold text-primary">Editing Department</p>
                  <div className="flex gap-1">
                    <button onClick={onSaveEdit} className="text-[10px] font-semibold px-2 py-1 rounded bg-primary text-white">Save</button>
                    <button onClick={onCancelEdit} className="text-[10px] font-semibold px-2 py-1 rounded bg-[#E5E5E5] text-mt-ink-2">Cancel</button>
                  </div>
                </div>
                <input className="w-full px-3 py-1.5 text-[12px] border border-mt-border rounded-lg focus:border-primary outline-none" placeholder="Department Name" value={editName} onChange={(e) => setEditName(e.target.value)} />
                <input className="w-full px-3 py-1.5 text-[12px] border border-mt-border rounded-lg focus:border-primary outline-none" placeholder="Description" value={editDesc} onChange={(e) => setEditDesc(e.target.value)} />
                <input className="w-full px-3 py-1.5 text-[12px] border border-mt-border rounded-lg focus:border-primary outline-none" placeholder="Contact Person" value={editContact} onChange={(e) => setEditContact(e.target.value)} />
                <input type="email" className="w-full px-3 py-1.5 text-[12px] border border-mt-border rounded-lg focus:border-primary outline-none" placeholder="Contact Email" value={editEmail} onChange={(e) => setEditEmail(e.target.value)} />
              </div>
            );
          }

          return (
            <div key={dept.id} className={`p-4 rounded-xl border-2 text-left transition-all ${isEnabled ? "border-primary bg-mt-brand-light/50" : "border-mt-border hover:border-mt-border-2"}`}>
              <div className="flex items-center justify-between mb-2">
                <div className="flex items-center gap-2">
                  {isEnabled && requireSequential && (
                    <span className="w-5 h-5 rounded-full bg-primary text-white text-[10px] font-bold flex items-center justify-center">{orderIdx + 1}</span>
                  )}
                  <p className="text-[13px] font-semibold text-mt-ink">{dept.name}</p>
                  {dept.isCustom && <span className="text-[8px] font-bold px-1.5 py-0.5 rounded bg-[#D97706]/10 text-[#D97706] uppercase">Custom</span>}
                </div>
                <div className="flex items-center gap-1.5">
                  <button onClick={(e) => { e.stopPropagation(); onStartEdit(dept); }} className="w-6 h-6 rounded flex items-center justify-center text-mt-ink-4 hover:text-primary hover:bg-mt-brand-light"><Edit3 size={11} /></button>
                  <button onClick={(e) => { e.stopPropagation(); onRemoveDept(dept.id); }} className="w-6 h-6 rounded flex items-center justify-center text-mt-ink-4 hover:text-[#DC2626] hover:bg-[#FEF2F2]"><Trash2 size={11} /></button>
                  <button onClick={() => onToggleDept(dept.id)} className={`w-5 h-5 rounded-full flex items-center justify-center ${isEnabled ? "bg-primary" : "border-2 border-mt-border-2"}`}>
                    {isEnabled && <Check size={10} className="text-white" />}
                  </button>
                </div>
              </div>
              <p className="text-[11px] text-mt-ink-3">{dept.desc}</p>
              <p className="text-[10px] text-mt-ink-4 mt-1">Contact: {dept.contact}{dept.email ? ` · ${dept.email}` : ""}</p>
            </div>
          );
        })}
      </div>

      {enabledDepts.size > 0 && (
        <div className="p-4 bg-mt-brand-light rounded-lg">
          <p className="text-[12px] font-semibold text-primary mb-2">
            Routing: {requireSequential ? "Sequential" : "Parallel"} · {enabledDepts.size} department{enabledDepts.size > 1 ? "s" : ""}
          </p>
          <div className="flex items-center gap-2 flex-wrap">
            {deptOrder.map((id, i) => {
              const dept = departments.find(d => d.id === id);
              return dept ? (
                <div key={id} className="flex items-center gap-1.5">
                  <span className="text-[11px] font-semibold px-2.5 py-1 rounded bg-white text-primary">{dept.name}</span>
                  {i < deptOrder.length - 1 && (requireSequential ? <ChevronRight size={12} className="text-primary" /> : <span className="text-[10px] text-primary">+</span>)}
                </div>
              ) : null;
            })}
          </div>
        </div>
      )}
    </div>
  );
}
