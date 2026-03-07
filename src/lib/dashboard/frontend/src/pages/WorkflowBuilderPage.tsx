/**
 * WorkflowBuilderPage
 * Full-page visual workflow builder with canvas, palette, YAML preview, and file management
 */

import { useCallback, useState, useRef } from "react";
import { Link } from "react-router-dom";
import { ArrowLeft, PanelRightOpen, PanelRightClose } from "lucide-react";
import { ReactFlowProvider, type Node, type Edge } from "@xyflow/react";
import { WorkflowCanvas } from "../components/WorkflowBuilder/Canvas/WorkflowCanvas";
import { NodePalette } from "../components/WorkflowBuilder/Canvas/NodePalette";
import { FileToolbar } from "../components/WorkflowBuilder/FileManager/FileToolbar";
import { YAMLPreviewPanel } from "../components/WorkflowBuilder/YAMLPreview/YAMLPreviewPanel";
import { canvasToYaml } from "../utils/graphToYaml";
import type { CanvasState, WorkflowMetadata } from "../components/WorkflowBuilder/FileManager/types";
import type { GraphData } from "../types/graph";
import type { AgentCount } from "../../../../workflow/types.js";

export function WorkflowBuilderPage(): JSX.Element {
  // Canvas state mirror - updated via onStateChange callback
  const [canvasNodes, setCanvasNodes] = useState<Node[]>([]);
  const [canvasEdges, setCanvasEdges] = useState<Edge[]>([]);
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [isDirty, setIsDirty] = useState(false);
  const [currentFile, setCurrentFile] = useState<WorkflowMetadata | null>(null);
  const [showYamlPanel, setShowYamlPanel] = useState(true);
  const initialStateRef = useRef<string>("");

  // Track state changes from canvas
  const handleStateChange = useCallback(
    (nodes: Node[], edges: Edge[], selNodeId: string | null) => {
      setCanvasNodes(nodes);
      setCanvasEdges(edges);
      setSelectedNodeId(selNodeId);

      // Track dirty state
      const currentState = JSON.stringify({ nodes, edges });
      if (initialStateRef.current && currentState !== initialStateRef.current) {
        setIsDirty(true);
      }
      if (!initialStateRef.current && nodes.length > 0) {
        initialStateRef.current = currentState;
      }
    },
    []
  );

  // Build GraphData for YAML preview (adapts canvas nodes to GraphData shape)
  const graphData: GraphData | null =
    canvasNodes.length > 0
      ? {
          nodes: canvasNodes.map((n) => ({
            id: n.id,
            type: n.type || "phase",
            position: n.position,
            data: {
              label: (n.data as Record<string, unknown>).label as string || n.id,
              agent: (n.data as Record<string, unknown>).agent as string || "",
              count: ((n.data as Record<string, unknown>).count as AgentCount) || 1,
              description: (n.data as Record<string, unknown>).description as string | undefined,
              nextConditions: [],
            },
          })),
          edges: canvasEdges.map((e) => ({
            id: e.id,
            source: e.source,
            target: e.target,
            type: e.type,
            data: e.data as { label?: string; conditional?: boolean } | undefined,
          })),
          metadata: {
            name: "visual-workflow",
            description: "Created in workflow builder",
          },
        }
      : null;

  // graphToYaml adapter using client-side converter
  const graphToYaml = useCallback(
    (_graphData: GraphData): string => {
      return canvasToYaml(canvasNodes, canvasEdges);
    },
    [canvasNodes, canvasEdges]
  );

  // Canvas state for FileToolbar
  const canvasState: CanvasState = {
    nodes: canvasNodes.map((n) => ({
      id: n.id,
      type: n.type || "phase",
      position: n.position,
      data: n.data as Record<string, unknown>,
    })),
    edges: canvasEdges.map((e) => ({
      id: e.id,
      source: e.source,
      target: e.target,
      type: e.type,
    })),
    isDirty,
    currentFile,
  };

  // File operations
  const handleNew = useCallback(() => {
    localStorage.removeItem("workflow-canvas-state");
    setCurrentFile(null);
    setIsDirty(false);
    initialStateRef.current = "";
    // Reload to clear canvas state
    window.location.reload();
  }, []);

  const handleOpen = useCallback((_workflow: WorkflowMetadata) => {
    // TODO: Load workflow content from API and populate canvas
    setCurrentFile(_workflow);
    setIsDirty(false);
  }, []);

  const handleSave = useCallback(async () => {
    if (!currentFile) return;

    const yamlContent = canvasToYaml(canvasNodes, canvasEdges);
    const response = await fetch(
      `/api/workflows/${currentFile.tier}/${currentFile.name}`,
      {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content: { yaml: yamlContent } }),
      }
    );

    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.message || "Failed to save workflow");
    }

    setIsDirty(false);
    initialStateRef.current = JSON.stringify({
      nodes: canvasNodes,
      edges: canvasEdges,
    });
  }, [currentFile, canvasNodes, canvasEdges]);

  const handleSaveAs = useCallback(
    async (name: string, tier: "user" | "project") => {
      const yamlContent = canvasToYaml(canvasNodes, canvasEdges);
      const response = await fetch(`/api/workflows/${tier}/${name}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content: { yaml: yamlContent } }),
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.message || "Failed to save workflow");
      }

      setCurrentFile({
        id: `${tier}-${name}`,
        name,
        tier,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      });
      setIsDirty(false);
      initialStateRef.current = JSON.stringify({
        nodes: canvasNodes,
        edges: canvasEdges,
      });
    },
    [canvasNodes, canvasEdges]
  );

  return (
    <div className="flex flex-col h-full bg-gray-950 text-gray-100">
      {/* Top bar */}
      <div className="flex items-center gap-4 px-4 py-2 bg-gray-900 border-b border-gray-800 shrink-0">
        <Link
          to="/"
          className="flex items-center gap-2 text-sm text-gray-400 hover:text-white transition-colors"
        >
          <ArrowLeft className="w-4 h-4" />
          <span>Dashboard</span>
        </Link>
        <div className="h-4 w-px bg-gray-700" />
        <h1 className="text-sm font-medium text-gray-200">Workflow Builder</h1>
        <div className="ml-auto">
          <button
            onClick={() => setShowYamlPanel((v) => !v)}
            className="flex items-center gap-1.5 px-2 py-1 text-xs text-gray-400 hover:text-white rounded transition-colors"
            title={showYamlPanel ? "Hide YAML Preview" : "Show YAML Preview"}
          >
            {showYamlPanel ? (
              <PanelRightClose className="w-4 h-4" />
            ) : (
              <PanelRightOpen className="w-4 h-4" />
            )}
            <span>YAML</span>
          </button>
        </div>
      </div>

      {/* File Toolbar */}
      <FileToolbar
        canvasState={canvasState}
        onNew={handleNew}
        onOpen={handleOpen}
        onSave={handleSave}
        onSaveAs={handleSaveAs}
      />

      {/* Main content */}
      <div className="flex flex-1 min-h-0">
        {/* Left sidebar - Node Palette */}
        <div className="w-48 shrink-0 p-3 bg-gray-900 border-r border-gray-800 overflow-y-auto">
          <NodePalette />
        </div>

        {/* Canvas area */}
        <div className="flex-1 min-w-0">
          <ReactFlowProvider>
            <WorkflowCanvas
              className="h-full"
              onStateChange={handleStateChange}
            />
          </ReactFlowProvider>
        </div>

        {/* YAML Preview Panel */}
        {showYamlPanel && (
          <div className="w-80 shrink-0">
            <YAMLPreviewPanel
              graphData={graphData}
              selectedNodeId={selectedNodeId}
              graphToYaml={graphToYaml}
              className="h-full"
            />
          </div>
        )}
      </div>
    </div>
  );
}
