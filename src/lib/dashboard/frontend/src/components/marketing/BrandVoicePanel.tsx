/**
 * BrandVoicePanel Component
 *
 * Master-detail layout for brand voice management.
 * Left sidebar: voice list + create button
 * Right panel: BrandVoiceEditor for selected voice
 *
 * Handles CRUD operations via dashboardFetch.
 *
 * @module components/marketing/BrandVoicePanel
 */

import { useCallback, useState } from "react";
import { Mic, Plus } from "lucide-react";

import { dashboardFetch } from "../../utils/dashboard-fetch";
import { useBrandVoices } from "../../hooks/useBrandVoices";
import { useConfirm } from "../../contexts/ConfirmationContext";
import type { BrandVoice, BrandVoiceFormData } from "../../types/marketing";
import { createEmptyBrandVoiceFormData, brandVoiceToFormData } from "../../types/marketing";
import { BrandVoiceCard } from "./BrandVoiceCard";
import { BrandVoiceEditor } from "./BrandVoiceEditor";

type EditorMode = { type: "idle" } | { type: "create" } | { type: "edit"; voice: BrandVoice };

export function BrandVoicePanel(): JSX.Element {
  const { voices, loading, error, refetch, fetchVoice } = useBrandVoices();
  const confirm = useConfirm();

  const [editorMode, setEditorMode] = useState<EditorMode>({ type: "idle" });
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [loadingVoiceId, setLoadingVoiceId] = useState<string | null>(null);

  // Select a voice: fetch full config then show editor
  const handleSelect = useCallback(
    async (id: string) => {
      if (loadingVoiceId) return;
      setSelectedId(id);
      setLoadingVoiceId(id);
      try {
        const voice = await fetchVoice(id);
        setEditorMode({ type: "edit", voice });
      } catch {
        // fetchVoice already handles errors
      } finally {
        setLoadingVoiceId(null);
      }
    },
    [fetchVoice, loadingVoiceId],
  );

  // Create new voice
  const handleCreate = useCallback(() => {
    setSelectedId(null);
    setEditorMode({ type: "create" });
  }, []);

  // Save (create or update)
  const handleSave = useCallback(
    async (data: BrandVoiceFormData) => {
      setIsSaving(true);
      try {
        if (editorMode.type === "create") {
          const response = await dashboardFetch("/api/marketing/brand-voices", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(data),
          });
          if (!response.ok) {
            const body = (await response.json()) as { message?: string };
            throw new Error(body.message ?? "Failed to create brand voice");
          }
        } else if (editorMode.type === "edit") {
          const response = await dashboardFetch(
            `/api/marketing/brand-voices/${editorMode.voice.id}`,
            {
              method: "PUT",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify(data),
            },
          );
          if (!response.ok) {
            const body = (await response.json()) as { message?: string };
            throw new Error(body.message ?? "Failed to update brand voice");
          }
        }
        await refetch();
        setEditorMode({ type: "idle" });
        setSelectedId(null);
      } finally {
        setIsSaving(false);
      }
    },
    [editorMode, refetch],
  );

  // Delete with confirmation
  const handleDelete = useCallback(
    async (id: string) => {
      const voice = voices.find((v) => v.id === id);
      const confirmed = await confirm({
        title: "Delete Brand Voice",
        message: `Are you sure you want to delete "${voice?.name ?? "this voice"}"? This action cannot be undone.`,
        confirmLabel: "Delete",
        variant: "destructive",
      });
      if (!confirmed) return;

      const response = await dashboardFetch(`/api/marketing/brand-voices/${id}`, {
        method: "DELETE",
      });
      if (!response.ok) {
        const body = (await response.json()) as { message?: string };
        throw new Error(body.message ?? "Failed to delete brand voice");
      }
      // If we were editing this voice, close the editor
      if (editorMode.type === "edit" && editorMode.voice.id === id) {
        setEditorMode({ type: "idle" });
        setSelectedId(null);
      }
      await refetch();
    },
    [voices, confirm, editorMode, refetch],
  );

  const handleCancel = useCallback(() => {
    setEditorMode({ type: "idle" });
    setSelectedId(null);
  }, []);

  // Get the form data for the editor
  const getEditorData = (): BrandVoiceFormData => {
    if (editorMode.type === "edit") {
      return brandVoiceToFormData(editorMode.voice);
    }
    return createEmptyBrandVoiceFormData();
  };

  return (
    <div className="flex h-full min-h-0 overflow-hidden">
      {/* Left sidebar: voice list */}
      <div className="w-full lg:w-80 shrink-0 flex flex-col border-r border-gray-800 overflow-hidden">
        {/* Create button */}
        <div className="p-3 border-b border-gray-800 shrink-0">
          <button
            type="button"
            onClick={handleCreate}
            className="w-full h-7 px-3 text-xs rounded-md transition-colors bg-red-700 text-white border border-red-600 hover:bg-red-600 flex items-center justify-center gap-1.5 focus:outline-none focus:ring-2 focus:ring-red-600"
          >
            <Plus className="w-3 h-3" />
            New Brand Voice
          </button>
        </div>

        {/* Voice list */}
        <div className="flex-1 overflow-y-auto p-3 space-y-2">
          {loading && (
            <div className="flex items-center justify-center py-8">
              <div className="spinner w-5 h-5" />
              <span className="ml-2 text-gray-500 text-xs">Loading voices...</span>
            </div>
          )}

          {error && !loading && (
            <div className="p-3 rounded-md border bg-red-900/20 border-red-800/50">
              <p className="text-xs text-red-400">{error.message}</p>
            </div>
          )}

          {!loading && !error && voices.length === 0 && (
            <div className="flex flex-col items-center justify-center py-8">
              <Mic className="w-6 h-6 text-gray-600 mb-2" />
              <p className="text-gray-500 text-xs">No brand voices yet</p>
              <p className="text-gray-600 text-[10px] mt-1">
                Create one to define your content style
              </p>
            </div>
          )}

          {!loading &&
            !error &&
            voices.map((v) => (
              <BrandVoiceCard
                key={v.id}
                voice={v}
                isSelected={selectedId === v.id}
                onSelect={(id) => void handleSelect(id)}
                onDelete={(id) => void handleDelete(id)}
              />
            ))}
        </div>
      </div>

      {/* Right panel: editor or empty state */}
      <div className="hidden lg:flex flex-1 min-w-0 flex-col overflow-hidden">
        {editorMode.type === "idle" && (
          <div className="flex flex-col items-center justify-center h-full">
            <Mic className="w-8 h-8 text-gray-600 mb-2" />
            <p className="text-gray-500 text-sm">Select a voice to edit</p>
            <p className="text-gray-600 text-xs mt-1">
              Or create a new one from the sidebar
            </p>
          </div>
        )}

        {loadingVoiceId && (
          <div className="flex items-center justify-center h-full">
            <div className="spinner w-6 h-6" />
            <span className="ml-2 text-gray-500 text-sm">Loading voice config...</span>
          </div>
        )}

        {(editorMode.type === "create" || editorMode.type === "edit") && !loadingVoiceId && (
          <BrandVoiceEditor
            key={editorMode.type === "edit" ? editorMode.voice.id : "new"}
            initialData={getEditorData()}
            isNew={editorMode.type === "create"}
            isSaving={isSaving}
            onSave={(data) => void handleSave(data)}
            onCancel={handleCancel}
          />
        )}
      </div>
    </div>
  );
}
