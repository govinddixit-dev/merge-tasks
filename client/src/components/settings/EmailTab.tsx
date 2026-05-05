/**
 * EmailTab — Settings > Email tab
 * Manages Gmail, Outlook, and SMTP email connections.
 * Extracted from Settings.tsx for maintainability.
 */
import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { Mail, Key, Plug, Unplug, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { RequiredMark } from "@/components/ui/required-mark";
import { FieldError } from "@/components/ui/field-error";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";

export default function EmailTab() {
  const { data: connections, isLoading } = trpc.email.listConnections.useQuery();
  const connectGmail = trpc.email.connectGmail.useMutation();
  const connectOutlook = trpc.email.connectOutlook.useMutation();
  const connectSMTP = trpc.email.connectSMTP.useMutation();
  const disconnect = trpc.email.disconnect.useMutation();
  const setDefault = trpc.email.setDefault.useMutation();
  const testConn = trpc.email.testConnection.useMutation();
  const utils = trpc.useUtils();
  const [showSmtp, setShowSmtp] = useState(false);
  const [smtp, setSmtp] = useState({ email: "", displayName: "", host: "", port: 587, username: "", password: "", secure: true });
  const [smtpAttemptedSubmit, setSmtpAttemptedSubmit] = useState(false);
  const [disconnectTarget, setDisconnectTarget] = useState<{ id: number; label: string } | null>(null);

  const smtpErrors = {
    email:    !smtp.email.trim()    ? "Email address is required" : null,
    host:     !smtp.host.trim()     ? "SMTP host is required"     : null,
    username: !smtp.username.trim() ? "Username is required"      : null,
    password: !smtp.password        ? "Password is required"      : null,
  };
  const smtpHasErrors = Boolean(smtpErrors.email || smtpErrors.host || smtpErrors.username || smtpErrors.password);

  const handleConnectGmail = async () => {
    try {
      const result = await connectGmail.mutateAsync({ origin: window.location.origin });
      window.open(result.url, "_blank");
      toast.info("Complete the Google sign-in in the new tab, then return here.");
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "Failed to initiate Gmail connection";
      toast.error(message);
    }
  };

  const handleConnectOutlook = async () => {
    try {
      const result = await connectOutlook.mutateAsync({ origin: window.location.origin });
      window.open(result.url, "_blank");
      toast.info("Complete the Microsoft sign-in in the new tab, then return here.");
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "Failed to initiate Outlook connection";
      toast.error(message);
    }
  };

  const handleConnectSMTP = async () => {
    setSmtpAttemptedSubmit(true);
    if (smtpHasErrors) return;
    try {
      await connectSMTP.mutateAsync(smtp);
      toast.success("SMTP connection verified");
      setShowSmtp(false);
      setSmtp({ email: "", displayName: "", host: "", port: 587, username: "", password: "", secure: true });
      setSmtpAttemptedSubmit(false);
      utils.email.listConnections.invalidate();
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "SMTP connection failed";
      toast.error(message);
    }
  };

  const handleDisconnect = async (id: number) => {
    try {
      await disconnect.mutateAsync({ connectionId: id });
      toast.success("Email account disconnected.");
      utils.email.listConnections.invalidate();
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "Failed to disconnect email account";
      toast.error(message);
    } finally {
      setDisconnectTarget(null);
    }
  };

  const handleSetDefault = async (id: number) => {
    try {
      await setDefault.mutateAsync({ connectionId: id });
      toast.success("Default email account updated.");
      utils.email.listConnections.invalidate();
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "Failed to set default email account";
      toast.error(message);
    }
  };

  const handleTest = async (id: number) => {
    try {
      await testConn.mutateAsync({ connectionId: id });
      toast.success("Test email sent — check your inbox");
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "Test failed";
      toast.error(message);
    }
  };

  if (isLoading) {
    return (
      <div className="bg-white rounded-lg border border-mt-border p-7">
        <div className="animate-pulse space-y-4">
          <div className="h-6 bg-mt-surface-2 rounded w-48" />
          <div className="h-20 bg-mt-surface-2 rounded" />
          <div className="h-20 bg-mt-surface-2 rounded" />
        </div>
      </div>
    );
  }

  const activeConnections = connections?.filter(c => c.status === "connected") || [];

  return (
    <div>
      {/* Connected Accounts */}
      {activeConnections.length > 0 && (
        <div className="bg-white rounded-lg border border-mt-border p-7 mb-4">
          <h3 className="text-[15px] font-semibold text-mt-ink mb-2">Connected Email Accounts</h3>
          <p className="text-[12px] text-mt-ink-3 mb-5">Proposals will be sent from your default email account.</p>
          <div className="space-y-3">
            {activeConnections.map((conn) => (
              <div key={conn.id} className={`flex items-center justify-between p-4 rounded-lg border transition-all ${
                conn.isDefault ? "bg-mt-brand-light border-primary" : "bg-mt-surface border-mt-border"
              }`}>
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 flex items-center justify-center bg-white rounded-lg border border-mt-border">
                    {conn.provider === "gmail" && (
                      <svg width="20" height="20" viewBox="0 0 48 48">
                        <path d="M43.611 20.083H42V20H24v8h11.303c-1.649 4.657-6.08 8-11.303 8-6.627 0-12-5.373-12-12s5.373-12 12-12c3.059 0 5.842 1.154 7.961 3.039l5.657-5.657C34.046 6.053 29.268 4 24 4 12.955 4 4 12.955 4 24s8.955 20 20 20 20-8.955 20-20c0-1.341-.138-2.65-.389-3.917z" fill="#FFC107"/>
                        <path d="M6.306 14.691l6.571 4.819C14.655 15.108 18.961 12 24 12c3.059 0 5.842 1.154 7.961 3.039l5.657-5.657C34.046 6.053 29.268 4 24 4 16.318 4 9.656 8.337 6.306 14.691z" fill="#FF3D00"/>
                        <path d="M24 44c5.166 0 9.86-1.977 13.409-5.192l-6.19-5.238A11.91 11.91 0 0124 36c-5.202 0-9.619-3.317-11.283-7.946l-6.522 5.025C9.505 39.556 16.227 44 24 44z" fill="#4CAF50"/>
                        <path d="M43.611 20.083H42V20H24v8h11.303a12.04 12.04 0 01-4.087 5.571l.003-.002 6.19 5.238C36.971 39.205 44 34 44 24c0-1.341-.138-2.65-.389-3.917z" fill="#1976D2"/>
                      </svg>
                    )}
                    {conn.provider === "outlook" && (
                      <svg width="20" height="20" viewBox="0 0 21 21">
                        <rect x="1" y="1" width="9" height="9" fill="#F25022" />
                        <rect x="11" y="1" width="9" height="9" fill="#7FBA00" />
                        <rect x="1" y="11" width="9" height="9" fill="#00A4EF" />
                        <rect x="11" y="11" width="9" height="9" fill="#FFB900" />
                      </svg>
                    )}
                    {conn.provider === "smtp" && <Mail size={20} className="text-primary" />}
                  </div>
                  <div>
                    <div className="flex items-center gap-2">
                      <p className="text-[13px] font-semibold text-mt-ink">{conn.email}</p>
                      {conn.isDefault && (
                        <span className="px-2 py-0.5 text-[9px] font-bold uppercase bg-primary text-white rounded-full">Default</span>
                      )}
                    </div>
                    <p className="text-[11px] text-mt-ink-3 capitalize">{conn.provider}{conn.displayName ? ` • ${conn.displayName}` : ""}</p>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  {!conn.isDefault && (
                    <button onClick={() => handleSetDefault(conn.id)} className="sq-action-btn text-[10px]" style={{ border: '1px solid #E5E5E5', color: '#525252' }}>
                      Set Default
                    </button>
                  )}
                  <button onClick={() => handleTest(conn.id)} disabled={testConn.isPending} className="sq-action-btn text-[10px]" style={{ border: '1px solid #E5E5E5', color: '#525252' }}>
                    {testConn.isPending ? "Sending..." : "Test"}
                  </button>
                  <button onClick={() => setDisconnectTarget({ id: conn.id, label: conn.email ?? "this account" })} className="sq-action-btn text-[10px] text-red-500 hover:text-red-700" style={{ border: '1px solid #FCA5A5' }}>
                    <Unplug size={10} />
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Credential Setup Guidance */}
      <div className="bg-gradient-to-r from-[#F5F3FF] to-[#EDE9FE] rounded-lg border border-[#DDD6FE] p-5 mb-4">
        <div className="flex items-start gap-3">
          <div className="w-8 h-8 bg-white rounded-lg flex items-center justify-center flex-shrink-0 mt-0.5">
            <Key size={16} className="text-primary" />
          </div>
          <div>
            <h4 className="text-[13px] font-semibold text-mt-ink mb-1">OAuth Credentials Required</h4>
            <p className="text-[11px] text-mt-ink-2 leading-relaxed mb-2">
              To connect Gmail or Outlook, you need OAuth credentials from Google/Microsoft. These are set up in your project's Settings → Secrets panel.
            </p>
            <div className="space-y-1.5">
              <p className="text-[11px] text-mt-ink-2">
                <strong>Gmail:</strong> Go to <a href="https://console.cloud.google.com/apis/credentials" target="_blank" rel="noopener" className="text-primary hover:underline">Google Cloud Console</a> → Create OAuth 2.0 Client ID → Enable Gmail API → Copy Client ID & Secret.
              </p>
              <p className="text-[11px] text-mt-ink-2">
                <strong>Outlook:</strong> Go to <a href="https://portal.azure.com/#blade/Microsoft_AAD_RegisteredApps" target="_blank" rel="noopener" className="text-primary hover:underline">Azure Portal</a> → App Registrations → New Registration → Add Mail.Send permission → Copy Client ID & Secret.
              </p>
            </div>
            <p className="text-[10px] text-mt-ink-4 mt-2">Alternatively, use Custom SMTP (no OAuth needed) with services like SendGrid, Mailgun, or Amazon SES.</p>
          </div>
        </div>
      </div>

      {/* Connect New Account */}
      <div className="bg-white rounded-lg border border-mt-border p-7 mb-4">
        <h3 className="text-[15px] font-semibold text-mt-ink mb-2">Connect Email Account</h3>
        <p className="text-[12px] text-mt-ink-3 mb-6">Connect your email to send proposals directly from your business email address.</p>

        <div className="space-y-3">
          {/* Gmail */}
          <div className="flex items-center justify-between p-5 bg-mt-surface rounded-lg border border-mt-border transition-all hover:border-primary">
            <div className="flex items-center gap-4">
              <div className="w-12 h-12 flex items-center justify-center bg-white rounded-lg border border-mt-border">
                <svg width="24" height="24" viewBox="0 0 48 48">
                  <path d="M43.611 20.083H42V20H24v8h11.303c-1.649 4.657-6.08 8-11.303 8-6.627 0-12-5.373-12-12s5.373-12 12-12c3.059 0 5.842 1.154 7.961 3.039l5.657-5.657C34.046 6.053 29.268 4 24 4 12.955 4 4 12.955 4 24s8.955 20 20 20 20-8.955 20-20c0-1.341-.138-2.65-.389-3.917z" fill="#FFC107"/>
                  <path d="M6.306 14.691l6.571 4.819C14.655 15.108 18.961 12 24 12c3.059 0 5.842 1.154 7.961 3.039l5.657-5.657C34.046 6.053 29.268 4 24 4 16.318 4 9.656 8.337 6.306 14.691z" fill="#FF3D00"/>
                  <path d="M24 44c5.166 0 9.86-1.977 13.409-5.192l-6.19-5.238A11.91 11.91 0 0124 36c-5.202 0-9.619-3.317-11.283-7.946l-6.522 5.025C9.505 39.556 16.227 44 24 44z" fill="#4CAF50"/>
                  <path d="M43.611 20.083H42V20H24v8h11.303a12.04 12.04 0 01-4.087 5.571l.003-.002 6.19 5.238C36.971 39.205 44 34 44 24c0-1.341-.138-2.65-.389-3.917z" fill="#1976D2"/>
                </svg>
              </div>
              <div>
                <h4 className="text-[14px] font-bold text-mt-ink">Gmail</h4>
                <p className="text-[11px] text-mt-ink-3">Send proposals from your Gmail account via Google OAuth</p>
              </div>
            </div>
            <button onClick={handleConnectGmail} disabled={connectGmail.isPending} className="sq-action-btn primary flex items-center gap-2">
              <Plug size={12} /> {connectGmail.isPending ? "Connecting..." : "Connect Gmail"}
            </button>
          </div>

          {/* Outlook */}
          <div className="flex items-center justify-between p-5 bg-mt-surface rounded-lg border border-mt-border transition-all hover:border-primary">
            <div className="flex items-center gap-4">
              <div className="w-12 h-12 flex items-center justify-center bg-white rounded-lg border border-mt-border">
                <svg width="24" height="24" viewBox="0 0 21 21">
                  <rect x="1" y="1" width="9" height="9" fill="#F25022" />
                  <rect x="11" y="1" width="9" height="9" fill="#7FBA00" />
                  <rect x="1" y="11" width="9" height="9" fill="#00A4EF" />
                  <rect x="11" y="11" width="9" height="9" fill="#FFB900" />
                </svg>
              </div>
              <div>
                <h4 className="text-[14px] font-bold text-mt-ink">Microsoft Outlook / 365</h4>
                <p className="text-[11px] text-mt-ink-3">Send proposals from your Outlook or Microsoft 365 account</p>
              </div>
            </div>
            <button onClick={handleConnectOutlook} disabled={connectOutlook.isPending} className="sq-action-btn primary flex items-center gap-2">
              <Plug size={12} /> {connectOutlook.isPending ? "Connecting..." : "Connect Outlook"}
            </button>
          </div>

          {/* SMTP */}
          <div className="p-5 bg-mt-surface rounded-lg border border-mt-border transition-all hover:border-primary">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-4">
                <div className="w-12 h-12 flex items-center justify-center bg-white rounded-lg border border-mt-border">
                  <Mail size={24} className="text-primary" />
                </div>
                <div>
                  <h4 className="text-[14px] font-bold text-mt-ink">Custom SMTP</h4>
                  <p className="text-[11px] text-mt-ink-3">Use your own SMTP server (SendGrid, Mailgun, Amazon SES, etc.)</p>
                </div>
              </div>
              <button onClick={() => setShowSmtp(!showSmtp)} className="sq-action-btn flex items-center gap-2" style={{ border: '1px solid #E5E5E5', color: '#525252' }}>
                <Plug size={12} /> {showSmtp ? "Cancel" : "Configure"}
              </button>
            </div>
            {showSmtp && (
              <div className="mt-4 pt-4 border-t border-mt-border grid grid-cols-2 gap-3">
                <div>
                  <label className="text-[11px] font-medium text-mt-ink-2 block mb-1">Email Address<RequiredMark /></label>
                  <input value={smtp.email} onChange={e => setSmtp(s => ({ ...s, email: e.target.value }))} placeholder="you@company.com" className="w-full px-3 py-2 text-[12px] border border-mt-border rounded-lg focus:border-primary focus:outline-none" />
                  {smtpAttemptedSubmit && <FieldError message={smtpErrors.email} />}
                </div>
                <div>
                  <label className="text-[11px] font-medium text-mt-ink-2 block mb-1">Display Name</label>
                  <input value={smtp.displayName} onChange={e => setSmtp(s => ({ ...s, displayName: e.target.value }))} placeholder="Your Name" className="w-full px-3 py-2 text-[12px] border border-mt-border rounded-lg focus:border-primary focus:outline-none" />
                </div>
                <div>
                  <label className="text-[11px] font-medium text-mt-ink-2 block mb-1">SMTP Host<RequiredMark /></label>
                  <input value={smtp.host} onChange={e => setSmtp(s => ({ ...s, host: e.target.value }))} placeholder="smtp.gmail.com" className="w-full px-3 py-2 text-[12px] border border-mt-border rounded-lg focus:border-primary focus:outline-none" />
                  {smtpAttemptedSubmit && <FieldError message={smtpErrors.host} />}
                </div>
                <div>
                  <label className="text-[11px] font-medium text-mt-ink-2 block mb-1">Port<RequiredMark /></label>
                  <input type="number" value={smtp.port} onChange={e => setSmtp(s => ({ ...s, port: parseInt(e.target.value) || 587 }))} className="w-full px-3 py-2 text-[12px] border border-mt-border rounded-lg focus:border-primary focus:outline-none" />
                </div>
                <div>
                  <label className="text-[11px] font-medium text-mt-ink-2 block mb-1">Username<RequiredMark /></label>
                  <input value={smtp.username} onChange={e => setSmtp(s => ({ ...s, username: e.target.value }))} placeholder="your-username" className="w-full px-3 py-2 text-[12px] border border-mt-border rounded-lg focus:border-primary focus:outline-none" />
                  {smtpAttemptedSubmit && <FieldError message={smtpErrors.username} />}
                </div>
                <div>
                  <label className="text-[11px] font-medium text-mt-ink-2 block mb-1">Password<RequiredMark /></label>
                  <input type="password" value={smtp.password} onChange={e => setSmtp(s => ({ ...s, password: e.target.value }))} placeholder="••••••••" className="w-full px-3 py-2 text-[12px] border border-mt-border rounded-lg focus:border-primary focus:outline-none" />
                  {smtpAttemptedSubmit && <FieldError message={smtpErrors.password} />}
                </div>
                <div className="col-span-2 flex items-center justify-between">
                  <label className="flex items-center gap-2 text-[11px] text-mt-ink-2">
                    <input type="checkbox" checked={smtp.secure} onChange={e => setSmtp(s => ({ ...s, secure: e.target.checked }))} className="rounded" />
                    Use SSL/TLS
                  </label>
                  <button onClick={handleConnectSMTP} disabled={connectSMTP.isPending} className="sq-action-btn primary">
                    {connectSMTP.isPending ? "Verifying..." : "Verify & Save"}
                  </button>
                </div>
                {/* Tier 3 compliance touchpoint — SMTP credential notice */}
                <p className="col-span-2 text-[10px] text-mt-ink-4 leading-relaxed">
                  SMTP credentials are encrypted at rest. By saving, you confirm authorization to use this mail server
                  and agree to MergeTasks'{" "}
                  <a href="/legal/terms" target="_blank" rel="noopener noreferrer" className="underline hover:text-mt-ink-3">Terms of Service</a>
                  {" "}and{" "}
                  <a href="/legal/privacy" target="_blank" rel="noopener noreferrer" className="underline hover:text-mt-ink-3">Privacy Policy</a>.
                </p>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Email Template Preview */}
      <div className="bg-white rounded-lg border border-mt-border p-7">
        <h3 className="text-[15px] font-semibold text-mt-ink mb-2">Email Template Preview</h3>
        <p className="text-[12px] text-mt-ink-3 mb-5">Preview how your proposal emails will look to clients.</p>
        <div className="bg-mt-surface rounded-lg border border-mt-border p-6">
          <div className="max-w-lg mx-auto bg-white rounded-lg border border-mt-border overflow-hidden">
            <div className="p-5 text-center" style={{ backgroundColor: 'var(--mt-brand)' }}>
              <h2 className="text-white text-[18px] font-bold">MergeTasks</h2>
              <p className="text-white/70 text-[11px]">Promotional Products Proposal</p>
            </div>
            <div className="p-6">
              <p className="text-[13px] text-mt-ink-2 mb-3">Hi <strong>[Client Name]</strong>,</p>
              <p className="text-[12px] text-mt-ink-3 mb-4">We're excited to share a customized promotional products proposal tailored for your team.</p>
              <div className="bg-mt-brand-light rounded-lg p-4 mb-4">
                <p className="text-[12px] font-bold text-primary mb-1">[Proposal Title]</p>
                <p className="text-[11px] text-mt-ink-3">Estimated Value: <strong>$[Amount]</strong></p>
                <p className="text-[11px] text-mt-ink-3">Products: <strong>[Count] items</strong></p>
              </div>
              <div className="text-center mb-4">
                <span className="inline-block px-6 py-2.5 text-[12px] font-bold text-white rounded-lg" style={{ backgroundColor: 'var(--mt-brand)' }}>View Full Proposal</span>
              </div>
              <p className="text-[11px] text-mt-ink-4 text-center">This proposal is valid for 30 days.</p>
            </div>
            <div className="p-4 bg-mt-surface border-t border-mt-border text-center">
              <p className="text-[10px] text-mt-ink-4">Sent via {activeConnections.length > 0 ? activeConnections.find(c => c.isDefault)?.email || activeConnections[0].email : "MergeTasks Platform"}</p>
            </div>
          </div>
        </div>
      </div>
      <ConfirmDialog
        open={disconnectTarget !== null}
        title="Disconnect this email account?"
        description={
          disconnectTarget
            ? <>Outgoing email from {disconnectTarget.label} will stop until you reconnect. Any drafts and history stay in place.</>
            : null
        }
        confirmLabel="Disconnect"
        loading={disconnect.isPending}
        onCancel={() => setDisconnectTarget(null)}
        onConfirm={() => { if (disconnectTarget) handleDisconnect(disconnectTarget.id); }}
      />
    </div>
  );
}
