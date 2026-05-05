import { useContext } from "react";
import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import NotFound from "@/pages/NotFound";
import { Route, Switch, Redirect, useLocation } from "wouter";
import { motion, AnimatePresence } from "framer-motion";
import { useReducedMotion } from "@/hooks/useReducedMotion";
import Sidebar from "@/components/Sidebar";
import GlobalAIAssistant from "@/components/GlobalAIAssistant";
import ErrorBoundary from "./components/ErrorBoundary";
import { ThemeProvider } from "./contexts/ThemeContext";
import { SidebarContext, SidebarProvider } from "./contexts/SidebarContext";
import Dashboard from "./pages/Dashboard";
import Webstores from "./pages/Webstores";
import Proposals from "./pages/Proposals";
import Curation from "./pages/Curation";
import Settings from "./pages/Settings";
// Integrations.tsx DELETED — /integrations redirects to /settings (Mock-to-Real Guide, Step 3)
import Reports from "./pages/Reports";
import CreateWebstore from "./pages/CreateWebstore";
// ITAdminPortal.tsx preserved but route redirects to /settings (Mock-to-Real Guide, Step 4)
import ProposalDetail from "./pages/ProposalDetail";
import CreateProposal from "./pages/CreateProposal";
import ProposalEditor from "./pages/ProposalEditor";
import EstimateDetail from "./pages/EstimateDetail";
import InvoiceDetail from "./pages/InvoiceDetail";
import StoreManagement from "./pages/StoreManagement";
import StoreProductDetailPage from "./pages/StoreManagement/StoreProductDetailPage";
import PurchaseOrders from "./pages/PurchaseOrders";
import PurchaseOrderDetail from "./pages/PurchaseOrderDetail";
import PurchaseOrderPreview from "./pages/PurchaseOrderPreview";
import WebstorePortal from "./pages/webstore/WebstorePortal";
import LiveStore from "./pages/webstore/LiveStore";
// Marketing /site routes removed — marketing site lives at mergetasks.com
import VirtualProofing from "./pages/VirtualProofing";
import Clients from "./pages/Clients";
import SignIn from "./pages/SignIn";
import SignUp from "./pages/SignUp";
import PublicProposalView from "./pages/PublicProposalView";
import PublicInvoicePay from "./pages/PublicInvoicePay";
import PublicProductDetail from "./pages/PublicProductDetail";
import ProductDetail from "./pages/ProductDetail";
import DepartmentApproval from "./pages/DepartmentApproval";
import StoreApprovalPage from "./pages/StoreApprovalPage";
import Onboarding from "./pages/Onboarding";
import AcceptInvite from "./pages/AcceptInvite";
import AIInsights from "./pages/AIInsights";
import StorePreviewPage from "./pages/StorePreviewPage";
import StoreEditorPage from "./pages/StoreEditorPage";
import PlatformAdmin from "./pages/PlatformAdmin";
import AgentInbox from "./pages/AgentInbox";
import EstimatesList from "./pages/EstimatesList";
import InvoicesList from "./pages/InvoicesList";
import CreateInvoice from "./pages/CreateInvoice";
import CreateEstimate from "./pages/CreateEstimate";
import { TermsPage, PrivacyPage } from "./pages/legal";
import PrivacyPolicy from "./pages/PrivacyPolicy";
import { useAuth } from "./_core/hooks/useAuth";
import { MergeTasksLoader } from "./components/MergeTasksLoader";
import { DistributorSessionTimeout } from "./components/DistributorSessionTimeout";

function AuthRedirect() {
  const { isAuthenticated, loading } = useAuth();
  if (loading) return <LoadingScreen />;
  return <Redirect to={isAuthenticated ? "/dashboard" : "/sign-in"} />;
}

function ProtectedRoute({ component: Component }: { component: React.ComponentType<any> }) {
  const { isAuthenticated, loading } = useAuth();
  if (loading) return <LoadingScreen />;
  if (!isAuthenticated) return <Redirect to="/sign-in" />;
  return <Component />;
}

function AdminRoute({ component: Component }: { component: React.ComponentType<any> }) {
  const { isAuthenticated, loading, user } = useAuth();
  if (loading) return <LoadingScreen />;
  if (!isAuthenticated) return <Redirect to="/sign-in" />;
  if (user?.role !== 'admin') return <Redirect to="/dashboard" />;
  return <Component />;
}

function LoadingScreen() {
  return <MergeTasksLoader variant="page" />;
}

/*  Material Design "standard" easing — starts fast, decelerates at the
    end. The curve Google and Apple use for natural-feeling UI motion.     */
const ROUTE_FADE_EASE: [number, number, number, number] = [0.4, 0, 0.2, 1];

/**
 * AppShell — persistent chrome (Sidebar + AI assistant) for every
 * authenticated route, with a single AnimatePresence that fades and
 * subtly settles the route content while the sidebar/header stay
 * perfectly static.
 *
 * Entrance: opacity 0 → 1 + y: 4 → 0      (0.2s, Material ease)
 * Exit:     opacity 1 → 0                 (0.2s, Material ease)
 * mode="wait" keeps them strictly sequential so old content finishes
 * fading out before new content begins settling in.
 *
 * Sidebar / GlobalAIAssistant are rendered once per shell mount — they
 * live as siblings of the motion wrapper, so the cross-fade does not
 * touch them. Scroll snaps to top at entrance start, and the motion
 * div declares `will-change: opacity, transform` so the browser keeps
 * the layer composited on the GPU.
 */
function AppShell({ children }: { children: React.ReactNode }) {
  const { isAuthenticated, loading } = useAuth();
  const [location] = useLocation();
  const prefersReduced = useReducedMotion();
  const { collapsed } = useContext(SidebarContext);
  // Defer the chrome until auth has resolved so an unauth'd visitor to
  // a protected URL never sees Sidebar flash before the redirect fires.
  const showChrome = isAuthenticated && !loading;
  const duration = prefersReduced ? 0 : 0.2;
  const yOffset = prefersReduced ? 0 : 4;

  return (
    <>
      {showChrome && <Sidebar />}
      {/* NotificationCenter is docked next to StripeStatusPill in DashboardLayout
          (or, for pages that pass `hideHeader`, in the page's own hero). Keeping
          a single render point avoids the previous overlap with the header's
          right-side widgets. */}
      <AnimatePresence mode="wait" initial={false}>
        <motion.div
          key={location}
          initial={{ opacity: 0, y: yOffset }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0 }}
          transition={{ duration, ease: ROUTE_FADE_EASE }}
          onAnimationStart={() => window.scrollTo(0, 0)}
          style={{ willChange: "opacity, transform" }}
          className={`${showChrome ? (collapsed ? 'xl:ml-[64px]' : 'xl:ml-[260px]') : ''} transition-all duration-200`}
        >
          {children}
        </motion.div>
      </AnimatePresence>
      {showChrome && <GlobalAIAssistant />}
    </>
  );
}

function Router() {
  // Two-level Switch: public/token routes render bare so no sidebar
  // flashes for signed-out visitors; everything else falls through to
  // AppShell, which keeps the chrome mounted and animates only the
  // inner content as the inner Switch selects a route.
  return (
    <Switch>
      {/* ——— Public / token-gated routes (no app shell) ——————————————— */}
      <Route path={'/sign-in'} component={SignIn} />
      <Route path={'/sign-up'} component={SignUp} />
      <Route path={'/onboarding'} component={Onboarding} />
      <Route path={'/accept-invite'} component={AcceptInvite} />
      <Route path="/view/proposal/:token/product/:productId" component={PublicProductDetail} />
      <Route path="/view/proposal/:token" component={PublicProposalView} />
      <Route path="/invoices/pay/:token" component={PublicInvoicePay} />
      <Route path="/approve/:token" component={DepartmentApproval} />
      <Route path="/store-approval/:token" component={StoreApprovalPage} />
      <Route path="/s/:slug" nest component={LiveStore} />
      <Route path="/legal/terms" component={TermsPage} />
      <Route path="/legal/privacy" component={PrivacyPage} />
      <Route path="/privacy" component={PrivacyPolicy} />
      <Route path="/site/:rest*">{() => { window.location.replace("https://mergetasks.com"); return null; }}</Route>

      {/* 404 is served outside the shell to preserve the full-bleed 404
         treatment from before this refactor. Any unmatched path inside
         the shell redirects here via the inner fallback below. */}
      <Route path={"/404"} component={NotFound} />

      {/* ——— Everything else — wrapped in AppShell ——————————————————— */}
      <Route>
        <AppShell>
          <Switch>
            <Route path="/"><AuthRedirect /></Route>
            <Route path="/dashboard"><ProtectedRoute component={Dashboard} /></Route>
            <Route path="/webstores"><ProtectedRoute component={Webstores} /></Route>
            <Route path="/proposals"><ProtectedRoute component={Proposals} /></Route>
            <Route path="/proposals/:id"><ProtectedRoute component={ProposalDetail} /></Route>
            <Route path="/create-proposal"><ProtectedRoute component={CreateProposal} /></Route>
            <Route path="/edit-proposal/:id"><ProtectedRoute component={ProposalEditor} /></Route>
            <Route path="/curation/product/:id"><ProtectedRoute component={ProductDetail} /></Route>
            <Route path="/curation"><ProtectedRoute component={Curation} /></Route>
            <Route path="/stores"><Redirect to="/webstores" /></Route>
            <Route path="/integrations"><Redirect to="/settings" /></Route>
            <Route path="/reports"><ProtectedRoute component={Reports} /></Route>
            <Route path="/create-webstore"><ProtectedRoute component={CreateWebstore} /></Route>
            <Route path="/store-management/:id/product/:styleGroup"><ProtectedRoute component={StoreProductDetailPage} /></Route>
            <Route path="/store-management/:id"><ProtectedRoute component={StoreManagement} /></Route>
            <Route path="/store-preview/:id"><ProtectedRoute component={StorePreviewPage} /></Route>
            <Route path="/store-editor/:id"><ProtectedRoute component={StoreEditorPage} /></Route>
            <Route path="/settings"><ProtectedRoute component={Settings} /></Route>
            <Route path="/it-admin"><Redirect to="/settings" /></Route>
            <Route path="/virtual-proofing"><ProtectedRoute component={VirtualProofing} /></Route>
            <Route path="/clients"><ProtectedRoute component={Clients} /></Route>
            <Route path="/ai-insights"><ProtectedRoute component={AIInsights} /></Route>
            <Route path="/agent-inbox"><ProtectedRoute component={AgentInbox} /></Route>
            <Route path="/platform-admin"><AdminRoute component={PlatformAdmin} /></Route>
            <Route path="/documents/estimates"><ProtectedRoute component={EstimatesList} /></Route>
            <Route path="/documents/invoices"><ProtectedRoute component={InvoicesList} /></Route>
            <Route path="/invoices/new"><ProtectedRoute component={CreateInvoice} /></Route>
            <Route path="/estimates/new"><ProtectedRoute component={CreateEstimate} /></Route>
            <Route path="/estimates/:id"><ProtectedRoute component={EstimateDetail} /></Route>
            <Route path="/invoices/:id"><ProtectedRoute component={InvoiceDetail} /></Route>
            <Route path="/purchase-orders"><ProtectedRoute component={PurchaseOrders} /></Route>
            <Route path="/purchase-orders/preview/:token"><ProtectedRoute component={PurchaseOrderPreview} /></Route>
            <Route path="/purchase-orders/:id"><ProtectedRoute component={PurchaseOrderDetail} /></Route>
            {/* Unmatched path inside the shell — redirect out to /404 so
               NotFound renders full-bleed (same as pre-refactor). */}
            <Route><Redirect to="/404" /></Route>
          </Switch>
        </AppShell>
      </Route>
    </Switch>
  );
}

function App() {
  return (
    <ErrorBoundary>
      <ThemeProvider defaultTheme="light">
        <SidebarProvider>
          <TooltipProvider>
            <Toaster />
            {/* Inactivity watchdog. Internally no-ops when the user is not
                authenticated, so it's safe to mount above the Router. */}
            <DistributorSessionTimeout />
            <Router />
          </TooltipProvider>
        </SidebarProvider>
      </ThemeProvider>
    </ErrorBoundary>
  );
}

export default App;
