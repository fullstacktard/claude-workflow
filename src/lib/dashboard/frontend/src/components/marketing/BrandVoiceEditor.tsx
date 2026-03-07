/**
 * BrandVoiceEditor Component
 *
 * Multi-section form for creating/editing brand voice configuration.
 * Sections:
 *   1. Identity: name, description
 *   2. Tone & Personality: comma-separated tag inputs
 *   3. System Prompt: template textarea
 *   4. Few-shot Examples: dynamic add/remove list
 *   5. Constitutional Rules: dynamic add/remove list
 *   6. Vocabulary: whitelist + banned words textareas
 *   7. Policies: emoji policy + hashtag strategy radio groups
 *   8. Platform Overrides: JSON textarea
 *
 * @module components/marketing/BrandVoiceEditor
 */

import { useCallback, useState } from "react";
import { Plus, Save, Trash2, X } from "lucide-react";

import type {
  BrandVoiceFormData,
  EmojiPolicy,
  FewShotExample,
  HashtagStrategy,
} from "../../types/marketing";

const EMOJI_OPTIONS: Array<{ value: EmojiPolicy; label: string }> = [
  { value: "none", label: "None" },
  { value: "minimal", label: "Minimal" },
  { value: "moderate", label: "Moderate" },
  { value: "liberal", label: "Liberal" },
];

const HASHTAG_OPTIONS: Array<{ value: HashtagStrategy; label: string }> = [
  { value: "none", label: "None" },
  { value: "relevant", label: "Relevant Only" },
  { value: "trending", label: "Trending" },
];

interface BrandVoiceEditorProps {
  initialData: BrandVoiceFormData;
  isNew: boolean;
  isSaving: boolean;
  onSave: (data: BrandVoiceFormData) => void;
  onCancel: () => void;
}

/** Shared input field styling */
const inputClass =
  "w-full rounded-md border border-gray-700 bg-gray-900 px-3 py-2 text-sm text-white font-mono placeholder-gray-600 focus:border-red-600 focus:outline-none focus:ring-1 focus:ring-red-600";

const textareaClass = `${inputClass} resize-y min-h-[80px]`;

const labelClass = "block text-xs font-medium text-gray-400 mb-1";

const sectionClass = "space-y-3 border-b border-gray-800 pb-4";

export function BrandVoiceEditor({
  initialData,
  isNew,
  isSaving,
  onSave,
  onCancel,
}: BrandVoiceEditorProps): JSX.Element {
  const [form, setForm] = useState<BrandVoiceFormData>(() =>
    JSON.parse(JSON.stringify(initialData))
  );

  const updateField = useCallback(
    <K extends keyof BrandVoiceFormData>(key: K, value: BrandVoiceFormData[K]) => {
      setForm((prev) => ({ ...prev, [key]: value }));
    },
    [],
  );

  // ---- Few-shot examples ----
  const addExample = useCallback(() => {
    setForm((prev) => ({
      ...prev,
      few_shot_examples: [
        ...prev.few_shot_examples,
        { platform: "twitter", topic: "", content: "" },
      ],
    }));
  }, []);

  const updateExample = useCallback(
    (index: number, field: keyof FewShotExample, value: string) => {
      setForm((prev) => {
        const examples = [...prev.few_shot_examples];
        examples[index] = { ...examples[index], [field]: value };
        return { ...prev, few_shot_examples: examples };
      });
    },
    [],
  );

  const removeExample = useCallback((index: number) => {
    setForm((prev) => ({
      ...prev,
      few_shot_examples: prev.few_shot_examples.filter((_, i) => i !== index),
    }));
  }, []);

  // ---- Constitutional rules ----
  const addRule = useCallback(() => {
    setForm((prev) => ({
      ...prev,
      constitutional_rules: [...prev.constitutional_rules, ""],
    }));
  }, []);

  const updateRule = useCallback((index: number, value: string) => {
    setForm((prev) => {
      const rules = [...prev.constitutional_rules];
      rules[index] = value;
      return { ...prev, constitutional_rules: rules };
    });
  }, []);

  const removeRule = useCallback((index: number) => {
    setForm((prev) => ({
      ...prev,
      constitutional_rules: prev.constitutional_rules.filter((_, i) => i !== index),
    }));
  }, []);

  // ---- Tags (tone, personality) from comma-separated input ----
  const parseTags = (value: string): string[] =>
    value
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);

  // ---- Platform overrides JSON ----
  const [overridesText, setOverridesText] = useState(() =>
    Object.keys(form.platform_overrides).length > 0
      ? JSON.stringify(form.platform_overrides, null, 2)
      : "",
  );
  const [overridesError, setOverridesError] = useState<string | null>(null);

  const handleOverridesChange = useCallback(
    (value: string) => {
      setOverridesText(value);
      if (!value.trim()) {
        setOverridesError(null);
        updateField("platform_overrides", {});
        return;
      }
      try {
        const parsed = JSON.parse(value) as Record<string, unknown>;
        if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
          setOverridesError("Must be a JSON object");
          return;
        }
        setOverridesError(null);
        updateField("platform_overrides", parsed as BrandVoiceFormData["platform_overrides"]);
      } catch {
        setOverridesError("Invalid JSON");
      }
    },
    [updateField],
  );

  const handleSubmit = useCallback(() => {
    if (overridesError) return;
    onSave(form);
  }, [form, onSave, overridesError]);

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between gap-2 p-3 border-b border-gray-800 shrink-0">
        <h3 className="text-sm font-medium text-white font-mono truncate">
          {isNew ? "New Brand Voice" : `Edit: ${form.name || "Untitled"}`}
        </h3>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={onCancel}
            className="h-7 px-3 text-xs rounded-md transition-colors bg-transparent text-gray-400 border border-gray-700 hover:border-gray-600 hover:text-gray-300 flex items-center gap-1.5"
          >
            <X className="w-3 h-3" />
            Cancel
          </button>
          <button
            type="button"
            onClick={handleSubmit}
            disabled={isSaving || !form.name.trim() || !!overridesError}
            className="h-7 px-3 text-xs rounded-md transition-colors bg-red-700 text-white border border-red-600 hover:bg-red-600 disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-1.5"
          >
            <Save className="w-3 h-3" />
            {isSaving ? "Saving..." : "Save"}
          </button>
        </div>
      </div>

      {/* Form body */}
      <div className="flex-1 overflow-y-auto p-3 space-y-4">
        {/* Section 1: Identity */}
        <div className={sectionClass}>
          <h4 className="text-xs font-semibold text-gray-300 uppercase tracking-wider">
            Identity
          </h4>
          <div>
            <label className={labelClass}>
              Name <span className="text-red-500">*</span>
            </label>
            <input
              type="text"
              className={inputClass}
              placeholder="e.g., Corporate Professional"
              value={form.name}
              onChange={(e) => updateField("name", e.target.value)}
            />
          </div>
          <div>
            <label className={labelClass}>Description</label>
            <textarea
              className={textareaClass}
              placeholder="Brief description of this brand voice..."
              rows={2}
              value={form.description}
              onChange={(e) => updateField("description", e.target.value)}
            />
          </div>
        </div>

        {/* Section 2: Tone & Personality */}
        <div className={sectionClass}>
          <h4 className="text-xs font-semibold text-gray-300 uppercase tracking-wider">
            Tone & Personality
          </h4>
          <div>
            <label className={labelClass}>Tone (comma-separated)</label>
            <input
              type="text"
              className={inputClass}
              placeholder="professional, witty, authoritative"
              value={form.tone.join(", ")}
              onChange={(e) => updateField("tone", parseTags(e.target.value))}
            />
            {form.tone.length > 0 && (
              <div className="flex flex-wrap gap-1 mt-1.5">
                {form.tone.map((t) => (
                  <span
                    key={t}
                    className="inline-block rounded px-1.5 py-0.5 text-[10px] font-mono bg-cyan-900/40 text-cyan-400 border border-cyan-800/40"
                  >
                    {t}
                  </span>
                ))}
              </div>
            )}
          </div>
          <div>
            <label className={labelClass}>Personality Traits (comma-separated)</label>
            <input
              type="text"
              className={inputClass}
              placeholder="helpful, confident, data-driven"
              value={form.personality_traits.join(", ")}
              onChange={(e) => updateField("personality_traits", parseTags(e.target.value))}
            />
            {form.personality_traits.length > 0 && (
              <div className="flex flex-wrap gap-1 mt-1.5">
                {form.personality_traits.map((t) => (
                  <span
                    key={t}
                    className="inline-block rounded px-1.5 py-0.5 text-[10px] font-mono bg-purple-900/40 text-purple-400 border border-purple-800/40"
                  >
                    {t}
                  </span>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* Section 3: System Prompt */}
        <div className={sectionClass}>
          <h4 className="text-xs font-semibold text-gray-300 uppercase tracking-wider">
            System Prompt Template
          </h4>
          <div>
            <label className={labelClass}>
              Template (use {"{{platform}}"} and {"{{topic}}"} as placeholders)
            </label>
            <textarea
              className={`${textareaClass} min-h-[120px]`}
              placeholder="You are a {{platform}} content creator..."
              rows={5}
              value={form.system_prompt_template}
              onChange={(e) => updateField("system_prompt_template", e.target.value)}
            />
          </div>
        </div>

        {/* Section 4: Few-shot Examples */}
        <div className={sectionClass}>
          <div className="flex items-center justify-between">
            <h4 className="text-xs font-semibold text-gray-300 uppercase tracking-wider">
              Few-shot Examples ({form.few_shot_examples.length})
            </h4>
            <button
              type="button"
              onClick={addExample}
              className="h-6 px-2 text-[10px] rounded transition-colors bg-transparent text-gray-400 border border-gray-700 hover:border-gray-600 hover:text-gray-300 flex items-center gap-1"
            >
              <Plus className="w-3 h-3" />
              Add
            </button>
          </div>
          {form.few_shot_examples.map((ex, i) => (
            <div key={i} className="rounded-md border border-gray-800 bg-gray-900/30 p-2.5 space-y-2">
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-2 flex-1 min-w-0">
                  <input
                    type="text"
                    className={`${inputClass} max-w-[120px]`}
                    placeholder="platform"
                    value={ex.platform}
                    onChange={(e) => updateExample(i, "platform", e.target.value)}
                  />
                  <input
                    type="text"
                    className={`${inputClass} flex-1`}
                    placeholder="topic"
                    value={ex.topic}
                    onChange={(e) => updateExample(i, "topic", e.target.value)}
                  />
                </div>
                <button
                  type="button"
                  onClick={() => removeExample(i)}
                  className="shrink-0 p-1 rounded text-gray-600 hover:text-red-400 hover:bg-red-900/30 transition-colors"
                  title="Remove example"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              </div>
              <textarea
                className={`${textareaClass} min-h-[60px]`}
                placeholder="Example content demonstrating this voice..."
                rows={2}
                value={ex.content}
                onChange={(e) => updateExample(i, "content", e.target.value)}
              />
            </div>
          ))}
        </div>

        {/* Section 5: Constitutional Rules */}
        <div className={sectionClass}>
          <div className="flex items-center justify-between">
            <h4 className="text-xs font-semibold text-gray-300 uppercase tracking-wider">
              Constitutional Rules ({form.constitutional_rules.length})
            </h4>
            <button
              type="button"
              onClick={addRule}
              className="h-6 px-2 text-[10px] rounded transition-colors bg-transparent text-gray-400 border border-gray-700 hover:border-gray-600 hover:text-gray-300 flex items-center gap-1"
            >
              <Plus className="w-3 h-3" />
              Add
            </button>
          </div>
          {form.constitutional_rules.map((rule, i) => (
            <div key={i} className="flex items-center gap-2">
              <input
                type="text"
                className={`${inputClass} flex-1`}
                placeholder="e.g., Never use profanity"
                value={rule}
                onChange={(e) => updateRule(i, e.target.value)}
              />
              <button
                type="button"
                onClick={() => removeRule(i)}
                className="shrink-0 p-1 rounded text-gray-600 hover:text-red-400 hover:bg-red-900/30 transition-colors"
                title="Remove rule"
              >
                <Trash2 className="w-3.5 h-3.5" />
              </button>
            </div>
          ))}
        </div>

        {/* Section 6: Vocabulary */}
        <div className={sectionClass}>
          <h4 className="text-xs font-semibold text-gray-300 uppercase tracking-wider">
            Vocabulary
          </h4>
          <div>
            <label className={labelClass}>Whitelist (comma-separated)</label>
            <textarea
              className={textareaClass}
              placeholder="preferred, terms, to, use"
              rows={2}
              value={form.vocabulary_whitelist.join(", ")}
              onChange={(e) => updateField("vocabulary_whitelist", parseTags(e.target.value))}
            />
          </div>
          <div>
            <label className={labelClass}>Banned Words (comma-separated)</label>
            <textarea
              className={textareaClass}
              placeholder="synergy, leverage, disruption"
              rows={2}
              value={form.banned_words.join(", ")}
              onChange={(e) => updateField("banned_words", parseTags(e.target.value))}
            />
          </div>
        </div>

        {/* Section 7: Policies */}
        <div className={sectionClass}>
          <h4 className="text-xs font-semibold text-gray-300 uppercase tracking-wider">
            Policies
          </h4>
          <div>
            <label className={labelClass}>Emoji Policy</label>
            <div className="flex flex-wrap gap-2">
              {EMOJI_OPTIONS.map((opt) => (
                <label
                  key={opt.value}
                  className={`flex items-center gap-1.5 rounded-md border px-2.5 py-1.5 text-xs font-mono cursor-pointer transition-colors ${
                    form.emoji_policy === opt.value
                      ? "border-red-600 bg-red-900/20 text-white"
                      : "border-gray-700 bg-gray-900 text-gray-400 hover:border-gray-600"
                  }`}
                >
                  <input
                    type="radio"
                    name="emoji_policy"
                    value={opt.value}
                    checked={form.emoji_policy === opt.value}
                    onChange={() => updateField("emoji_policy", opt.value)}
                    className="sr-only"
                  />
                  {opt.label}
                </label>
              ))}
            </div>
          </div>
          <div>
            <label className={labelClass}>Hashtag Strategy</label>
            <div className="flex flex-wrap gap-2">
              {HASHTAG_OPTIONS.map((opt) => (
                <label
                  key={opt.value}
                  className={`flex items-center gap-1.5 rounded-md border px-2.5 py-1.5 text-xs font-mono cursor-pointer transition-colors ${
                    form.hashtag_strategy === opt.value
                      ? "border-red-600 bg-red-900/20 text-white"
                      : "border-gray-700 bg-gray-900 text-gray-400 hover:border-gray-600"
                  }`}
                >
                  <input
                    type="radio"
                    name="hashtag_strategy"
                    value={opt.value}
                    checked={form.hashtag_strategy === opt.value}
                    onChange={() => updateField("hashtag_strategy", opt.value)}
                    className="sr-only"
                  />
                  {opt.label}
                </label>
              ))}
            </div>
          </div>
        </div>

        {/* Section 8: Platform Overrides */}
        <div className="space-y-3 pb-4">
          <h4 className="text-xs font-semibold text-gray-300 uppercase tracking-wider">
            Platform Overrides (JSON)
          </h4>
          <div>
            <label className={labelClass}>
              Per-platform config overrides (optional)
            </label>
            <textarea
              className={`${textareaClass} min-h-[100px] ${
                overridesError ? "border-red-500 focus:border-red-500 focus:ring-red-500" : ""
              }`}
              placeholder={'{\n  "twitter": { "tone": ["casual", "witty"] },\n  "linkedin": { "tone": ["professional"] }\n}'}
              rows={4}
              value={overridesText}
              onChange={(e) => handleOverridesChange(e.target.value)}
            />
            {overridesError && (
              <p className="text-xs text-red-400 mt-1">{overridesError}</p>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
