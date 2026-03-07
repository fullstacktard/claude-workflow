/**
 * PropertyPanel Component
 * Dynamic form panel for editing workflow node properties
 * Displays type-specific fields based on selected node type
 */

import { useEffect, useState, useCallback, useRef, Ref } from 'react';
import { X } from 'lucide-react';
import { NodeProperties, NODE_FIELD_SCHEMAS, FieldSchema } from './nodeSchemas';

// ============================================================================
// Types
// ============================================================================

interface PropertyPanelProps {
  selectedNode: {
    id: string;
    type: 'entry' | 'phase' | 'condition' | 'agent' | 'hook';
    data: NodeProperties;
  } | null;
  onNodeUpdate: (nodeId: string, properties: Partial<NodeProperties>) => void;
  onClose: () => void;
}

type RefValue = HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement;

// ============================================================================
// Component
// ============================================================================

export function PropertyPanel({
  selectedNode,
  onNodeUpdate,
  onClose,
}: PropertyPanelProps): JSX.Element {
  const [formData, setFormData] = useState<NodeProperties | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const firstFieldRef = useRef<RefValue | null>(null);

  // Update form data when different node selected
  useEffect(() => {
    if (selectedNode) {
      setFormData(selectedNode.data);
      setErrors({}); // Clear errors on node change
    } else {
      setFormData(null);
      setErrors({});
    }
  }, [selectedNode?.id]);

  // Focus first field when panel opens or node changes
  useEffect(() => {
    if (selectedNode && firstFieldRef.current) {
      firstFieldRef.current.focus();
    }
  }, [selectedNode?.id]);

  /**
   * Handle field value changes
   * Updates both local state and canvas immediately (no save button)
   */
  const handleFieldChange = useCallback(
    (field: string, value: unknown) => {
      if (!selectedNode || !formData) return;

      const updated = { ...formData, [field]: value } as NodeProperties;
      setFormData(updated);

      // Immediate canvas update (AC #10)
      onNodeUpdate(selectedNode.id, updated);

      // Clear error for this field
      if (errors[field]) {
        setErrors((prev) => {
          const next = { ...prev };
          delete next[field];
          return next;
        });
      }
    },
    [selectedNode, formData, errors, onNodeUpdate]
  );

  /**
   * Validate a single field value
   */
  const validateField = useCallback(
    (fieldName: string, value: unknown): string | null => {
      if (!selectedNode) return null;

      const schema = NODE_FIELD_SCHEMAS[selectedNode.type];
      const fieldSchema = schema.find((f) => f.name === fieldName);

      if (!fieldSchema) return null;

      // Required field validation
      if (fieldSchema.required) {
        if (!value || (typeof value === 'string' && !value.trim())) {
          return `${fieldSchema.label} is required`;
        }
      }

      // Number range validation
      if (fieldSchema.type === 'number' && typeof value === 'number') {
        if (fieldSchema.min !== undefined && value < fieldSchema.min) {
          return `${fieldSchema.label} must be at least ${fieldSchema.min}`;
        }
        if (fieldSchema.max !== undefined && value > fieldSchema.max) {
          return `${fieldSchema.label} must be at most ${fieldSchema.max}`;
        }
      }

      return null;
    },
    [selectedNode]
  );

  /**
   * Handle field blur for validation
   */
  const handleBlur = useCallback(
    (fieldName: string, value: unknown) => {
      const error = validateField(fieldName, value);
      if (error) {
        setErrors((prev) => ({ ...prev, [fieldName]: error }));
      }
    },
    [validateField]
  );

  /**
   * Render a single form field based on schema
   */
  const renderField = useCallback(
    (field: FieldSchema, isFirstField: boolean) => {
      if (!formData) return null;

      // Conditional field visibility (AC #9)
      if (field.showIf && !field.showIf(formData)) {
        return null;
      }

      const value = formData[field.name as keyof typeof formData];
      const error = errors[field.name];
      const inputId = `field-${field.name}`;

      return (
        <div key={field.name}>
          <label
            htmlFor={inputId}
            className="block text-sm font-medium text-gray-300 mb-2"
          >
            {field.label}
            {field.required && <span className="text-red-400 ml-1">*</span>}
          </label>

          {/* Text Input */}
          {field.type === 'text' && (
            <input
              ref={(isFirstField ? firstFieldRef : null) as Ref<HTMLInputElement>}
              id={inputId}
              type="text"
              value={(value as string) || ''}
              onChange={(e) => handleFieldChange(field.name, e.target.value)}
              onBlur={(e) => handleBlur(field.name, e.target.value)}
              placeholder={field.placeholder}
              className="w-full bg-gray-950 border border-red-800 rounded-md px-3 py-2.5 text-sm text-foreground placeholder:text-gray-400 outline-none focus:border-red-500 focus:ring-1 focus:ring-red-500/50 transition-colors"
              aria-describedby={error ? `${inputId}-error` : undefined}
              aria-invalid={!!error}
              aria-required={field.required}
            />
          )}

          {/* Number Input */}
          {field.type === 'number' && (
            <input
              ref={(isFirstField ? firstFieldRef : null) as Ref<HTMLInputElement>}
              id={inputId}
              type="number"
              value={typeof value === 'number' ? value : ''}
              onChange={(e) => {
                const numValue = e.target.value ? parseInt(e.target.value, 10) : undefined;
                handleFieldChange(field.name, numValue);
              }}
              onBlur={(e) => {
                const numValue = e.target.value ? parseInt(e.target.value, 10) : undefined;
                handleBlur(field.name, numValue);
              }}
              placeholder={field.placeholder}
              min={field.min}
              max={field.max}
              className="w-full bg-gray-950 border border-red-800 rounded-md px-3 py-2.5 text-sm text-foreground placeholder:text-gray-400 outline-none focus:border-red-500 focus:ring-1 focus:ring-red-500/50 transition-colors"
              aria-describedby={error ? `${inputId}-error` : undefined}
              aria-invalid={!!error}
              aria-required={field.required}
            />
          )}

          {/* Textarea */}
          {field.type === 'textarea' && (
            <textarea
              ref={(isFirstField ? firstFieldRef : null) as Ref<HTMLTextAreaElement>}
              id={inputId}
              value={(value as string) || ''}
              onChange={(e) => handleFieldChange(field.name, e.target.value)}
              onBlur={(e) => handleBlur(field.name, e.target.value)}
              placeholder={field.placeholder}
              rows={3}
              className="w-full bg-gray-950 border border-red-800 rounded-md px-3 py-2.5 text-sm text-foreground placeholder:text-gray-400 outline-none focus:border-red-500 focus:ring-1 focus:ring-red-500/50 resize-y transition-colors"
              aria-describedby={error ? `${inputId}-error` : undefined}
              aria-invalid={!!error}
              aria-required={field.required}
            />
          )}

          {/* Select Dropdown */}
          {field.type === 'select' && field.options && (
            <select
              ref={(isFirstField ? firstFieldRef : null) as Ref<HTMLSelectElement>}
              id={inputId}
              value={(value as string) || ''}
              onChange={(e) => handleFieldChange(field.name, e.target.value)}
              onBlur={(e) => handleBlur(field.name, e.target.value)}
              className="w-full bg-gray-950 border border-red-800 rounded-md px-3 py-2.5 text-sm text-foreground outline-none focus:border-red-500 focus:ring-1 focus:ring-red-500/50 appearance-none cursor-pointer transition-colors"
              style={{
                backgroundImage: `url("data:image/svg+xml,%3csvg xmlns='http://www.w3.org/2000/svg' fill='none' viewBox='0 0 20 20'%3e%3cpath stroke='%236b7280' stroke-linecap='round' stroke-linejoin='round' stroke-width='1.5' d='m6 8 4 4 4-4'/%3e%3c/svg%3e")`,
                backgroundPosition: 'right 0.5rem center',
                backgroundRepeat: 'no-repeat',
                backgroundSize: '1.5em 1.5em',
                paddingRight: '2.5rem',
              }}
              aria-describedby={error ? `${inputId}-error` : undefined}
              aria-invalid={!!error}
              aria-required={field.required}
            >
              <option value="">Select {field.label}</option>
              {field.options.map((opt) => (
                <option key={opt} value={opt}>
                  {opt}
                </option>
              ))}
            </select>
          )}

          {/* Inline Error Message (AC #11) */}
          {error && (
            <p
              id={`${inputId}-error`}
              className="text-red-400 text-xs mt-1"
              role="alert"
            >
              {error}
            </p>
          )}
        </div>
      );
    },
    [formData, errors, handleFieldChange, handleBlur]
  );

  // Empty state when no node selected
  if (!selectedNode || !formData) {
    return (
      <div className="w-80 bg-gray-900 border-l border-red-800 p-4 flex items-center justify-center text-gray-400">
        <p className="text-sm">Select a node to edit properties</p>
      </div>
    );
  }

  const fields = NODE_FIELD_SCHEMAS[selectedNode.type];

  return (
    <div className="w-80 bg-gray-900 border-l border-red-800 flex flex-col h-full">
      {/* Header (AC #14 - focus states, AC #15 - keyboard navigation) */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-red-800">
        <h2 className="text-white font-medium font-mono">
          {selectedNode.type.charAt(0).toUpperCase() + selectedNode.type.slice(1)}{' '}
          Node
        </h2>
        <button
          type="button"
          onClick={onClose}
          className="w-11 h-11 min-w-[44px] min-h-[44px] flex items-center justify-center text-gray-400 rounded transition-colors hover:text-white hover:bg-red-800/50 focus:outline-none focus:ring-2 focus:ring-red-500 focus:ring-offset-2 focus:ring-offset-gray-900"
          aria-label="Close property panel"
        >
          <X className="w-5 h-5" />
        </button>
      </div>

      {/* Form Fields (AC #8, #9, #12) */}
      <div className="flex-1 overflow-y-auto p-4 space-y-4">
        {fields.map((field, index) => renderField(field, index === 0))}
      </div>

      {/* Footer Info (AC #10 - no save button) */}
      <div className="px-4 py-3 border-t border-red-800 bg-gray-950 text-xs text-gray-400">
        <p>Changes save automatically</p>
      </div>
    </div>
  );
}
