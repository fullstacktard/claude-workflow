/**
 * PhaseNode Component
 * Custom node type for workflow phases with validation error support
 */

import { Handle, Position } from '@xyflow/react';
import { GitBranch } from 'lucide-react';

export interface PhaseNodeData {
  label: string;
  validationErrors?: string[];
}

interface PhaseNodeProps {
  data: PhaseNodeData;
  selected?: boolean;
}

export function PhaseNode({ data, selected }: PhaseNodeProps): JSX.Element {
  const hasErrors = (data.validationErrors?.length ?? 0) > 0;
  const errorCount = data.validationErrors?.length ?? 0;

  // Status-based styling with distinct selected state
  const borderClass = hasErrors
    ? "border-red-500 border-2 shadow-[0_0_0_2px_rgba(239,68,68,0.3)]"
    : selected
    ? "border-blue-400 border-2 shadow-[0_0_0_3px_rgba(96,165,250,0.3)]"
    : "border-gray-600 border";

  const bgClass = hasErrors
    ? "bg-red-900/20"
    : "bg-gray-800";

  return (
    <div className={`px-4 py-3 ${bgClass} ${borderClass} rounded shadow-lg min-w-[150px] relative`}>
      {/* Error badge overlay */}
      {hasErrors && (
        <div className="absolute -top-2 -right-2 bg-red-500 text-white text-xs font-bold rounded-full w-6 h-6 flex items-center justify-center">
          {errorCount}
        </div>
      )}

      <div className="flex items-center gap-2 mb-2">
        <GitBranch className="w-4 h-4 text-blue-400" />
        <div className="text-gray-100 text-sm font-medium">Phase</div>
      </div>
      <div className="text-gray-400 text-xs">{data.label}</div>

      {/* Input handle (left side) */}
      <Handle
        type="target"
        position={Position.Left}
        className="!bg-blue-400 !w-3 !h-3 !border-2 !border-gray-800"
      />

      {/* Output handle (right side) */}
      <Handle
        type="source"
        position={Position.Right}
        className="!bg-blue-400 !w-3 !h-3 !border-2 !border-gray-800"
      />
    </div>
  );
}
