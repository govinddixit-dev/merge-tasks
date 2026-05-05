import { initSentryClient, SentryErrorBoundary } from "@/lib/sentry";
import { trpc } from "@/lib/trpc";
// Initialize Sentry before anything else renders
initSentryClient();
import { UNAUTHED_ERR_MSG } from '@shared/const';
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { httpBatchLink, TRPCClientError } from "@trpc/client";
import { createRoot } from "react-dom/client";
import superjson from "superjson";
import App from "./App";
import { getLoginUrl } from "./const";
import "./index.css";
import { getLogger } from "./lib/logger";

const log = getLogger("main");

const queryClient = new QueryClient();

const redirectToLoginIfUnauthorized = (error: unknown) => {
  if (!(error instanceof TRPCClientError)) return;
  if (typeof window === "undefined") return;

  const isUnauthorized = error.message === UNAUTHED_ERR_MSG;

  if (!isUnauthorized) return;

  
  // Skip redirect if already on auth pages
  const authPaths = ["/sign-in", "/sign-up", "/onboarding", "/site"];
  if (authPaths.some(p => window.location.pathname.startsWith(p))) return;

  window.location.href = "/sign-in";
};

queryClient.getQueryCache().subscribe(event => {
  if (event.type === "updated" && event.action.type === "error") {
    const error = event.query.state.error;
    redirectToLoginIfUnauthorized(error);
    log.error("[API Query Error]", error);
  }
});

queryClient.getMutationCache().subscribe(event => {
  if (event.type === "updated" && event.action.type === "error") {
    const error = event.mutation.state.error;
    redirectToLoginIfUnauthorized(error);
    log.error("[API Mutation Error]", error);
  }
});

const trpcClient = trpc.createClient({
  links: [
    httpBatchLink({
      url: "/api/trpc",
      transformer: superjson,
      headers() {
        // Read the CSRF token from the cookie set by the server and send it
        // as a header on every tRPC request (double-submit cookie pattern)
        const csrfToken = document.cookie
          .split("; ")
          .find(row => row.startsWith("csrf_token="))
          ?.split("=")[1];
        return csrfToken ? { "x-csrf-token": csrfToken } : {};
      },
      fetch(input, init) {
        return globalThis.fetch(input, {
          ...(init ?? {}),
          credentials: "include",
        });
      },
    }),
  ],
});

createRoot(document.getElementById("root")!).render(
  <SentryErrorBoundary fallback={<div style={{padding:"2rem",textAlign:"center"}}><h2>Something went wrong</h2><p>Our team has been notified. Please refresh the page.</p></div>}>
    <trpc.Provider client={trpcClient} queryClient={queryClient}>
      <QueryClientProvider client={queryClient}>
        <App />
      </QueryClientProvider>
    </trpc.Provider>
  </SentryErrorBoundary>
);
