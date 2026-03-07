/**
 * WorkflowCanvas Component
 * Main React Flow canvas with drag-and-drop, connection validation,
 * and real-time visual validation feedback
 * Uses @xyflow/react v12.10.0
 */

import { useCallback, useEffect, useState } from 'react';
import {
  ReactFlow,
  Node,
  Edge,
  Controls,
  Background,
  BackgroundVariant,
  MiniMap,
  useNodesState,
  useEdgesState,
  addEdge,
  Connection,
  NodeTypes,
  useReactFlow,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import { TerminalCard } from '../../TerminalCard';
import { EntryNode } from './nodes/EntryNode';
import { PhaseNode } from './nodes/PhaseNode';
import { ConditionNode } from './nodes/ConditionNode';
import { AgentNode } from './nodes/AgentNode';
import { HookNode } from './nodes/HookNode';
import { PropertyPanel, NodeProperties } from '../PropertyPanel';
import { ValidationPanel } from '../Validation/ValidationPanel';
import { useWorkflowValidation } from '../../../hooks/useWorkflowValidation';

// Define node types registry
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const nodeTypes: NodeTypes = {
  entry: EntryNode as any,
  phase: PhaseNode as any,
  condition: ConditionNode as any,
  agent: AgentNode as any,
  hook: HookNode as any,
};

interface WorkflowCanvasProps {
  className?: string;
  /** Called whenever nodes or edges change - exposes state to parent */
  onStateChange?: (nodes: Node[], edges: Edge[], selectedNodeId: string | null) => void;
}

const STORAGE_KEY = 'workflow-canvas-state';
let nodeIdCounter = 1;

export function WorkflowCanvas({ className = '', onStateChange }: WorkflowCanvasProps): JSX.Element {
  // React Flow state hooks - use proper type inference with initial node
  const initialNodes: Node[] = [];
  const initialEdges: Edge[] = [];
  const [nodes, setNodes, onNodesChange] = useNodesState(initialNodes);
  const [edges, setEdges, onEdgesChange] = useEdgesState(initialEdges);
  const { screenToFlowPosition, fitView, setCenter } = useReactFlow();

  // Property panel state (AC #8, #13)
  const [selectedNode, setSelectedNode] = useState<{
    id: string;
    type: 'entry' | 'phase' | 'condition' | 'agent' | 'hook';
    data: NodeProperties;
  } | null>(null);
  const [isPanelOpen, setIsPanelOpen] = useState(false);

  // Validation state (task-1182)
  const { errors, isValidating, getNodeErrors } = useWorkflowValidation(nodes, edges);

  // Load state from localStorage on mount
  useEffect(() => {
    const savedState = localStorage.getItem(STORAGE_KEY);
    if (savedState) {
      try {
        const { nodes: savedNodes, edges: savedEdges } = JSON.parse(savedState);
        setNodes(savedNodes || []);
        setEdges(savedEdges || []);
        // Update counter to avoid ID collisions
        const maxId = savedNodes.reduce((max: number, node: Node) => {
          const match = node.id.match(/-(\d+)$/);
          if (match) {
            return Math.max(max, parseInt(match[1], 10));
          }
          return max;
        }, 0);
        nodeIdCounter = maxId + 1;
      } catch (err) {
        console.error('Failed to load canvas state:', err);
      }
    }
  }, [setNodes, setEdges]);

  // Save state to localStorage on change
  useEffect(() => {
    if (nodes.length > 0 || edges.length > 0) {
      const state = { nodes, edges };
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    }
  }, [nodes, edges]);

  // Report state changes to parent
  useEffect(() => {
    onStateChange?.(nodes, edges, selectedNode?.id ?? null);
  }, [nodes, edges, selectedNode?.id, onStateChange]);

  // Update nodes with validation errors (task-1182 AC #5, #12)
  useEffect(() => {
    setNodes((nds) =>
      nds.map((node) => {
        const nodeErrors = getNodeErrors(node.id);
        const validationErrors = nodeErrors.map((e) => e.message);
        return {
          ...node,
          data: {
            ...node.data,
            validationErrors,
          },
        };
      })
    );
  }, [errors, getNodeErrors, setNodes]);

  // Handle new connections with validation
  const onConnect = useCallback(
    (connection: Connection) => {
      setEdges((eds) => addEdge(connection, eds));
    },
    [setEdges]
  );

  // Handle drop from palette - auto-generate sensible defaults
  const onDrop = useCallback(
    (event: React.DragEvent) => {
      event.preventDefault();

      const type = event.dataTransfer.getData('application/reactflow');
      if (!type) return;

      const position = screenToFlowPosition({
        x: event.clientX,
        y: event.clientY,
      });

      // Count existing nodes of this type for auto-numbering
      const existingCount = nodes.filter((n) => n.type === type).length;
      const nodeNumber = existingCount + 1;

      // Generate smart defaults based on node type
      const defaultData: Record<string, Record<string, unknown>> = {
        entry: {
          label: `Entry ${nodeNumber}`,
          trigger: 'manual',
        },
        phase: {
          label: `Phase ${nodeNumber}`,
          agent: 'frontend-engineer',
          count: '1',
        },
        condition: {
          label: `Condition ${nodeNumber}`,
          expression: 'all_tasks_complete',
        },
        agent: {
          label: `Agent ${nodeNumber}`,
          agentName: 'frontend-engineer',
        },
        hook: {
          label: `Hook ${nodeNumber}`,
          hookType: 'after_phase',
        },
      };

      const newNode: Node = {
        id: `${type}-${nodeIdCounter++}`,
        type,
        position,
        data: defaultData[type] ?? { label: `${type} ${nodeNumber}` },
      };

      setNodes((nds) => nds.concat(newNode));
    },
    [screenToFlowPosition, setNodes, nodes]
  );

  const onDragOver = useCallback((event: React.DragEvent) => {
    event.preventDefault();
    event.dataTransfer.dropEffect = 'move';
  }, []);

  // Connection validation
  const isValidConnection = useCallback((connection: Connection | Edge) => {
    // Business logic: Entry can only connect to Phase
    // Phase can connect to Condition or Agent
    // etc.
    const sourceNode = nodes.find((n) => n.id === connection.source);
    const targetNode = nodes.find((n) => n.id === connection.target);

    if (!sourceNode || !targetNode) return false;

    // Validation rules
    const rules: Record<string, string[]> = {
      entry: ['phase'],
      phase: ['condition', 'agent', 'hook'],
      condition: ['phase', 'agent'],
      agent: ['phase', 'hook'],
      hook: ['phase'],
    };

    return rules[sourceNode.type ?? '']?.includes(targetNode.type ?? '') ?? false;
  }, [nodes]);

  // Handle node deletion
  const onNodesDelete = useCallback((deleted: Node[]) => {
    console.log('Deleted nodes:', deleted);
    // Close property panel if deleted node was selected
    if (selectedNode && deleted.some((n) => n.id === selectedNode.id)) {
      setSelectedNode(null);
      setIsPanelOpen(false);
    }
  }, [selectedNode]);

  // Handle node click to open property panel (AC #8)
  const onNodeClick = useCallback(
    (_event: React.MouseEvent, node: Node) => {
      // Validate node type before casting
      const validTypes = ['entry', 'phase', 'condition', 'agent', 'hook'];
      if (node.type && validTypes.includes(node.type)) {
        setSelectedNode({
          id: node.id,
          type: node.type as 'entry' | 'phase' | 'condition' | 'agent' | 'hook',
          data: {
            id: node.id,
            type: node.type,
            label: (node.data as Record<string, unknown>).label as string || node.type,
            ...node.data,
          } as NodeProperties,
        });
        setIsPanelOpen(true);
      }
    },
    []
  );

  // Handle node property updates from panel (AC #10 - immediate updates)
  const handleNodeUpdate = useCallback(
    (nodeId: string, properties: Partial<NodeProperties>) => {
      setNodes((nds) =>
        nds.map((n) =>
          n.id === nodeId ? { ...n, data: { ...n.data, ...properties } } : n
        )
      );
    },
    [setNodes]
  );

  // Handle panel close
  const handlePanelClose = useCallback(() => {
    setIsPanelOpen(false);
    // Keep selectedNode in state to preserve form data (AC #13)
  }, []);

  // Handle validation error click - select and navigate to node (task-1182 AC #7)
  const handleErrorClick = useCallback(
    (nodeId: string) => {
      // Find the target node
      const targetNode = nodes.find((n) => n.id === nodeId);
      if (!targetNode) return;

      // Select only the target node
      setNodes((nds) =>
        nds.map((node) => ({
          ...node,
          selected: node.id === nodeId,
        }))
      );

      // Center the viewport on the target node with smooth animation
      if (targetNode.position) {
        // Use setCenter for smooth panning to the node
        setCenter(
          targetNode.position.x + 75, // Offset for node width (~150px / 2)
          targetNode.position.y + 40, // Offset for node height (~80px / 2)
          { duration: 500, zoom: 1 }
        );
      }

      // Open property panel for the node
      const validTypes = ['entry', 'phase', 'condition', 'agent', 'hook'];
      if (targetNode.type && validTypes.includes(targetNode.type)) {
        setSelectedNode({
          id: targetNode.id,
          type: targetNode.type as 'entry' | 'phase' | 'condition' | 'agent' | 'hook',
          data: {
            id: targetNode.id,
            type: targetNode.type,
            label: (targetNode.data as Record<string, unknown>).label as string || targetNode.type,
            ...targetNode.data,
          } as NodeProperties,
        });
        setIsPanelOpen(true);
      }
    },
    [nodes, setNodes, setCenter]
  );

  return (
    <TerminalCard
      command="workflow"
      filename="builder.canvas"
      headerText="Workflow Canvas"
      className={className}
      noPadding
    >
      <div className="w-full h-full min-h-[600px] flex flex-col">
        {/* Validation Panel - positioned at top (task-1182 AC #6, #7, #11) */}
        <div className="p-3 border-b border-gray-700 shrink-0">
          <ValidationPanel
            errors={errors}
            onErrorClick={handleErrorClick}
            isValidating={isValidating}
          />
        </div>

        {/* Main content area - canvas and property panel */}
        <div className="flex-1 flex min-h-0">
          {/* Canvas Area */}
          <div className="flex-1 relative" onDrop={onDrop} onDragOver={onDragOver}>
            <ReactFlow
              nodes={nodes}
              edges={edges}
              onNodesChange={onNodesChange}
              onEdgesChange={onEdgesChange}
              onConnect={onConnect}
              onNodesDelete={onNodesDelete}
              onNodeClick={onNodeClick}
              isValidConnection={isValidConnection}
              nodeTypes={nodeTypes}
              deleteKeyCode="Delete"
              fitView
            >
              <Background variant={BackgroundVariant.Dots} />
              <Controls />
              <MiniMap
                nodeColor={(node) => {
                  const colors: Record<string, string> = {
                    entry: '#4ade80',
                    phase: '#60a5fa',
                    condition: '#facc15',
                    agent: '#c084fc',
                    hook: '#22d3ee',
                  };
                  return colors[node.type || 'phase'] || '#6b7280';
                }}
                maskColor="rgba(0, 0, 0, 0.8)"
                className="bg-gray-900 border border-gray-700 rounded-lg"
              />
            </ReactFlow>
            {/* Empty canvas onboarding state */}
            {nodes.length === 0 && (
              <div className="absolute inset-0 flex items-center justify-center pointer-events-none z-10">
                <div className="text-center space-y-4 pointer-events-auto">
                  <div className="w-16 h-16 mx-auto rounded-full bg-gray-800 border border-gray-700 flex items-center justify-center mb-4">
                    <svg className="w-8 h-8 text-gray-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 6v6m0 0v6m0-6h6m-6 0H6" />
                    </svg>
                  </div>
                  <div className="text-gray-400 text-lg font-medium">
                    Drag a node from the palette to start building
                  </div>
                  <div className="text-gray-500 text-sm">
                    Connect nodes to define your workflow phases
                  </div>
                </div>
              </div>
            )}
          </div>

          {/* Property Panel (AC #8, #12, #13) */}
          {isPanelOpen && (
            <PropertyPanel
              selectedNode={selectedNode}
              onNodeUpdate={handleNodeUpdate}
              onClose={handlePanelClose}
            />
          )}
        </div>
      </div>
    </TerminalCard>
  );
}
