import { useState } from "react";
import { Plus, X } from "lucide-react";
import { INDUSTRIES, SSO_PROVIDERS, EMPLOYEE_DEPARTMENTS, EMPLOYEE_ROLES } from "./types";
import { useWebstore } from "./WebstoreContext";

function PocButton({ isPoc, onToggle }: { isPoc: boolean; onToggle: () => void }) {
  const [bouncing, setBouncing] = useState(false);

  const handleClick = () => {
    setBouncing(true);
    setTimeout(() => setBouncing(false), 400);
    onToggle();
  };

  return (
    <div className="relative flex items-center justify-center">

      <button
        title={isPoc ? "POC — click to remove" : "Set as POC"}
        onClick={handleClick}
        style={{
          transition: "background-color 0.25s ease, box-shadow 0.25s ease, transform 0.15s ease",
          transform: bouncing ? "scale(1.35)" : "scale(1)",
          boxShadow: isPoc ? "0 0 0 3px rgba(101,75,249,0.25)" : "none",
        }}
        className={`relative w-9 h-9 rounded-full flex items-center justify-center text-[9px] font-bold select-none cursor-pointer ${
          isPoc
            ? "bg-primary text-white"
            : "bg-[#E5E5E5] text-mt-ink-4 hover:bg-mt-border-2 hover:text-mt-ink-2"
        }`}
      >
        POC
      </button>
    </div>
  );
}

function MicrosoftIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 21 21" fill="none">
      <rect x="1" y="1" width="9" height="9" fill="#F25022" />
      <rect x="11" y="1" width="9" height="9" fill="#7FBA00" />
      <rect x="1" y="11" width="9" height="9" fill="#00A4EF" />
      <rect x="11" y="11" width="9" height="9" fill="#FFB900" />
    </svg>
  );
}

function OktaIcon() {
  return (
    <img
      src="https://d2xsxph8kpxj0f.cloudfront.net/310519663484183704/DPGaqtkDjDHo63WLPE8Ejg/pasted_file_NF4K7T_image_5375dd89.png"
      alt="Okta" width={20} height={20} style={{ objectFit: "contain" }}
    />
  );
}

function GoogleIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24">
      <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 0 1-2.2 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.1z" fill="#4285F4" />
      <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853" />
      <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="#FBBC05" />
      <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335" />
    </svg>
  );
}

function EmailIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <rect x="2" y="4" width="20" height="16" rx="2" />
      <path d="m22 7-8.97 5.7a1.94 1.94 0 0 1-2.06 0L2 7" />
    </svg>
  );
}

const SSO_ICONS: Record<string, React.FC> = {
  microsoft: MicrosoftIcon,
  okta: OktaIcon,
  google: GoogleIcon,
  none: EmailIcon,
};

interface Props {
  dbClients: Array<{ id: number; companyName: string; industry?: string | null; contactName?: string | null; contactEmail?: string | null }>;
  companyName: string;
}

export default function Step1CompanyInfo({ dbClients, companyName }: Props) {
  const { state, set, dispatch } = useWebstore();
  const { selectedClientId, pocEnabled, pocs, industry, employeeCount, ssoProvider, storeEmployees } = state;

  return (
    <div>
      <h2 className="text-xl font-bold text-mt-ink mb-1">Company Information</h2>
      <p className="text-[13px] text-mt-ink-3 mb-7">Enter your client's details to get started</p>

      <div className="space-y-5">
        <div>
          <label className="block text-[12px] font-semibold text-mt-ink-2 mb-2">Select Client *</label>
          <select
            className="w-full px-4 py-3 text-[13px] border border-mt-border rounded-lg bg-white text-mt-ink outline-none focus:border-primary transition-all"
            value={selectedClientId ?? ""}
            onChange={(e) => {
              const id = e.target.value ? Number(e.target.value) : null;
              set("selectedClientId", id);
              if (id) {
                const client = dbClients.find(c => c.id === id);
                if (client) {
                  set("industry", client.industry || "");
                  if (client.contactName) dispatch({ type: "SET_POCS", pocs: [{ name: client.contactName, email: client.contactEmail || "" }] });
                }
              }
            }}
          >
            <option value="">Select a client...</option>
            {dbClients.map(c => (
              <option key={c.id} value={c.id}>{c.companyName}</option>
            ))}
          </select>
          {dbClients.length === 0 && (
            <p className="text-[11px] text-[#D97706] mt-2">No clients found. <a href="/clients" className="text-primary underline">Add a client first</a>.</p>
          )}
        </div>

        {/* POC Toggle */}
        <div>
          <div className="flex items-center justify-between mb-3">
            <div>
              <label className="block text-[12px] font-semibold text-mt-ink-2">Point of Contact (POC)</label>
              <p className="text-[11px] text-mt-ink-4 mt-0.5">Designate one or more contacts who manage the store</p>
            </div>
            <button
              onClick={() => set("pocEnabled", !pocEnabled)}
              className={`relative w-11 h-6 rounded-full transition-colors ${pocEnabled ? "bg-primary" : "bg-mt-border-2"}`}
            >
              <span className={`absolute top-0.5 left-0.5 w-5 h-5 bg-white rounded-full shadow transition-transform ${pocEnabled ? "translate-x-5" : "translate-x-0"}`} />
            </button>
          </div>
          {pocEnabled && (
            <div className="space-y-3">
              {pocs.map((poc, idx) => (
                <div key={idx} className="flex items-start gap-3">
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 flex-1">
                    <input
                      className="w-full px-4 py-3 text-[13px] border border-mt-border rounded-lg bg-white text-mt-ink outline-none focus:border-primary focus:ring-1 focus:ring-primary transition-all"
                      placeholder="Full name"
                      value={poc.name}
                      onChange={(e) => {
                        const updated = [...pocs];
                        updated[idx] = { ...updated[idx], name: e.target.value };
                        dispatch({ type: "SET_POCS", pocs: updated });
                      }}
                    />
                    <input
                      className="w-full px-4 py-3 text-[13px] border border-mt-border rounded-lg bg-white text-mt-ink outline-none focus:border-primary focus:ring-1 focus:ring-primary transition-all"
                      placeholder="Email address"
                      value={poc.email}
                      onChange={(e) => {
                        const updated = [...pocs];
                        updated[idx] = { ...updated[idx], email: e.target.value };
                        dispatch({ type: "SET_POCS", pocs: updated });
                      }}
                    />
                  </div>
                  {pocs.length > 1 && (
                    <button
                      onClick={() => dispatch({ type: "SET_POCS", pocs: pocs.filter((_, i) => i !== idx) })}
                      className="mt-3 text-mt-ink-4 hover:text-[#EF4444] transition-colors"
                    >
                      <X size={16} />
                    </button>
                  )}
                </div>
              ))}
              <button
                onClick={() => dispatch({ type: "SET_POCS", pocs: [...pocs, { name: "", email: "" }] })}
                className="flex items-center gap-1.5 text-[12px] font-medium text-primary hover:text-primary/90 transition-colors"
              >
                <Plus size={14} />
                Add another POC
              </button>
            </div>
          )}
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">
          <div>
            <label className="block text-[12px] font-semibold text-mt-ink-2 mb-2">Industry</label>
            <select
              className="w-full px-4 py-3 text-[13px] border border-mt-border rounded-lg bg-white text-mt-ink outline-none focus:border-primary transition-all"
              value={industry}
              onChange={(e) => set("industry", e.target.value)}
            >
              <option value="">Select industry</option>
              {INDUSTRIES.map(i => <option key={i} value={i}>{i}</option>)}
            </select>
          </div>
          <div>
            <label className="block text-[12px] font-semibold text-mt-ink-2 mb-2">Employee Count</label>
            <input
              className="w-full px-4 py-3 text-[13px] border border-mt-border rounded-lg bg-white text-mt-ink outline-none focus:border-primary focus:ring-1 focus:ring-primary transition-all"
              placeholder="e.g., 2500"
              value={employeeCount}
              onChange={(e) => set("employeeCount", e.target.value)}
            />
          </div>
        </div>

        <div>
          <label className="block text-[12px] font-semibold text-mt-ink-2 mb-3">Authentication Method</label>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {SSO_PROVIDERS.map((p) => {
              const Icon = SSO_ICONS[p.id];
              return (
                <button
                  key={p.id}
                  className={`text-left p-4 rounded-lg border-2 transition-all ${ssoProvider === p.id ? "border-primary bg-mt-brand-light" : "border-mt-border hover:border-mt-border-2"}`}
                  onClick={() => set("ssoProvider", p.id)}
                >
                  <div className="flex items-center gap-3">
                    <div className="w-8 h-8 flex items-center justify-center flex-shrink-0"><Icon /></div>
                    <div>
                      <p className="text-[13px] font-semibold text-mt-ink">{p.name}</p>
                      <p className="text-[10px] text-mt-ink-4">{p.protocol}</p>
                    </div>
                  </div>
                </button>
              );
            })}
          </div>
        </div>

        {/* No-SSO: Employee Assignment */}
        {ssoProvider === "none" && (
          <div className="mt-6 pt-6 border-t border-mt-border">
            <div className="flex items-center justify-between mb-3">
              <div>
                <label className="block text-[12px] font-semibold text-mt-ink-2">Store Users</label>
                <p className="text-[11px] text-mt-ink-4 mt-0.5">Add users who will access the store. Mark one as POC (Point of Contact) for order communications.</p>
              </div>
              <button
                onClick={() => dispatch({ type: "SET_STORE_EMPLOYEES", employees: [...storeEmployees, { name: "", email: "", role: "employee", department: "marketing", isPoc: storeEmployees.length === 0 }] })}
                className="flex items-center gap-1.5 text-[12px] font-medium text-primary hover:text-primary/90 transition-colors"
              >
                <Plus size={14} /> Add User
              </button>
            </div>

            {storeEmployees.length > 0 && (
              <div className="space-y-3">
                {storeEmployees.map((emp, idx) => (
                  <div key={idx} className={`p-4 rounded-lg border ${emp.isPoc ? 'bg-mt-brand-light border-primary' : 'bg-mt-surface border-mt-border'}`}>
                    <div className="flex items-start gap-3">
                      <div className="flex-1 grid grid-cols-1 sm:grid-cols-2 gap-3">
                        <input
                          className="w-full px-3 py-2.5 text-[13px] border border-mt-border rounded-lg bg-white text-mt-ink outline-none focus:border-primary focus:ring-1 focus:ring-primary transition-all"
                          placeholder="Full name" value={emp.name}
                          onChange={(e) => { const u = [...storeEmployees]; u[idx] = { ...u[idx], name: e.target.value }; dispatch({ type: "SET_STORE_EMPLOYEES", employees: u }); }}
                        />
                        <input
                          className="w-full px-3 py-2.5 text-[13px] border border-mt-border rounded-lg bg-white text-mt-ink outline-none focus:border-primary focus:ring-1 focus:ring-primary transition-all"
                          placeholder="Email address" value={emp.email}
                          onChange={(e) => { const u = [...storeEmployees]; u[idx] = { ...u[idx], email: e.target.value }; dispatch({ type: "SET_STORE_EMPLOYEES", employees: u }); }}
                        />
                        <select
                          className="w-full px-3 py-2.5 text-[13px] border border-mt-border rounded-lg bg-white text-mt-ink outline-none focus:border-primary transition-all"
                          value={emp.department}
                          aria-label="Department"
                          onChange={(e) => { const u = [...storeEmployees]; u[idx] = { ...u[idx], department: e.target.value }; dispatch({ type: "SET_STORE_EMPLOYEES", employees: u }); }}
                        >
                          {EMPLOYEE_DEPARTMENTS.map(d => (
                            <option key={d.id} value={d.id}>{d.name}</option>
                          ))}
                        </select>
                        <select
                          className="w-full px-3 py-2.5 text-[13px] border border-mt-border rounded-lg bg-white text-mt-ink outline-none focus:border-primary transition-all"
                          value={emp.role}
                          aria-label="Role"
                          onChange={(e) => { const u = [...storeEmployees]; u[idx] = { ...u[idx], role: e.target.value }; dispatch({ type: "SET_STORE_EMPLOYEES", employees: u }); }}
                        >
                          {EMPLOYEE_ROLES.map(r => (
                            <option key={r.id} value={r.id}>{r.name}</option>
                          ))}
                        </select>
                      </div>
                      <div className="flex flex-col items-center gap-2 mt-1">
<PocButton
                          isPoc={emp.isPoc}
                          onToggle={() => {
                            const u = storeEmployees.map((e2, i2) => ({ ...e2, isPoc: i2 === idx ? !e2.isPoc : false }));
                            dispatch({ type: "SET_STORE_EMPLOYEES", employees: u });
                          }}
                        />
                        <button
                          onClick={() => dispatch({ type: "SET_STORE_EMPLOYEES", employees: storeEmployees.filter((_, i) => i !== idx) })}
                          className="text-mt-ink-4 hover:text-[#EF4444] transition-colors"
                        >
                          <X size={16} />
                        </button>
                      </div>
                    </div>
                    {emp.isPoc && (
                      <div className="mt-2 flex items-center gap-1.5">
                        <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-primary text-white">POC</span>
                        <span className="text-[10px] text-primary">Point of Contact — receives order notifications and approval requests</span>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
