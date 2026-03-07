/**
 * EntryNode Component
 * Custom node type for workflow entry points with validation error support
 */

import { Handle, Position } from '@xyflow/react';
import { Terminal } from 'lucide-react';

export interface EntryNodeData {
  label: string;
  validationErrors?: string[];
}

interface EntryNodeProps {
  data: EntryNodeData;
  selected?: boolean;
}

export function EntryNode({ data, selected }: EntryNodeProps): JSX.Element {
  const hasErrors = (data.validationErrors?.length ?? 0) > 0;
  const errorCount = data.validationErrors?.length ?? 0;

  // Status-based styling with distinct selected state
  const borderClass = hasErrors
    ? "border-red-500 border-2 shadow-[0_0_0_2px_rgba(239,68,68,0.3)]"
    : selected
    ? "border-green-400 border-2 shadow-[0_0_0_3px_rgba(74,222,128,0.3)]"
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
        <Terminal className="w-4 h-4 text-green-400" />
        <div className="text-gray-100 text-sm font-medium">Entry</div>
      </div>
      <div className="text-gray-400 text-xs">{data.label}</div>

      {/* Output handle (right side) */}
      <Handle
        type="source"
        position={Position.Right}
        className="!bg-green-400 !w-3 !h-3 !border-2 !border-gray-800"
      />
    </div>
  );
}
