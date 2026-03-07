/**
 * LoadingSpinner Component
 * Loading indicator for async data fetching
 */

interface LoadingSpinnerProps {
  /** Optional size override - defaults to 'lg' (64x64) */
  size?: 'sm' | 'md' | 'lg';
  /** Optional loading text to display below spinner */
  text?: string;
}

const sizeClasses = {
  sm: 'w-8 h-8',    // 32x32 - for inline usage
  md: 'w-12 h-12',  // 48x48 - medium contexts
  lg: 'w-16 h-16',  // 64x64 - default, main loading states
};

/**
 * LoadingSpinner component
 */
export function LoadingSpinner({ size = 'lg', text }: LoadingSpinnerProps): JSX.Element {
  return (
    <div className="flex flex-col items-center gap-4 font-sans">
      <div className={`spinner ${sizeClasses[size]}`} />
      {text !== undefined && (
        <p className="text-gray-400 font-sans">{text}</p>
      )}
    </div>
  );
}
