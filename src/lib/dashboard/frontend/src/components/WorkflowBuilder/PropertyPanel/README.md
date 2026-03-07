# PropertyPanel Component

Dynamic form panel for editing workflow node properties in the visual workflow builder.

## Overview

The `PropertyPanel` component provides a type-safe, schema-driven interface for configuring workflow nodes. It displays when a node is selected on the React Flow canvas and renders different form fields based on the node type (Entry, Phase, Condition, Agent, or Hook).

## Architecture

```
PropertyPanel/
├── PropertyPanel.tsx      # Main component with form rendering logic
├── nodeSchemas.ts         # Type definitions and field schemas
├── index.ts               # Public exports
└── README.md              # This file
```

### Key Features

- **Schema-driven forms** - Fields are defined declaratively in `NODE_FIELD_SCHEMAS`
- **Type-safe** - Full TypeScript support with discriminated unions
- **Immediate updates** - Property changes sync to canvas without save button
- **Inline validation** - Field-level validation with error messages
- **Accessibility** - Keyboard navigation, focus management, ARIA labels
- **Conditional fields** - Fields can be shown/hidden based on other field values

## Component API

### PropertyPanel Props

```typescript
interface PropertyPanelProps {
  selectedNode: {
    id: string;
    type: 'entry' | 'phase' | 'condition' | 'agent' | 'hook';
    data: NodeProperties;
  } | null;
  onNodeUpdate: (nodeId: string, properties: Partial<NodeProperties>) => void;
  onClose: () => void;
}
```

**Props:**
- `selectedNode` - Currently selected node from React Flow canvas (null if none selected)
- `onNodeUpdate` - Callback to update node properties on canvas
- `onClose` - Callback when user closes panel

### Usage Example

```tsx
import { PropertyPanel, NodeProperties } from './PropertyPanel';

function WorkflowCanvas() {
  const [selectedNode, setSelectedNode] = useState(null);
  const [isPanelOpen, setIsPanelOpen] = useState(false);

  const handleNodeClick = (event, node) => {
    setSelectedNode({
      id: node.id,
      type: node.type,
      data: node.data,
    });
    setIsPanelOpen(true);
  };

  const handleNodeUpdate = (nodeId, properties) => {
    setNodes(prev =>
      prev.map(n =>
        n.id === nodeId
          ? { ...n, data: { ...n.data, ...properties } }
          : n
      )
    );
  };

  return (
    <div className="flex">
      <ReactFlow onNodeClick={handleNodeClick} />
      {isPanelOpen && (
        <PropertyPanel
          selectedNode={selectedNode}
          onNodeUpdate={handleNodeUpdate}
          onClose={() => setIsPanelOpen(false)}
        />
      )}
    </div>
  );
}
```

## Node Type Schemas

Each node type has a corresponding interface and field schema:

### Supported Node Types

1. **Entry Node** - Workflow entry points
   - Fields: label, description, trigger, schedule (conditional)

2. **Phase Node** - Workflow stages where agents execute
   - Fields: label, description, agent, count, next

3. **Condition Node** - Branching logic based on expressions
   - Fields: label, expression, trueBranch, falseBranch

4. **Agent Node** - Direct agent invocations
   - Fields: label, agentName, description

5. **Hook Node** - Lifecycle handlers attached to phases
   - Fields: label, hookType, targetPhase, script

### Field Schema Format

```typescript
interface FieldSchema {
  name: string;                                      // Property key
  type: 'text' | 'textarea' | 'select' | 'number'; // Input type
  label: string;                                     // Display label
  required: boolean;                                 // Validation flag
  options?: readonly string[];                      // For select fields
  showIf?: (data: Partial<NodeProperties>) => boolean; // Conditional display
  placeholder?: string;                              // Input placeholder
  min?: number;                                      // For number fields
  max?: number;                                      // For number fields
}
```

## Adding New Node Types

To add a new node type:

### 1. Define Type Interface

Add to `nodeSchemas.ts`:

```typescript
export interface CustomNodeProperties extends BaseNodeProperties {
  type: 'custom';
  customField: string;
  customOption?: 'option1' | 'option2';
}
```

### 2. Update Union Type

```typescript
export type NodeProperties =
  | EntryNodeProperties
  | PhaseNodeProperties
  // ... existing types
  | CustomNodeProperties; // Add new type
```

### 3. Add Field Schema

```typescript
export const NODE_FIELD_SCHEMAS = {
  // ... existing schemas
  custom: [
    {
      name: 'label',
      type: 'text',
      label: 'Label',
      required: true
    },
    {
      name: 'customField',
      type: 'text',
      label: 'Custom Field',
      required: true
    },
    {
      name: 'customOption',
      type: 'select',
      label: 'Custom Option',
      options: ['option1', 'option2'],
      required: false
    },
  ],
} as const;
```

### 4. Register Node Component

Update `WorkflowCanvas.tsx` to include the new node type in React Flow's `nodeTypes` registry.

## Validation Patterns

### Built-in Validation

The component provides automatic validation for:
- **Required fields** - Validates non-empty strings
- **Number ranges** - Validates min/max constraints

### Custom Validation

To add custom validation logic, modify the `validateField` function in `PropertyPanel.tsx`:

```typescript
const validateField = (fieldName: string, value: unknown): string | null => {
  // ... existing validation

  // Custom validation example
  if (fieldName === 'schedule' && value) {
    if (!isValidCronExpression(value as string)) {
      return 'Invalid cron expression';
    }
  }

  return null;
};
```

## Styling

### Design Tokens

The component uses Tailwind v4 @theme tokens from `globals.css`:

- **Background:** `bg-gray-900`, `bg-gray-950`
- **Borders:** `border-red-800`
- **Text:** `text-foreground`, `text-gray-300`, `text-gray-400`
- **Focus:** `focus:border-red-500`, `focus:ring-red-500/50`
- **Errors:** `text-red-400`

### Customization

To customize styling, update the `className` attributes in `PropertyPanel.tsx`. Always use @theme design tokens (never arbitrary values like `bg-[#ff0000]`).

## Accessibility

### Keyboard Navigation

- **Tab:** Navigate between fields
- **Escape:** Close panel (when close button is focused)
- **Enter:** Submit forms (native browser behavior)
- **Arrow keys:** Navigate select dropdowns

### Screen Reader Support

- **Labels:** All inputs have associated `<label>` elements with `htmlFor`
- **Required indicators:** Visual asterisk + `aria-required` attribute
- **Error messages:** Linked via `aria-describedby`
- **Invalid state:** Marked with `aria-invalid` when errors present
- **Error announcements:** Error paragraphs have `role="alert"` for live announcements

### Focus Management

- **Auto-focus:** First field receives focus when panel opens
- **Focus trap:** Close button is easily reachable
- **Focus indicators:** Visible ring on all interactive elements

## State Management

### Form State

The component maintains local form state with `useState`:
- Updates immediately on change (no save button required)
- Clears errors when field is corrected
- Resets when different node is selected

### State Persistence

Form state persists when switching nodes:
- Local state updates trigger immediate canvas updates via `onNodeUpdate`
- Canvas state is source of truth (survives page refresh via localStorage)
- No unsaved changes - all edits are committed immediately

## Performance Considerations

- **useCallback** - Event handlers are memoized to prevent unnecessary re-renders
- **Conditional rendering** - Fields with `showIf` are only rendered when visible
- **Ref management** - Single ref for first field focus (no ref array)

## Testing

To test the PropertyPanel component:

### Manual Testing Checklist

- [ ] Panel opens when node is clicked
- [ ] Panel displays correct fields for each node type
- [ ] Required field validation shows errors on blur
- [ ] Changes update canvas node immediately
- [ ] Conditional fields show/hide correctly (e.g., schedule field for Entry nodes)
- [ ] Close button hides panel
- [ ] Keyboard navigation works (Tab, Escape)
- [ ] Screen reader announces errors

### Automated Testing (Future)

```typescript
import { render, fireEvent, screen } from '@testing-library/react';
import { PropertyPanel } from './PropertyPanel';

test('validates required fields', () => {
  const mockUpdate = vi.fn();
  const selectedNode = {
    id: 'test-1',
    type: 'entry',
    data: { id: 'test-1', type: 'entry', label: '' },
  };

  render(
    <PropertyPanel
      selectedNode={selectedNode}
      onNodeUpdate={mockUpdate}
      onClose={() => {}}
    />
  );

  const labelInput = screen.getByLabelText(/Label/i);
  fireEvent.blur(labelInput);

  expect(screen.getByText(/Label is required/i)).toBeInTheDocument();
});
```

## Troubleshooting

### Issue: Panel doesn't update when node properties change externally

**Solution:** Ensure `selectedNode.data` is updated when canvas nodes change. The component watches `selectedNode.id` to detect node switches.

### Issue: TypeScript errors on node.data casting

**Solution:** Use type guards or cast with proper validation:

```typescript
const validTypes = ['entry', 'phase', 'condition', 'agent', 'hook'];
if (node.type && validTypes.includes(node.type)) {
  setSelectedNode({
    id: node.id,
    type: node.type as 'entry' | 'phase' | 'condition' | 'agent' | 'hook',
    data: { ...node.data } as NodeProperties,
  });
}
```

### Issue: Fields not clearing when switching nodes

**Solution:** Verify `useEffect` dependency array includes `selectedNode?.id` (not `selectedNode` object reference).

## Future Enhancements

- [ ] Async validation (e.g., check if agent name exists)
- [ ] Field dependencies (auto-populate fields based on other field values)
- [ ] Undo/redo for property changes
- [ ] Bulk edit multiple nodes
- [ ] Advanced validation (regex patterns, custom validators)
- [ ] Field-level help tooltips
- [ ] Keyboard shortcuts (Ctrl+S to save, Ctrl+Z to undo)

## Related Components

- **WorkflowCanvas** - Parent component that integrates PropertyPanel
- **EntryNode, PhaseNode, etc.** - Node components that display properties on canvas
- **NodePalette** - Drag-and-drop palette for adding nodes

## License

Part of the claude-workflow project.
