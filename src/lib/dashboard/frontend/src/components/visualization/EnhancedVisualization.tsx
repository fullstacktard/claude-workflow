/**
 * EnhancedVisualization Component
 *
 * Wraps the medieval village with all the epic visual enhancements:
 * - Day/Night cycle with dynamic lighting
 * - Weather effects (fireflies, rain, leaves)
 * - Agent trail particles
 * - MCP tool magic effects
 * - Village pond
 * - Ambient animations (windmill, smoke, birds, trees)
 * - Data flow visualization
 * - Camera presets
 *
 * All features are toggleable via the control panel.
 *
 * @module components/visualization/EnhancedVisualization
 */

import { useState, useMemo, useCallback } from "react";
import * as THREE from "three";

import { DayNightCycle } from "./DayNightCycle";
import { WeatherSystem, type WeatherType } from "./WeatherSystem";
import { AgentTrails } from "./AgentTrails";
import { MCPToolEffectsManager, type ActiveMCPEffect } from "./MCPToolEffects";
import { VillagePond } from "./VillagePond";
import { AmbientAnimations } from "./AmbientAnimations";
import { DataFlowParticles, type DataConnection } from "./DataFlowParticles";
import {
  useCameraController,
  CameraPresetUI,
  CameraKeyboardShortcuts,
} from "./CameraPresets";

// =============================================================================
// Configuration
// =============================================================================

export interface EnhancedSettings {
  /** Enable day/night cycle */
  dayNightCycle: boolean;
  /** Time of day (0-1, 0.5 = noon) - null for auto-cycling */
  fixedTime: number | null;
  /** Day/night cycle speed */
  cycleSpeed: number;
  /** Weather type */
  weather: WeatherType;
  /** Show agent trails */
  agentTrails: boolean;
  /** Show MCP effects */
  mcpEffects: boolean;
  /** Show village pond */
  villagePond: boolean;
  /** Pond position */
  pondPosition: [number, number, number];
  /** Show ambient animations */
  ambientAnimations: boolean;
  /** Windmill position */
  windmillPosition: [number, number, number];
  /** Show data flow particles */
  dataFlow: boolean;
  /** Show camera controls UI */
  cameraUI: boolean;
  /** Enable keyboard shortcuts */
  keyboardShortcuts: boolean;
  /** Auto-orbit when idle */
  autoOrbit: boolean;
  /** Tree positions around village */
  treePositions: [number, number, number][];
  /** Chimney positions for smoke (will be set from cottages) */
  chimneyPositions: [number, number, number][];
}

export const ENHANCED_DEFAULTS: EnhancedSettings = {
  dayNightCycle: true,
  fixedTime: 0.75,
  cycleSpeed: 0.5,
  weather: "fireflies",
  agentTrails: true,
  mcpEffects: true,
  villagePond: true,
  pondPosition: [-15, 0, 8],
  ambientAnimations: true,
  windmillPosition: [-25, 0, -20],
  dataFlow: false,
  cameraUI: true,
  keyboardShortcuts: true,
  autoOrbit: false,
  treePositions: [
    [-20, 0, 10],
    [-22, 0, 5],
    [20, 0, 12],
    [18, 0, 8],
    [-18, 0, -10],
    [22, 0, -8],
    [-25, 0, 0],
    [25, 0, 0],
  ],
  chimneyPositions: [],
};

// =============================================================================
// Types
// =============================================================================

export interface EnhancedVisualizationProps {
  /** Agent data for trails */
  agents?: Array<{
    id: string;
    type: string;
    position: [number, number, number];
    isWalking: boolean;
  }>;
  /** Active MCP tool effects */
  mcpEffects?: ActiveMCPEffect[];
  /** Data flow connections */
  dataConnections?: DataConnection[];
  /** Override default settings */
  settings?: Partial<EnhancedSettings>;
  /** Cottage positions for chimney smoke */
  cottagePositions?: [number, number, number][];
  /** Callback when MCP effect completes */
  onMCPEffectComplete?: (id: string) => void;
  /** Render the control panel */
  showControlPanel?: boolean;
}

// =============================================================================
// Control Panel Component
// =============================================================================

interface ControlPanelProps {
  settings: EnhancedSettings;
  onSettingChange: <K extends keyof EnhancedSettings>(
    key: K,
    value: EnhancedSettings[K]
  ) => void;
  timeOfDay: number;
}

function ControlPanel({
  settings,
  onSettingChange,
  timeOfDay,
}: ControlPanelProps): JSX.Element {
  const [isOpen, setIsOpen] = useState(false);

  const getTimeLabel = (time: number): string => {
    const hours = Math.floor(time * 24);
    const mins = Math.floor((time * 24 * 60) % 60);
    return `${hours.toString().padStart(2, "0")}:${mins.toString().padStart(2, "0")}`;
  };

  return (
    <div className="absolute top-4 left-20 z-10">
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="bg-gray-800/90 hover:bg-gray-700/90 text-white px-3 py-2 rounded-lg text-sm transition-colors flex items-center gap-2"
      >
        <span className="text-lg">✨</span>
        Effects
        <span className="text-gray-400">{isOpen ? "▲" : "▼"}</span>
      </button>

      {isOpen && (
        <div className="mt-2 bg-gray-900/95 backdrop-blur-sm rounded-lg p-4 w-64 shadow-xl border border-gray-700">
          <h3 className="text-white font-medium mb-3 text-sm">
            Visual Enhancements
          </h3>

          {/* Day/Night Section */}
          <div className="mb-4">
            <label className="flex items-center gap-2 text-gray-300 text-xs mb-2">
              <input
                type="checkbox"
                checked={settings.dayNightCycle}
                onChange={(e) =>
                  onSettingChange("dayNightCycle", e.target.checked)
                }
                className="rounded bg-gray-700 border-gray-600"
              />
              Day/Night Cycle
            </label>

            {settings.dayNightCycle && (
              <div className="ml-4 space-y-2">
                <div className="text-gray-400 text-[10px]">
                  Time: {getTimeLabel(timeOfDay)}
                </div>
                <input
                  type="range"
                  min="0"
                  max="1"
                  step="0.01"
                  value={settings.fixedTime ?? timeOfDay}
                  onChange={(e) =>
                    onSettingChange("fixedTime", parseFloat(e.target.value))
                  }
                  className="w-full h-1 bg-gray-700 rounded-lg appearance-none cursor-pointer"
                />
                <div className="flex justify-between text-[10px] text-gray-500">
                  <span>Midnight</span>
                  <span>Noon</span>
                  <span>Midnight</span>
                </div>
              </div>
            )}
          </div>

          {/* Weather */}
          <div className="mb-4">
            <label className="text-gray-300 text-xs block mb-1">Weather</label>
            <select
              value={settings.weather}
              onChange={(e) =>
                onSettingChange("weather", e.target.value as WeatherType)
              }
              className="w-full bg-gray-700 text-gray-200 text-xs rounded px-2 py-1 border border-gray-600"
            >
              <option value="clear">Clear</option>
              <option value="fireflies">Fireflies</option>
              <option value="rain">Rain</option>
              <option value="autumn">Autumn Leaves</option>
              <option value="dusty">Dust Motes</option>
            </select>
          </div>

          {/* Toggles */}
          <div className="space-y-2">
            <label className="flex items-center gap-2 text-gray-300 text-xs">
              <input
                type="checkbox"
                checked={settings.agentTrails}
                onChange={(e) =>
                  onSettingChange("agentTrails", e.target.checked)
                }
                className="rounded bg-gray-700 border-gray-600"
              />
              Agent Trails
            </label>

            <label className="flex items-center gap-2 text-gray-300 text-xs">
              <input
                type="checkbox"
                checked={settings.mcpEffects}
                onChange={(e) =>
                  onSettingChange("mcpEffects", e.target.checked)
                }
                className="rounded bg-gray-700 border-gray-600"
              />
              MCP Magic Effects
            </label>

            <label className="flex items-center gap-2 text-gray-300 text-xs">
              <input
                type="checkbox"
                checked={settings.villagePond}
                onChange={(e) =>
                  onSettingChange("villagePond", e.target.checked)
                }
                className="rounded bg-gray-700 border-gray-600"
              />
              Village Pond
            </label>

            <label className="flex items-center gap-2 text-gray-300 text-xs">
              <input
                type="checkbox"
                checked={settings.ambientAnimations}
                onChange={(e) =>
                  onSettingChange("ambientAnimations", e.target.checked)
                }
                className="rounded bg-gray-700 border-gray-600"
              />
              Ambient Animations
            </label>

            <label className="flex items-center gap-2 text-gray-300 text-xs">
              <input
                type="checkbox"
                checked={settings.dataFlow}
                onChange={(e) => onSettingChange("dataFlow", e.target.checked)}
                className="rounded bg-gray-700 border-gray-600"
              />
              Data Flow Particles
            </label>

            <label className="flex items-center gap-2 text-gray-300 text-xs">
              <input
                type="checkbox"
                checked={settings.autoOrbit}
                onChange={(e) => onSettingChange("autoOrbit", e.target.checked)}
                className="rounded bg-gray-700 border-gray-600"
              />
              Auto-Orbit Camera
            </label>
          </div>

          <div className="mt-4 pt-3 border-t border-gray-700">
            <div className="text-[10px] text-gray-500">
              Keyboard: 1-8 for camera presets, O for orbit
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// =============================================================================
// Main Component
// =============================================================================

/**
 * EnhancedVisualization component
 *
 * Add this as a child of your Scene3D to enable all visual enhancements.
 *
 * @example
 * ```tsx
 * <Scene3D>
 *   <MedievalAtmosphere />
 *   <EnhancedVisualization
 *     agents={visibleAgents}
 *     mcpEffects={activeMcpEffects}
 *     showControlPanel={true}
 *   />
 *   {// Other scene content}
 * </Scene3D>
 * ```
 */
export function EnhancedVisualization({
  agents = [],
  mcpEffects: externalMcpEffects = [],
  dataConnections = [],
  settings: settingsOverride = {},
  cottagePositions = [],
  onMCPEffectComplete,
  showControlPanel = true,
}: EnhancedVisualizationProps): JSX.Element {
  // Merge settings with defaults
  const [settings, setSettings] = useState<EnhancedSettings>({
    ...ENHANCED_DEFAULTS,
    ...settingsOverride,
  });

  // Track current time for display
  const [currentTime, setCurrentTime] = useState(settings.fixedTime ?? 0.75);

  // Camera controller
  const cameraController = useCameraController({
    initialPreset: "overview",
    autoOrbit: settings.autoOrbit,
    idleTimeout: 30,
  });

  // Generate chimney positions from cottage positions
  const chimneyPositions = useMemo(() => {
    return cottagePositions.map(
      (pos) =>
        [pos[0] + 0.5, pos[1] + 4, pos[2]] as [number, number, number]
    );
  }, [cottagePositions]);

  // Handle setting changes
  const handleSettingChange = useCallback(
    <K extends keyof EnhancedSettings>(
      key: K,
      value: EnhancedSettings[K]
    ) => {
      setSettings((s) => ({ ...s, [key]: value }));
    },
    []
  );

  // Track time changes
  const handleTimeChange = useCallback((time: number) => {
    setCurrentTime(time);
  }, []);

  // Format agents for trail system
  const trailAgents = useMemo(
    () =>
      agents.map((a) => ({
        id: a.id,
        type: a.type,
        position: a.position,
        isWalking: a.isWalking,
      })),
    [agents]
  );

  return (
    <>
      {/* Day/Night Cycle */}
      {settings.dayNightCycle && (
        <DayNightCycle
          enabled={true}
          fixedTime={settings.fixedTime ?? undefined}
          speed={settings.cycleSpeed}
          onTimeChange={handleTimeChange}
        />
      )}

      {/* Weather System */}
      <WeatherSystem
        weather={settings.weather}
        timeOfDay={currentTime}
      />

      {/* Agent Trails */}
      {settings.agentTrails && <AgentTrails agents={trailAgents} />}

      {/* MCP Tool Effects */}
      {settings.mcpEffects && externalMcpEffects.length > 0 && (
        <MCPToolEffectsManager
          effects={externalMcpEffects}
          onEffectComplete={onMCPEffectComplete}
        />
      )}

      {/* Village Pond */}
      {settings.villagePond && (
        <VillagePond position={settings.pondPosition} size={6} />
      )}

      {/* Ambient Animations */}
      {settings.ambientAnimations && (
        <AmbientAnimations
          showWindmill={true}
          windmillPosition={settings.windmillPosition}
          chimneyPositions={chimneyPositions}
          showBirds={true}
          showTrees={true}
          treePositions={settings.treePositions}
        />
      )}

      {/* Data Flow Particles */}
      {settings.dataFlow && dataConnections.length > 0 && (
        <DataFlowParticles connections={dataConnections} />
      )}

      {/* Camera keyboard shortcuts */}
      {settings.keyboardShortcuts && (
        <CameraKeyboardShortcuts controller={cameraController} />
      )}

      {/* Control Panel (HTML overlay - rendered via Html component or portal) */}
      {showControlPanel && (
        <>
          <ControlPanel
            settings={settings}
            onSettingChange={handleSettingChange}
            timeOfDay={currentTime}
          />
          {settings.cameraUI && (
            <CameraPresetUI controller={cameraController} />
          )}
        </>
      )}
    </>
  );
}

export default EnhancedVisualization;
