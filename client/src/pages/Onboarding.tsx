/**
 * MergeTasks AI Onboarding Questionnaire
 * - Multi-step questionnaire about the distributorship
 * - AI analyzes answers to personalize the experience
 * - Beautiful branded design with progress indicator
 * - Leads to personalized dashboard
 */

import { useState, useMemo } from "react";
import { useLocation, useSearch } from "wouter";
import { trpc } from "@/lib/trpc";
import { toast } from "sonner";
import { AnimatePresence, motion } from "framer-motion";
import { useReducedMotion } from "@/hooks/useReducedMotion";
import {
  Building2,
  Users,
  DollarSign,
  Target,
  Package,
  Briefcase,
  Sparkles,
  ArrowRight,
  ArrowLeft,
  Loader2,
  CheckCircle2,
  Rocket,
  Zap,
  Palette,
  Upload,
  CreditCard,
  ExternalLink,
} from "lucide-react";

function OnboardingConnectStep() {
  const { data: status } = trpc.stripeConnect.getStatus.useQuery(undefined, {
    refetchOnWindowFocus: true,
    staleTime: 15_000,
  });
  const createLink = trpc.stripeConnect.createOnboardingLink.useMutation({
    onSuccess: (data) => {
      if (data?.url) {
        window.open(data.url, "_blank");
        toast.info("Stripe opened in a new tab. Complete the setup there, then come back.");
      }
    },
    onError: (err) => toast.error(err.message || "Could not start Stripe Connect"),
  });
  const connected = Boolean((status as { payoutsEnabled?: boolean } | undefined)?.payoutsEnabled);
  return (
    <div>
      <div className="flex items-center gap-3 mb-2">
        <div className="w-10 h-10 bg-mt-brand-light rounded-xl flex items-center justify-center">
          <CreditCard size={20} className="text-primary" />
        </div>
        <div>
          <h2 className="text-[22px] font-bold text-mt-ink tracking-tight">Connect Stripe</h2>
          <p className="text-[13px] text-mt-ink-3">Accept credit card payments on your workstores — money goes directly to your bank.</p>
        </div>
      </div>
      <div className="mt-8 space-y-4">
        <div className="bg-[#F5F3FF] border border-[#DDD4FF] rounded-xl p-5 text-[13px] text-[#2B1B7A] leading-relaxed">
          <p className="font-semibold mb-1">How it works</p>
          <ul className="list-disc ml-5 space-y-1">
            <li>You don't need an existing Stripe account — you can create one in the next step.</li>
            <li>Your customers check out securely on Stripe. You never see or store card data.</li>
            <li>Payouts land in your bank account, typically within 2 business days.</li>
            <li>MergeTasks charges a 2% platform fee per transaction. No hidden fees.</li>
          </ul>
        </div>
        {connected ? (
          <div className="flex items-center gap-3 bg-[#F0FDF4] border border-[#86EFAC] rounded-xl p-4">
            <CheckCircle2 size={20} className="text-[#16A34A]" />
            <div className="flex-1 text-[13px] text-[#14532D]">
              <strong>Stripe is connected.</strong> You're ready to accept workstore payments.
            </div>
          </div>
        ) : (
          <button
            onClick={() => {
              const base = window.location.origin;
              createLink.mutate({
                returnUrl: `${base}/onboarding?stripe=return`,
                refreshUrl: `${base}/onboarding?stripe=refresh`,
              });
            }}
            disabled={createLink.isPending}
            className="inline-flex items-center gap-2 bg-primary text-white px-5 h-11 rounded-lg text-[14px] font-semibold hover:bg-[#5438D8] transition-colors disabled:opacity-60"
          >
            {createLink.isPending ? <Loader2 size={16} className="animate-spin" /> : <ExternalLink size={16} />}
            Connect Stripe account
          </button>
        )}
        <p className="text-[11px] text-mt-ink-4">You can skip this and finish setup later in Settings → Billing.</p>
      </div>
    </div>
  );
}

const LOGO_URL = "/logo_clean.png";

const COMPANY_SIZES = [
  { value: "1-5", label: "1-5 employees", desc: "Solo or small team" },
  { value: "6-20", label: "6-20 employees", desc: "Growing team" },
  { value: "21-50", label: "21-50 employees", desc: "Mid-size operation" },
  { value: "51-100", label: "51-100 employees", desc: "Established business" },
  { value: "100+", label: "100+ employees", desc: "Enterprise" },
];

const REVENUE_RANGES = [
  { value: "under-500k", label: "Under $500K" },
  { value: "500k-1m", label: "$500K - $1M" },
  { value: "1m-5m", label: "$1M - $5M" },
  { value: "5m-10m", label: "$5M - $10M" },
  { value: "10m+", label: "$10M+" },
  { value: "prefer-not", label: "Prefer not to say" },
];

const SPECIALTIES = [
  "Apparel & Wearables",
  "Drinkware & Barware",
  "Tech & Electronics",
  "Office & Desk Accessories",
  "Bags & Totes",
  "Awards & Recognition",
  "Health & Wellness",
  "Outdoor & Leisure",
  "Print & Stationery",
  "Packaging & Kitting",
  "Uniforms & Workwear",
  "Event & Trade Show",
];

const CATEGORIES = [
  "Corporate Gifts",
  "Employee Onboarding Kits",
  "Trade Show Giveaways",
  "Branded Merchandise",
  "Safety & PPE",
  "Uniforms & Workwear",
  "Holiday Gifts",
  "Client Appreciation",
  "Sports & Athletics",
  "Non-Profit & Fundraising",
];

const INDUSTRIES = [
  "Technology",
  "Healthcare",
  "Finance & Banking",
  "Education",
  "Manufacturing",
  "Retail & E-commerce",
  "Real Estate",
  "Government",
  "Non-Profit",
  "Hospitality & Events",
  "Construction",
  "Legal",
];

const GOALS = [
  { value: "streamline-proposals", label: "Streamline proposal creation", icon: "📋" },
  { value: "virtual-proofing", label: "Better virtual proofing for clients", icon: "🎨" },
  { value: "grow-revenue", label: "Grow revenue and win more deals", icon: "📈" },
  { value: "manage-webstores", label: "Launch and manage company stores", icon: "🏪" },
  { value: "automate-operations", label: "Automate day-to-day operations", icon: "⚡" },
  { value: "client-experience", label: "Improve client experience", icon: "🤝" },
];

const YEARS_OPTIONS = [
  { value: "0-1", label: "Less than 1 year" },
  { value: "1-3", label: "1-3 years" },
  { value: "3-5", label: "3-5 years" },
  { value: "5-10", label: "5-10 years" },
  { value: "10+", label: "10+ years" },
];

type OnboardingStep = 1 | 2 | 3 | 4 | 5 | 6 | 7;

export default function Onboarding() {
  const [, navigate] = useLocation();
  const searchString = useSearch();
  const params = useMemo(() => new URLSearchParams(searchString), [searchString]);
  const companyFromUrl = params.get("company") || "";

  const [currentStep, setCurrentStep] = useState<OnboardingStep>(1);
  const [companySize, setCompanySize] = useState("");
  const [annualRevenue, setAnnualRevenue] = useState("");
  const [yearsInBusiness, setYearsInBusiness] = useState("");
  const [selectedSpecialties, setSelectedSpecialties] = useState<string[]>([]);
  const [selectedCategories, setSelectedCategories] = useState<string[]>([]);
  const [selectedIndustries, setSelectedIndustries] = useState<string[]>([]);
  const [primaryGoal, setPrimaryGoal] = useState("");
  const [currentTools, setCurrentTools] = useState("");
  const [teamSize, setTeamSize] = useState("");
  // Branding step
  const [brandPrimaryColor, setBrandPrimaryColor] = useState("var(--mt-brand)");
  const [brandSecondaryColor, setBrandSecondaryColor] = useState("#1A1A1A");
  const [brandCompanyName, setBrandCompanyName] = useState(companyFromUrl);
  const [brandLogoUploading, setBrandLogoUploading] = useState(false);
  const [brandLogoUrl, setBrandLogoUrl] = useState<string | null>(null);
  const uploadLogo = trpc.branding.uploadLogo.useMutation();
  const updateBranding = trpc.branding.update.useMutation();
  const [showResults, setShowResults] = useState(false);
  const [personalization, setPersonalization] = useState<any>(null);

  const saveOnboarding = trpc.onboarding.saveOnboarding.useMutation();
  const getAI = trpc.onboarding.getAIPersonalization.useMutation();

  const totalSteps = 7;

  const toggleArrayItem = (arr: string[], item: string, setter: (v: string[]) => void) => {
    setter(arr.includes(item) ? arr.filter((x) => x !== item) : [...arr, item]);
  };

  const canProceed = () => {
    switch (currentStep) {
      case 1: return !!companySize;
      case 2: return selectedSpecialties.length > 0;
      case 3: return selectedCategories.length > 0 && selectedIndustries.length > 0;
      case 4: return !!primaryGoal;
      case 5: return true;
      case 6: return true;
      case 7: return true;
      default: return false;
    }
  };

  const handleNext = () => {
    if (currentStep < totalSteps) {
      setCurrentStep((currentStep + 1) as OnboardingStep);
    }
  };

  const handleBack = () => {
    if (currentStep > 1) {
      setCurrentStep((currentStep - 1) as OnboardingStep);
    }
  };

  const handleLogoUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (!file.type.startsWith("image/")) { toast.error("Please upload an image file"); return; }
    if (file.size > 5 * 1024 * 1024) { toast.error("Image must be under 5MB"); return; }
    setBrandLogoUploading(true);
    try {
      const reader = new FileReader();
      const base64 = await new Promise<string>((resolve, reject) => {
        reader.onload = () => { resolve((reader.result as string).split(",")[1]); };
        reader.onerror = reject;
        reader.readAsDataURL(file);
      });
      const result = await uploadLogo.mutateAsync({ imageBase64: base64, mimeType: file.type, fileName: file.name });
      setBrandLogoUrl(result.processedUrl || result.originalUrl);
      toast.success(result.bgRemoved ? "Logo uploaded — background removed" : "Logo uploaded");
    } catch { toast.error("Couldn't upload the logo — please try again"); }
    finally { setBrandLogoUploading(false); }
  };

  const handleFinish = async () => {
    // Save branding
    try {
      await updateBranding.mutateAsync({
        brandPrimaryColor: brandPrimaryColor,
        brandSecondaryColor: brandSecondaryColor,
        brandCompanyName: brandCompanyName || companyFromUrl || undefined,
      });
    } catch { /* continue */ }

    // Save onboarding data
    try {
      await saveOnboarding.mutateAsync({
        companyName: companyFromUrl,
        companySize,
        annualRevenue,
        yearsInBusiness,
        specialties: selectedSpecialties,
        topCategories: selectedCategories,
        targetIndustries: selectedIndustries,
        primaryGoal,
        currentTools,
        teamSize,
      });
    } catch {
      // Continue even if save fails
    }

    // Get AI personalization
    setShowResults(true);
    try {
      const result = await getAI.mutateAsync({
        companyName: companyFromUrl || "Your Company",
        companySize: companySize || "1-5",
        annualRevenue: annualRevenue || "under-500k",
        specialties: selectedSpecialties,
        topCategories: selectedCategories,
        targetIndustries: selectedIndustries,
        primaryGoal: primaryGoal || "streamline-proposals",
      });

      if (result.success && result.personalization) {
        setPersonalization(result.personalization);
      }
    } catch {
      setPersonalization({
        welcomeMessage: `Welcome to MergeTasks! We're excited to help you grow your promotional products business.`,
        recommendedFeatures: [
          { name: "Proposal Builder", description: "Create professional proposals in minutes", priority: "high" },
          { name: "Virtual Proofing", description: "AI-powered product mockups", priority: "high" },
          { name: "Company Stores", description: "Launch branded webstores for clients", priority: "medium" },
        ],
        suggestedFirstSteps: ["Import your product catalog", "Create your first client", "Build a sample proposal"],
      });
    }
  };

  const stepLabels = [
    "Company",
    "Specialties",
    "Markets",
    "Goals",
    "Tools",
    "Branding",
    "Payments",
  ];

  return (
    <div className="min-h-screen bg-mt-surface flex flex-col">
      {/* Header */}
      <header className="bg-white border-b border-mt-border px-6 py-4">
        <div className="max-w-[800px] mx-auto flex items-center justify-between">
          <img src={LOGO_URL} alt="MergeTasks" className="h-8 object-contain" />
          <button
            onClick={() => navigate("/dashboard")}
            className="text-[13px] text-mt-ink-3 hover:text-mt-ink-2 transition-colors"
          >
            Skip for now
          </button>
        </div>
      </header>

      {/* Progress bar */}
      {!showResults && (
        <div className="bg-white border-b border-[#F0F0F0] px-6 py-3">
          <div className="max-w-[800px] mx-auto">
            <div className="flex items-center justify-between mb-2">
              {stepLabels.map((label, i) => (
                <button
                  key={i}
                  onClick={() => {
                    if (i + 1 <= currentStep) setCurrentStep((i + 1) as OnboardingStep);
                  }}
                  className={`text-[12px] font-medium transition-colors ${
                    i + 1 === currentStep
                      ? "text-primary"
                      : i + 1 < currentStep
                      ? "text-[#16A34A] cursor-pointer"
                      : "text-[#C4C4C4]"
                  }`}
                >
                  {i + 1 < currentStep ? <CheckCircle2 size={14} className="inline mr-1" /> : null}
                  {label}
                </button>
              ))}
            </div>
            <div className="h-1.5 bg-[#F0F0F0] rounded-full overflow-hidden">
              <div
                className="h-full rounded-full transition-all duration-500"
                style={{
                  width: `${(currentStep / totalSteps) * 100}%`,
                  background: "linear-gradient(90deg, var(--mt-brand), #8B7AFC)",
                }}
              />
            </div>
          </div>
        </div>
      )}

      {/* Content */}
      <main className="flex-1 flex items-start justify-center px-6 py-10">
        <div className="w-full max-w-[640px]">
          {showResults ? (
            /* AI Personalization Results */
            <div className="text-center">
              {!personalization ? (
                <div className="py-20">
                  <div className="w-20 h-20 bg-mt-brand-light rounded-3xl flex items-center justify-center mx-auto mb-6 animate-pulse">
                    <Sparkles size={32} className="text-primary" />
                  </div>
                  <h2 className="text-[24px] font-bold text-mt-ink mb-2">AI is personalizing your experience...</h2>
                  <p className="text-[14px] text-mt-ink-3">Analyzing your profile to recommend the best features and setup</p>
                  <Loader2 size={24} className="animate-spin text-primary mx-auto mt-6" />
                </div>
              ) : (
                <div>
                  <div className="w-20 h-20 bg-[#F0FDF4] rounded-3xl flex items-center justify-center mx-auto mb-6">
                    <Rocket size={32} className="text-[#16A34A]" />
                  </div>
                  <h2 className="text-[28px] font-bold text-mt-ink tracking-tight mb-3">You're all set!</h2>
                  <p className="text-[15px] text-mt-ink-2 leading-relaxed max-w-[480px] mx-auto mb-8">
                    {personalization.welcomeMessage}
                  </p>

                  {/* Recommended Features */}
                  <div className="bg-white rounded-xl border border-mt-border p-6 mb-6 text-left">
                    <h3 className="text-[14px] font-semibold text-mt-ink mb-4 flex items-center gap-2">
                      <Zap size={16} className="text-primary" />
                      Recommended for You
                    </h3>
                    <div className="space-y-3">
                      {personalization.recommendedFeatures?.map((feat: { name: string; description: string; priority: string }, i: number) => (
                        <div key={i} className="flex items-start gap-3 p-3 rounded-lg bg-mt-surface">
                          <div className={`w-2 h-2 rounded-full mt-1.5 flex-shrink-0 ${
                            feat.priority === "high" ? "bg-primary" : "bg-[#C4B5FD]"
                          }`} />
                          <div>
                            <p className="text-[13px] font-semibold text-mt-ink">{feat.name}</p>
                            <p className="text-[12px] text-mt-ink-3">{feat.description}</p>
                          </div>
                          {feat.priority === "high" && (
                            <span className="text-[10px] bg-mt-brand-light text-primary px-2 py-0.5 rounded-full font-medium ml-auto flex-shrink-0">
                              Priority
                            </span>
                          )}
                        </div>
                      ))}
                    </div>
                  </div>

                  {/* First Steps */}
                  <div className="bg-white rounded-xl border border-mt-border p-6 mb-8 text-left">
                    <h3 className="text-[14px] font-semibold text-mt-ink mb-4 flex items-center gap-2">
                      <Target size={16} className="text-primary" />
                      Suggested First Steps
                    </h3>
                    <div className="space-y-2">
                      {personalization.suggestedFirstSteps?.map((step: string, i: number) => (
                        <div key={i} className="flex items-center gap-3 p-2.5">
                          <div className="w-6 h-6 rounded-full bg-mt-brand-light flex items-center justify-center flex-shrink-0">
                            <span className="text-[11px] font-bold text-primary">{i + 1}</span>
                          </div>
                          <p className="text-[13px] text-mt-ink-2">{step}</p>
                        </div>
                      ))}
                    </div>
                  </div>

                  {/* Go to Dashboard */}
                  <button
                    onClick={() => navigate("/dashboard")}
                    className="w-full h-12 bg-primary hover:bg-[#5438E0] text-white rounded-lg text-[15px] font-semibold flex items-center justify-center gap-2 transition-all active:scale-[0.98] shadow-sm hover:shadow-md"
                  >
                    Go to Dashboard <ArrowRight size={18} />
                  </button>
                </div>
              )}
            </div>
          ) : (
            /* Questionnaire Steps — AnimatePresence for smooth step transitions */
            <AnimatePresence mode="wait">
            <motion.div
              key={currentStep}
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -4 }}
              transition={{ duration: 0.25, ease: [0.25, 0.46, 0.45, 0.94] }}
            >
              {/* Step 1: Company Size & Revenue */}
              {currentStep === 1 && (
                <div>
                  <div className="flex items-center gap-3 mb-2">
                    <div className="w-10 h-10 bg-mt-brand-light rounded-xl flex items-center justify-center">
                      <Building2 size={20} className="text-primary" />
                    </div>
                    <div>
                      <h2 className="text-[22px] font-bold text-mt-ink tracking-tight">Tell us about your company</h2>
                      <p className="text-[13px] text-mt-ink-3">This helps us tailor MergeTasks to your scale</p>
                    </div>
                  </div>

                  <div className="mt-8 space-y-6">
                    <div>
                      <label className="block text-[13px] font-semibold text-mt-ink-2 mb-3">How big is your team?</label>
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                        {COMPANY_SIZES.map((size) => (
                          <button
                            key={size.value}
                            onClick={() => setCompanySize(size.value)}
                            className={`p-4 rounded-xl border-2 text-left transition-all active:scale-[0.98] ${
                              companySize === size.value
                                ? "border-primary bg-mt-brand-light"
                                : "border-mt-border hover:border-[#C4B5FD] bg-white"
                            }`}
                          >
                            <p className="text-[14px] font-semibold text-mt-ink">{size.label}</p>
                            <p className="text-[12px] text-mt-ink-3">{size.desc}</p>
                          </button>
                        ))}
                      </div>
                    </div>

                    <div>
                      <label className="block text-[13px] font-semibold text-mt-ink-2 mb-3">Annual revenue range</label>
                      <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                        {REVENUE_RANGES.map((rev) => (
                          <button
                            key={rev.value}
                            onClick={() => setAnnualRevenue(rev.value)}
                            className={`p-3 rounded-xl border-2 text-center transition-all active:scale-[0.98] ${
                              annualRevenue === rev.value
                                ? "border-primary bg-mt-brand-light"
                                : "border-mt-border hover:border-[#C4B5FD] bg-white"
                            }`}
                          >
                            <p className="text-[13px] font-medium text-mt-ink">{rev.label}</p>
                          </button>
                        ))}
                      </div>
                    </div>

                    <div>
                      <label className="block text-[13px] font-semibold text-mt-ink-2 mb-3">Years in business</label>
                      <div className="flex flex-wrap gap-2">
                        {YEARS_OPTIONS.map((yr) => (
                          <button
                            key={yr.value}
                            onClick={() => setYearsInBusiness(yr.value)}
                            className={`px-4 py-2.5 rounded-full border-2 text-[13px] font-medium transition-all active:scale-[0.98] ${
                              yearsInBusiness === yr.value
                                ? "border-primary bg-mt-brand-light text-primary"
                                : "border-mt-border hover:border-[#C4B5FD] text-mt-ink-2 bg-white"
                            }`}
                          >
                            {yr.label}
                          </button>
                        ))}
                      </div>
                    </div>
                  </div>
                </div>
              )}

              {/* Step 2: Specialties */}
              {currentStep === 2 && (
                <div>
                  <div className="flex items-center gap-3 mb-2">
                    <div className="w-10 h-10 bg-mt-brand-light rounded-xl flex items-center justify-center">
                      <Package size={20} className="text-primary" />
                    </div>
                    <div>
                      <h2 className="text-[22px] font-bold text-mt-ink tracking-tight">What are your specialties?</h2>
                      <p className="text-[13px] text-mt-ink-3">Select all product areas you work with</p>
                    </div>
                  </div>

                  <div className="mt-8 grid grid-cols-2 sm:grid-cols-3 gap-2">
                    {SPECIALTIES.map((spec) => (
                      <button
                        key={spec}
                        onClick={() => toggleArrayItem(selectedSpecialties, spec, setSelectedSpecialties)}
                        className={`p-3.5 rounded-xl border-2 text-left transition-all active:scale-[0.98] ${
                          selectedSpecialties.includes(spec)
                            ? "border-primary bg-mt-brand-light"
                            : "border-mt-border hover:border-[#C4B5FD] bg-white"
                        }`}
                      >
                        <p className="text-[13px] font-medium text-mt-ink">{spec}</p>
                        {selectedSpecialties.includes(spec) && (
                          <CheckCircle2 size={14} className="text-primary mt-1" />
                        )}
                      </button>
                    ))}
                  </div>
                  <p className="text-[12px] text-mt-ink-4 mt-3">
                    {selectedSpecialties.length} selected
                  </p>
                </div>
              )}

              {/* Step 3: Target Markets */}
              {currentStep === 3 && (
                <div>
                  <div className="flex items-center gap-3 mb-2">
                    <div className="w-10 h-10 bg-mt-brand-light rounded-xl flex items-center justify-center">
                      <Briefcase size={20} className="text-primary" />
                    </div>
                    <div>
                      <h2 className="text-[22px] font-bold text-mt-ink tracking-tight">Your target markets</h2>
                      <p className="text-[13px] text-mt-ink-3">Help us recommend the right products and templates</p>
                    </div>
                  </div>

                  <div className="mt-8 space-y-6">
                    <div>
                      <label className="block text-[13px] font-semibold text-mt-ink-2 mb-3">Top product categories you sell</label>
                      <div className="grid grid-cols-2 gap-2">
                        {CATEGORIES.map((cat) => (
                          <button
                            key={cat}
                            onClick={() => toggleArrayItem(selectedCategories, cat, setSelectedCategories)}
                            className={`p-3 rounded-xl border-2 text-left transition-all active:scale-[0.98] ${
                              selectedCategories.includes(cat)
                                ? "border-primary bg-mt-brand-light"
                                : "border-mt-border hover:border-[#C4B5FD] bg-white"
                            }`}
                          >
                            <p className="text-[13px] font-medium text-mt-ink">{cat}</p>
                          </button>
                        ))}
                      </div>
                    </div>

                    <div>
                      <label className="block text-[13px] font-semibold text-mt-ink-2 mb-3">Industries you serve</label>
                      <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                        {INDUSTRIES.map((ind) => (
                          <button
                            key={ind}
                            onClick={() => toggleArrayItem(selectedIndustries, ind, setSelectedIndustries)}
                            className={`p-3 rounded-xl border-2 text-center transition-all active:scale-[0.98] ${
                              selectedIndustries.includes(ind)
                                ? "border-primary bg-mt-brand-light"
                                : "border-mt-border hover:border-[#C4B5FD] bg-white"
                            }`}
                          >
                            <p className="text-[12px] font-medium text-mt-ink">{ind}</p>
                          </button>
                        ))}
                      </div>
                    </div>
                  </div>
                </div>
              )}

              {/* Step 4: Primary Goal */}
              {currentStep === 4 && (
                <div>
                  <div className="flex items-center gap-3 mb-2">
                    <div className="w-10 h-10 bg-mt-brand-light rounded-xl flex items-center justify-center">
                      <Target size={20} className="text-primary" />
                    </div>
                    <div>
                      <h2 className="text-[22px] font-bold text-mt-ink tracking-tight">What's your primary goal?</h2>
                      <p className="text-[13px] text-mt-ink-3">We'll prioritize features that help you most</p>
                    </div>
                  </div>

                  <div className="mt-8 space-y-3">
                    {GOALS.map((goal) => (
                      <button
                        key={goal.value}
                        onClick={() => setPrimaryGoal(goal.value)}
                        className={`w-full p-5 rounded-xl border-2 text-left flex items-center gap-4 transition-all active:scale-[0.98] ${
                          primaryGoal === goal.value
                            ? "border-primary bg-mt-brand-light"
                            : "border-mt-border hover:border-[#C4B5FD] bg-white"
                        }`}
                      >
                        <span className="text-[24px]">{goal.icon}</span>
                        <p className="text-[15px] font-medium text-mt-ink">{goal.label}</p>
                        {primaryGoal === goal.value && (
                          <CheckCircle2 size={18} className="text-primary ml-auto" />
                        )}
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {/* Step 5: Current Tools & Team */}
              {currentStep === 5 && (
                <div>
                  <div className="flex items-center gap-3 mb-2">
                    <div className="w-10 h-10 bg-mt-brand-light rounded-xl flex items-center justify-center">
                      <Users size={20} className="text-primary" />
                    </div>
                    <div>
                      <h2 className="text-[22px] font-bold text-mt-ink tracking-tight">Almost done!</h2>
                      <p className="text-[13px] text-mt-ink-3">A couple more details to finalize your setup</p>
                    </div>
                  </div>

                  <div className="mt-8 space-y-6">
                    <div>
                      <label className="block text-[13px] font-semibold text-mt-ink-2 mb-2">
                        What tools do you currently use? <span className="font-normal text-mt-ink-4">(optional)</span>
                      </label>
                      <textarea
                        value={currentTools}
                        onChange={(e) => setCurrentTools(e.target.value)}
                        placeholder="e.g., commonsku, OrderMyGear, Sage Online, spreadsheets, etc."
                        className="w-full h-24 p-3.5 border border-mt-border rounded-xl text-[14px] text-mt-ink placeholder:text-[#C4C4C4] focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary transition-all resize-none"
                      />
                    </div>

                    <div>
                      <label className="block text-[13px] font-semibold text-mt-ink-2 mb-3">
                        How many people will use MergeTasks?
                      </label>
                      <div className="flex flex-wrap gap-2">
                        {["Just me", "2-5", "6-10", "11-25", "25+"].map((size) => (
                          <button
                            key={size}
                            onClick={() => setTeamSize(size)}
                            className={`px-5 py-2.5 rounded-full border-2 text-[13px] font-medium transition-all active:scale-[0.98] ${
                              teamSize === size
                                ? "border-primary bg-mt-brand-light text-primary"
                                : "border-mt-border hover:border-[#C4B5FD] text-mt-ink-2 bg-white"
                            }`}
                          >
                            {size}
                          </button>
                        ))}
                      </div>
                    </div>

                    {/* AI personalization teaser */}
                    <div className="bg-gradient-to-r from-[#F5F3FF] to-[#EDE9FE] rounded-xl p-5 border border-[#DDD6FE]">
                      <div className="flex items-center gap-2 mb-2">
                        <Sparkles size={16} className="text-primary" />
                        <p className="text-[13px] font-semibold text-primary">AI Personalization</p>
                      </div>
                      <p className="text-[12px] text-mt-ink-2 leading-relaxed">
                        Based on your answers, our AI will customize your dashboard, recommend features, and suggest the best first steps for your distributorship.
                      </p>
                    </div>
                  </div>
                </div>
              )}

              {/* Step 6: Branding */}
              {currentStep === 6 && (
                <div>
                  <div className="flex items-center gap-3 mb-2">
                    <div className="w-10 h-10 bg-mt-brand-light rounded-xl flex items-center justify-center">
                      <Palette size={20} className="text-primary" />
                    </div>
                    <div>
                      <h2 className="text-[22px] font-bold text-mt-ink tracking-tight">Brand Your Experience</h2>
                      <p className="text-[13px] text-mt-ink-3">Upload your logo and set brand colors for proposals and emails</p>
                    </div>
                  </div>

                  <div className="mt-8 space-y-6">
                    {/* Logo Upload */}
                    <div>
                      <label className="block text-[13px] font-semibold text-mt-ink-2 mb-3">Company Logo</label>
                      <div className="flex items-center gap-5">
                        <div className="w-[100px] h-[100px] border-2 border-dashed border-mt-border rounded-xl flex items-center justify-center bg-mt-surface overflow-hidden flex-shrink-0">
                          {brandLogoUrl ? (
                            <img src={brandLogoUrl} alt="Logo" className="max-w-[80px] max-h-[80px] object-contain" />
                          ) : (
                            <Upload className="w-6 h-6 text-[#C4C4C4]" />
                          )}
                        </div>
                        <div>
                          <label className={`inline-flex items-center gap-2 px-4 py-2.5 rounded-lg text-[13px] font-semibold cursor-pointer transition-all ${
                            brandLogoUploading ? "bg-mt-surface-2 text-mt-ink-4" : "bg-primary text-white hover:bg-[#5438D8]"
                          }`}>
                            {brandLogoUploading ? (<><Loader2 size={14} className="animate-spin" /> Processing...</>) : (<><Upload size={14} /> Upload Logo</>)}
                            <input type="file" accept="image/*" onChange={handleLogoUpload} disabled={brandLogoUploading} className="hidden" />
                          </label>
                          <p className="text-[11px] text-mt-ink-4 mt-1.5">Background will be automatically removed</p>
                        </div>
                      </div>
                    </div>

                    {/* Company Display Name */}
                    <div>
                      <label className="block text-[13px] font-semibold text-mt-ink-2 mb-2">Company Display Name</label>
                      <input
                        type="text"
                        value={brandCompanyName}
                        onChange={(e) => setBrandCompanyName(e.target.value)}
                        placeholder="e.g., Acme Promotional Products"
                        className="w-full h-11 px-3.5 border border-mt-border rounded-xl text-[14px] text-mt-ink placeholder:text-[#C4C4C4] focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary"
                      />
                    </div>

                    {/* Brand Colors */}
                    <div>
                      <label className="block text-[13px] font-semibold text-mt-ink-2 mb-3">Brand Colors</label>
                      <div className="flex gap-6">
                        <div>
                          <p className="text-[11px] text-mt-ink-3 mb-1.5">Primary</p>
                          <div className="flex items-center gap-2">
                            <input type="color" value={brandPrimaryColor} onChange={(e) => setBrandPrimaryColor(e.target.value)} className="w-10 h-10 rounded-lg border border-mt-border cursor-pointer" style={{ padding: 0 }} />
                            <input type="text" value={brandPrimaryColor} onChange={(e) => { if (/^#[0-9A-Fa-f]{0,6}$/.test(e.target.value)) setBrandPrimaryColor(e.target.value); }} className="w-20 h-10 px-2 border border-mt-border rounded-lg text-[12px] font-mono text-mt-ink focus:outline-none focus:ring-2 focus:ring-primary/20" />
                          </div>
                        </div>
                        <div>
                          <p className="text-[11px] text-mt-ink-3 mb-1.5">Secondary</p>
                          <div className="flex items-center gap-2">
                            <input type="color" value={brandSecondaryColor} onChange={(e) => setBrandSecondaryColor(e.target.value)} className="w-10 h-10 rounded-lg border border-mt-border cursor-pointer" style={{ padding: 0 }} />
                            <input type="text" value={brandSecondaryColor} onChange={(e) => { if (/^#[0-9A-Fa-f]{0,6}$/.test(e.target.value)) setBrandSecondaryColor(e.target.value); }} className="w-20 h-10 px-2 border border-mt-border rounded-lg text-[12px] font-mono text-mt-ink focus:outline-none focus:ring-2 focus:ring-primary/20" />
                          </div>
                        </div>
                      </div>
                    </div>

                    {/* Preview */}
                    <div className="bg-[#F9F9F9] rounded-xl p-4 border border-mt-border">
                      <p className="text-[11px] font-medium text-mt-ink-3 mb-2">EMAIL PREVIEW</p>
                      <div className="rounded-lg overflow-hidden border border-mt-border">
                        <div className="p-3 flex items-center gap-2" style={{ backgroundColor: brandPrimaryColor }}>
                          {brandLogoUrl ? (
                            <img src={brandLogoUrl} alt="Logo" className="h-6 object-contain" style={{ maxWidth: 80 }} />
                          ) : null}
                          <span className="text-white text-[12px] font-semibold">{brandCompanyName || "Your Company"}</span>
                        </div>
                        <div className="p-3 bg-white">
                          <p className="text-[11px] text-mt-ink-2">Hi Client, a new proposal is ready for you...</p>
                          <div className="mt-2 text-center py-1.5 rounded text-white text-[11px] font-semibold" style={{ backgroundColor: brandPrimaryColor }}>View Proposal</div>
                        </div>
                      </div>
                    </div>

                    <p className="text-[11px] text-mt-ink-4">You can update these anytime in Settings &rarr; Branding</p>
                  </div>
                </div>
              )}

              {currentStep === 7 && <OnboardingConnectStep />}

              {/* Navigation buttons */}
              <div className="flex items-center justify-between mt-10 pt-6 border-t border-[#F0F0F0]">
                {currentStep > 1 ? (
                  <button
                    onClick={handleBack}
                    className="h-11 px-5 text-[14px] font-medium text-mt-ink-2 hover:text-mt-ink flex items-center gap-2 transition-colors active:scale-[0.98]"
                  >
                    <ArrowLeft size={16} /> Back
                  </button>
                ) : (
                  <div />
                )}

                {currentStep < totalSteps ? (
                  <button
                    onClick={handleNext}
                    disabled={!canProceed()}
                    className="h-11 px-6 bg-primary hover:bg-[#5438E0] text-white rounded-lg text-[14px] font-semibold flex items-center gap-2 transition-all active:scale-[0.98] disabled:opacity-40 disabled:cursor-not-allowed shadow-sm hover:shadow-md"
                  >
                    Continue <ArrowRight size={16} />
                  </button>
                ) : (
                  <button
                    onClick={handleFinish}
                    disabled={saveOnboarding.isPending || getAI.isPending}
                    className="h-11 px-6 bg-primary hover:bg-[#5438E0] text-white rounded-lg text-[14px] font-semibold flex items-center gap-2 transition-all active:scale-[0.98] disabled:opacity-60 shadow-sm hover:shadow-md"
                  >
                    {saveOnboarding.isPending || getAI.isPending ? (
                      <><Loader2 size={16} className="animate-spin" /> Personalizing...</>
                    ) : (
                      <><Sparkles size={16} /> Finish & Personalize</>
                    )}
                  </button>
                )}
              </div>
            </motion.div>
            </AnimatePresence>
          )}
        </div>
      </main>
    </div>
  );
}
