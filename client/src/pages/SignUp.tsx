/**
 * MergeTasks Sign Up Page
 * - Branded split-screen layout matching Sign In
 * - Company registration form
 * - 2FA email verification with OTP
 * - Leads into AI onboarding questionnaire
 * - Mobile responsive
 */

import { useState } from "react";
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
  Building2,
  User,
  Check,
} from "lucide-react";

const LOGO_URL = "/logo_clean.png";
const LOGO_WHITE = "/logo_white.png";

type Step = "register" | "verify";

export default function SignUp() {
  const [, navigate] = useLocation();
  const [step, setStep] = useState<Step>("register");
  const [fullName, setFullName] = useState("");
  const [companyName, setCompanyName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [agreeTerms, setAgreeTerms] = useState(false);
  const [userId, setUserId] = useState<number | null>(null);
  const [otpValue, setOtpValue] = useState("");
  const [attemptedSubmit, setAttemptedSubmit] = useState(false);

  const registerErrors = {
    fullName: !fullName.trim() ? "Full name is required" : null,
    companyName: !companyName.trim() ? "Company name is required" : null,
    email: !email.trim()
      ? "Email is required"
      : /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())
      ? null
      : "Enter a valid email address",
    password: !password
      ? "Password is required"
      : password.length < 12
      ? "Password must be at least 12 characters with uppercase, lowercase, digit, and special character"
      : null,
    confirmPassword:
      confirmPassword && confirmPassword !== password ? "Passwords do not match" : null,
  };
  const hasRegisterErrors = Object.values(registerErrors).some((v) => v !== null);

  const signUp = trpc.onboarding.signUp.useMutation();
  const verify2FA = trpc.onboarding.verify2FA.useMutation();
  const resendCode = trpc.onboarding.resendCode.useMutation();
  const googleAuth = trpc.socialAuth.getGoogleUrl.useMutation();
  const microsoftAuth = trpc.socialAuth.getMicrosoftUrl.useMutation();

  // Password strength
  const getPasswordStrength = (pw: string) => {
    let score = 0;
    if (pw.length >= 12) score++;
    if (/[A-Z]/.test(pw) && /[a-z]/.test(pw)) score++;
    if (/[0-9]/.test(pw)) score++;
    if (/[^A-Za-z0-9]/.test(pw)) score++;
    return score;
  };

  const strength = getPasswordStrength(password);
  const strengthLabels = ["", "Weak", "Fair", "Good", "Strong"];
  const strengthColors = ["", "#EF4444", "#F59E0B", "#3B82F6", "#16A34A"];

  const handleSignUp = async (e: React.FormEvent) => {
    e.preventDefault();
    setAttemptedSubmit(true);

    if (hasRegisterErrors) return;
    if (!agreeTerms) {
      toast.error("Please agree to the Terms of Service.");
      return;
    }

    try {
      const result = await signUp.mutateAsync({ email, fullName, companyName, password });
      if (result.success) {
        setUserId(result.userId!);
        setStep("verify");
        toast.success("Account created! Check your email for the verification code.");
      } else {
        toast.error(result.error || "Sign-up failed. Please try again.");
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
        toast.success("Email verified! Let's personalize your experience.");
        // Navigate to onboarding with userId
        setTimeout(() => navigate(`/onboarding?userId=${userId}&company=${encodeURIComponent(companyName)}`), 500);
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
      await resendCode.mutateAsync({ userId, email, type: "signup_verify" });
      toast.success("New verification code sent!");
    } catch {
      toast.error("Couldn't resend the code. Please try again.");
    }
  };

  return (
    <div className="min-h-screen flex">
      {/* Left Panel — Brand Showcase */}
      <div className="hidden lg:flex lg:w-[480px] xl:w-[520px] flex-col justify-between relative overflow-hidden"
        style={{ background: "linear-gradient(160deg, var(--mt-brand) 0%, #4C35D4 40%, #3A25B0 100%)" }}>
        
        {/* Decorative elements */}
        <div className="absolute top-0 right-0 w-[300px] h-[300px] rounded-full opacity-10"
          style={{ background: "radial-gradient(circle, #A594FD 0%, transparent 70%)", transform: "translate(30%, -30%)" }} />
        <div className="absolute bottom-0 left-0 w-[400px] h-[400px] rounded-full opacity-8"
          style={{ background: "radial-gradient(circle, #8B7AFC 0%, transparent 70%)", transform: "translate(-30%, 30%)" }} />
        
        <div className="relative z-10 px-10 flex-1 flex flex-col justify-center">
          {/* Logo */}
          <div className="mb-10">
            <img src={LOGO_WHITE} alt="MergeTasks" className="h-8 object-contain" />
          </div>

          <h2 className="text-white text-[28px] font-semibold leading-snug tracking-tight mb-3">
            Join 500+ Distributors<br />Growing with MergeTasks
          </h2>
          <p className="text-white/60 text-[14px] leading-relaxed mb-10">
            Set up your account in under 2 minutes. Our AI will personalize your experience based on your distributorship.
          </p>

          {/* What you get */}
          <div className="space-y-3.5">
            {[
              "14-day free trial of all Pro features",
              "AI-powered onboarding tailored to your business",
              "Unlimited proposals and virtual proofs",
              "No credit card required to start",
            ].map((text, i) => (
              <div key={i} className="flex items-center gap-3">
                <div className="w-4 h-4 rounded-full bg-white/15 flex items-center justify-center flex-shrink-0">
                  <Check size={10} className="text-white" />
                </div>
                <span className="text-white/75 text-[13px]">{text}</span>
              </div>
            ))}
          </div>
        </div>

        <div className="relative z-10 px-10 pb-8">
          <p className="text-white/30 text-[11px]">
            &copy; {new Date().getFullYear()} MergeTasks Inc. All rights reserved.
          </p>
        </div>
      </div>

      {/* Right Panel — Sign Up Form */}
      <div className="flex-1 flex items-center justify-center px-6 py-12 bg-white">
        <div className="w-full max-w-[420px]">
          {/* Mobile logo */}
          <div className="lg:hidden flex justify-center mb-8">
            <img src={LOGO_URL} alt="MergeTasks" className="h-10 object-contain" />
          </div>

          {step === "register" ? (
            <>
              <div className="mb-6">
                <h1 className="text-[28px] font-bold text-mt-ink tracking-tight">Create your account</h1>
                <p className="text-[14px] text-mt-ink-3 mt-2">Start your free trial — no credit card needed</p>
              </div>

              <form onSubmit={handleSignUp} className="space-y-4">
                {/* Full Name */}
                <div>
                  <label htmlFor="signup-fullname" className="block text-[13px] font-medium text-mt-ink-2 mb-1.5">
                    Full name<RequiredMark />
                  </label>
                  <Input
                    id="signup-fullname"
                    type="text"
                    value={fullName}
                    onChange={(e) => setFullName(e.target.value)}
                    placeholder="John Smith"
                    leadingIcon={<User />}
                    aria-invalid={attemptedSubmit && Boolean(registerErrors.fullName)}
                    className="h-11 text-[14px]"
                    required
                  />
                  {attemptedSubmit && <FieldError message={registerErrors.fullName} />}
                </div>

                {/* Company Name */}
                <div>
                  <label htmlFor="signup-company" className="block text-[13px] font-medium text-mt-ink-2 mb-1.5">
                    Company name<RequiredMark />
                  </label>
                  <Input
                    id="signup-company"
                    type="text"
                    value={companyName}
                    onChange={(e) => setCompanyName(e.target.value)}
                    placeholder="Acme Promotions"
                    leadingIcon={<Building2 />}
                    aria-invalid={attemptedSubmit && Boolean(registerErrors.companyName)}
                    className="h-11 text-[14px]"
                    required
                  />
                  {attemptedSubmit && <FieldError message={registerErrors.companyName} />}
                </div>

                {/* Email */}
                <div>
                  <label htmlFor="signup-email" className="block text-[13px] font-medium text-mt-ink-2 mb-1.5">
                    Work email<RequiredMark />
                  </label>
                  <Input
                    id="signup-email"
                    type="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder="you@company.com"
                    leadingIcon={<Mail />}
                    aria-invalid={attemptedSubmit && Boolean(registerErrors.email)}
                    className="h-11 text-[14px]"
                    required
                  />
                  {attemptedSubmit && <FieldError message={registerErrors.email} />}
                </div>

                {/* Password */}
                <div>
                  <label htmlFor="signup-password" className="block text-[13px] font-medium text-mt-ink-2 mb-1.5">
                    Password<RequiredMark />
                  </label>
                  <Input
                    id="signup-password"
                    type={showPassword ? "text" : "password"}
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder="Min. 12 characters (A-Z, a-z, 0-9, special)"
                    leadingIcon={<Lock />}
                    trailingIcon={
                      <button
                        type="button"
                        onClick={() => setShowPassword(!showPassword)}
                        className="text-mt-ink-4 hover:text-mt-ink-2 transition-colors"
                        aria-label={showPassword ? "Hide password" : "Show password"}
                      >
                        {showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
                      </button>
                    }
                    aria-invalid={attemptedSubmit && Boolean(registerErrors.password)}
                    className="h-11 text-[14px]"
                    required
                    minLength={12}
                  />
                  {attemptedSubmit && <FieldError message={registerErrors.password} />}
                  {/* Password strength bar */}
                  {password.length > 0 && (
                    <div className="mt-2">
                      <div className="flex gap-1 mb-1">
                        {[1, 2, 3, 4].map((level) => (
                          <div
                            key={level}
                            className="h-1 flex-1 rounded-full transition-all"
                            style={{
                              backgroundColor: strength >= level ? strengthColors[strength] : "#E5E5E5",
                            }}
                          />
                        ))}
                      </div>
                      <p className="text-[11px]" style={{ color: strengthColors[strength] }}>
                        {strengthLabels[strength]}
                      </p>
                    </div>
                  )}
                </div>

                {/* Confirm Password */}
                <div>
                  <label htmlFor="signup-confirm-password" className="block text-[13px] font-medium text-mt-ink-2 mb-1.5">
                    Confirm password<RequiredMark />
                  </label>
                  <Input
                    id="signup-confirm-password"
                    type={showPassword ? "text" : "password"}
                    value={confirmPassword}
                    onChange={(e) => setConfirmPassword(e.target.value)}
                    placeholder="Re-enter your password"
                    leadingIcon={<Lock />}
                    trailingIcon={
                      confirmPassword && confirmPassword === password ? (
                        <CheckCircle2 size={16} className="text-[#16A34A]" />
                      ) : undefined
                    }
                    aria-invalid={Boolean(registerErrors.confirmPassword)}
                    className={`h-11 text-[14px] ${
                      confirmPassword && confirmPassword !== password
                        ? "border-[#EF4444]"
                        : confirmPassword && confirmPassword === password
                        ? "border-[#16A34A]"
                        : ""
                    }`}
                    required
                  />
                  <FieldError message={registerErrors.confirmPassword} />
                </div>

                {/* Terms */}
                <div className="flex items-start gap-2 pt-1">
                  <input
                    type="checkbox"
                    id="terms"
                    checked={agreeTerms}
                    onChange={(e) => setAgreeTerms(e.target.checked)}
                    className="w-4 h-4 mt-0.5 rounded border-mt-border-2 text-primary focus:ring-primary/20"
                  />
                  <label htmlFor="terms" className="text-[12px] text-mt-ink-3 leading-relaxed">
                    I agree to the{" "}
                    <a href="/legal/terms" target="_blank" rel="noopener noreferrer" className="text-primary hover:underline">Terms of Service</a>
                    {" "}and{" "}
                    <a href="/legal/privacy" target="_blank" rel="noopener noreferrer" className="text-primary hover:underline">Privacy Policy</a>
                  </label>
                </div>

                {/* Sign Up Button */}
                <button
                  type="submit"
                  disabled={signUp.isPending || !agreeTerms}
                  className="w-full h-11 bg-primary hover:bg-[#5438E0] text-white rounded-lg text-[14px] font-semibold flex items-center justify-center gap-2 transition-all active:scale-[0.98] disabled:opacity-40 disabled:cursor-not-allowed shadow-sm hover:shadow-md"
                >
                  {signUp.isPending ? (
                    <><Loader2 size={16} className="animate-spin" /> Creating account...</>
                  ) : (
                    <>Create Account <ArrowRight size={16} /></>
                  )}
                </button>
              </form>

              {/* Divider */}
              <div className="flex items-center gap-3 my-6">
                <div className="flex-1 h-px bg-[#E5E5E5]" />
                <span className="text-[12px] text-mt-ink-4">or sign up with</span>
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
                      toast.error(err instanceof Error ? err.message : "Google sign-up not available.");
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
                      toast.error(err instanceof Error ? err.message : "Microsoft sign-up not available.");
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

              {/* Sign in link */}
              <p className="text-center mt-6 text-[13px] text-mt-ink-3">
                Already have an account?{" "}
                <button onClick={() => navigate("/sign-in")} className="text-primary hover:text-[#4C35D4] font-semibold transition-colors">
                  Sign in
                </button>
              </p>
            </>
          ) : (
            /* 2FA Verification Step */
            <div className="text-center">
              <div className="w-16 h-16 bg-mt-brand-light rounded-2xl flex items-center justify-center mx-auto mb-6">
                <Shield size={28} className="text-primary" />
              </div>

              <h1 className="text-[28px] font-bold text-mt-ink tracking-tight mb-2">Verify your email</h1>
              <p className="text-[14px] text-mt-ink-3 mb-1">
                We sent a beautifully branded verification email to
              </p>
              <p className="text-[14px] font-semibold text-mt-ink mb-2">{email}</p>
              <p className="text-[12px] text-mt-ink-4 mb-8">Check your inbox (and spam folder) for the MergeTasks email</p>

              {/* OTP Input */}
              <div className="flex justify-center mb-6">
                <InputOTP
                  maxLength={6}
                  value={otpValue}
                  onChange={(val) => setOtpValue(val)}
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
                  <><CheckCircle2 size={16} /> Verify Email</>
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

              {/* Back */}
              <button
                onClick={() => { setStep("register"); setOtpValue(""); }}
                className="text-[13px] text-mt-ink-3 hover:text-mt-ink-2 mt-6 block mx-auto transition-colors"
              >
                &larr; Back to registration
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
