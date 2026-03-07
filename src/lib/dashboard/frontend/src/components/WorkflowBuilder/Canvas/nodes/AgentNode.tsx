/**
 * AgentNode Component
 * Custom node type for workflow agents with validation error support
 */

import { Handle, Position } from '@xyflow/react';
import { User } from 'lucide-react';

export interface AgentNodeData {
  label: string;
  validationErrors?: string[];
}

interface AgentNodeProps {
  data: AgentNodeData;
  selected?: boolean;
}

export function AgentNode({ data, selected }: AgentNodeProps): JSX.Element {
  const hasErrors = (data.validationErrors?.length ?? 0) > 0;
  const errorCount = data.validationErrors?.length ?? 0;

  // Status-based styling with distinct selected state
  const borderClass = hasErrors
    ? "border-red-500 border-2 shadow-[0_0_0_2px_rgba(239,68,68,0.3)]"
    : selected
    ? "border-purple-400 border-2 shadow-[0_0_0_3px_rgba(192,132,252,0.3)]"
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
        <User className="w-4 h-4 text-purple-400" />
        <div className="text-gray-100 text-sm font-medium">Agent</div>
      </div>
      <div className="text-gray-400 text-xs">{data.label}</div>

      {/* Input handle (left side) */}
      <Handle
        type="target"
        position={Position.Left}
        className="!bg-purple-400 !w-3 !h-3 !border-2 !border-gray-800"
      />

      {/* Output handle (right side) */}
      <Handle
        type="source"
        position={Position.Right}
        className="!bg-purple-400 !w-3 !h-3 !border-2 !border-gray-800"
      />
    </div>
  );
}
