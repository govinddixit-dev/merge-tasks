/**
 * StoreLoginPage — Multi-mode authentication: SSO, email code, and password.
 * Also renders the logged-in profile view when user is already authenticated.
 *
 * SSO flow (email-first):
 *   1. User enters email
 *   2. Client calls storeSso.checkDomain with the email domain
 *   3. If SSO is configured → redirect to the IdP init URL
 *   4. If not → fall through to OTP or password login
 *   5. On callback error → ?sso_error= query param is displayed
 */

import { useState, useEffect } from "react";
import { useLocation } from "wouter";
import {
  Mail, Lock, Eye, EyeOff, User, Building2, DollarSign,
  CreditCard, Star, ShoppingBag, Shield, Loader2, AlertCircle,
} from "lucide-react";
import { toast } from "sonner";
import { trpc } from "@/lib/trpc";
import { useStore } from "./StoreContext";
import type { StoreUserData } from "./StoreContext";

export default function StoreLoginPage() {
  const { store, isDark, loginUser, isLoggedIn, storeUser, logoutUser } = useStore();
  const [, navigate] = useLocation();
  const fg = isDark ? "#F5F5F5" : "#1A1A1A";
  const mutedFg = isDark ? "#A3A3A3" : "#737373";
  const cardBg = isDark ? "#252525" : "#FFFFFF";
  const borderColor = isDark ? "#333" : "#E5E5E5";
  const inputBg = isDark ? "#1A1A1A" : "#F5F5F5";

  const [email, setEmail] = useState("");
  const [name, setName] = useState("");
  const [step, setStep] = useState<"email" | "verify">("email");
  const [code, setCode] = useState("");
  const [showCode, setShowCode] = useState(false);
  const [loading, setLoading] = useState(false);
  const [loginMode, setLoginMode] = useState<"email" | "password">("email");
  const [loginPassword, setLoginPassword] = useState("");
  const [showLoginPassword, setShowLoginPassword] = useState(false);
  const [forgotSent, setForgotSent] = useState(false);
  const [ssoChecking, setSsoChecking] = useState(false);
  const [ssoError, setSsoError] = useState<string | null>(null);

  const requestLoginMut = trpc.storeAuth.requestLogin.useMutation();
  const verifyCodeMut = trpc.storeAuth.verifyCode.useMutation();
  const passwordLoginMut = trpc.storeProvisioning.passwordLogin.useMutation();
  const forgotPasswordMut = trpc.storeProvisioning.forgotPassword.useMutation();

  // Check for SSO error from callback redirect, or an inactivity notice
  // from the store-session timeout watchdog.
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const error = params.get("sso_error");
    const logoutReason = params.get("logout");
    if (error) {
      setSsoError(error);
      toast.error(error);
    }
    if (logoutReason === "inactive") {
      toast.info("You were logged out due to inactivity.");
    }
    if (error || logoutReason) {
      // Clean the URL
      window.history.replaceState({}, "", window.location.pathname);
    }
  }, []);

  const roleInfo: Record<string, { label: string; color: string; limit: string; methods: string }> = {
    admin: { label: "Administrator", color: "#DC2626", limit: "Unlimited", methods: "All payment methods" },
    manager: { label: "Manager", color: "#2563EB", limit: "$5,000/order", methods: "Credit Card, PO, GL Code" },
    employee: { label: "Employee", color: "#16A34A", limit: "$500/order", methods: "Company Points only" },
    intern: { label: "Intern", color: "#F59E0B", limit: "$100/order", methods: "Company Points only" },
  };

  //  Logged-in profile view 
  if (isLoggedIn && storeUser) {
    const ri = roleInfo[storeUser.role] || roleInfo.employee;
    return (
      <div className="max-w-lg mx-auto px-4 sm:px-6 py-16">
        <div className="p-8 rounded-xl" style={{ backgroundColor: cardBg, border: `1px solid ${borderColor}` }}>
          <div className="text-center mb-6">
            <div className="w-20 h-20 rounded-full flex items-center justify-center text-white text-3xl font-bold mx-auto mb-4" style={{ backgroundColor: store.primaryColor }}>
              {(storeUser.name || "U").charAt(0)}
            </div>
            <h2 className="text-xl font-bold mb-1" style={{ color: fg }}>{storeUser.name || "User"}</h2>
            <p className="text-[13px] mb-3" style={{ color: mutedFg }}>{storeUser.email}</p>
            <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-[11px] font-bold uppercase tracking-wider text-white" style={{ backgroundColor: ri.color }}>
              <User size={10} /> {ri.label}
            </span>
          </div>

          <div className="space-y-3 mb-6">
            {storeUser.department && (
              <div className="flex items-center justify-between py-2 px-3 rounded-lg" style={{ backgroundColor: inputBg }}>
                <span className="flex items-center gap-2 text-[12px]" style={{ color: mutedFg }}><Building2 size={12} /> Department</span>
                <span className="text-[12px] font-semibold" style={{ color: fg }}>{storeUser.department}</span>
              </div>
            )}
            <div className="flex items-center justify-between py-2 px-3 rounded-lg" style={{ backgroundColor: inputBg }}>
              <span className="flex items-center gap-2 text-[12px]" style={{ color: mutedFg }}><DollarSign size={12} /> Spending Limit</span>
              <span className="text-[12px] font-semibold" style={{ color: fg }}>{storeUser.spendingLimit ? `$${storeUser.spendingLimit}` : ri.limit}</span>
            </div>
            <div className="flex items-center justify-between py-2 px-3 rounded-lg" style={{ backgroundColor: inputBg }}>
              <span className="flex items-center gap-2 text-[12px]" style={{ color: mutedFg }}><CreditCard size={12} /> Payment Methods</span>
              <span className="text-[12px] font-semibold" style={{ color: fg }}>{ri.methods}</span>
            </div>
            {storeUser.pointsBalance > 0 && (
              <div className="flex items-center justify-between py-2 px-3 rounded-lg" style={{ backgroundColor: inputBg }}>
                <span className="flex items-center gap-2 text-[12px]" style={{ color: mutedFg }}><Star size={12} /> Points Balance</span>
                <span className="text-[12px] font-semibold" style={{ color: store.primaryColor }}>{storeUser.pointsBalance.toLocaleString()} pts</span>
              </div>
            )}
          </div>

          <div className="space-y-3">
            <button
              onClick={() => navigate(`~/s/${store.slug}/products`)}
              className="w-full py-3 rounded-lg text-[13px] font-semibold text-white flex items-center justify-center gap-2"
              style={{ backgroundColor: store.primaryColor }}
            >
              <ShoppingBag size={14} /> Continue Shopping
            </button>
            <button
              onClick={logoutUser}
              className="w-full py-3 rounded-lg text-[13px] font-semibold"
              style={{ border: `1px solid ${borderColor}`, color: fg }}
            >
              Sign Out
            </button>
          </div>
        </div>
      </div>
    );
  }

  //  SSO domain check — intercepts before OTP/password flow 
  const checkSsoAndProceed = async () => {
    if (!email || !email.includes("@")) return false;
    setSsoChecking(true);
    try {
      const result = await fetch(
        `/api/trpc/storeSso.checkDomain?input=${encodeURIComponent(JSON.stringify({ storeSlug: store.slug, email: email.toLowerCase() }))}`,
      ).then(r => r.json());

      const data = result?.result?.data;
      if (data?.hasSso && data?.initUrl) {
        // Redirect to IdP
        window.location.href = data.initUrl;
        return true; // SSO redirect initiated
      }
      return false; // No SSO, proceed with normal flow
    } catch {
      // If SSO check fails, fall through to normal login
      return false;
    } finally {
      setSsoChecking(false);
    }
  };

  //  Handlers 
  const handleSubmitEmail = async () => {
    if (!email || !email.includes("@")) { toast.error("Please enter a valid email address"); return; }
    if (!name.trim()) { toast.error("Please enter your name"); return; }
    setLoading(true);

    // Check SSO first
    const ssoRedirected = await checkSsoAndProceed();
    if (ssoRedirected) return; // Browser is redirecting to IdP

    try {
      const result = await requestLoginMut.mutateAsync({ storeSlug: store.slug, email: email.toLowerCase(), name: name.trim() });
      if (result.success) {
        setStep("verify");
        toast.success(result.message || "Verification code sent!");
      } else {
        toast.error(result.message || "Failed to send code");
      }
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : "Failed to send verification code");
    } finally { setLoading(false); }
  };

  const handleVerify = async () => {
    if (code.length < 6) { toast.error("Please enter the 6-digit verification code"); return; }
    setLoading(true);
    try {
      const result = await verifyCodeMut.mutateAsync({ storeSlug: store.slug, email: email.toLowerCase(), code });
      if (result.success && result.user) {
        loginUser(result.user as StoreUserData);
        toast.success("Welcome! You're now signed in.");
        navigate(`~/s/${store.slug}`);
      } else {
        toast.error(result.error || "Verification failed");
      }
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : "Verification failed");
    } finally { setLoading(false); }
  };

  const handlePasswordLogin = async () => {
    if (!email || !email.includes("@")) { toast.error("Please enter a valid email address"); return; }
    if (!loginPassword) { toast.error("Please enter your password"); return; }
    setLoading(true);

    // Check SSO first
    const ssoRedirected = await checkSsoAndProceed();
    if (ssoRedirected) return;

    try {
      const result = await passwordLoginMut.mutateAsync({ storeSlug: store.slug, email: email.toLowerCase(), password: loginPassword });
      if (result.success && result.user) {
        loginUser(result.user as StoreUserData);
        toast.success("Welcome! You're now signed in.");
        navigate(`~/s/${store.slug}`);
      }
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : "Login failed. Check your email and password.");
    } finally { setLoading(false); }
  };

  const handleForgotPassword = async () => {
    if (!email || !email.includes("@")) { toast.error("Please enter your email address first"); return; }
    setLoading(true);
    try {
      await forgotPasswordMut.mutateAsync({ storeSlug: store.slug, email: email.toLowerCase(), origin: window.location.origin });
      setForgotSent(true);
      toast.success("If an account exists with this email, a password reset link has been sent.");
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : "Failed to send reset link");
    } finally { setLoading(false); }
  };

  return (
    <div className="min-h-[calc(100vh-72px)] flex items-center justify-center px-4 sm:px-6">
      <div className="w-full max-w-md">
        {/* Header */}
        <div className="text-center mb-8">
          {store.logoUrl ? (
            <img src={store.logoUrl} alt={store.name} className="h-10 mx-auto mb-4 object-contain" />
          ) : (
            <div className="w-12 h-12 rounded-xl flex items-center justify-center text-white text-xl font-bold mx-auto mb-4" style={{ backgroundColor: store.primaryColor }}>
              {store.name.charAt(0)}
            </div>
          )}
          <h1 className="text-2xl font-bold mb-1" style={{ color: fg }}>
            Sign in to {store.client?.companyName || store.name}
          </h1>
          <p className="text-[13px]" style={{ color: mutedFg }}>
            {step === "email" ? "Choose how you'd like to sign in" : `We sent a code to ${email}`}
          </p>
        </div>

        {/* SSO error banner */}
        {ssoError && (
          <div className="mb-4 p-3 rounded-lg flex items-start gap-2" style={{ backgroundColor: isDark ? "#3B1818" : "#FEF2F2", border: `1px solid ${isDark ? "#7F1D1D" : "#FECACA"}` }}>
            <AlertCircle size={14} className="mt-0.5 flex-shrink-0" style={{ color: "#DC2626" }} />
            <div>
              <p className="text-[12px] font-semibold" style={{ color: "#DC2626" }}>SSO Authentication Failed</p>
              <p className="text-[11px] mt-0.5" style={{ color: mutedFg }}>{ssoError}</p>
            </div>
          </div>
        )}

        {/* SSO checking overlay */}
        {ssoChecking && (
          <div className="mb-4 p-3 rounded-lg flex items-center gap-2" style={{ backgroundColor: isDark ? "#1A2332" : "#EFF6FF", border: `1px solid ${isDark ? "#1E3A5F" : "#BFDBFE"}` }}>
            <Loader2 size={14} className="animate-spin" style={{ color: store.primaryColor }} />
            <p className="text-[12px]" style={{ color: fg }}>Checking for enterprise SSO...</p>
          </div>
        )}

        <div className="p-6 rounded-xl" style={{ backgroundColor: cardBg, border: `1px solid ${borderColor}` }}>
          {step === "email" ? (
            <div className="space-y-4">
              {/* Mode toggle */}
              <div className="flex rounded-lg overflow-hidden" style={{ border: `1px solid ${borderColor}` }}>
                {(["email", "password"] as const).map((mode) => (
                  <button
                    key={mode}
                    className="flex-1 py-2 text-[11px] font-semibold transition-colors"
                    style={{ backgroundColor: loginMode === mode ? store.primaryColor : "transparent", color: loginMode === mode ? "#fff" : mutedFg }}
                    onClick={() => { setLoginMode(mode); setSsoError(null); }}
                  >
                    {mode === "email" ? "Email Code" : "Password"}
                  </button>
                ))}
              </div>

              {/* Password mode fields */}
              {loginMode === "password" && (
                <>
                  <div>
                    <label className="block text-[12px] font-semibold mb-1.5" style={{ color: fg }}>Email Address</label>
                    <div className="relative">
                      <Mail size={14} className="absolute left-3 top-1/2 -translate-y-1/2" style={{ color: mutedFg }} />
                      <input
                        type="email" value={email} onChange={(e) => setEmail(e.target.value)}
                        placeholder="you@company.com"
                        className="w-full pl-9 pr-4 py-2.5 rounded-lg text-[13px] outline-none"
                        style={{ backgroundColor: inputBg, color: fg, border: `1px solid ${borderColor}` }}
                      />
                    </div>
                  </div>
                  <div>
                    <label className="block text-[12px] font-semibold mb-1.5" style={{ color: fg }}>Password</label>
                    <div className="relative">
                      <Lock size={14} className="absolute left-3 top-1/2 -translate-y-1/2" style={{ color: mutedFg }} />
                      <input
                        type={showLoginPassword ? "text" : "password"}
                        value={loginPassword} onChange={(e) => setLoginPassword(e.target.value)}
                        placeholder="Enter your password"
                        className="w-full pl-9 pr-10 py-2.5 rounded-lg text-[13px] outline-none"
                        style={{ backgroundColor: inputBg, color: fg, border: `1px solid ${borderColor}` }}
                        onKeyDown={(e) => e.key === "Enter" && handlePasswordLogin()}
                      />
                      <button onClick={() => setShowLoginPassword(!showLoginPassword)} className="absolute right-3 top-1/2 -translate-y-1/2" style={{ color: mutedFg }}>
                        {showLoginPassword ? <EyeOff size={14} /> : <Eye size={14} />}
                      </button>
                    </div>
                  </div>
                  <button
                    onClick={handlePasswordLogin}
                    disabled={loading || ssoChecking}
                    className="w-full flex items-center justify-center gap-2 py-3 rounded-lg text-[13px] font-semibold text-white transition-colors disabled:opacity-60"
                    style={{ backgroundColor: store.primaryColor }}
                  >
                    {loading || ssoChecking ? "Signing in..." : "Sign In"}
                  </button>
                  <p className="text-[11px] mt-2 text-center" style={{ color: mutedFg }}>
                    By signing in, you agree to MergeTasks'{" "}
                    <a href="/legal/terms" target="_blank" rel="noopener noreferrer" className="underline hover:opacity-80" style={{ color: mutedFg }}>Terms of Service</a>{" "}and{" "}
                    <a href="/legal/privacy" target="_blank" rel="noopener noreferrer" className="underline hover:opacity-80" style={{ color: mutedFg }}>Privacy Policy</a>.
                  </p>
                  <button
                    onClick={handleForgotPassword}
                    disabled={loading || forgotSent}
                    className="w-full text-center text-[12px] font-medium transition-colors"
                    style={{ color: forgotSent ? "#16A34A" : store.primaryColor }}
                  >
                    {forgotSent ? "Reset link sent — check your email" : "Forgot password?"}
                  </button>
                </>
              )}

              {/* Email code mode: Name + Email fields */}
              {loginMode === "email" && (
                <>
                  <div>
                    <label className="block text-[12px] font-semibold mb-1.5" style={{ color: fg }}>Full Name</label>
                    <input
                      type="text" value={name} onChange={(e) => setName(e.target.value)}
                      placeholder="John Doe"
                      className="w-full px-4 py-2.5 rounded-lg text-[13px] outline-none"
                      style={{ backgroundColor: inputBg, color: fg, border: `1px solid ${borderColor}` }}
                    />
                  </div>
                  <div>
                    <label className="block text-[12px] font-semibold mb-1.5" style={{ color: fg }}>Email Address</label>
                    <div className="relative">
                      <Mail size={14} className="absolute left-3 top-1/2 -translate-y-1/2" style={{ color: mutedFg }} />
                      <input
                        type="email" value={email} onChange={(e) => setEmail(e.target.value)}
                        placeholder="you@company.com"
                        className="w-full pl-9 pr-4 py-2.5 rounded-lg text-[13px] outline-none"
                        style={{ backgroundColor: inputBg, color: fg, border: `1px solid ${borderColor}` }}
                        onKeyDown={(e) => e.key === "Enter" && handleSubmitEmail()}
                      />
                    </div>
                  </div>
                  <button
                    onClick={handleSubmitEmail}
                    disabled={loading || ssoChecking}
                    className="w-full flex items-center justify-center gap-2 py-3 rounded-lg text-[13px] font-semibold text-white transition-colors disabled:opacity-60"
                    style={{ backgroundColor: store.primaryColor }}
                  >
                    {ssoChecking ? (
                      <><Loader2 size={14} className="animate-spin" /> Checking SSO...</>
                    ) : loading ? "Processing..." : "Continue with Email"}
                  </button>
                </>
              )}

              {/* SSO info text */}
              <p className="text-center text-[10px]" style={{ color: mutedFg }}>
                <Shield size={9} className="inline mr-1" style={{ verticalAlign: "middle" }} />
                Enterprise SSO is automatically detected by your email domain.
              </p>
            </div>
          ) : (
            /* Verify step */
            <div className="space-y-4">
              <div>
                <label className="block text-[12px] font-semibold mb-1.5" style={{ color: fg }}>Verification Code</label>
                <div className="relative">
                  <Lock size={14} className="absolute left-3 top-1/2 -translate-y-1/2" style={{ color: mutedFg }} />
                  <input
                    type={showCode ? "text" : "password"}
                    value={code} onChange={(e) => setCode(e.target.value)}
                    placeholder="Enter 6-digit code"
                    maxLength={6}
                    className="w-full pl-9 pr-10 py-2.5 rounded-lg text-[13px] outline-none tracking-[4px] text-center font-semibold"
                    style={{ backgroundColor: inputBg, color: fg, border: `1px solid ${borderColor}` }}
                    onKeyDown={(e) => e.key === "Enter" && handleVerify()}
                  />
                  <button onClick={() => setShowCode(!showCode)} className="absolute right-3 top-1/2 -translate-y-1/2" style={{ color: mutedFg }}>
                    {showCode ? <EyeOff size={14} /> : <Eye size={14} />}
                  </button>
                </div>
              </div>
              <button
                onClick={handleVerify}
                disabled={loading}
                className="w-full flex items-center justify-center gap-2 py-3 rounded-lg text-[13px] font-semibold text-white transition-colors disabled:opacity-60"
                style={{ backgroundColor: store.primaryColor }}
              >
                {loading ? "Verifying..." : "Verify & Sign In"}
              </button>
              <button
                onClick={() => { setStep("email"); setCode(""); }}
                className="w-full text-center text-[12px] font-semibold"
                style={{ color: mutedFg }}
              >
                Use a different email
              </button>
            </div>
          )}
        </div>

        <p className="text-center text-[11px] mt-6" style={{ color: mutedFg }}>
          Powered by MergeTasks Enterprise Platform
        </p>
      </div>
    </div>
  );
}
