/**
 * useServiceHealth - Polls health endpoints for dashboard, claude-proxy, and mcp-proxy
 * Returns status for each service: "healthy" | "unhealthy" | "checking"
 *
 * Endpoints:
 * - /health            - Dashboard backend (also implies WebSocket server health)
 * - /api/status/proxy  - Claude Proxy health (response has `running` boolean)
 * - /api/mcpproxy/status - MCP Proxy health (response has `containerRunning` boolean)
 */

import { useCallback, useEffect, useRef, useState } from "react";

export type ServiceStatus = "healthy" | "unhealthy" | "checking";

export interface ServiceHealthState {
  dashboard: ServiceStatus;
  claudeProxy: ServiceStatus;
  mcpProxy: ServiceStatus;
  codeServer: ServiceStatus;
}

/** Polling interval in milliseconds (30 seconds) */
const POLL_INTERVAL = 30_000;

/** Fetch timeout in milliseconds */
const FETCH_TIMEOUT = 5_000;

async function checkEndpoint(url: string): Promise<boolean> {
  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), FETCH_TIMEOUT);
    const response = await fetch(url, { signal: controller.signal });
    clearTimeout(timeoutId);
    return response.ok;
  } catch {
    return false;
  }
}

async function checkClaudeProxy(): Promise<boolean> {
  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), FETCH_TIMEOUT);
    const response = await fetch("/api/status/proxy", { signal: controller.signal });
    clearTimeout(timeoutId);
    if (!response.ok) return false;
    const data = (await response.json()) as { running?: boolean };
    return data.running === true;
  } catch {
    return false;
  }
}

async function checkMcpProxy(): Promise<boolean> {
  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), FETCH_TIMEOUT);
    const response = await fetch("/api/mcpproxy/status", { signal: controller.signal });
    clearTimeout(timeoutId);
    if (!response.ok) return false;
    const data = (await response.json()) as { containerRunning?: boolean };
    return data.containerRunning === true;
  } catch {
    return false;
  }
}

async function checkCodeServer(): Promise<boolean> {
  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), FETCH_TIMEOUT);
    const response = await fetch("/api/health/services", { signal: controller.signal });
    clearTimeout(timeoutId);
    if (!response.ok) return false;
    const data = (await response.json()) as Array<{ name: string; status: string }>;
    const codeService = data.find((s) => s.name === "code-server");
    return codeService?.status === "healthy";
  } catch {
    return false;
  }
}

export function useServiceHealth(): ServiceHealthState {
  const [health, setHealth] = useState<ServiceHealthState>({
    dashboard: "checking",
    claudeProxy: "checking",
    mcpProxy: "checking",
    codeServer: "checking",
  });

  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const pollHealth = useCallback(async (): Promise<void> => {
    const [dashboardOk, claudeOk, mcpOk, codeOk] = await Promise.all([
      checkEndpoint("/health"),
      checkClaudeProxy(),
      checkMcpProxy(),
      checkCodeServer(),
    ]);

    setHealth({
      dashboard: dashboardOk ? "healthy" : "unhealthy",
      claudeProxy: claudeOk ? "healthy" : "unhealthy",
      mcpProxy: mcpOk ? "healthy" : "unhealthy",
      codeServer: codeOk ? "healthy" : "unhealthy",
    });
  }, []);

  useEffect(() => {
    // Initial check
    void pollHealth();

    // Poll on interval
    intervalRef.current = setInterval(() => {
      void pollHealth();
    }, POLL_INTERVAL);

    return () => {
      if (intervalRef.current !== null) {
        clearInterval(intervalRef.current);
      }
    };
  }, [pollHealth]);

  return health;
}
