/**
 * ProposalStep1ClientScope
 * Step 1 of the Create Proposal wizard — Client selection & proposal scope
 */

import {
  Building2, UserPlus, UserCheck, Search, X, Check, CheckCircle2,
  ChevronDown, Mail, Store, Users, CreditCard, AlertCircle, Clock,
  Package, Printer, Star,
} from "lucide-react";
import { toast } from "sonner";

interface Client {
  id: string;
  name: string;
  company: string;
  email: string;
  phone: string;
  address: string;
  hasWebstore: boolean;
  webstoreName?: string;
  webstoreSlug?: string;
  pocName?: string;
}

interface Props {
  // Client mode
  clientMode: "existing" | "new";
  setClientMode: (m: "existing" | "new") => void;
  selectedClient: Client | null;
  setSelectedClient: (c: Client | null) => void;
  clientSearch: string;
  setClientSearch: (s: string) => void;
  showClientDropdown: boolean;
  setShowClientDropdown: (v: boolean) => void;
  filteredClients: Client[];
  // New client fields
  newClientName: string; setNewClientName: (v: string) => void;
  newClientTitle: string; setNewClientTitle: (v: string) => void;
  newClientEmail: string; setNewClientEmail: (v: string) => void;
  newClientPhone: string; setNewClientPhone: (v: string) => void;
  newClientCompany: string; setNewClientCompany: (v: string) => void;
  newClientIndustry: string; setNewClientIndustry: (v: string) => void;
  newClientSize: string; setNewClientSize: (v: string) => void;
  newClientWebsite: string; setNewClientWebsite: (v: string) => void;
  newClientAddress: string; setNewClientAddress: (v: string) => void;
  createWebstoreForNew: boolean; setCreateWebstoreForNew: (v: boolean) => void;
  newStoreType: "permanent" | "popup"; setNewStoreType: (v: "permanent" | "popup") => void;
  // Shared proposal fields
  proposalTitle: string; setProposalTitle: (v: string) => void;
  budget: string; setBudget: (v: string) => void;
  proposalType: "promo" | "print" | "both"; setProposalType: (v: "promo" | "print" | "both") => void;
  deliverEmail: boolean; setDeliverEmail: (v: boolean) => void;
  deliverWebstore: boolean; setDeliverWebstore: (v: boolean) => void;
  clientHasWebstore: boolean;
  clientWebstoreName: string;
  multiDeptEnabled: boolean; setMultiDeptEnabled: (v: boolean) => void;
  stripeCheckoutEnabled: boolean; setStripeCheckoutEnabled: (v: boolean) => void;
  approvalLinkExpiryEnabled: boolean; setApprovalLinkExpiryEnabled: (v: boolean) => void;
  validDays: number; setValidDays: (v: number) => void;
}

export default function ProposalStep1ClientScope({
  clientMode, setClientMode, selectedClient, setSelectedClient,
  clientSearch, setClientSearch, showClientDropdown, setShowClientDropdown,
  filteredClients,
  newClientName, setNewClientName, newClientTitle, setNewClientTitle,
  newClientEmail, setNewClientEmail, newClientPhone, setNewClientPhone,
  newClientCompany, setNewClientCompany, newClientIndustry, setNewClientIndustry,
  newClientSize, setNewClientSize, newClientWebsite, setNewClientWebsite,
  newClientAddress, setNewClientAddress,
  createWebstoreForNew, setCreateWebstoreForNew, newStoreType, setNewStoreType,
  proposalTitle, setProposalTitle, budget, setBudget,
  proposalType, setProposalType,
  deliverEmail, setDeliverEmail, deliverWebstore, setDeliverWebstore,
  clientHasWebstore, clientWebstoreName,
  multiDeptEnabled, setMultiDeptEnabled,
  stripeCheckoutEnabled, setStripeCheckoutEnabled,
  approvalLinkExpiryEnabled, setApprovalLinkExpiryEnabled,
  validDays, setValidDays,
}: Props) {
  return (
    <div className="bg-white rounded-xl border border-mt-border p-8 space-y-6">
      <div>
        <h2 className="text-[18px] font-bold text-mt-ink mb-1">Client &amp; Scope</h2>
        <p className="text-[13px] text-mt-ink-3">Select or add a client, define the proposal type and budget</p>
      </div>

      {/* New / Existing Toggle */}
      <div className="flex gap-3">
        <button
          onClick={() => { setClientMode("existing"); setSelectedClient(null); }}
          className={`flex-1 flex items-center gap-3 p-4 rounded-xl border-2 transition-all ${clientMode === "existing" ? "border-primary bg-mt-brand-light" : "border-mt-border hover:border-mt-border-2"}`}
        >
          <UserCheck size={18} className={clientMode === "existing" ? "text-primary" : "text-mt-ink-4"} />
          <div className="text-left">
            <p className="text-[13px] font-semibold text-mt-ink">Existing Client</p>
            <p className="text-[11px] text-mt-ink-3">Select from your client database</p>
          </div>
        </button>
        <button
          onClick={() => { setClientMode("new"); setSelectedClient(null); }}
          className={`flex-1 flex items-center gap-3 p-4 rounded-xl border-2 transition-all ${clientMode === "new" ? "border-primary bg-mt-brand-light" : "border-mt-border hover:border-mt-border-2"}`}
        >
          <UserPlus size={18} className={clientMode === "new" ? "text-primary" : "text-mt-ink-4"} />
          <div className="text-left">
            <p className="text-[13px] font-semibold text-mt-ink">New Client</p>
            <p className="text-[11px] text-mt-ink-3">Add a new client to your database</p>
          </div>
        </button>
      </div>

      {/* Existing Client Search */}
      {clientMode === "existing" && (
        <div className="space-y-3">
          <label className="block text-[12px] font-semibold text-mt-ink-2">Search Clients</label>
          <div className="relative">
            <div className="flex items-center gap-3 px-4 py-3 bg-mt-surface rounded-lg border border-mt-border cursor-pointer" onClick={(e) => { if ((e.target as HTMLElement).tagName !== 'INPUT') setShowClientDropdown(!showClientDropdown); }}>
              <Search size={14} className="text-mt-ink-4" />
              {selectedClient ? (
                <div className="flex-1 flex items-center justify-between">
                  <div>
                    <span className="text-[13px] font-semibold text-mt-ink">{selectedClient.name}</span>
                    <span className="text-[12px] text-mt-ink-3 ml-2">— {selectedClient.company}</span>
                  </div>
                  <button onClick={(e) => { e.stopPropagation(); setSelectedClient(null); setClientSearch(""); }} className="text-mt-ink-4 hover:text-mt-ink-2"><X size={14} /></button>
                </div>
              ) : (
                <input
                  className="flex-1 text-[13px] outline-none bg-transparent"
                  placeholder="Search by name, company, or email..."
                  value={clientSearch}
                  onChange={(e) => { setClientSearch(e.target.value); setShowClientDropdown(true); }}
                  onClick={(e) => { e.stopPropagation(); setShowClientDropdown(true); }}
                  onFocus={() => setShowClientDropdown(true)}
                />
              )}
              <ChevronDown size={14} className="text-mt-ink-4" />
            </div>

            {showClientDropdown && !selectedClient && (
              <div className="absolute z-20 top-full mt-1 w-full bg-white rounded-xl border border-mt-border shadow-lg max-h-64 overflow-y-auto">
                {filteredClients.length === 0 ? (
                  <div className="p-4 text-center text-[12px] text-mt-ink-4">No clients found</div>
                ) : (
                  filteredClients.map(c => (
                    <button
                      key={c.id}
                      onClick={() => { setSelectedClient(c); setShowClientDropdown(false); setClientSearch(""); }}
                      className="w-full flex items-center gap-3 px-4 py-3 hover:bg-mt-brand-light transition-colors text-left border-b border-[#F5F5F5] last:border-0"
                    >
                      <div className="w-8 h-8 rounded-full bg-mt-brand-light flex items-center justify-center flex-shrink-0">
                        <span className="text-[11px] font-bold text-primary">{c.name.split(" ").map((n: string) => n[0]).join("")}</span>
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <p className="text-[13px] font-semibold text-mt-ink truncate">{c.name}</p>
                          {c.hasWebstore && (
                            <span className="text-[8px] font-bold px-1.5 py-0.5 rounded bg-[#16A34A]/10 text-[#16A34A] uppercase flex-shrink-0">Has Store</span>
                          )}
                        </div>
                        <p className="text-[11px] text-mt-ink-3 truncate">{c.company} · {c.email}</p>
                      </div>
                    </button>
                  ))
                )}
              </div>
            )}
          </div>

          {selectedClient && (
            <div className="p-4 bg-mt-brand-light/50 rounded-xl border border-primary/20 space-y-3">
              <div className="flex items-center gap-2 mb-1">
                <CheckCircle2 size={14} className="text-[#16A34A]" />
                <p className="text-[12px] font-semibold text-[#16A34A]">Client information auto-filled</p>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <p className="text-[10px] font-semibold text-mt-ink-3 uppercase mb-0.5">Contact</p>
                  <p className="text-[13px] text-mt-ink">{selectedClient.name}</p>
                </div>
                <div>
                  <p className="text-[10px] font-semibold text-mt-ink-3 uppercase mb-0.5">Company</p>
                  <p className="text-[13px] text-mt-ink">{selectedClient.company}</p>
                </div>
                <div>
                  <p className="text-[10px] font-semibold text-mt-ink-3 uppercase mb-0.5">Email</p>
                  <p className={`text-[13px] ${selectedClient.email ? 'text-mt-ink' : 'text-mt-ink-4 italic'}`}>{selectedClient.email || "Not provided"}</p>
                </div>
                <div>
                  <p className="text-[10px] font-semibold text-mt-ink-3 uppercase mb-0.5">Phone</p>
                  <p className={`text-[13px] ${selectedClient.phone ? 'text-mt-ink' : 'text-mt-ink-4 italic'}`}>{selectedClient.phone || "Not provided"}</p>
                </div>
                <div className="col-span-2">
                  <p className="text-[10px] font-semibold text-mt-ink-3 uppercase mb-0.5">Address</p>
                  <p className="text-[13px] text-mt-ink">{selectedClient.address}</p>
                </div>
              </div>
            </div>
          )}
        </div>
      )}

      {/* New Client Form */}
      {clientMode === "new" && (
        <div className="space-y-5 p-5 bg-mt-surface rounded-xl border border-mt-border">
          {/* Primary Contact */}
          <div>
            <p className="text-[12px] font-semibold text-mt-ink-2 flex items-center gap-2 mb-3"><UserPlus size={13} className="text-primary" /> Primary Contact</p>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-[10px] font-semibold text-mt-ink-2 mb-1">Full Name *</label>
                <input className="w-full px-3 py-2.5 text-[13px] border border-mt-border rounded-lg focus:border-primary focus:ring-1 focus:ring-primary outline-none bg-white" placeholder="e.g., Sarah Chen" value={newClientName} onChange={(e) => setNewClientName(e.target.value)} />
              </div>
              <div>
                <label className="block text-[10px] font-semibold text-mt-ink-2 mb-1">Title / Role</label>
                <input className="w-full px-3 py-2.5 text-[13px] border border-mt-border rounded-lg focus:border-primary focus:ring-1 focus:ring-primary outline-none bg-white" placeholder="e.g., Marketing Director" value={newClientTitle} onChange={(e) => setNewClientTitle(e.target.value)} />
              </div>
              <div>
                <label className="block text-[10px] font-semibold text-mt-ink-2 mb-1">Email *</label>
                <input className="w-full px-3 py-2.5 text-[13px] border border-mt-border rounded-lg focus:border-primary focus:ring-1 focus:ring-primary outline-none bg-white" placeholder="e.g., sarah@acmecorp.com" value={newClientEmail} onChange={(e) => setNewClientEmail(e.target.value)} />
              </div>
              <div>
                <label className="block text-[10px] font-semibold text-mt-ink-2 mb-1">Phone</label>
                <input className="w-full px-3 py-2.5 text-[13px] border border-mt-border rounded-lg focus:border-primary focus:ring-1 focus:ring-primary outline-none bg-white" placeholder="e.g., (415) 555-0142" value={newClientPhone} onChange={(e) => setNewClientPhone(e.target.value)} />
              </div>
            </div>
          </div>

          <div className="border-t border-mt-border" />

          {/* Company Details */}
          <div>
            <p className="text-[12px] font-semibold text-mt-ink-2 flex items-center gap-2 mb-3"><Building2 size={13} className="text-primary" /> Company Details</p>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-[10px] font-semibold text-mt-ink-2 mb-1">Company Name *</label>
                <input className="w-full px-3 py-2.5 text-[13px] border border-mt-border rounded-lg focus:border-primary focus:ring-1 focus:ring-primary outline-none bg-white" placeholder="e.g., Acme Corp" value={newClientCompany} onChange={(e) => setNewClientCompany(e.target.value)} />
              </div>
              <div>
                <label className="block text-[10px] font-semibold text-mt-ink-2 mb-1">Industry</label>
                <select className="w-full px-3 py-2.5 text-[13px] border border-mt-border rounded-lg focus:border-primary focus:ring-1 focus:ring-primary outline-none bg-white" value={newClientIndustry} onChange={(e) => setNewClientIndustry(e.target.value)}>
                  <option value="">Select industry...</option>
                  <option value="technology">Technology</option>
                  <option value="healthcare">Healthcare</option>
                  <option value="finance">Finance & Banking</option>
                  <option value="education">Education</option>
                  <option value="manufacturing">Manufacturing</option>
                  <option value="retail">Retail & E-Commerce</option>
                  <option value="media">Media & Entertainment</option>
                  <option value="nonprofit">Non-Profit</option>
                  <option value="government">Government</option>
                  <option value="hospitality">Hospitality</option>
                  <option value="real-estate">Real Estate</option>
                  <option value="other">Other</option>
                </select>
              </div>
              <div>
                <label className="block text-[10px] font-semibold text-mt-ink-2 mb-1">Company Size</label>
                <select className="w-full px-3 py-2.5 text-[13px] border border-mt-border rounded-lg focus:border-primary focus:ring-1 focus:ring-primary outline-none bg-white" value={newClientSize} onChange={(e) => setNewClientSize(e.target.value)}>
                  <option value="">Select size...</option>
                  <option value="1-50">1–50 employees</option>
                  <option value="51-200">51–200 employees</option>
                  <option value="201-1000">201–1,000 employees</option>
                  <option value="1001-5000">1,001–5,000 employees</option>
                  <option value="5001+">5,001+ employees</option>
                </select>
              </div>
              <div>
                <label className="block text-[10px] font-semibold text-mt-ink-2 mb-1">Website</label>
                <input className="w-full px-3 py-2.5 text-[13px] border border-mt-border rounded-lg focus:border-primary focus:ring-1 focus:ring-primary outline-none bg-white" placeholder="e.g., https://acmecorp.com" value={newClientWebsite} onChange={(e) => setNewClientWebsite(e.target.value)} />
              </div>
              <div className="col-span-2">
                <label className="block text-[10px] font-semibold text-mt-ink-2 mb-1">Address</label>
                <input className="w-full px-3 py-2.5 text-[13px] border border-mt-border rounded-lg focus:border-primary focus:ring-1 focus:ring-primary outline-none bg-white" placeholder="e.g., 100 Market St, San Francisco, CA 94105" value={newClientAddress} onChange={(e) => setNewClientAddress(e.target.value)} />
              </div>
            </div>
          </div>

          <div className="border-t border-mt-border" />

          {/* Create Webstore Toggle */}
          <div>
            <div className="flex items-center justify-between p-4 bg-white rounded-lg border border-mt-border">
              <div className="flex items-center gap-3">
                <Store size={16} className="text-primary" />
                <div>
                  <p className="text-[13px] font-semibold text-mt-ink">Create a Webstore for this client</p>
                  <p className="text-[11px] text-mt-ink-3">Set up a branded store so the client can browse and order products online</p>
                </div>
              </div>
              <button onClick={() => setCreateWebstoreForNew(!createWebstoreForNew)} className={`relative w-11 h-6 rounded-full transition-colors ${createWebstoreForNew ? 'bg-primary' : 'bg-mt-border-2'}`}>
                <span className={`absolute top-0.5 left-0.5 w-5 h-5 bg-white rounded-full shadow transition-transform ${createWebstoreForNew ? 'translate-x-5' : 'translate-x-0'}`} />
              </button>
            </div>
            {createWebstoreForNew && (
              <div className="mt-3 p-4 bg-mt-brand-light rounded-lg border border-mt-border space-y-3">
                <p className="text-[11px] font-semibold text-primary">Webstore will be created after proposal is sent</p>
                <div className="flex gap-3">
                  <button onClick={() => setNewStoreType("permanent")} className={`flex-1 p-3 rounded-lg border-2 text-left transition-all ${newStoreType === "permanent" ? "border-primary bg-white" : "border-mt-border bg-white hover:border-mt-border-2"}`}>
                    <p className="text-[12px] font-semibold text-mt-ink">Permanent Store</p>
                    <p className="text-[10px] text-mt-ink-3">Always-on company store</p>
                  </button>
                  <button onClick={() => setNewStoreType("popup")} className={`flex-1 p-3 rounded-lg border-2 text-left transition-all ${newStoreType === "popup" ? "border-primary bg-white" : "border-mt-border bg-white hover:border-mt-border-2"}`}>
                    <p className="text-[12px] font-semibold text-mt-ink">Pop-Up Shop</p>
                    <p className="text-[10px] text-mt-ink-3">Time-limited campaign store</p>
                  </button>
                </div>
                <p className="text-[10px] text-mt-ink-3">The store URL will be: <span className="font-mono text-primary">{newClientCompany ? newClientCompany.toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '') : 'company-name'}.mergetasks.store</span></p>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Proposal Title & Budget */}
      <div className="grid grid-cols-2 gap-4">
        <div>
          <label className="block text-[12px] font-semibold text-mt-ink-2 mb-1.5">Proposal Title *</label>
          <input className="w-full px-4 py-2.5 text-[13px] border border-mt-border rounded-lg focus:border-primary focus:ring-1 focus:ring-primary outline-none" placeholder="e.g., Q2 Employee Appreciation Kit" value={proposalTitle} onChange={(e) => setProposalTitle(e.target.value)} />
        </div>
        <div>
          <label className="block text-[12px] font-semibold text-mt-ink-2 mb-1.5">Budget Range</label>
          <input className="w-full px-4 py-2.5 text-[13px] border border-mt-border rounded-lg focus:border-primary focus:ring-1 focus:ring-primary outline-none" placeholder="e.g., $10,000 - $25,000" value={budget} onChange={(e) => setBudget(e.target.value)} />
        </div>
      </div>

      {/* Proposal Type */}
      <div>
        <label className="block text-[12px] font-semibold text-mt-ink-2 mb-3">Proposal Type</label>
        <div className="grid grid-cols-3 gap-3">
          {([
            { id: "promo" as const, label: "Promotional Only", icon: Package, desc: "Branded merchandise and swag" },
            { id: "print" as const, label: "Print Only", icon: Printer, desc: "Business cards, brochures, banners" },
            { id: "both" as const, label: "Promo + Print", icon: Star, desc: "Combined promotional and print" },
          ]).map((type) => {
            const Icon = type.icon;
            return (
              <button key={type.id} onClick={() => setProposalType(type.id)} className={`p-4 rounded-xl border-2 text-left transition-all ${proposalType === type.id ? "border-primary bg-mt-brand-light" : "border-mt-border hover:border-mt-border-2"}`}>
                <Icon size={18} className={proposalType === type.id ? "text-primary" : "text-mt-ink-4"} />
                <p className="text-[13px] font-semibold text-mt-ink mt-2">{type.label}</p>
                <p className="text-[11px] text-mt-ink-3">{type.desc}</p>
              </button>
            );
          })}
        </div>
      </div>

      {/* Delivery Options */}
      <div>
        <label className="block text-[12px] font-semibold text-mt-ink-2 mb-3">Delivery Method</label>
        <div className="space-y-3">
          <div className="flex items-center justify-between p-4 bg-mt-surface rounded-lg border border-mt-border">
            <div className="flex items-center gap-3">
              <Mail size={16} className="text-primary" />
              <div>
                <p className="text-[13px] font-semibold text-mt-ink">Send via Email</p>
                <p className="text-[11px] text-mt-ink-3">Client receives a direct link to the proposal via email</p>
              </div>
            </div>
            <button onClick={() => setDeliverEmail(!deliverEmail)} className={`relative w-11 h-6 rounded-full transition-colors ${deliverEmail ? 'bg-primary' : 'bg-mt-border-2'}`}>
              <span className={`absolute top-0.5 left-0.5 w-5 h-5 bg-white rounded-full shadow transition-transform ${deliverEmail ? 'translate-x-5' : 'translate-x-0'}`} />
            </button>
          </div>

          <div className={`flex items-center justify-between p-4 rounded-lg border ${clientHasWebstore ? "bg-mt-surface border-mt-border" : "bg-mt-surface-2 border-mt-border opacity-60"}`}>
            <div className="flex items-center gap-3">
              <Store size={16} className={clientHasWebstore ? "text-primary" : "text-mt-ink-4"} />
              <div>
                <p className="text-[13px] font-semibold text-mt-ink">Publish to Webstore</p>
                {clientHasWebstore ? (
                  <p className="text-[11px] text-[#16A34A]">Will appear in "{clientWebstoreName}"</p>
                ) : (
                  <p className="text-[11px] text-mt-ink-3">Select a client with a webstore to enable this</p>
                )}
              </div>
            </div>
            <button
              onClick={() => clientHasWebstore && setDeliverWebstore(!deliverWebstore)}
              disabled={!clientHasWebstore}
              className={`relative w-11 h-6 rounded-full transition-colors ${deliverWebstore && clientHasWebstore ? 'bg-primary' : 'bg-mt-border-2'}`}
            >
              <span className={`absolute top-0.5 left-0.5 w-5 h-5 bg-white rounded-full shadow transition-transform ${deliverWebstore && clientHasWebstore ? 'translate-x-5' : 'translate-x-0'}`} />
            </button>
          </div>

          {!deliverEmail && !deliverWebstore && (
            <p className="text-[11px] text-[#DC2626] flex items-center gap-1.5"><AlertCircle size={12} /> At least one delivery method must be enabled</p>
          )}
        </div>
      </div>

      {/* Multi-Department Toggle */}
      <div className="flex items-center justify-between p-4 bg-mt-surface rounded-lg border border-mt-border">
        <div>
          <div className="flex items-center gap-2 mb-0.5">
            <Users size={15} className="text-primary" />
            <p className="text-[13px] font-semibold text-mt-ink">Multi-Department Routing</p>
          </div>
          <p className="text-[11px] text-mt-ink-3 ml-[23px]">Route this proposal through multiple departments for approval</p>
        </div>
        <button onClick={() => setMultiDeptEnabled(!multiDeptEnabled)} className={`relative w-11 h-6 rounded-full transition-colors ${multiDeptEnabled ? 'bg-primary' : 'bg-mt-border-2'}`}>
          <span className={`absolute top-0.5 left-0.5 w-5 h-5 bg-white rounded-full shadow transition-transform ${multiDeptEnabled ? 'translate-x-5' : 'translate-x-0'}`} />
        </button>
      </div>

      {/* Approval Link Expiry Toggle — only relevant when multi-department is on */}
      {multiDeptEnabled && (
        <div className="flex items-center justify-between p-4 bg-mt-surface rounded-lg border border-mt-border">
          <div>
            <div className="flex items-center gap-2 mb-0.5">
              <Clock size={15} className="text-primary" />
              <p className="text-[13px] font-semibold text-mt-ink">Enable Approval Link Expiry</p>
            </div>
            <p className="text-[11px] text-mt-ink-3 ml-[23px]">Department approval links expire 72 hours after issuance. You can resend to refresh them.</p>
          </div>
          <button onClick={() => setApprovalLinkExpiryEnabled(!approvalLinkExpiryEnabled)} className={`relative w-11 h-6 rounded-full transition-colors ${approvalLinkExpiryEnabled ? 'bg-primary' : 'bg-mt-border-2'}`}>
            <span className={`absolute top-0.5 left-0.5 w-5 h-5 bg-white rounded-full shadow transition-transform ${approvalLinkExpiryEnabled ? 'translate-x-5' : 'translate-x-0'}`} />
          </button>
        </div>
      )}

      {/* Stripe Checkout Toggle */}
      <div className="flex items-center justify-between p-4 bg-mt-surface rounded-lg border border-mt-border">
        <div>
          <div className="flex items-center gap-2 mb-0.5">
            <CreditCard size={15} className="text-primary" />
            <p className="text-[13px] font-semibold text-mt-ink">Enable Stripe Checkout</p>
          </div>
          <p className="text-[11px] text-mt-ink-3 ml-[23px]">Allow the client to pay directly from the proposal via Stripe</p>
        </div>
        <button onClick={() => setStripeCheckoutEnabled(!stripeCheckoutEnabled)} className={`relative w-11 h-6 rounded-full transition-colors ${stripeCheckoutEnabled ? 'bg-primary' : 'bg-mt-border-2'}`}>
          <span className={`absolute top-0.5 left-0.5 w-5 h-5 bg-white rounded-full shadow transition-transform ${stripeCheckoutEnabled ? 'translate-x-5' : 'translate-x-0'}`} />
        </button>
      </div>
      {stripeCheckoutEnabled && (
        <p className="text-[11px] text-primary bg-mt-brand-light px-3 py-2 rounded-lg -mt-2">
          A "Checkout with Stripe" button will appear on the client's proposal view. You'll see this in the Preview step.
        </p>
      )}

      {/* Proposal Validity */}
      <div>
        <label className="block text-[12px] font-semibold text-mt-ink-2 mb-3">Proposal Validity</label>
        <div className="grid grid-cols-5 gap-2">
          {[
            { value: 15, label: "15 Days" },
            { value: 30, label: "30 Days" },
            { value: 60, label: "60 Days" },
            { value: 90, label: "90 Days" },
            { value: 0, label: "No Expiration" },
          ].map((opt) => (
            <button
              key={opt.value}
              onClick={() => setValidDays(opt.value)}
              className={`px-3 py-2.5 rounded-lg text-[12px] font-semibold border-2 transition-all ${
                validDays === opt.value
                  ? "border-primary bg-mt-brand-light text-primary"
                  : "border-mt-border text-mt-ink-3 hover:border-mt-border-2"
              }`}
            >
              {opt.value === 0 ? (
                <><Clock size={12} className="inline mr-1" />{opt.label}</>
              ) : (
                opt.label
              )}
            </button>
          ))}
        </div>
        <p className="text-[11px] text-mt-ink-4 mt-2">
          {validDays === 0
            ? "This proposal will have no expiration date. Pricing and availability may change over time."
            : `The proposal will expire ${validDays} days after it is sent to the client.`}
        </p>
      </div>
    </div>
  );
}
