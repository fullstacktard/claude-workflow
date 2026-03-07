/**
 * PersonaContentPanel Component
 *
 * Right panel of the personas master-detail layout.
 * Provides a tabbed interface with 4 tabs:
 * - Detail: Read-only persona summary
 * - Editor: Dual-mode (form/JSON) character file editor with save/export
 * - Preview: Sample tweet generation
 * - Linked: Account association checkboxes
 *
 * Pattern: Replicates XContentPanel.tsx tabbed layout styling.
 *
 * @module components/personas/PersonaContentPanel
 */

import { useState, useCallback, useEffect } from "react";
import { Info, Pencil, Eye, Link2, Download, Code, FormInput } from "lucide-react";

import type { DashboardPersona, PersonaCharacterFile } from "../../types/persona";
import type { DashboardXAccount } from "../../types/x-accounts";
import { createEmptyCharacterFile } from "../../types/persona";
import { TerminalCard } from "../TerminalCard";
import { PersonaFormEditor } from "./PersonaFormEditor";
import { PersonaJsonEditor } from "./PersonaJsonEditor";
import { PersonaPreview } from "./PersonaPreview";
import { LinkedAccounts } from "./LinkedAccounts";
import { dashboardFetch } from "../../utils/dashboard-fetch";

type ContentTab = "detail" | "editor" | "preview" | "linked";

interface PersonaContentPanelProps {
  /** Currently selected persona (null if none) */
  selectedPersona: DashboardPersona | null;
  /** All available X accounts for linking */
  accounts: DashboardXAccount[];
  /** Callback to update a persona's character file */
  onUpdate: (id: string, data: Partial<PersonaCharacterFile>) => Promise<void>;
  /** Callback to generate sample tweets */
  onGenerateSamples: (personaId: string, count?: number, topic?: string) => Promise<string[]>;
  /** Callback to link an X account to a persona */
  onLinkAccount: (personaId: string, accountId: string) => Promise<void>;
  /** Callback to unlink an X account from a persona */
  onUnlinkAccount: (personaId: string, accountId: string) => Promise<void>;
  /** Optional initial topic from ?trend= query param */
  initialTopic?: string;
  /** Optional className for TerminalCard wrapper */
  className?: string;
}

const TABS: Array<{ id: ContentTab; label: string; icon: typeof Info }> = [
  { id: "detail", label: "Detail", icon: Info },
  { id: "editor", label: "Editor", icon: Pencil },
  { id: "preview", label: "Preview", icon: Eye },
  { id: "linked", label: "Linked", icon: Link2 },
];

export function PersonaContentPanel({
  selectedPersona,
  accounts,
  onUpdate,
  onGenerateSamples,
  onLinkAccount,
  onUnlinkAccount,
  initialTopic,
  className = "",
}: PersonaContentPanelProps): JSX.Element {
  const [activeTab, setActiveTab] = useState<ContentTab>(initialTopic ? "preview" : "detail");
  const [editorMode, setEditorMode] = useState<"form" | "json">("form");
  const [characterData, setCharacterData] = useState<PersonaCharacterFile>(createEmptyCharacterFile());
  const [loadingCharFile, setLoadingCharFile] = useState(false);
  const [dirty, setDirty] = useState(false);

  // Fetch full character file when selected persona changes (by ID, not object reference)
  const selectedPersonaId = selectedPersona?.id ?? null;
  useEffect(() => {
    if (selectedPersonaId === null) return;
    let cancelled = false;
    setLoadingCharFile(true);
    void (async () => {
      try {
        const res = await dashboardFetch(`/api/personas/${selectedPersonaId}`);
        if (res.ok && !cancelled) {
          const data = (await res.json()) as { persona: PersonaCharacterFile };
          setCharacterData(data.persona);
          setDirty(false);
        }
      } finally {
        if (!cancelled) setLoadingCharFile(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [selectedPersonaId]);

  const handleCharacterChange = useCallback(
    (data: PersonaCharacterFile): void => {
      setCharacterData(data);
      setDirty(true);
    },
    [],
  );

  const handleSave = useCallback(async (): Promise<void> => {
    if (selectedPersona === null) return;
    await onUpdate(selectedPersona.id, characterData);
    setDirty(false);
  }, [selectedPersona, characterData, onUpdate]);

  const handleExport = useCallback((): void => {
    const json = JSON.stringify(characterData, null, 2);
    const blob = new Blob([json], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `${characterData.name.toLowerCase().replace(/\s+/g, "-")}.character.json`;
    document.body.appendChild(anchor);
    anchor.click();
    document.body.removeChild(anchor);
    URL.revokeObjectURL(url);
  }, [characterData]);

  if (selectedPersona === null) {
    return (
      <TerminalCard command="cat" filename="persona.json" className={className}>
        <div className="flex flex-col items-center justify-center h-full">
          <p className="text-gray-500 text-sm">Select a persona to view details</p>
          <p className="text-gray-600 text-xs mt-1">Choose a persona from the list on the left</p>
        </div>
      </TerminalCard>
    );
  }

  const tabButtons = (
    <div className="flex items-center gap-1.5" role="tablist" aria-label="Persona content tabs">
      {TABS.map((tab) => {
        const Icon = tab.icon;
        const isActive = activeTab === tab.id;
        return (
          <button
            key={tab.id}
            type="button"
            onClick={() => setActiveTab(tab.id)}
            className={`h-7 px-2 sm:px-3 text-xs rounded-md transition-colors border border-red-800 whitespace-nowrap flex items-center gap-1.5 ${
              isActive
                ? "bg-red-600 text-white"
                : "bg-transparent text-gray-400 hover:bg-red-800 hover:text-gray-900"
            }`}
            role="tab"
            aria-selected={isActive}
          >
            <Icon className="w-3 h-3" />
            {tab.label}
          </button>
        );
      })}
    </div>
  );

  return (
    <TerminalCard
      command="cat"
      filename={`personas/${selectedPersona.name.toLowerCase().replace(/\s+/g, "-")}.json`}
      headerText={tabButtons}
      promptActions={
        activeTab === "editor" ? (
          <div className="flex items-center gap-1.5">
            <button
              type="button"
              onClick={() => setEditorMode(editorMode === "form" ? "json" : "form")}
              className="h-6 px-2 text-xs rounded border border-gray-600 text-gray-400 hover:border-red-800 hover:text-gray-300 transition-colors flex items-center gap-1"
            >
              {editorMode === "form" ? <Code className="w-3 h-3" /> : <FormInput className="w-3 h-3" />}
              {editorMode === "form" ? "JSON" : "Form"}
            </button>
            <button
              type="button"
              onClick={handleExport}
              className="h-6 px-2 text-xs rounded border border-gray-600 text-gray-400 hover:border-red-800 hover:text-gray-300 transition-colors flex items-center gap-1"
            >
              <Download className="w-3 h-3" />
              Export
            </button>
            {dirty && (
              <button
                type="button"
                onClick={() => void handleSave()}
                className="h-6 px-2 text-xs rounded border border-red-600 bg-red-600 text-white hover:bg-red-700 transition-colors"
              >
                Save
              </button>
            )}
          </div>
        ) : undefined
      }
      className={className}
      noPadding
    >
      <div className="flex flex-col flex-1 min-h-0 overflow-hidden">
        {activeTab === "detail" && (
          <div className="flex-1 overflow-y-auto p-4">
            <div className="flex flex-col gap-3">
              <div>
                <span className="text-xs text-gray-500 font-mono">name</span>
                <p className="text-sm text-white">{selectedPersona.name}</p>
              </div>
              <div>
                <span className="text-xs text-gray-500 font-mono">bio</span>
                <p className="text-sm text-gray-300">{selectedPersona.bio}</p>
              </div>
              <div>
                <span className="text-xs text-gray-500 font-mono">status</span>
                <p className="text-sm text-gray-300">{selectedPersona.status}</p>
              </div>
              <div>
                <span className="text-xs text-gray-500 font-mono">topics</span>
                <p className="text-sm text-gray-300">{selectedPersona.topicCount} topics defined</p>
              </div>
              <div>
                <span className="text-xs text-gray-500 font-mono">linked accounts</span>
                <p className="text-sm text-gray-300">
                  {(selectedPersona.linkedAccountIds ?? []).length} account(s)
                </p>
              </div>
              <div>
                <span className="text-xs text-gray-500 font-mono">created</span>
                <p className="text-sm text-gray-300">
                  {new Date(selectedPersona.created_at).toLocaleString()}
                </p>
              </div>
              <div>
                <span className="text-xs text-gray-500 font-mono">updated</span>
                <p className="text-sm text-gray-300">
                  {new Date(selectedPersona.updated_at).toLocaleString()}
                </p>
              </div>
            </div>
          </div>
        )}
        {activeTab === "editor" && (
          <div className="flex-1 overflow-y-auto">
            {loadingCharFile ? (
              <div className="flex items-center justify-center h-full">
                <p className="text-gray-500 text-sm animate-pulse">Loading character file...</p>
              </div>
            ) : editorMode === "form" ? (
              <PersonaFormEditor data={characterData} onChange={handleCharacterChange} />
            ) : (
              <PersonaJsonEditor data={characterData} onChange={handleCharacterChange} />
            )}
          </div>
        )}
        {activeTab === "preview" && (
          <div className="flex-1 overflow-y-auto">
            <PersonaPreview
              personaId={selectedPersona.id}
              personaName={selectedPersona.name}
              initialTopic={initialTopic}
              onGenerate={onGenerateSamples}
            />
          </div>
        )}
        {activeTab === "linked" && (
          <div className="flex-1 overflow-y-auto">
            <LinkedAccounts
              personaId={selectedPersona.id}
              linkedAccountIds={selectedPersona.linkedAccountIds ?? []}
              accounts={accounts}
              onLink={onLinkAccount}
              onUnlink={onUnlinkAccount}
            />
          </div>
        )}
      </div>
    </TerminalCard>
  );
}
