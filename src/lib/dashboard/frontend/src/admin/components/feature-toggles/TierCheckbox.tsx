/**
 * TierCheckbox Component
 *
 * Checkbox with indeterminate state support for parent-level group toggles.
 * Uses useRef + useEffect to set the indeterminate property on the DOM element,
 * since the HTML indeterminate attribute is not reflected by the JSX property.
 */

import { useRef, useEffect } from "react";
import { Lock } from "lucide-react";

interface TierCheckboxProps {
  checked: boolean;
  indeterminate?: boolean;
  disabled?: boolean;
  locked?: boolean;
  lockTooltip?: string;
  onChange: (checked: boolean) => void;
  ariaLabel?: string;
}

export function TierCheckbox({
  checked,
  indeterminate = false,
  disabled = false,
  locked = false,
  lockTooltip,
  onChange,
  ariaLabel,
}: TierCheckboxProps): JSX.Element {
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (inputRef.current) {
      inputRef.current.indeterminate = indeterminate;
    }
  }, [indeterminate]);

  if (locked) {
    return (
      <div
        className="flex h-5 w-5 items-center justify-center"
        title={lockTooltip ?? "Locked: minimum tier requirement not met"}
        role="img"
        aria-label={lockTooltip ?? "Locked: minimum tier requirement not met"}
      >
        <Lock size={12} className="text-gray-600" />
      </div>
    );
  }

  return (
    <input
      ref={inputRef}
      type="checkbox"
      checked={checked}
      disabled={disabled}
      onChange={(e: React.ChangeEvent<HTMLInputElement>) => onChange(e.target.checked)}
      aria-label={ariaLabel}
      className="h-4 w-4 cursor-pointer rounded border-gray-600 bg-gray-800 text-red-500 accent-red-500 focus:ring-1 focus:ring-red-500 focus:ring-offset-0 disabled:cursor-not-allowed disabled:opacity-40"
    />
  );
}
