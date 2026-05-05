/**
 * SetPasswordPage — Handles invitation token validation and initial password setup.
 */

import { useState } from "react";
import { useLocation } from "wouter";
import { AlertTriangle, Lock, Eye, EyeOff, Check, Shield } from "lucide-react";
import { toast } from "sonner";
import { trpc } from "@/lib/trpc";
import { useStore, capitalize } from "./StoreContext";
import type { StoreUserData } from "./StoreContext";

export default function SetPasswordPage() {
  const { store, isDark, loginUser } = useStore();
  const [, navigate] = useLocation();
  const fg = isDark ? "#F5F5F5" : "#1A1A1A";
  const mutedFg = isDark ? "#A3A3A3" : "#737373";
  const cardBg = isDark ? "#252525" : "#FFFFFF";
  const borderColor = isDark ? "#333" : "#E5E5E5";
  const inputBg = isDark ? "#1A1A1A" : "#F5F5F5";

  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [success, setSuccess] = useState(false);

  const urlParams = new URLSearchParams(window.location.search);
  const token = urlParams.get("token") || "";

  const { data: tokenData, isLoading: validating } = trpc.storeProvisioning.validateToken.useQuery(
    { token },
    { enabled: !!token }
  );

  const setPasswordMut = trpc.storeProvisioning.setPassword.useMutation();

  const handleSetPassword = async () => {
    if (password.length < 12 || !/[A-Z]/.test(password) || !/[a-z]/.test(password) || !/[0-9]/.test(password) || !/[^A-Za-z0-9]/.test(password)) {
      toast.error("Password must be at least 12 characters with uppercase, lowercase, digit, and special character");
      return;
    }
    if (password !== confirmPassword) { toast.error("Passwords do not match"); return; }
    setLoading(true);
    try {
      const result = await setPasswordMut.mutateAsync({ token, password });
      if (result.success && result.user) {
        setSuccess(true);
        loginUser(result.user as StoreUserData);
        toast.success("Password set — you're now signed in");
        setTimeout(() => navigate(`~/s/${store.slug}`), 2000);
      }
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : "Couldn't set your password — please try again");
    } finally { setLoading(false); }
  };

  if (!token) {
    return (
      <div className="min-h-[calc(100vh-72px)] flex items-center justify-center px-4 sm:px-6">
        <div className="text-center max-w-md">
          <AlertTriangle size={48} className="mx-auto mb-4" style={{ color: "#D97706" }} />
          <h2 className="text-xl font-bold mb-2" style={{ color: fg }}>Invalid Link</h2>
          <p className="text-[13px] mb-6" style={{ color: mutedFg }}>This set-password link is missing a token. Please check your email for the correct link.</p>
          <button onClick={() => navigate(`~/s/${store.slug}/login`)} className="px-6 py-2.5 rounded-lg text-[13px] font-semibold text-white" style={{ backgroundColor: store.primaryColor }}>Go to Login</button>
        </div>
      </div>
    );
  }

  if (validating) {
    return (
      <div className="min-h-[calc(100vh-72px)] flex items-center justify-center">
        <div className="text-center">
          <div className="w-8 h-8 border-2 border-t-transparent rounded-full animate-spin mx-auto mb-4" style={{ borderColor: store.primaryColor }} />
          <p className="text-[13px]" style={{ color: mutedFg }}>Validating your invitation...</p>
        </div>
      </div>
    );
  }

  if (!tokenData?.valid) {
    return (
      <div className="min-h-[calc(100vh-72px)] flex items-center justify-center px-4 sm:px-6">
        <div className="text-center max-w-md">
          <AlertTriangle size={48} className="mx-auto mb-4" style={{ color: "#EF4444" }} />
          <h2 className="text-xl font-bold mb-2" style={{ color: fg }}>Link Expired</h2>
          <p className="text-[13px] mb-6" style={{ color: mutedFg }}>This set-password link has expired or has already been used. Please contact your administrator for a new invitation.</p>
          <button onClick={() => navigate(`~/s/${store.slug}/login`)} className="px-6 py-2.5 rounded-lg text-[13px] font-semibold text-white" style={{ backgroundColor: store.primaryColor }}>Go to Login</button>
        </div>
      </div>
    );
  }

  if (success) {
    return (
      <div className="min-h-[calc(100vh-72px)] flex items-center justify-center px-4 sm:px-6">
        <div className="text-center max-w-md">
          <div className="w-16 h-16 rounded-full flex items-center justify-center mx-auto mb-4" style={{ backgroundColor: store.primaryColor + "20" }}>
            <Check size={32} style={{ color: store.primaryColor }} />
          </div>
          <h2 className="text-xl font-bold mb-2" style={{ color: fg }}>You're All Set!</h2>
          <p className="text-[13px] mb-2" style={{ color: mutedFg }}>Your password has been set and you're now signed in.</p>
          <p className="text-[12px]" style={{ color: mutedFg }}>Redirecting to the store...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-[calc(100vh-72px)] flex items-center justify-center px-4 sm:px-6">
      <div className="w-full max-w-md">
        <div className="text-center mb-8">
          {store.logoUrl ? (
            <img src={store.logoUrl} alt={store.name} className="h-10 mx-auto mb-4 object-contain" />
          ) : (
            <div className="w-12 h-12 rounded-xl flex items-center justify-center text-white text-xl font-bold mx-auto mb-4" style={{ backgroundColor: store.primaryColor }}>
              {store.name.charAt(0)}
            </div>
          )}
          <h1 className="text-2xl font-bold mb-1" style={{ color: fg }}>Set Your Password</h1>
          <p className="text-[13px]" style={{ color: mutedFg }}>
            Welcome{tokenData.user?.name ? `, ${tokenData.user.name}` : ""}! Create a password to access {store.client?.companyName || store.name}.
          </p>
        </div>

        <div className="p-6 rounded-xl" style={{ backgroundColor: cardBg, border: `1px solid ${borderColor}` }}>
          <div className="space-y-4">
            {tokenData.user?.role && (
              <div className="flex items-center gap-2 p-3 rounded-lg" style={{ backgroundColor: inputBg }}>
                <Shield size={14} style={{ color: store.primaryColor }} />
                <span className="text-[12px] font-medium" style={{ color: fg }}>
                  You'll be signing in as <strong>{tokenData.user.role === "admin" ? "Administrator (POC)" : capitalize(tokenData.user.role)}</strong>
                </span>
              </div>
            )}

            <div>
              <label className="block text-[12px] font-semibold mb-1.5" style={{ color: fg }}>Email</label>
              <input
                type="email" value={tokenData.user?.email || ""} disabled
                className="w-full px-4 py-2.5 rounded-lg text-[13px] outline-none opacity-60"
                style={{ backgroundColor: inputBg, color: fg, border: `1px solid ${borderColor}` }}
              />
            </div>

            <div>
              <label className="block text-[12px] font-semibold mb-1.5" style={{ color: fg }}>New Password</label>
              <div className="relative">
                <Lock size={14} className="absolute left-3 top-1/2 -translate-y-1/2" style={{ color: mutedFg }} />
                <input
                  type={showPassword ? "text" : "password"}
                  value={password} onChange={(e) => setPassword(e.target.value)}
                  placeholder="Min. 12 chars (A-Z, a-z, 0-9, special)"
                  className="w-full pl-9 pr-10 py-2.5 rounded-lg text-[13px] outline-none"
                  style={{ backgroundColor: inputBg, color: fg, border: `1px solid ${borderColor}` }}
                />
                <button onClick={() => setShowPassword(!showPassword)} className="absolute right-3 top-1/2 -translate-y-1/2" style={{ color: mutedFg }}>
                  {showPassword ? <EyeOff size={14} /> : <Eye size={14} />}
                </button>
              </div>
              {password.length > 0 && password.length < 12 && (
                <p className="text-[11px] mt-1" style={{ color: "#EF4444" }}>Password must be at least 12 characters</p>
              )}
            </div>

            <div>
              <label className="block text-[12px] font-semibold mb-1.5" style={{ color: fg }}>Confirm Password</label>
              <div className="relative">
                <Lock size={14} className="absolute left-3 top-1/2 -translate-y-1/2" style={{ color: mutedFg }} />
                <input
                  type={showPassword ? "text" : "password"}
                  value={confirmPassword} onChange={(e) => setConfirmPassword(e.target.value)}
                  placeholder="Re-enter your password"
                  className="w-full pl-9 pr-10 py-2.5 rounded-lg text-[13px] outline-none"
                  style={{ backgroundColor: inputBg, color: fg, border: `1px solid ${borderColor}` }}
                  onKeyDown={(e) => e.key === "Enter" && handleSetPassword()}
                />
              </div>
              {confirmPassword.length > 0 && password !== confirmPassword && (
                <p className="text-[11px] mt-1" style={{ color: "#EF4444" }}>Passwords do not match</p>
              )}
            </div>

            <button
              onClick={handleSetPassword}
              disabled={loading || password.length < 12 || !/[A-Z]/.test(password) || !/[a-z]/.test(password) || !/[0-9]/.test(password) || !/[^A-Za-z0-9]/.test(password) || password !== confirmPassword}
              className="w-full flex items-center justify-center gap-2 py-3 rounded-lg text-[13px] font-semibold text-white transition-colors disabled:opacity-60"
              style={{ backgroundColor: store.primaryColor }}
            >
              {loading ? "Setting Password..." : "Set Password & Sign In"}
            </button>
            {/* Tier 2 compliance touchpoint — password setup consent */}
            <p className="text-center text-[10px] mt-2" style={{ color: mutedFg }}>
              By setting a password, you agree to MergeTasks'{" "}
              <a href="/legal/terms" target="_blank" rel="noopener noreferrer" className="underline">Terms of Service</a>
              {" "}and{" "}
              <a href="/legal/privacy" target="_blank" rel="noopener noreferrer" className="underline">Privacy Policy</a>.
            </p>
          </div>
        </div>

        <p className="text-center text-[11px] mt-6" style={{ color: mutedFg }}>
          Powered by MergeTasks Enterprise Platform
        </p>
      </div>
    </div>
  );
}
