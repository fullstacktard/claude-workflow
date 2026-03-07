/**
 * VisualisePage -- Placeholder page for the upcoming Visualise feature
 *
 * Displays a centered heading and "Coming soon" subtext on a dark background.
 * Styled consistently with the dashboard dark theme.
 *
 * @example
 * ```tsx
 * // In main.tsx routes:
 * <Route element={<VisualisePage />} path="/visualise" />
 * ```
 */

export function VisualisePage(): JSX.Element {
  return (
    <div className="flex h-full flex-col items-center justify-center bg-gray-950">
      <h1 className="text-3xl font-semibold text-gray-200">Visualise</h1>
      <p className="mt-3 text-gray-500">Coming soon</p>
    </div>
  );
}
