/**
 * CompetitorPanel Component
 *
 * Tabbed container for the Marketing page content.
 * Renders three tabs: Competitors (active), Brand Voice (placeholder),
 * Content Generation (placeholder).
 *
 * @module components/marketing/CompetitorPanel
 */

import { useState } from "react";
import { Users, Mic, FileText, Plus, RefreshCw } from "lucide-react";

import type { Competitor, AddCompetitorFormData } from "../../types/marketing";
import { TerminalCard } from "../TerminalCard";
import { CompetitorCard } from "./CompetitorCard";
import { AddCompetitorModal } from "./AddCompetitorModal";
import { BrandVoicePanel } from "./BrandVoicePanel";
import { ContentGenerationPanel } from "./ContentGenerationPanel";

type MarketingTab = "competitors" | "brand_voice" | "content";

const TABS: Array<{ id: MarketingTab; label: string; icon: typeof Users }> = [
  { id: "competitors", label: "Competitors", icon: Users },
  { id: "brand_voice", label: "Brand Voice", icon: Mic },
  { id: "content", label: "Content", icon: FileText },
];

interface CompetitorPanelProps {
  competitors: Competitor[];
  loading: boolean;
  error: Error | null;
  onAddCompetitor: (data: AddCompetitorFormData) => Promise<void>;
  onRemoveCompetitor: (id: string) => Promise<void>;
  onScrapeCompetitor: (handle: string) => Promise<void>;
  onScrapeAll: () => Promise<void>;
  className?: string;
}

export function CompetitorPanel({
  competitors,
  loading,
  error,
  onAddCompetitor,
  onRemoveCompetitor,
  onScrapeCompetitor,
  onScrapeAll,
  className = "",
}: CompetitorPanelProps): JSX.Element {
  const [activeTab, setActiveTab] = useState<MarketingTab>("competitors");
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [scrapingHandles, setScrapingHandles] = useState<Set<string>>(new Set());
  const [isScrapeAllRunning, setIsScrapeAllRunning] = useState(false);

  const handleScrape = async (handle: string): Promise<void> => {
    setScrapingHandles((prev) => new Set(prev).add(handle));
    try {
      await onScrapeCompetitor(handle);
    } finally {
      setScrapingHandles((prev) => {
        const next = new Set(prev);
        next.delete(handle);
        return next;
      });
    }
  };

  const handleScrapeAll = async (): Promise<void> => {
    setIsScrapeAllRunning(true);
    try {
      await onScrapeAll();
    } finally {
      setIsScrapeAllRunning(false);
    }
  };

  const tabButtons = (
    <div className="flex items-center gap-1.5">
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
            aria-pressed={isActive}
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
    <>
      <TerminalCard
        command="cat"
        filename="~/.marketing/competitors"
        headerText={tabButtons}
        className={className}
        noPadding
      >
        <div className="flex flex-col flex-1 min-h-0 overflow-hidden">
          {activeTab === "competitors" && (
            <div className="flex-1 overflow-y-auto">
              {/* Action bar */}
              <div className="flex items-center justify-between gap-2 p-3 border-b border-gray-800">
                <button
                  type="button"
                  onClick={() => setIsModalOpen(true)}
                  className="h-7 px-3 text-xs rounded-md transition-colors bg-red-700 text-white border border-red-600 hover:bg-red-600 flex items-center gap-1.5 focus:outline-none focus:ring-2 focus:ring-red-600"
                >
                  <Plus className="w-3 h-3" />
                  Add Competitor
                </button>
                <button
                  type="button"
                  onClick={() => void handleScrapeAll()}
                  disabled={isScrapeAllRunning || competitors.length === 0}
                  className="h-7 px-3 text-xs rounded-md transition-colors bg-transparent text-gray-400 border border-red-800 hover:bg-red-800 hover:text-gray-900 disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-1.5 focus:outline-none focus:ring-2 focus:ring-red-600"
                >
                  <RefreshCw className={`w-3 h-3 ${isScrapeAllRunning ? "animate-spin" : ""}`} />
                  Scrape All
                </button>
              </div>

              {/* Loading state */}
              {loading && (
                <div className="flex items-center justify-center py-12">
                  <div className="spinner w-6 h-6" />
                  <span className="ml-2 text-gray-500 text-sm">Loading competitors...</span>
                </div>
              )}

              {/* Error state */}
              {error && !loading && (
                <div className="p-4 m-3 rounded-md border bg-red-900/20 border-red-800/50">
                  <p className="text-sm text-red-400">{error.message}</p>
                </div>
              )}

              {/* Empty state */}
              {!loading && !error && competitors.length === 0 && (
                <div className="flex flex-col items-center justify-center py-12">
                  <Users className="w-8 h-8 text-gray-600 mb-2" />
                  <p className="text-gray-500 text-sm">No competitors tracked yet</p>
                  <p className="text-gray-600 text-xs mt-1">
                    Add a competitor to start tracking their engagement
                  </p>
                </div>
              )}

              {/* Competitor cards */}
              {!loading && !error && competitors.length > 0 && (
                <div className="p-3 space-y-2">
                  {competitors.map((c) => (
                    <CompetitorCard
                      key={c.id}
                      competitor={c}
                      onScrape={(h) => void handleScrape(h)}
                      onRemove={(id) => void onRemoveCompetitor(id)}
                      isScraping={scrapingHandles.has(c.handle)}
                    />
                  ))}
                </div>
              )}
            </div>
          )}

          {activeTab === "brand_voice" && (
            <BrandVoicePanel />
          )}

          {activeTab === "content" && (
            <ContentGenerationPanel />
          )}
        </div>
      </TerminalCard>

      <AddCompetitorModal
        isOpen={isModalOpen}
        onClose={() => setIsModalOpen(false)}
        onSubmit={onAddCompetitor}
      />
    </>
  );
}
