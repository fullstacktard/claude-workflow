/**
 * PersonasPage Component
 *
 * Master-detail layout for persona management. Replicates the XAccountsPage
 * pattern: 12-column grid with 4-col left panel (PersonaList) and 8-col
 * right panel (PersonaContentPanel).
 *
 * Composes all persona sub-components and wires up API callbacks via
 * dashboardFetch. Uses usePersonas for list data and useXAccounts for
 * the linked-accounts feature.
 *
 * @module pages/PersonasPage
 */

import { useCallback, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { usePersonas } from "../hooks/usePersonas";
import { useXAccounts } from "../hooks/useXAccounts";
import { PersonaList } from "../components/personas/PersonaList";
import { PersonaContentPanel } from "../components/personas/PersonaContentPanel";
import { dashboardFetch } from "../utils/dashboard-fetch";
import type { PersonaCharacterFile } from "../types/persona";

export function PersonasPage(): JSX.Element {
  const [searchParams] = useSearchParams();
  const initialTopic = searchParams.get("trend") ?? undefined;

  const { personas, loading, error, refetch } = usePersonas();
  const { accounts } = useXAccounts();
  const [selectedPersonaId, setSelectedPersonaId] = useState<string | null>(null);

  const selectedPersona = personas.find((p) => p.id === selectedPersonaId) ?? null;

  const handleCreatePersona = useCallback(
    async (data: Partial<PersonaCharacterFile>): Promise<void> => {
      const response = await dashboardFetch("/api/personas", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
      });
      if (!response.ok) {
        const body = (await response.json()) as { message?: string };
        throw new Error(body.message ?? "Failed to create persona");
      }
      void refetch();
    },
    [refetch],
  );

  const handleUpdatePersona = useCallback(
    async (id: string, data: Partial<PersonaCharacterFile>): Promise<void> => {
      const response = await dashboardFetch(`/api/personas/${id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
      });
      if (!response.ok) {
        const body = (await response.json()) as { message?: string };
        throw new Error(body.message ?? "Failed to update persona");
      }
      void refetch();
    },
    [refetch],
  );

  const handleGenerateSamples = useCallback(
    async (personaId: string, count?: number, topic?: string): Promise<string[]> => {
      const payload: Record<string, unknown> = { count: count ?? 3 };
      if (topic) payload["topic"] = topic;
      const response = await dashboardFetch(
        `/api/personas/${personaId}/generate`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        },
      );
      if (!response.ok) {
        const body = (await response.json()) as { message?: string };
        throw new Error(body.message ?? "Failed to generate samples");
      }
      const data = (await response.json()) as { tweets: string[] };
      return data.tweets;
    },
    [],
  );

  const handleLinkAccount = useCallback(
    async (personaId: string, accountId: string): Promise<void> => {
      const response = await dashboardFetch(
        `/api/personas/${personaId}/link`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ account_id: accountId }),
        },
      );
      if (!response.ok) {
        const body = (await response.json()) as { message?: string };
        throw new Error(body.message ?? "Failed to link account");
      }
      void refetch();
    },
    [refetch],
  );

  const handleUnlinkAccount = useCallback(
    async (personaId: string, accountId: string): Promise<void> => {
      const response = await dashboardFetch(
        `/api/personas/${personaId}/link/${accountId}`,
        { method: "DELETE" },
      );
      if (!response.ok) {
        const body = (await response.json()) as { message?: string };
        throw new Error(body.message ?? "Failed to unlink account");
      }
      void refetch();
    },
    [refetch],
  );

  return (
    <div className="flex h-full flex-col bg-gray-950 p-3 sm:p-6 gap-3 overflow-hidden">
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-3 flex-1 min-h-0">
        {/* Left Panel: Persona list */}
        <div className="lg:col-span-4 flex flex-col min-h-0">
          <PersonaList
            personas={personas}
            loading={loading}
            error={error}
            selectedId={selectedPersonaId}
            onSelect={setSelectedPersonaId}
            onCreate={handleCreatePersona}
            className="flex-1 min-h-0"
          />
        </div>

        {/* Right Panel: Tabbed content */}
        <div className="lg:col-span-8 flex flex-col min-h-0">
          <PersonaContentPanel
            selectedPersona={selectedPersona}
            accounts={accounts}
            onUpdate={handleUpdatePersona}
            onGenerateSamples={handleGenerateSamples}
            onLinkAccount={handleLinkAccount}
            onUnlinkAccount={handleUnlinkAccount}
            initialTopic={initialTopic}
            className="flex-1 min-h-0"
          />
        </div>
      </div>
    </div>
  );
}
