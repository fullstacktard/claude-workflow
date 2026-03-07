/**
 * NodePalette Component
 * Displays draggable node types for workflow canvas
 */

import { Terminal, GitBranch, Zap, User, Webhook, type LucideIcon } from 'lucide-react';

interface NodeType {
  type: string;
  label: string;
  icon: LucideIcon;
  color: string;
  borderColor: string;
}

const nodeTypes: NodeType[] = [
  { type: 'entry', label: 'Entry', icon: Terminal, color: 'text-green-400', borderColor: 'border-l-green-400' },
  { type: 'phase', label: 'Phase', icon: GitBranch, color: 'text-blue-400', borderColor: 'border-l-blue-400' },
  { type: 'condition', label: 'Condition', icon: Zap, color: 'text-yellow-400', borderColor: 'border-l-yellow-400' },
  { type: 'agent', label: 'Agent', icon: User, color: 'text-purple-400', borderColor: 'border-l-purple-400' },
  { type: 'hook', label: 'Hook', icon: Webhook, color: 'text-cyan-400', borderColor: 'border-l-cyan-400' },
];

export function NodePalette(): JSX.Element {
  const onDragStart = (event: React.DragEvent, nodeType: string): void => {
    event.dataTransfer.setData('application/reactflow', nodeType);
    event.dataTransfer.effectAllowed = 'move';
  };

  return (
    <div className="flex flex-col gap-2">
      <div className="text-gray-400 text-sm font-medium mb-2">Node Types</div>
      {nodeTypes.map(({ type, label, icon: Icon, color, borderColor }) => {
        const iconClassName = `w-5 h-5 ${color}`;
        return (
          <div
            key={type}
            draggable
            onDragStart={(e) => onDragStart(e, type)}
            className={`flex items-center gap-3 px-4 py-3 bg-gray-800 border-l-4 ${borderColor} border border-gray-700 rounded cursor-move hover:bg-gray-700 transition-colors`}
          >
            <Icon className={iconClassName} />
            <span className="text-gray-300 text-sm font-medium">{label}</span>
          </div>
        );
      })}
    </div>
  );
}
