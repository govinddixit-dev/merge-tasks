/**
 * BrandingTab — Settings > Branding tab
 * Logo upload, company name, and brand color management.
 * Extracted from Settings.tsx for maintainability.
 */
import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { Palette, Upload, Loader2, CheckCircle2 } from "lucide-react";
import { toast } from "sonner";

export default function BrandingTab() {
  const { data: branding, isLoading } = trpc.branding.get.useQuery();
  const updateBranding = trpc.branding.update.useMutation();
  const uploadLogo = trpc.branding.uploadLogo.useMutation();
  const utils = trpc.useUtils();

  const [primaryColor, setPrimaryColor] = useState("");
  const [secondaryColor, setSecondaryColor] = useState("");
  const [bannerColor, setBannerColor] = useState("");
  const [companyName, setCompanyName] = useState("");
  const [companyAddress, setCompanyAddress] = useState("");
  const [companyPhone, setCompanyPhone] = useState("");
  const [companyEmail, setCompanyEmail] = useState("");
  const [companyWebsite, setCompanyWebsite] = useState("");
  const [initialized, setInitialized] = useState(false);
  const [uploading, setUploading] = useState(false);

  // Initialize form values from server data
  if (branding && !initialized) {
    setPrimaryColor(branding.brandPrimaryColor || "var(--mt-brand)");
    setSecondaryColor(branding.brandSecondaryColor || "#1A1A1A");
    setBannerColor(branding.brandBannerColor || branding.brandPrimaryColor || "var(--mt-brand)");
    setCompanyName(branding.brandCompanyName || "");
    setCompanyAddress(branding.companyAddress || "");
    setCompanyPhone(branding.companyPhone || "");
    setCompanyEmail(branding.companyEmail || "");
    setCompanyWebsite(branding.companyWebsite || "");
    setInitialized(true);
  }

  const handleLogoUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (!file.type.startsWith("image/")) {
      toast.error("Please upload an image file");
      return;
    }
    if (file.size > 5 * 1024 * 1024) {
      toast.error("Image must be under 5MB");
      return;
    }

    setUploading(true);
    try {
      const reader = new FileReader();
      const base64 = await new Promise<string>((resolve, reject) => {
        reader.onload = () => {
          const result = reader.result as string;
          resolve(result.split(",")[1]);
        };
        reader.onerror = reject;
        reader.readAsDataURL(file);
      });

      const result = await uploadLogo.mutateAsync({
        imageBase64: base64,
        mimeType: file.type,
        fileName: file.name,
      });

      utils.branding.get.invalidate();
      toast.success(
        result.bgRemoved
          ? "Logo uploaded and background removed!"
          : "Logo uploaded successfully!"
      );
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "Failed to upload logo";
      toast.error(message);
    } finally {
      setUploading(false);
    }
  };

  const handleSaveColors = async () => {
    try {
      await updateBranding.mutateAsync({
        brandPrimaryColor: primaryColor,
        brandSecondaryColor: secondaryColor,
        brandBannerColor: bannerColor,
        brandCompanyName: companyName || undefined,
        companyAddress: companyAddress,
        companyPhone: companyPhone,
        companyEmail: companyEmail,
        companyWebsite: companyWebsite,
      });
      utils.branding.get.invalidate();
      toast.success("Branding updated");
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "Couldn't update branding — please try again";
      toast.error(message);
    }
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 className="w-6 h-6 animate-spin text-primary" />
      </div>
    );
  }

  return (
    <div className="space-y-8">
      {/* Header */}
      <div>
        <h2 className="text-[18px] font-bold text-mt-ink tracking-tight">Brand Identity</h2>
        <p className="text-[13px] text-mt-ink-3 mt-1">
          Customize your logo and brand colors. These will appear on proposal emails, client-facing pages, and webstores.
        </p>
      </div>

      {/* Logo Section */}
      <div className="bg-white border border-mt-border rounded-xl p-6">
        <h3 className="text-[14px] font-semibold text-mt-ink mb-1">Company Logo</h3>
        <p className="text-[12px] text-mt-ink-3 mb-4">
          Upload your logo and we'll automatically remove the background for clean rendering on emails and documents.
        </p>

        <div className="flex items-start gap-6">
          {/* Logo Preview */}
          <div className="w-[140px] h-[140px] border-2 border-dashed border-mt-border rounded-xl flex items-center justify-center bg-mt-surface overflow-hidden flex-shrink-0">
            {branding?.brandLogoUrl ? (
              <img
                src={branding.brandLogoUrl}
                alt="Brand logo"
                className="max-w-[120px] max-h-[120px] object-contain"
              />
            ) : (
              <div className="text-center">
                <Upload className="w-8 h-8 text-[#C4C4C4] mx-auto mb-1" />
                <p className="text-[11px] text-mt-ink-4">No logo</p>
              </div>
            )}
          </div>

          {/* Upload Controls */}
          <div className="flex-1">
            <label
              className={`inline-flex items-center gap-2 px-4 py-2.5 rounded-lg text-[13px] font-semibold cursor-pointer transition-all ${
                uploading
                  ? "bg-mt-surface-2 text-mt-ink-4 cursor-not-allowed"
                  : "bg-primary text-white hover:bg-[#5438D8]"
              }`}
            >
              {uploading ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" />
                  Processing...
                </>
              ) : (
                <>
                  <Upload className="w-4 h-4" />
                  Upload Logo
                </>
              )}
              <input
                type="file"
                accept="image/*"
                onChange={handleLogoUpload}
                disabled={uploading}
                className="hidden"
              />
            </label>
            <p className="text-[11px] text-mt-ink-4 mt-2">
              PNG, JPG, or SVG. Max 5MB. Background will be automatically removed.
            </p>
            {branding?.brandLogoUrl && branding.brandLogoOriginalUrl && branding.brandLogoUrl !== branding.brandLogoOriginalUrl && (
              <div className="mt-3 flex items-center gap-2">
                <CheckCircle2 className="w-3.5 h-3.5 text-green-500" />
                <span className="text-[11px] text-green-600 font-medium">Background removed automatically</span>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Company Display Name */}
      <div className="bg-white border border-mt-border rounded-xl p-6">
        <h3 className="text-[14px] font-semibold text-mt-ink mb-1">Company Display Name</h3>
        <p className="text-[12px] text-mt-ink-3 mb-4">
          This name appears on proposal emails and client-facing materials.
        </p>
        <input
          type="text"
          value={companyName}
          onChange={(e) => setCompanyName(e.target.value)}
          placeholder="e.g., Acme Promotional Products"
          className="w-full max-w-md h-10 px-3 border border-mt-border rounded-lg text-[13px] text-mt-ink placeholder:text-[#C4C4C4] focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary"
        />
      </div>

      {/* Contact Details — printed on PDF Bill To / footer */}
      <div className="bg-white border border-mt-border rounded-xl p-6">
        <h3 className="text-[14px] font-semibold text-mt-ink mb-1">Contact Details</h3>
        <p className="text-[12px] text-mt-ink-3 mb-4">
          Shown in the Bill To / Ship To block and footer of branded PDFs (estimates, invoices, purchase orders).
        </p>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 max-w-2xl">
          <div className="md:col-span-2">
            <label className="block text-[12px] font-medium text-mt-ink-2 mb-1.5">Mailing Address</label>
            <textarea
              value={companyAddress}
              onChange={(e) => setCompanyAddress(e.target.value)}
              placeholder="123 Main St&#10;Suite 200&#10;Springfield, IL 62704"
              rows={3}
              className="w-full px-3 py-2 border border-mt-border rounded-lg text-[13px] text-mt-ink placeholder:text-[#C4C4C4] focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary resize-none"
            />
          </div>
          <div>
            <label className="block text-[12px] font-medium text-mt-ink-2 mb-1.5">Phone</label>
            <input
              type="tel"
              value={companyPhone}
              onChange={(e) => setCompanyPhone(e.target.value)}
              placeholder="(555) 123-4567"
              className="w-full h-10 px-3 border border-mt-border rounded-lg text-[13px] text-mt-ink placeholder:text-[#C4C4C4] focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary"
            />
          </div>
          <div>
            <label className="block text-[12px] font-medium text-mt-ink-2 mb-1.5">Email</label>
            <input
              type="email"
              value={companyEmail}
              onChange={(e) => setCompanyEmail(e.target.value)}
              placeholder="hello@yourcompany.com"
              className="w-full h-10 px-3 border border-mt-border rounded-lg text-[13px] text-mt-ink placeholder:text-[#C4C4C4] focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary"
            />
          </div>
          <div className="md:col-span-2">
            <label className="block text-[12px] font-medium text-mt-ink-2 mb-1.5">Website</label>
            <input
              type="url"
              value={companyWebsite}
              onChange={(e) => setCompanyWebsite(e.target.value)}
              placeholder="https://yourcompany.com"
              className="w-full h-10 px-3 border border-mt-border rounded-lg text-[13px] text-mt-ink placeholder:text-[#C4C4C4] focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary"
            />
          </div>
        </div>
      </div>

      {/* Brand Colors */}
      <div className="bg-white border border-mt-border rounded-xl p-6">
        <h3 className="text-[14px] font-semibold text-mt-ink mb-1">Brand Colors</h3>
        <p className="text-[12px] text-mt-ink-3 mb-4">
          Set your primary and secondary brand colors for emails, proposals, and webstores.
        </p>

        <div className="flex flex-wrap gap-6">
          {/* Primary Color */}
          <div>
            <label className="block text-[12px] font-medium text-mt-ink-2 mb-2">Primary Color</label>
            <div className="flex items-center gap-3">
              <input
                type="color"
                value={primaryColor}
                onChange={(e) => setPrimaryColor(e.target.value)}
                className="w-10 h-10 rounded-lg border border-mt-border cursor-pointer"
                style={{ padding: 0 }}
              />
              <input
                type="text"
                value={primaryColor}
                onChange={(e) => {
                  if (/^#[0-9A-Fa-f]{0,6}$/.test(e.target.value)) setPrimaryColor(e.target.value);
                }}
                className="w-24 h-10 px-3 border border-mt-border rounded-lg text-[13px] text-mt-ink font-mono focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary"
              />
            </div>
          </div>

          {/* Banner / Header Color */}
          <div>
            <label className="block text-[12px] font-medium text-mt-ink-2 mb-2">Email Banner Color</label>
            <div className="flex items-center gap-3">
              <input
                type="color"
                value={bannerColor}
                onChange={(e) => setBannerColor(e.target.value)}
                className="w-10 h-10 rounded-lg border border-mt-border cursor-pointer"
                style={{ padding: 0 }}
              />
              <input
                type="text"
                value={bannerColor}
                onChange={(e) => {
                  if (/^#[0-9A-Fa-f]{0,6}$/.test(e.target.value)) setBannerColor(e.target.value);
                }}
                className="w-24 h-10 px-3 border border-mt-border rounded-lg text-[13px] text-mt-ink font-mono focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary"
              />
            </div>
            <p className="text-[11px] text-mt-ink-4 mt-1">Used for the header/banner in proposal emails</p>
          </div>

          {/* Secondary Color */}
          <div>
            <label className="block text-[12px] font-medium text-mt-ink-2 mb-2">Secondary Color</label>
            <div className="flex items-center gap-3">
              <input
                type="color"
                value={secondaryColor}
                onChange={(e) => setSecondaryColor(e.target.value)}
                className="w-10 h-10 rounded-lg border border-mt-border cursor-pointer"
                style={{ padding: 0 }}
              />
              <input
                type="text"
                value={secondaryColor}
                onChange={(e) => {
                  if (/^#[0-9A-Fa-f]{0,6}$/.test(e.target.value)) setSecondaryColor(e.target.value);
                }}
                className="w-24 h-10 px-3 border border-mt-border rounded-lg text-[13px] text-mt-ink font-mono focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary"
              />
            </div>
          </div>
        </div>

        {/* Color Preview */}
        <div className="mt-5 p-4 rounded-xl border border-mt-border bg-mt-surface">
          <p className="text-[11px] font-medium text-mt-ink-3 mb-3">PREVIEW</p>
          <div className="flex items-center gap-3">
            <div
              className="h-10 flex-1 rounded-lg flex items-center justify-center text-white text-[12px] font-semibold"
              style={{ backgroundColor: primaryColor }}
            >
              Primary Button
            </div>
            <div
              className="h-10 flex-1 rounded-lg flex items-center justify-center text-white text-[12px] font-semibold"
              style={{ backgroundColor: secondaryColor }}
            >
              Secondary
            </div>
            <div
              className="h-10 flex-1 rounded-lg border-2 flex items-center justify-center text-[12px] font-semibold"
              style={{ borderColor: primaryColor, color: primaryColor }}
            >
              Outline
            </div>
          </div>
        </div>
      </div>

      {/* Save Button */}
      <div className="flex justify-end">
        <button
          onClick={handleSaveColors}
          disabled={updateBranding.isPending}
          className="px-6 py-2.5 bg-primary text-white rounded-lg text-[13px] font-semibold hover:bg-[#5438D8] transition-all disabled:opacity-60"
        >
          {updateBranding.isPending ? "Saving..." : "Save Branding"}
        </button>
      </div>

      {/* Email Preview */}
      <div className="bg-white border border-mt-border rounded-xl p-6">
        <h3 className="text-[14px] font-semibold text-mt-ink mb-1">Email Preview</h3>
        <p className="text-[12px] text-mt-ink-3 mb-4">
          This is how your branding will appear in proposal emails sent to clients.
        </p>
        <div className="border border-mt-border rounded-lg overflow-hidden max-w-md mx-auto">
          {/* Email Header */}
          <div className="p-4 flex items-center gap-3" style={{ backgroundColor: bannerColor }}>
            {branding?.brandLogoUrl ? (
              <img src={branding.brandLogoUrl} alt="Logo" className="h-8 object-contain" style={{ maxWidth: 120 }} />
            ) : (
              <div className="h-8 w-8 rounded bg-white/20 flex items-center justify-center">
                <Palette className="w-4 h-4 text-white" />
              </div>
            )}
            <span className="text-white text-[14px] font-semibold">
              {companyName || "Your Company"}
            </span>
          </div>
          {/* Email Body Preview */}
          <div className="p-5 bg-white">
            <p className="text-[13px] text-mt-ink-2 mb-3">Hi Sarah,</p>
            <p className="text-[13px] text-mt-ink-2 mb-4">
              A new proposal has been prepared for you. Click below to view the details and products.
            </p>
            <div
              className="text-center py-2.5 rounded-lg text-white text-[13px] font-semibold"
              style={{ backgroundColor: primaryColor }}
            >
              View Proposal
            </div>
          </div>
          {/* Email Footer */}
          <div className="px-5 py-3 bg-[#F9F9F9] border-t border-mt-border">
            <p className="text-[10px] text-mt-ink-4 text-center">
              Sent via {companyName || "Your Company"} &bull; Powered by MergeTasks
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
