/**
 * PersonaFormEditor Component
 *
 * Structured form for editing all character file fields:
 * name, bio (textarea), topics (tag input), adjectives (tag input),
 * style.all/post/chat (editable rules lists), postExamples (text list).
 *
 * Uses sub-components TagInput and RulesList for reusable field patterns.
 *
 * @module components/personas/PersonaFormEditor
 */

import { useState, useCallback } from "react";
import { Plus, X, GripVertical } from "lucide-react";
import type { PersonaCharacterFile } from "../../types/persona";

interface PersonaFormEditorProps {
  /** Current character file data */
  data: PersonaCharacterFile;
  /** Callback when any field changes */
  onChange: (data: PersonaCharacterFile) => void;
}

/** Reusable tag input for topics/adjectives arrays */
function TagInput({
  label,
  tags,
  onChange,
  placeholder,
}: {
  label: string;
  tags: string[];
  onChange: (tags: string[]) => void;
  placeholder: string;
}): JSX.Element {
  const [input, setInput] = useState("");

  const addTag = (): void => {
    const trimmed = input.trim();
    if (trimmed !== "" && !tags.includes(trimmed)) {
      onChange([...tags, trimmed]);
      setInput("");
    }
  };

  return (
    <div>
      <label className="block text-xs text-gray-400 mb-1 font-mono">{label}</label>
      <div className="flex flex-wrap gap-1.5 mb-2">
        {tags.map((tag, i) => (
          <span
            key={`${tag}-${String(i)}`}
            className="inline-flex items-center gap-1 px-2 py-0.5 text-xs bg-gray-800 border border-gray-600 rounded text-gray-300"
          >
            {tag}
            <button
              type="button"
              onClick={() => onChange(tags.filter((_, idx) => idx !== i))}
              className="text-gray-500 hover:text-red-400"
              aria-label={`Remove ${tag}`}
            >
              <X className="w-3 h-3" />
            </button>
          </span>
        ))}
      </div>
      <div className="flex gap-2">
        <input
          type="text"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              addTag();
            }
          }}
          placeholder={placeholder}
          className="flex-1 px-2 py-1 text-xs bg-gray-800 border border-gray-600 rounded text-white placeholder:text-gray-500 focus:outline-none focus:ring-2 focus:ring-red-600"
        />
        <button
          type="button"
          onClick={addTag}
          className="px-2 py-1 text-xs border border-red-800 rounded text-gray-400 hover:bg-red-800 hover:text-white transition-colors"
          aria-label={`Add ${label}`}
        >
          <Plus className="w-3 h-3" />
        </button>
      </div>
    </div>
  );
}

/** Reusable editable rules list for style arrays */
function RulesList({
  label,
  rules,
  onChange,
  placeholder,
}: {
  label: string;
  rules: string[];
  onChange: (rules: string[]) => void;
  placeholder: string;
}): JSX.Element {
  const addRule = (): void => {
    onChange([...rules, ""]);
  };

  const updateRule = (index: number, value: string): void => {
    onChange(rules.map((r, i) => (i === index ? value : r)));
  };

  const removeRule = (index: number): void => {
    onChange(rules.filter((_, i) => i !== index));
  };

  return (
    <div>
      <label className="block text-xs text-gray-400 mb-1 font-mono">{label}</label>
      <div className="flex flex-col gap-1.5">
        {rules.map((rule, i) => (
          <div key={String(i)} className="flex items-center gap-1.5">
            <GripVertical className="w-3 h-3 text-gray-600 shrink-0" aria-hidden="true" />
            <input
              type="text"
              value={rule}
              onChange={(e) => updateRule(i, e.target.value)}
              placeholder={placeholder}
              className="flex-1 px-2 py-1 text-xs bg-gray-800 border border-gray-600 rounded text-white placeholder:text-gray-500 focus:outline-none focus:ring-2 focus:ring-red-600"
            />
            <button
              type="button"
              onClick={() => removeRule(i)}
              className="text-gray-500 hover:text-red-400 shrink-0"
              aria-label={`Remove rule ${String(i + 1)}`}
            >
              <X className="w-3 h-3" />
            </button>
          </div>
        ))}
      </div>
      <button
        type="button"
        onClick={addRule}
        className="mt-1.5 px-2 py-1 text-xs border border-dashed border-gray-600 rounded text-gray-500 hover:border-red-800 hover:text-gray-400 transition-colors w-full"
      >
        + Add rule
      </button>
    </div>
  );
}

/**
 * PersonaFormEditor -- structured form for all character file fields.
 * Each field type uses specialized sub-components (TagInput, RulesList).
 */
export function PersonaFormEditor({ data, onChange }: PersonaFormEditorProps): JSX.Element {
  const update = useCallback(
    <K extends keyof PersonaCharacterFile>(key: K, value: PersonaCharacterFile[K]): void => {
      onChange({ ...data, [key]: value });
    },
    [data, onChange],
  );

  const updateStyle = useCallback(
    (context: "all" | "post" | "chat", value: string[]): void => {
      onChange({ ...data, style: { ...data.style, [context]: value } });
    },
    [data, onChange],
  );

  return (
    <div className="flex flex-col gap-4 p-4">
      {/* Name */}
      <div>
        <label htmlFor="persona-name" className="block text-xs text-gray-400 mb-1 font-mono">
          name *
        </label>
        <input
          id="persona-name"
          type="text"
          value={data.name}
          onChange={(e) => update("name", e.target.value)}
          placeholder="Persona display name"
          className="w-full px-2 py-1.5 text-sm bg-gray-800 border border-gray-600 rounded text-white placeholder:text-gray-500 focus:outline-none focus:ring-2 focus:ring-red-600"
        />
      </div>

      {/* Bio */}
      <div>
        <label htmlFor="persona-bio" className="block text-xs text-gray-400 mb-1 font-mono">
          bio *
        </label>
        <textarea
          id="persona-bio"
          value={data.bio.join("\n")}
          onChange={(e) => update("bio", e.target.value.split("\n"))}
          placeholder="Background and personality description (one paragraph per line)"
          rows={4}
          className="w-full px-2 py-1.5 text-sm bg-gray-800 border border-gray-600 rounded text-white placeholder:text-gray-500 focus:outline-none focus:ring-2 focus:ring-red-600 resize-y"
        />
      </div>

      {/* Topics */}
      <TagInput
        label="topics"
        tags={data.topics}
        onChange={(t) => update("topics", t)}
        placeholder="Add a topic..."
      />

      {/* Adjectives */}
      <TagInput
        label="adjectives"
        tags={data.adjectives}
        onChange={(a) => update("adjectives", a)}
        placeholder="Add a trait..."
      />

      {/* Style rules */}
      <div className="border-t border-gray-700 pt-4">
        <h3 className="text-xs text-red-400 font-mono mb-3">style rules</h3>
        <div className="flex flex-col gap-4">
          <RulesList
            label="style.all (universal)"
            rules={data.style.all}
            onChange={(r) => updateStyle("all", r)}
            placeholder="Universal style rule..."
          />
          <RulesList
            label="style.post (tweets)"
            rules={data.style.post}
            onChange={(r) => updateStyle("post", r)}
            placeholder="Tweet-specific rule..."
          />
          <RulesList
            label="style.chat (DMs)"
            rules={data.style.chat}
            onChange={(r) => updateStyle("chat", r)}
            placeholder="Chat-specific rule..."
          />
        </div>
      </div>

      {/* Post Examples */}
      <div className="border-t border-gray-700 pt-4">
        <RulesList
          label="postExamples"
          rules={data.postExamples}
          onChange={(r) => update("postExamples", r)}
          placeholder="Example tweet text..."
        />
      </div>
    </div>
  );
}
