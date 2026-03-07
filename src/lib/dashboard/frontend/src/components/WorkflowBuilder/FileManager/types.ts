/**
 * File Manager Types
 * TypeScript interfaces for workflow file management
 */

// Re-export storage types (from task-1174)
export type WorkflowTier = 'built-in' | 'user' | 'project';

export interface WorkflowMetadata {
  id: string;
  name: string;
  tier: WorkflowTier;
  path?: string;
  description?: string;
  createdAt: string;
  updatedAt: string;
  readonly?: boolean;
}

// Re-export canvas types (from task-1178)
export interface WorkflowNode {
  id: string;
  type: string;
  position: { x: number; y: number };
  data: Record<string, unknown>;
}

export interface WorkflowEdge {
  id: string;
  source: string;
  target: string;
  type?: string;
}

export interface WorkflowData {
  nodes: WorkflowNode[];
  edges: WorkflowEdge[];
  metadata?: {
    name: string;
    description?: string;
  };
}

export interface CanvasState {
  nodes: WorkflowNode[];
  edges: WorkflowEdge[];
  isDirty: boolean;
  currentFile: WorkflowMetadata | null;
}

// File manager specific types
export type FileOperation = 'new' | 'open' | 'save' | 'saveAs';

export interface ToastMessage {
  type: 'success' | 'error';
  message: string;
}
