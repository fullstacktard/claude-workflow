import { lazy, StrictMode, Suspense } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter, Navigate, Route, Routes } from "react-router-dom";

import { BottomBar } from "./components/BottomBar";
import { ClaudeProxyConfigScreen } from "./pages/ClaudeProxyConfigScreen";
import { CodeEditorPage } from "./pages/CodeEditorPage";
import { AnalyticsPage } from "./pages/AnalyticsPage";
import { DraftsPage } from "./pages/DraftsPage";
import { EmailAccountsPage } from "./pages/EmailAccountsPage";
import { HomePage } from "./pages/HomePage";
import { MarketingPage } from "./pages/MarketingPage";
import { PersonasPage } from "./pages/PersonasPage";
import { TmuxPage } from "./pages/TmuxPage";
import { TrendsPage } from "./pages/TrendsPage";
import { VisualisePage } from "./pages/VisualisePage";
import { XAccountsPage } from "./pages/XAccountsPage";
import { XOpsPage } from "./pages/XOpsPage";
import { ContentCalendarPage } from "./pages/ContentCalendarPage";
import { TemplateGallery } from "./components/WorkflowBuilder/TemplateGallery/TemplateGallery";
import { WorkflowBuilderPage } from "./pages/WorkflowBuilderPage";
import { ConfirmationProvider } from "./contexts/ConfirmationContext";
import { ToastProvider } from "./contexts/ToastContext";
import { useAgentCompletionNotifications } from "./hooks/useAgentCompletionNotifications";
import { useSessionStateNotifications } from "./hooks/useSessionStateNotifications";
import "./styles/globals.css";
import "./styles/dashboard.css";
import "./components/DependencyGraph.css";

// Lazy load the 3D visualization page to avoid loading Three.js on initial page load
const AgentVisualization = lazy(() =>
  import("./pages/AgentVisualization").then((module) => ({
    default: module.AgentVisualization,
  }))
);

/**
 * App-level hook activator for notification system.
 * Must be inside ToastProvider since it uses useToast().
 * Subscribes to agent completions and session state changes.
 */
function NotificationManager({ children }: { children: React.ReactNode }): JSX.Element {
  useAgentCompletionNotifications();
  useSessionStateNotifications();
  return <>{children}</>;
}

// Apply dark mode before React renders to prevent flash of light mode
document.documentElement.classList.add("dark");

const rootElement = document.querySelector("#root");
if (rootElement === null) {
  throw new Error("Failed to find the root element");
}

createRoot(rootElement).render(
  <StrictMode>
    <ToastProvider>
      <ConfirmationProvider>
        <BrowserRouter>
          <NotificationManager>
            {/* Flex column layout: content fills remaining space, BottomBar fixed at bottom */}
            <div className="flex h-screen flex-col bg-gray-950 gap-0.5 pb-px">
              <div className="min-h-0 flex-1 overflow-hidden">
                <Routes>
                  <Route element={<HomePage />} path="/" />
                  <Route element={<ClaudeProxyConfigScreen />} path="/claude-proxy/config" />
                  <Route element={<TemplateGallery />} path="/workflow-templates" />
                  <Route element={<WorkflowBuilderPage />} path="/workflow-builder" />
                  <Route
                    element={
                      <Suspense
                        fallback={
                          <div className="flex h-full items-center justify-center bg-gray-950">
                            <div className="text-gray-400">Loading 3D visualization...</div>
                          </div>
                        }
                      >
                        <AgentVisualization />
                      </Suspense>
                    }
                    path="/visualization"
                  />
                  <Route element={<TmuxPage />} path="/tmux" />
                  <Route element={<VisualisePage />} path="/visualise" />
                  <Route element={<XOpsPage />} path="/x-ops">
                    <Route element={<Navigate replace to="accounts" />} index />
                    <Route element={<XAccountsPage />} path="accounts" />
                    <Route element={<PersonasPage />} path="personas" />
                    <Route element={<DraftsPage />} path="drafts" />
                    <Route element={<TrendsPage />} path="trends" />
                  </Route>
                  <Route element={<EmailAccountsPage />} path="/email-accounts" />
                  <Route element={<CodeEditorPage />} path="/code" />
                  <Route element={<MarketingPage />} path="/marketing" />
                  <Route element={<ContentCalendarPage />} path="/content-calendar" />
                  <Route element={<AnalyticsPage />} path="/analytics" />
                  {/* Redirect any other routes to home */}
                  <Route element={<Navigate replace to="/" />} path="*" />
                </Routes>
              </div>
              <BottomBar />
            </div>
          </NotificationManager>
        </BrowserRouter>
      </ConfirmationProvider>
    </ToastProvider>
  </StrictMode>
);
