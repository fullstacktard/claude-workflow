# YAMLPreviewPanel Component

Real-time YAML preview panel for the visual workflow builder. Uses Monaco Editor to display syntax-highlighted YAML output as workflows are built on the canvas.

## Features

- **Syntax Highlighting**: Full YAML syntax highlighting with custom dark theme
- **Debounced Updates**: 500ms debounce prevents excessive re-renders during rapid canvas changes
- **Read-Only Mode**: Preview-only, no inline editing to prevent confusion
- **Copy to Clipboard**: One-click copy of entire YAML content with visual feedback
- **Auto-Scroll**: Automatically scrolls to relevant YAML section when node is selected on canvas
- **Line Highlighting**: Temporarily highlights the scrolled-to line for visual feedback
- **Performance Optimized**: Memoized options, efficient line mapping

## Installation

Monaco Editor is already included in the dashboard package dependencies:

```json
{
  "@monaco-editor/react": "^4.7.0",
  "monaco-editor": "^0.55.1"
}
```

## Usage

```tsx
import { YAMLPreviewPanel } from './components/WorkflowBuilder/YAMLPreview';
import { graphToYaml } from '../../../services/workflow-serializer';

function WorkflowBuilder() {
  const [graphData, setGraphData] = useState<GraphData | null>(null);
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);

  return (
    <div className="flex h-full">
      {/* Canvas on left */}
      <div className="flex-1">
        <WorkflowCanvas
          graphData={graphData}
          onGraphChange={setGraphData}
          onNodeSelect={setSelectedNodeId}
        />
      </div>

      {/* YAML Preview on right */}
      <div className="w-96">
        <YAMLPreviewPanel
          graphData={graphData}
          selectedNodeId={selectedNodeId}
          graphToYaml={graphToYaml}
        />
      </div>
    </div>
  );
}
```

## Props

| Prop | Type | Required | Description |
|------|------|----------|-------------|
| `graphData` | `GraphData \| null` | Yes | Workflow graph data from canvas state |
| `selectedNodeId` | `string \| null` | No | ID of currently selected node for auto-scroll |
| `className` | `string` | No | Additional CSS classes for container |
| `graphToYaml` | `(graph: GraphData) => string` | Yes | Function to convert graph to YAML string |

## States

### Empty State
When `graphData` is null, displays a placeholder message.

### Error State
When YAML generation fails, displays error message with alert icon.

### Loading State
Shows "Generating..." indicator during debounced YAML conversion.

### Active State
Displays Monaco Editor with syntax-highlighted YAML content.

## Performance Considerations

1. **Debouncing**: YAML generation is debounced by 500ms to prevent excessive computation during rapid canvas changes (dragging nodes, connecting edges).

2. **Memoization**: Editor options are memoized to prevent Monaco re-initialization on every render.

3. **Lazy Line Mapping**: Node-to-line mapping is only updated when YAML content changes, not on every selection change.

4. **Performance Warnings**: Console warnings are logged if YAML conversion takes >100ms, helping identify performance issues with large workflows.

## Theme Customization

The component uses a custom `yaml-dark` theme that matches the dashboard's dark mode:

- Background: `#0c0c0c` (gray-950)
- Foreground: `#e2e8f0` (text-gray-200)
- Line highlight: `#1f2937` (gray-800)
- Selection: `#374151` (gray-700)

YAML token colors:
- Keys: `#9CDCFE` (blue)
- Strings: `#CE9178` (orange)
- Numbers: `#B5CEA8` (green)
- Comments: `#6A9955` (green-gray)
- Types: `#4EC9B0` (teal)

## CSS Dependencies

The component requires these CSS classes in `globals.css`:

```css
.yaml-highlight-line {
  background-color: rgba(239, 68, 68, 0.2) !important;
  animation: yaml-highlight-fade 2s ease-out forwards;
}

@keyframes yaml-highlight-fade {
  0% { background-color: rgba(239, 68, 68, 0.3); }
  100% { background-color: transparent; }
}

.yaml-highlight-glyph {
  background-color: var(--color-primary);
  width: 3px !important;
  margin-left: 3px;
  border-radius: 1px;
}
```

## Accessibility

- Copy button has `aria-label` for screen readers
- Error icons are decorative (`aria-hidden="true"`)
- Button states are keyboard accessible
- Focus ring on copy button for keyboard navigation

## Related Components

- **WorkflowCanvas**: Provides graph data and node selection
- **PropertyPanel**: Companion panel for editing node properties
- **ValidationPanel**: Shows validation errors for the workflow

## Dependencies

- `@monaco-editor/react`: React wrapper for Monaco Editor
- `monaco-editor`: Core Monaco Editor package
- `lucide-react`: Icons (Copy, Check, AlertCircle)

## Future Enhancements (Out of Scope)

- Two-way sync (YAML edits update canvas)
- YAML validation with inline error indicators
- Syntax highlighting for custom YAML extensions
- Download YAML file functionality
- YAML diff view when comparing workflow versions
