/**
 * MergeTasks Sign In Page
 * - Branded split-screen layout
 * - MergeTasks workflow card-shuffle animation (Proposal → Proof → Store)
 * - Email/password authentication
 * - 2FA email verification with OTP input
 * - Mobile responsive
 */

import { useState, useEffect } from "react";
import { useLocation } from "wouter";
import { trpc } from "@/lib/trpc";
import { toast } from "sonner";
import { InputOTP, InputOTPGroup, InputOTPSlot, InputOTPSeparator } from "@/components/ui/input-otp";
import { Input } from "@/components/ui/input";
import { RequiredMark } from "@/components/ui/required-mark";
import { FieldError } from "@/components/ui/field-error";
import {
  Mail,
  Lock,
  Eye,
  EyeOff,
  ArrowRight,
  Shield,
  RefreshCw,
  Loader2,
  CheckCircle2,
} from "lucide-react";

const LOGO_URL = "/logo_clean.png";
const LOGO_WHITE = "/logo_white.png";

type Step = "credentials" | "verify";

/*  MergeTasks Workflow Card Animation  */
function WorkflowAnimation() {
  const [activeCard, setActiveCard] = useState(0);

  useEffect(() => {
    const interval = setInterval(() => {
      setActiveCard((prev) => (prev + 1) % 3);
    }, 3500);
    return () => clearInterval(interval);
  }, []);

  const cards = [
    {
      label: "PROPOSAL",
      title: "Acme Corp — Q2 Package",
      content: (
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <span style={{ color: "rgba(255,255,255,0.5)", fontSize: "10px", letterSpacing: "0.08em", textTransform: "uppercase" as const }}>Client</span>
            <span style={{ color: "rgba(255,255,255,0.9)", fontSize: "12px", fontWeight: 600 }}>Acme Corporation</span>
          </div>
          <div style={{ height: "1px", background: "rgba(255,255,255,0.08)" }} />
          <div className="space-y-2">
            {[
              { name: "Performance Polo", qty: "250 units", price: "$9,997" },
              { name: "Insulated Bottle", qty: "150 units", price: "$4,200" },
              { name: "Branded Hoodie", qty: "100 units", price: "$5,999" },
            ].map((item, i) => (
              <div key={i} className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <div style={{ width: "6px", height: "6px", borderRadius: "2px", background: i === 0 ? "#A594FD" : i === 1 ? "#8B7AFC" : "var(--mt-brand)" }} />
                  <span style={{ color: "rgba(255,255,255,0.75)", fontSize: "11px" }}>{item.name}</span>
                </div>
                <div className="flex items-center gap-3">
                  <span style={{ color: "rgba(255,255,255,0.4)", fontSize: "10px" }}>{item.qty}</span>
                  <span style={{ color: "rgba(255,255,255,0.9)", fontSize: "11px", fontWeight: 600 }}>{item.price}</span>
                </div>
              </div>
            ))}
          </div>
          <div style={{ height: "1px", background: "rgba(255,255,255,0.08)" }} />
          <div className="flex items-center justify-between">
            <span style={{ color: "rgba(255,255,255,0.5)", fontSize: "11px" }}>Total</span>
            <span style={{ color: "#A594FD", fontSize: "14px", fontWeight: 700 }}>$20,196</span>
          </div>
          <div className="flex items-center gap-2" style={{ marginTop: "4px" }}>
            <div style={{ width: "6px", height: "6px", borderRadius: "50%", background: "#34D399" }} />
            <span style={{ color: "#34D399", fontSize: "10px", fontWeight: 500 }}>Ready for approval</span>
          </div>
        </div>
      ),
    },
    {
      label: "VIRTUAL PROOF",
      title: "Logo Mockup — Performance Polo",
      content: (
        <div className="space-y-3">
          <div className="flex items-center gap-3">
            <div style={{
              width: "64px", height: "64px", borderRadius: "10px",
              background: "linear-gradient(135deg, rgba(101,75,249,0.3) 0%, rgba(165,148,253,0.15) 100%)",
              border: "1px solid rgba(255,255,255,0.1)",
              display: "flex", alignItems: "center", justifyContent: "center",
            }}>
              <svg width="32" height="32" viewBox="0 0 32 32" fill="none">
                <rect x="4" y="8" width="24" height="16" rx="2" stroke="rgba(255,255,255,0.6)" strokeWidth="1.5" />
                <path d="M10 18l4-4 3 3 5-5" stroke="#A594FD" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                <circle cx="22" cy="13" r="2" fill="#A594FD" opacity="0.6" />
              </svg>
            </div>
            <div>
              <div style={{ color: "rgba(255,255,255,0.9)", fontSize: "12px", fontWeight: 600 }}>AI-Generated Mockup</div>
              <div style={{ color: "rgba(255,255,255,0.4)", fontSize: "10px", marginTop: "2px" }}>Photorealistic rendering</div>
            </div>
          </div>
          <div style={{
            borderRadius: "8px", padding: "12px",
            background: "linear-gradient(135deg, rgba(255,255,255,0.06) 0%, rgba(255,255,255,0.02) 100%)",
            border: "1px solid rgba(255,255,255,0.06)",
          }}>
            <div className="flex items-center justify-between" style={{ marginBottom: "8px" }}>
              <span style={{ color: "rgba(255,255,255,0.5)", fontSize: "10px", letterSpacing: "0.06em" }}>PLACEMENT</span>
              <span style={{ color: "rgba(255,255,255,0.8)", fontSize: "11px" }}>Left Chest</span>
            </div>
            <div className="flex items-center justify-between" style={{ marginBottom: "8px" }}>
              <span style={{ color: "rgba(255,255,255,0.5)", fontSize: "10px", letterSpacing: "0.06em" }}>METHOD</span>
              <span style={{ color: "rgba(255,255,255,0.8)", fontSize: "11px" }}>Embroidery</span>
            </div>
            <div className="flex items-center justify-between">
              <span style={{ color: "rgba(255,255,255,0.5)", fontSize: "10px", letterSpacing: "0.06em" }}>COLORS</span>
              <div className="flex gap-1.5">
                <div style={{ width: "14px", height: "14px", borderRadius: "50%", background: 'var(--mt-brand)', border: "1.5px solid rgba(255,255,255,0.2)" }} />
                <div style={{ width: "14px", height: "14px", borderRadius: "50%", background: "#FFFFFF", border: "1.5px solid rgba(255,255,255,0.2)" }} />
                <div style={{ width: "14px", height: "14px", borderRadius: "50%", background: "#1A1A1A", border: "1.5px solid rgba(255,255,255,0.2)" }} />
              </div>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <div style={{ width: "6px", height: "6px", borderRadius: "50%", background: 'var(--mt-brand)' }} />
            <span style={{ color: "#A594FD", fontSize: "10px", fontWeight: 500 }}>Proof approved by client</span>
          </div>
        </div>
      ),
    },
    {
      label: "WEBSTORE",
      title: "Acme Corp Employee Store",
      content: (
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <div>
              <div style={{ color: "rgba(255,255,255,0.9)", fontSize: "12px", fontWeight: 600 }}>acme-corp.mergetasks.com</div>
              <div style={{ color: "rgba(255,255,255,0.4)", fontSize: "10px", marginTop: "2px" }}>Permanent store · SSO enabled</div>
            </div>
            <div style={{
              padding: "3px 8px", borderRadius: "10px",
              background: "rgba(52,211,153,0.15)", border: "1px solid rgba(52,211,153,0.3)",
            }}>
              <span style={{ color: "#34D399", fontSize: "10px", fontWeight: 600 }}>LIVE</span>
            </div>
          </div>
          <div style={{ height: "1px", background: "rgba(255,255,255,0.08)" }} />
          <div className="grid grid-cols-3 gap-2">
            {[
              { label: "Products", value: "24" },
              { label: "Orders", value: "156" },
              { label: "Revenue", value: "$18.5K" },
            ].map((stat, i) => (
              <div key={i} style={{
                padding: "8px", borderRadius: "6px", textAlign: "center" as const,
                background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.06)",
              }}>
                <div style={{ color: "rgba(255,255,255,0.9)", fontSize: "14px", fontWeight: 700 }}>{stat.value}</div>
                <div style={{ color: "rgba(255,255,255,0.4)", fontSize: "9px", marginTop: "2px", textTransform: "uppercase" as const, letterSpacing: "0.05em" }}>{stat.label}</div>
              </div>
            ))}
          </div>
          <div style={{ height: "1px", background: "rgba(255,255,255,0.08)" }} />
          <div className="space-y-1.5">
            {[
              { name: "New order #1247", time: "2m ago", amount: "+$249.50" },
              { name: "Reorder alert", time: "1h ago", amount: "150 polos" },
            ].map((activity, i) => (
              <div key={i} className="flex items-center justify-between" style={{ padding: "4px 0" }}>
                <div className="flex items-center gap-2">
                  <div style={{ width: "5px", height: "5px", borderRadius: "50%", background: i === 0 ? "#34D399" : "#FBBF24" }} />
                  <span style={{ color: "rgba(255,255,255,0.7)", fontSize: "11px" }}>{activity.name}</span>
                  <span style={{ color: "rgba(255,255,255,0.3)", fontSize: "9px" }}>{activity.time}</span>
                </div>
                <span style={{ color: i === 0 ? "#34D399" : "rgba(255,255,255,0.5)", fontSize: "11px", fontWeight: 500 }}>{activity.amount}</span>
              </div>
            ))}
          </div>
        </div>
      ),
    },
  ];

  // Card positions: front, middle (behind), back (hidden)
  const getCardStyle = (index: number): React.CSSProperties => {
    const offset = (index - activeCard + 3) % 3;
    
    if (offset === 0) {
      // Front card — fully visible
      return {
        transform: "translateY(0px) scale(1)",
        opacity: 1,
        zIndex: 3,
        filter: "none",
      };
    } else if (offset === 1) {
      // Next card — peeking behind, shifted down
      return {
        transform: "translateY(24px) scale(0.95)",
        opacity: 0.5,
        zIndex: 2,
        filter: "blur(1px)",
      };
    } else {
      // Back card — hidden behind
      return {
        transform: "translateY(48px) scale(0.9)",
        opacity: 0,
        zIndex: 1,
        filter: "blur(2px)",
      };
    }
  };

  return (
    <div style={{ position: "relative", width: "300px", height: "320px" }}>
      {/* Subtle glow behind cards */}
      <div style={{
        position: "absolute", top: "50%", left: "50%",
        transform: "translate(-50%, -50%)",
        width: "200px", height: "200px",
        background: "radial-gradient(circle, rgba(101,75,249,0.2) 0%, transparent 70%)",
        borderRadius: "50%", filter: "blur(40px)",
      }} />

      {/* Workflow step indicators */}
      <div className="flex items-center justify-center gap-2" style={{ position: "absolute", top: "-32px", left: "0", right: "0" }}>
        {["Proposal", "Proof", "Store"].map((label, i) => (
          <div key={i} className="flex items-center gap-2">
            <div style={{
              width: "7px", height: "7px", borderRadius: "50%",
              background: activeCard === i ? "#A594FD" : "rgba(255,255,255,0.2)",
              transition: "all 0.6s cubic-bezier(0.4, 0, 0.2, 1)",
              boxShadow: activeCard === i ? "0 0 10px rgba(165,148,253,0.5)" : "none",
            }} />
            <span style={{
              fontSize: "10px", fontWeight: 500, letterSpacing: "0.04em",
              color: activeCard === i ? "rgba(255,255,255,0.9)" : "rgba(255,255,255,0.3)",
              transition: "color 0.6s cubic-bezier(0.4, 0, 0.2, 1)",
            }}>{label}</span>
            {i < 2 && (
              <div style={{
                width: "20px", height: "1px",
                background: activeCard > i ? "rgba(165,148,253,0.4)" : "rgba(255,255,255,0.1)",
                transition: "background 0.6s cubic-bezier(0.4, 0, 0.2, 1)",
              }} />
            )}
          </div>
        ))}
      </div>

      {/* Animated cards */}
      {cards.map((card, index) => (
        <div
          key={index}
          style={{
            position: "absolute",
            top: 0, left: 0, right: 0,
            padding: "20px",
            borderRadius: "16px",
            background: "linear-gradient(145deg, rgba(255,255,255,0.1) 0%, rgba(255,255,255,0.03) 100%)",
            backdropFilter: "blur(24px)",
            WebkitBackdropFilter: "blur(24px)",
            border: "1px solid rgba(255,255,255,0.1)",
            transition: "all 0.8s cubic-bezier(0.4, 0, 0.2, 1)",
            ...getCardStyle(index),
          }}
        >
          {/* Card header */}
          <div className="flex items-center justify-between" style={{ marginBottom: "12px" }}>
            <div>
              <span style={{
                fontSize: "9px", fontWeight: 600, letterSpacing: "0.1em",
                color: "#A594FD", textTransform: "uppercase" as const,
              }}>{card.label}</span>
              <div style={{ color: "rgba(255,255,255,0.95)", fontSize: "13px", fontWeight: 600, marginTop: "2px" }}>
                {card.title}
              </div>
            </div>
            <div style={{
              width: "28px", height: "28px", borderRadius: "8px",
              background: "rgba(101,75,249,0.2)", border: "1px solid rgba(101,75,249,0.3)",
              display: "flex", alignItems: "center", justifyContent: "center",
            }}>
              <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
                {index === 0 && (
                  <path d="M2 3h10M2 7h7M2 11h10" stroke="#A594FD" strokeWidth="1.2" strokeLinecap="round" />
                )}
                {index === 1 && (
                  <>
                    <rect x="2" y="2" width="10" height="10" rx="2" stroke="#A594FD" strokeWidth="1.2" />
                    <path d="M5 8l2-2 2 2" stroke="#A594FD" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" />
                  </>
                )}
                {index === 2 && (
                  <>
                    <rect x="2" y="3" width="10" height="8" rx="1.5" stroke="#A594FD" strokeWidth="1.2" />
                    <path d="M2 6h10" stroke="#A594FD" strokeWidth="1.2" />
                  </>
                )}
              </svg>
            </div>
          </div>
          {/* Card content */}
          {card.content}
        </div>
      ))}
    </div>
  );
}

export default function SignIn() {
  const [, navigate] = useLocation();
  const [step, setStep] = useState<Step>("credentials");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [userId, setUserId] = useState<number | null>(null);
  const [otpValue, setOtpValue] = useState("");
  const [rememberMe, setRememberMe] = useState(false);
  const [attemptedSubmit, setAttemptedSubmit] = useState(false);

  const credentialErrors = {
    email: !email.trim() ? "Email is required" : null,
    password: !password ? "Password is required" : null,
  };

  const signIn = trpc.onboarding.signIn.useMutation();
  const verify2FA = trpc.onboarding.verify2FA.useMutation();
  const utils = trpc.useUtils();
  const resendCode = trpc.onboarding.resendCode.useMutation();
  const googleAuth = trpc.socialAuth.getGoogleUrl.useMutation();
  const microsoftAuth = trpc.socialAuth.getMicrosoftUrl.useMutation();

  // Show error toast if redirected back from failed OAuth, or an inactivity
  // notice if redirected from the session-timeout watchdog.
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const error = params.get("error");
    const logoutReason = params.get("logout");
    if (error === "google_auth_failed") {
      toast.error("Google sign-in failed. Please try again or use email/password.");
    } else if (error === "microsoft_auth_failed") {
      toast.error("Microsoft sign-in failed. Please try again or use email/password.");
    }
    if (logoutReason === "inactive") {
      toast.info("You were logged out due to inactivity.");
    }
    // Clean up the URL
    if (error || logoutReason) {
      window.history.replaceState({}, "", "/sign-in");
    }
  }, []);

  const handleSignIn = async (e: React.FormEvent) => {
    e.preventDefault();
    setAttemptedSubmit(true);
    if (credentialErrors.email || credentialErrors.password) {
      return;
    }

    try {
      const result = await signIn.mutateAsync({ email, password });
      if (result.success) {
        // DEMO/DEV ONLY — server bypassed 2FA, go straight to dashboard
        if (result.demoBypass) {
          toast.success("Welcome back to MergeTasks!");
          setTimeout(() => navigate(result.needsOnboarding ? "/onboarding" : "/dashboard"), 300);
          return;
        }
        setUserId(result.userId!);
        setStep("verify");
        toast.success("Verification code sent to your email!");
      } else {
        toast.error(result.error || "Sign-in failed. Please try again.");
      }
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : "Something went wrong. Please try again.");
    }
  };

  const handleVerify = async () => {
    if (!userId || otpValue.length !== 6) return;

    try {
      const result = await verify2FA.mutateAsync({ userId, code: otpValue });
      if (result.success) {
        toast.success("Welcome back to MergeTasks!");
        // Invalidate auth.me so dashboard sees the new session cookie immediately
        await utils.auth.me.invalidate();
        navigate("/dashboard");
      } else {
        toast.error(result.error || "That code didn't match — please try again");
        setOtpValue("");
      }
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : "Verification failed. Please try again.");
      setOtpValue("");
    }
  };

  const handleResend = async () => {
    if (!userId || !email) return;
    try {
      await resendCode.mutateAsync({ userId, email, type: "login_2fa" });
      toast.success("New verification code sent!");
    } catch {
      toast.error("Couldn't resend the code. Please try again.");
    }
  };

  return (
    <div className="min-h-screen flex">
      {/* Left Panel — Brand Showcase with Workflow Animation */}
      <div className="hidden lg:flex lg:w-[480px] xl:w-[520px] flex-col justify-between relative overflow-hidden"
        style={{ background: "linear-gradient(160deg, var(--mt-brand) 0%, #4C35D4 40%, #3A25B0 100%)" }}>
        
        {/* Subtle background texture */}
        <div style={{
          position: "absolute", inset: 0,
          background: "radial-gradient(circle at 20% 80%, rgba(165,148,253,0.15) 0%, transparent 50%), radial-gradient(circle at 80% 20%, rgba(101,75,249,0.1) 0%, transparent 50%)",
        }} />

        <div className="relative z-10 px-10 flex-1 flex flex-col justify-center">
          {/* Logo */}
          <div className="mb-8">
            <img src={LOGO_WHITE} alt="MergeTasks" className="h-8 object-contain" />
          </div>

          <h2 className="text-white text-[26px] font-semibold leading-snug tracking-tight mb-2">
            The Enterprise Platform<br />for Promotional Products
          </h2>
          <p className="text-white/50 text-[13px] leading-relaxed mb-10">
            Streamline proposals, virtual proofing, and webstore management — all in one platform.
          </p>

          {/* Workflow Animation */}
          <div className="flex justify-center mb-10">
            <WorkflowAnimation />
          </div>
        </div>

        <div className="relative z-10 px-10 pb-8">
          <p className="text-white/25 text-[11px]">
            &copy; {new Date().getFullYear()} MergeTasks Inc. All rights reserved.
          </p>
        </div>
      </div>

      {/* Right Panel — Sign In Form */}
      <div className="flex-1 flex items-center justify-center px-6 py-12 bg-white">
        <div className="w-full max-w-[420px]">
          {/* Mobile logo */}
          <div className="lg:hidden flex justify-center mb-8">
            <img src={LOGO_URL} alt="MergeTasks" className="h-10 object-contain" />
          </div>

          {step === "credentials" ? (
            <>
              <div className="mb-8">
                <h1 className="text-[28px] font-bold text-mt-ink tracking-tight">Welcome back</h1>
                <p className="text-[14px] text-mt-ink-3 mt-2">Sign in to your MergeTasks account</p>
              </div>

              <form onSubmit={handleSignIn} className="space-y-5">
                {/* Email */}
                <div>
                  <label htmlFor="signin-email" className="block text-[13px] font-medium text-mt-ink-2 mb-1.5">
                    Email address<RequiredMark />
                  </label>
                  <Input
                    id="signin-email"
                    type="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder="you@company.com"
                    leadingIcon={<Mail />}
                    aria-invalid={attemptedSubmit && Boolean(credentialErrors.email)}
                    className="h-11 text-[14px]"
                    required
                  />
                  {attemptedSubmit && <FieldError message={credentialErrors.email} />}
                </div>

                {/* Password */}
                <div>
                  <div className="flex items-center justify-between mb-1.5">
                    <label htmlFor="signin-password" className="text-[13px] font-medium text-mt-ink-2">
                      Password<RequiredMark />
                    </label>
                    <button type="button" className="text-[12px] text-primary hover:text-[#4C35D4] font-medium transition-colors">
                      Forgot password?
                    </button>
                  </div>
                  <Input
                    id="signin-password"
                    type={showPassword ? "text" : "password"}
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder="Enter your password"
                    leadingIcon={<Lock />}
                    trailingIcon={
                      <button
                        type="button"
                        onClick={() => setShowPassword(!showPassword)}
                        className="pointer-events-auto text-mt-ink-4 hover:text-mt-ink-2 transition-colors"
                        aria-label={showPassword ? "Hide password" : "Show password"}
                      >
                        {showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
                      </button>
                    }
                    aria-invalid={attemptedSubmit && Boolean(credentialErrors.password)}
                    className="h-11 text-[14px]"
                    required
                  />
                  {attemptedSubmit && <FieldError message={credentialErrors.password} />}
                </div>

                {/* Remember me */}
                <div className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    id="remember"
                    checked={rememberMe}
                    onChange={(e) => setRememberMe(e.target.checked)}
                    className="w-4 h-4 rounded border-mt-border-2 text-primary focus:ring-primary/20"
                  />
                  <label htmlFor="remember" className="text-[13px] text-mt-ink-3">Remember me for 30 days</label>
                </div>

                {/* Sign In Button */}
                <button
                  type="submit"
                  disabled={signIn.isPending}
                  className="w-full h-11 bg-primary hover:bg-[#5438E0] text-white rounded-lg text-[14px] font-semibold flex items-center justify-center gap-2 transition-all active:scale-[0.98] disabled:opacity-60 disabled:cursor-not-allowed shadow-sm hover:shadow-md"
                >
                  {signIn.isPending ? (
                    <><Loader2 size={16} className="animate-spin" /> Signing in...</>
                  ) : (
                    <>Sign In <ArrowRight size={16} /></>
                  )}
                </button>
              </form>

              {/* Divider */}
              <div className="flex items-center gap-3 my-6">
                <div className="flex-1 h-px bg-[#E5E5E5]" />
                <span className="text-[12px] text-mt-ink-4">or continue with</span>
                <div className="flex-1 h-px bg-[#E5E5E5]" />
              </div>

              {/* Social login buttons */}
              <div className="grid grid-cols-2 gap-3">
                <button
                  type="button"
                  disabled={googleAuth.isPending}
                  onClick={async () => {
                    try {
                      const result = await googleAuth.mutateAsync({ origin: window.location.origin });
                      window.location.href = result.url;
                    } catch (err: unknown) {
                      toast.error(err instanceof Error ? err.message : "Google sign-in not available. Please configure GOOGLE_CLIENT_ID in Settings.");
                    }
                  }}
                  className="h-11 border border-mt-border rounded-lg flex items-center justify-center gap-2 text-[13px] text-mt-ink-2 font-medium hover:bg-mt-surface transition-all active:scale-[0.98] disabled:opacity-50"
                >
                  {googleAuth.isPending ? <Loader2 size={16} className="animate-spin" /> : (
                    <svg width="16" height="16" viewBox="0 0 24 24"><path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 0 1-2.2 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.1z" fill="#4285F4"/><path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853"/><path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="#FBBC05"/><path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335"/></svg>
                  )}
                  Google
                </button>
                <button
                  type="button"
                  disabled={microsoftAuth.isPending}
                  onClick={async () => {
                    try {
                      const result = await microsoftAuth.mutateAsync({ origin: window.location.origin });
                      window.location.href = result.url;
                    } catch (err: unknown) {
                      toast.error(err instanceof Error ? err.message : "Microsoft sign-in not available. Please configure MICROSOFT_CLIENT_ID in Settings.");
                    }
                  }}
                  className="h-11 border border-mt-border rounded-lg flex items-center justify-center gap-2 text-[13px] text-mt-ink-2 font-medium hover:bg-mt-surface transition-all active:scale-[0.98] disabled:opacity-50"
                >
                  {microsoftAuth.isPending ? <Loader2 size={16} className="animate-spin" /> : (
                    <svg width="16" height="16" viewBox="0 0 24 24"><path d="M1 1h10v10H1z" fill="#F25022"/><path d="M13 1h10v10H13z" fill="#7FBA00"/><path d="M1 13h10v10H1z" fill="#00A4EF"/><path d="M13 13h10v10H13z" fill="#FFB900"/></svg>
                  )}
                  Microsoft
                </button>
              </div>

              {/* Sign up link */}
              <p className="text-center text-[13px] text-mt-ink-3 mt-8">
                Don't have an account?{" "}
                <button onClick={() => navigate("/sign-up")} className="text-primary hover:text-[#4C35D4] font-semibold transition-colors">
                  Sign up free
                </button>
              </p>

              {/* Legal footer */}
              <p className="text-center text-[11px] text-mt-ink-4 mt-6">
                <a href="/privacy" className="hover:text-mt-ink-2">Privacy Policy</a>
                <span className="mx-2" aria-hidden>·</span>
                <a href="/legal/terms" className="hover:text-mt-ink-2">Terms of Service</a>
              </p>
            </>
          ) : (
            /* 2FA Verification Step */
            <div className="text-center">
              <div className="w-16 h-16 bg-mt-brand-light rounded-2xl flex items-center justify-center mx-auto mb-6">
                <Shield size={28} className="text-primary" />
              </div>

              <h1 className="text-[28px] font-bold text-mt-ink tracking-tight mb-2">Check your email</h1>
              <p className="text-[14px] text-mt-ink-3 mb-1">
                We sent a 6-digit verification code to
              </p>
              <p className="text-[14px] font-semibold text-mt-ink mb-8">{email}</p>

              {/* OTP Input */}
              <div className="flex justify-center mb-6">
                <InputOTP
                  maxLength={6}
                  value={otpValue}
                  onChange={(val) => {
                    setOtpValue(val);
                  }}
                >
                  <InputOTPGroup>
                    <InputOTPSlot index={0} className="w-12 h-14 text-[20px] font-bold border-mt-border focus:border-primary" />
                    <InputOTPSlot index={1} className="w-12 h-14 text-[20px] font-bold border-mt-border focus:border-primary" />
                    <InputOTPSlot index={2} className="w-12 h-14 text-[20px] font-bold border-mt-border focus:border-primary" />
                  </InputOTPGroup>
                  <InputOTPSeparator />
                  <InputOTPGroup>
                    <InputOTPSlot index={3} className="w-12 h-14 text-[20px] font-bold border-mt-border focus:border-primary" />
                    <InputOTPSlot index={4} className="w-12 h-14 text-[20px] font-bold border-mt-border focus:border-primary" />
                    <InputOTPSlot index={5} className="w-12 h-14 text-[20px] font-bold border-mt-border focus:border-primary" />
                  </InputOTPGroup>
                </InputOTP>
              </div>

              <p className="text-[12px] text-mt-ink-4 mb-6">Code expires in 10 minutes</p>

              {/* Verify Button */}
              <button
                onClick={handleVerify}
                disabled={otpValue.length !== 6 || verify2FA.isPending}
                className="w-full h-11 bg-primary hover:bg-[#5438E0] text-white rounded-lg text-[14px] font-semibold flex items-center justify-center gap-2 transition-all active:scale-[0.98] disabled:opacity-40 disabled:cursor-not-allowed shadow-sm hover:shadow-md mb-4"
              >
                {verify2FA.isPending ? (
                  <><Loader2 size={16} className="animate-spin" /> Verifying...</>
                ) : (
                  <><CheckCircle2 size={16} /> Verify & Sign In</>
                )}
              </button>

              {/* Resend */}
              <button
                onClick={handleResend}
                disabled={resendCode.isPending}
                className="text-[13px] text-primary hover:text-[#4C35D4] font-medium flex items-center gap-1.5 mx-auto transition-colors"
              >
                <RefreshCw size={13} className={resendCode.isPending ? "animate-spin" : ""} />
                {resendCode.isPending ? "Sending..." : "Resend code"}
              </button>

              {/* Back to sign in */}
              <button
                onClick={() => { setStep("credentials"); setOtpValue(""); }}
                className="text-[13px] text-mt-ink-3 hover:text-mt-ink-2 mt-6 block mx-auto transition-colors"
              >
                &larr; Back to sign in
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
