/**
 * CodeEditorPage - Embeds code-server (VS Code) in an iframe with project selection.
 *
 * Fetches discovered projects from GET /api/projects and maps their container paths
 * from the dashboard mount (/app/projects/...) to the code-server mount (/home/coder/projects/...).
 * Switching projects changes the iframe src via the ?folder= query param.
 */

import { RefreshCw } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";

interface ProjectInfo {
  name: string;
  path: string;
}

/** Map dashboard container path to code-server container path */
function toCoderPath(dashboardPath: string): string {
  // Dashboard mounts PROJECT_PATH at /app/projects
  // code-server mounts the same PROJECT_PATH at /home/coder/projects
  return dashboardPath.replace(/^\/app\/projects/, "/home/coder/projects");
}

const CODE_SERVER_PORT = 8443;

export function CodeEditorPage(): JSX.Element {
  const [projects, setProjects] = useState<ProjectInfo[]>([]);
  const [selectedPath, setSelectedPath] = useState<string>("");
  const [loading, setLoading] = useState(true);
  const iframeRef = useRef<HTMLIFrameElement>(null);

  const fetchProjects = useCallback(async () => {
    try {
      const response = await fetch("/api/projects");
      if (!response.ok) return;
      const data = (await response.json()) as ProjectInfo[];
      setProjects(data);
      // Auto-select first project if none selected
      if (data.length > 0 && selectedPath === "") {
        setSelectedPath(data[0].path);
      }
    } catch {
      // Silently fail — health dot shows service status
    } finally {
      setLoading(false);
    }
  }, [selectedPath]);

  useEffect(() => {
    void fetchProjects();
  }, [fetchProjects]);

  const iframeSrc = selectedPath
    ? `http://localhost:${CODE_SERVER_PORT}/?folder=${encodeURIComponent(toCoderPath(selectedPath))}`
    : `http://localhost:${CODE_SERVER_PORT}/`;

  const handleReload = (): void => {
    if (iframeRef.current) {
      iframeRef.current.src = iframeSrc;
    }
  };

  return (
    <div className="flex h-full flex-col">
      {/* Toolbar */}
      <div className="flex h-10 shrink-0 items-center gap-3 border-b border-red-800 bg-gray-900 px-4">
        <label htmlFor="project-select" className="font-mono text-xs text-gray-400">
          Project:
        </label>
        <select
          id="project-select"
          value={selectedPath}
          onChange={(e) => setSelectedPath(e.target.value)}
          disabled={loading || projects.length === 0}
          className="h-7 rounded border border-gray-700 bg-gray-800 px-2 font-mono text-xs text-gray-200 focus:border-red-700 focus:outline-none disabled:opacity-50"
        >
          {loading && <option value="">Loading...</option>}
          {!loading && projects.length === 0 && <option value="">No projects found</option>}
          {projects.map((p) => (
            <option key={p.path} value={p.path}>
              {p.name}
            </option>
          ))}
        </select>
        <button
          type="button"
          onClick={handleReload}
          className="flex h-7 w-7 items-center justify-center rounded border border-gray-700 bg-gray-800 text-gray-400 transition-colors hover:bg-gray-700 hover:text-gray-200"
          title="Reload editor"
        >
          <RefreshCw size={14} />
        </button>
      </div>

      {/* code-server iframe */}
      <iframe
        ref={iframeRef}
        src={iframeSrc}
        title="VS Code Editor"
        className="flex-1 border-none"
        sandbox="allow-scripts allow-same-origin allow-forms allow-popups allow-modals allow-downloads"
      />
    </div>
  );
}
