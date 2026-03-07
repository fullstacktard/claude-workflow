/**
 * MedievalOverlay Component
 *
 * A game-like HUD overlay for a 3D medieval village visualization built with Three.js.
 * Provides controls for visual effects, displays kingdom statistics, connection status,
 * and includes a music player slot. Uses medieval-themed styling with existing CSS classes.
 *
 * Features:
 * - Home/Dashboard navigation button (stone-textured)
 * - Expandable effects control panel with day/night cycle, weather, and visual toggles
 * - Kingdom statistics display (villages, sessions, agents)
 * - WebSocket connection status indicator with lantern visualization
 * - Music player integration slot via children prop
 *
 * @module components/visualization/MedievalOverlay
 */

import { useState } from "react";
import { Link } from "react-router-dom";

// =============================================================================
// Types
// =============================================================================

/**
 * EffectsSettings interface defines the visual effects configuration
 * for the medieval village 3D scene
 */
export interface EffectsSettings {
  dayNightCycle: boolean;
  fixedTime: number | null;
  weather: "clear" | "fireflies" | "rain" | "autumn" | "dusty";
  agentTrails: boolean;
  villagePond: boolean;
  ambientAnimations: boolean;
  cameraUI: boolean;
}

/**
 * MedievalOverlayProps interface defines all props for the overlay HUD component
 */
export interface MedievalOverlayProps {
  /** Current effects settings state */
  effectsSettings: EffectsSettings;
  /** Updater function for effects settings (receives functional updater) */
  onEffectsChange: (updater: (prev: EffectsSettings) => EffectsSettings) => void;
  /** Number of villages (projects) in the kingdom */
  villageCount: number;
  /** Number of active sessions */
  activeSessionCount: number;
  /** Number of active agents */
  activeAgentCount: number;
  /** WebSocket connection status */
  connectionStatus: "connected" | "reconnecting" | "disconnected";
  /** Whether initial data is still loading */
  isLoading: boolean;
  /** Current time of day (0-1 where 0.5 is noon) */
  currentTime: number;
  /** Function to format time value (0-1) into display string */
  getTimeLabel: (time: number) => string;
  /** Optional children rendered in the music player slot */
  children?: React.ReactNode;
}

// =============================================================================
// Component
// =============================================================================

/**
 * MedievalOverlay - Game HUD overlay for the 3D medieval village visualization
 *
 * Renders absolute-positioned UI elements over the Three.js canvas:
 * - Top-left: Home button + Effects panel
 * - Top-center: Connection status placard
 * - Top-right: Kingdom stats scroll + Music player slot
 *
 * All styling uses existing medieval CSS classes defined in globals.css
 * plus standard Tailwind utilities for positioning and layout.
 */
export function MedievalOverlay({
  effectsSettings,
  onEffectsChange,
  villageCount,
  activeSessionCount,
  activeAgentCount,
  connectionStatus,
  isLoading,
  currentTime,
  getTimeLabel,
  children,
}: MedievalOverlayProps): JSX.Element {
  const [showEffectsPanel, setShowEffectsPanel] = useState(false);

  return (
    <>
      {/* CONNECTION STATUS - Top center with lantern indicator */}
      <div className="absolute top-4 left-1/2 -translate-x-1/2 z-10 flex items-center gap-2">
        {isLoading && (
          <div className="medieval-placard px-3 py-1.5">
            <span className="medieval-placard-text text-sm flex items-center gap-2">
              <span className="text-yellow-400 animate-pulse">&#9679;</span>
              Loading data...
            </span>
          </div>
        )}
        <div className="medieval-placard px-3 py-1.5">
          <span className="medieval-placard-text text-sm flex items-center gap-2">
            <span
              className={`medieval-lantern ${
                connectionStatus === "connected"
                  ? "medieval-lantern--connected"
                  : connectionStatus === "reconnecting"
                    ? "medieval-lantern--reconnecting"
                    : "medieval-lantern--disconnected"
              }`}
            />
            <span>
              {connectionStatus === "connected" && "Connected"}
              {connectionStatus === "reconnecting" && "Reconnecting..."}
              {connectionStatus === "disconnected" && "Disconnected"}
            </span>
          </span>
        </div>
      </div>

      {/* HOME BUTTON - Top-left stone button */}
      <Link
        to="/"
        className="absolute top-4 left-4 medieval-button px-4 py-2 text-sm"
      >
        &#8592; Dashboard
      </Link>

      {/* EFFECTS CONTROL PANEL - Toggle button + expandable parchment panel */}
      <div className="absolute top-4 left-36 z-10">
        <button
          onClick={() => setShowEffectsPanel(!showEffectsPanel)}
          className="medieval-button px-3 py-2 text-sm flex items-center gap-2"
        >
          <span className="text-lg">&#10022;</span>
          Effects
          <span className="text-gray-300">{showEffectsPanel ? "\u25B2" : "\u25BC"}</span>
        </button>

        {showEffectsPanel && (
          <div className="mt-2 medieval-panel p-4 w-72 relative">
            {/* Wax seal decorations */}
            <div className="medieval-seal" style={{ top: -8, left: -8 }} />
            <div className="medieval-seal" style={{ top: -8, right: -8 }} />

            <h3 className="medieval-header text-base mb-4 relative z-10">
              Visual Enchantments
            </h3>

            {/* Day/Night Cycle */}
            <div className="mb-4 relative z-10">
              <label className="flex items-center gap-2 medieval-text text-sm mb-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={effectsSettings.dayNightCycle}
                  onChange={(e) =>
                    onEffectsChange((s) => ({ ...s, dayNightCycle: e.target.checked }))
                  }
                  className="medieval-checkbox"
                />
                Day/Night Cycle
              </label>

              {effectsSettings.dayNightCycle && (
                <div className="ml-6 space-y-2">
                  <div className="medieval-text-muted text-xs">
                    Hour: {getTimeLabel(currentTime)}
                  </div>
                  <input
                    type="range"
                    min="0"
                    max="1"
                    step="0.01"
                    value={effectsSettings.fixedTime ?? currentTime}
                    onChange={(e) =>
                      onEffectsChange((s) => ({
                        ...s,
                        fixedTime: parseFloat(e.target.value),
                      }))
                    }
                    className="w-full medieval-slider"
                  />
                  <div className="flex justify-between text-xs medieval-text-muted">
                    <span>Dawn</span>
                    <span>Noon</span>
                    <span>Dusk</span>
                  </div>
                </div>
              )}
            </div>

            {/* Weather */}
            <div className="mb-4 relative z-10">
              <label className="medieval-text text-sm block mb-1">Weather</label>
              <select
                value={effectsSettings.weather}
                onChange={(e) =>
                  onEffectsChange((s) => ({
                    ...s,
                    weather: e.target.value as EffectsSettings["weather"],
                  }))
                }
                className="w-full medieval-select text-sm px-2 py-1.5"
              >
                <option value="clear">Clear Skies</option>
                <option value="fireflies">Fireflies (Night)</option>
                <option value="rain">Rainfall</option>
                <option value="autumn">Autumn Leaves</option>
                <option value="dusty">Dust Motes</option>
              </select>
            </div>

            {/* Toggles */}
            <div className="space-y-2.5 relative z-10">
              <label className="flex items-center gap-2 medieval-text text-sm cursor-pointer">
                <input
                  type="checkbox"
                  checked={effectsSettings.agentTrails}
                  onChange={(e) =>
                    onEffectsChange((s) => ({ ...s, agentTrails: e.target.checked }))
                  }
                  className="medieval-checkbox"
                />
                Agent Trails
              </label>

              <label className="flex items-center gap-2 medieval-text text-sm cursor-pointer">
                <input
                  type="checkbox"
                  checked={effectsSettings.villagePond}
                  onChange={(e) =>
                    onEffectsChange((s) => ({ ...s, villagePond: e.target.checked }))
                  }
                  className="medieval-checkbox"
                />
                Village Pond
              </label>

              <label className="flex items-center gap-2 medieval-text text-sm cursor-pointer">
                <input
                  type="checkbox"
                  checked={effectsSettings.ambientAnimations}
                  onChange={(e) =>
                    onEffectsChange((s) => ({
                      ...s,
                      ambientAnimations: e.target.checked,
                    }))
                  }
                  className="medieval-checkbox"
                />
                Ambient (Windmill/Birds/Trees)
              </label>
            </div>

            <div className="mt-4 pt-3 border-t-2 border-dashed relative z-10" style={{ borderColor: "#8b4513" }}>
              <div className="text-xs medieval-text-muted italic">
                Tip: Adjust the time slider to witness dawn and dusk
              </div>
            </div>
          </div>
        )}
      </div>

      {/* KINGDOM STATS - Top-right scroll widget */}
      <div className="absolute top-4 right-4 medieval-scroll px-5 py-4">
        <h4 className="medieval-header text-sm mb-3 text-center" style={{ marginBottom: "12px" }}>
          Kingdom Stats
        </h4>
        <div className="space-y-2 relative z-10">
          <div className="medieval-stat">
            <span className="medieval-stat-icon">&#127984;</span>
            <span className="medieval-stat-value">{villageCount}</span>
            <span className="medieval-stat-label">Villages</span>
          </div>
          <div className="medieval-stat">
            <span className="medieval-stat-icon">&#128220;</span>
            <span className="medieval-stat-value">{activeSessionCount}</span>
            <span className="medieval-stat-label">Active Sessions</span>
          </div>
          <div className="medieval-stat">
            <span className="medieval-stat-icon">&#9876;</span>
            <span className="medieval-stat-value">{activeAgentCount}</span>
            <span className="medieval-stat-label">Active Agents</span>
          </div>
        </div>
      </div>

      {/* MUSIC PLAYER SLOT - Below Kingdom Stats */}
      {children && (
        <div className="absolute top-44 right-4 z-10">
          {children}
        </div>
      )}
    </>
  );
}
