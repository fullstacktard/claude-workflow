/**
 * SessionTree Component
 *
 * Accessible WAI-ARIA tree view sidebar for tmux session management.
 * Displays sessions grouped by project with expand/collapse, keyboard navigation,
 * notification indicators, attached status, new-session actions, and a context menu.
 *
 * Architecture:
 * - `useTmuxSessions()` provides REST polling (5s interval, AbortController cleanup)
 * - `useTreeView()` manages roving tabindex and keyboard navigation
 * - `expandedProjects` state lives in SessionTree (avoids circular dependency)
 * - `buildFlatNodes()` converts API tree data + expand state into a flat list
 * - `TreeItem` renders individual ARIA-attributed nodes
 * - `ContextMenu` provides right-click session actions
 * - `ExpandableGroup` wraps project children with CSS grid-template-rows transition
 *
 * @example
 * ```tsx
 * <SessionTree
 *   onAttachSession={(name) => attachToTerminal(name)}
 *   onNewSession={(path, name) => createSession(path, name)}
 *   onKillSession={(name) => killSession(name)}
 *   onRenameSession={(name) => promptRename(name)}
 * />
 * ```
 */

import { useCallback, useMemo, useRef, useState, type ReactNode } from "react";
import { ChevronDown, ChevronRight, Terminal } from "lucide-react";
import type { SessionStateChangePayload } from "../../types/websocket";
import { TreeItem } from "./TreeItem";
import { ContextMenu } from "./ContextMenu";
import { useTreeView } from "../../hooks/useTreeView";
import { useTmuxSessions } from "../../hooks/useTmuxSessions";
import { useSessionState } from "../../hooks/useSessionState";
import type {
  TmuxSessionWithNotification,
  SessionTreeResponse,
} from "../../hooks/useTmuxSessions";

// ── Flat Node Types ──────────────────────────────────────────────────

/** Node types matching the TUI tree-view.ts pattern. */
export type TreeNodeType = "project" | "session" | "unregistered-header" | "new-session";

/**
 * Flat node representation for visible tree items.
 * Each node maps 1:1 to a rendered `<li role="treeitem">`.
 */
export interface FlatTreeNode {
  /** Unique key for React rendering. */
  key: string;
  /** Node type (project, session, unregistered-header, new-session). */
  type: TreeNodeType;
  /** Display label. */
  label: string;
  /** ARIA level (1 for projects/headers, 2 for sessions/actions). */
  level: number;
  /** Position within sibling set (1-based, for aria-posinset). */
  posInSet: number;
  /** Total siblings at same level under same parent (for aria-setsize). */
  setSize: number;
  /** Project path (for project, session, new-session nodes). */
  projectPath?: string;
  /** Project name. */
  projectName?: string;
  /** Session data (for session nodes). */
  session?: TmuxSessionWithNotification;
  /** Whether node is expandable (only project nodes). */
  isExpandable: boolean;
  /** Whether node is currently expanded (only project nodes). */
  isExpanded: boolean;
  /** Whether session has notification bell. */
  hasNotification: boolean;
  /** Whether session is attached. */
  isAttached: boolean;
  /** Number of session children (for project badge display). */
  childCount: number;
  /** Claude session activity state (from session-state-watcher) */
  sessionState?: "error" | "idle" | "working" | "waiting_permission";
  /** Error message when sessionState is "error" */
  errorMessage?: string;
  /** Cumulative tokens used in this session */
  cumulativeTokens?: number;
  /** Index for rainbow color cycling (session nodes only). */
  colorIndex?: number;
}

// ── Component Props ──────────────────────────────────────────────────

/** Props for the SessionTree component. */
export interface SessionTreeProps {
  /** Called when a session is clicked or activated via Enter/Space. */
  onAttachSession: (sessionName: string) => void;
  /** Called when "+ new session" is clicked for a project. */
  onNewSession: (projectPath: string, projectName: string) => void;
  /** Called when "Kill" is selected from the context menu. */
  onKillSession: (sessionName: string) => void;
  /** Called when "Rename" is selected from the context menu. */
  onRenameSession: (sessionName: string) => void;
  /** Additional CSS classes for the container. */
  className?: string;
}

// ── Context Menu State ───────────────────────────────────────────────

/** State for the right-click context menu. */
interface ContextMenuState {
  x: number;
  y: number;
  sessionName: string;
}

// ── Expandable Group ─────────────────────────────────────────────────

/**
 * ExpandableGroup -- Wrapper for project children that animates
 * expand/collapse using CSS `grid-template-rows` transition (0fr -> 1fr).
 *
 * This avoids measuring DOM heights or using JS-based animation libraries.
 * The `overflow-hidden` inner div clips content when collapsed.
 */
function ExpandableGroup({
  isExpanded,
  children,
}: {
  isExpanded: boolean;
  children: ReactNode;
}): JSX.Element {
  return (
    <ul
      role="group"
      className="grid transition-[grid-template-rows] duration-200 ease-in-out"
      style={{ gridTemplateRows: isExpanded ? "1fr" : "0fr" }}
    >
      <div className="overflow-hidden">{children}</div>
    </ul>
  );
}

// ── Project Row ──────────────────────────────────────────────────────

/** Visual row content for a project node (chevron + label + count). */
function ProjectRow({
  node,
  isFocused,
}: {
  node: FlatTreeNode;
  isFocused: boolean;
}): JSX.Element {
  return (
    <div
      className={[
        "flex items-center gap-1.5 py-1 pl-2 pr-2 cursor-pointer select-none",
        "transition-colors duration-100",
        isFocused
          ? "bg-gray-800 text-white"
          : "text-gray-300 hover:bg-gray-800/50",
      ].join(" ")}
    >
      <span className="w-4 h-4 flex items-center justify-center shrink-0" aria-hidden="true">
        {node.isExpanded ? (
          <ChevronDown className="w-3.5 h-3.5 text-gray-400" />
        ) : (
          <ChevronRight className="w-3.5 h-3.5 text-gray-400" />
        )}
      </span>
      <span className="truncate">{node.label}</span>
      <span className="text-gray-500 text-xs ml-auto shrink-0">
        ({String(node.childCount)})
      </span>
    </div>
  );
}

// ── Main Component ───────────────────────────────────────────────────

/**
 * SessionTree -- Accessible WAI-ARIA tree view for tmux sessions.
 *
 * Renders tmux sessions grouped by project with:
 * - Expand/collapse project groups (CSS grid transition, 200ms)
 * - Roving tabindex keyboard navigation (W3C APG compliant)
 * - Green dot for attached sessions
 * - Yellow bell for sessions with notifications
 * - "+ new session" action per project
 * - Right-click context menu (Attach, Kill, Rename)
 * - "Unregistered Sessions" dimmed header for orphaned sessions
 * - Empty state when tmux server is not running
 */
export function SessionTree({
  onAttachSession,
  onNewSession,
  onKillSession,
  onRenameSession,
  className = "",
}: SessionTreeProps): JSX.Element {
  const { data, error, loading } = useTmuxSessions();
  const { states: sessionStates } = useSessionState();
  const treeRef = useRef<HTMLUListElement>(null);

  // Expand/collapse state owned by SessionTree (not useTreeView)
  // to avoid circular dependency: flatNodes need expandedProjects,
  // and useTreeView needs flatNodes.
  const [expandedProjects, setExpandedProjects] = useState<Set<string>>(new Set());

  // Context menu state
  const [contextMenu, setContextMenu] = useState<ContextMenuState | null>(null);

  // Build flat node list from API data + expand state + session states
  const flatNodes = useMemo(
    () => buildFlatNodes(data, expandedProjects, sessionStates),
    [data, expandedProjects, sessionStates],
  );

  // Expand/collapse callbacks
  const handleExpand = useCallback((projectPath: string): void => {
    setExpandedProjects((prev) => {
      const next = new Set(prev);
      next.add(projectPath);
      return next;
    });
  }, []);

  const handleCollapse = useCallback((projectPath: string): void => {
    setExpandedProjects((prev) => {
      const next = new Set(prev);
      next.delete(projectPath);
      return next;
    });
  }, []);

  const handleToggleExpand = useCallback((projectPath: string): void => {
    setExpandedProjects((prev) => {
      const next = new Set(prev);
      if (next.has(projectPath)) {
        next.delete(projectPath);
      } else {
        next.add(projectPath);
      }
      return next;
    });
  }, []);

  // Keyboard navigation via useTreeView
  const { focusedIndex, handleKeyDown, setFocusedIndex } = useTreeView(
    flatNodes,
    treeRef,
    {
      onActivate: (node: FlatTreeNode): void => {
        if (node.type === "session" && node.session) {
          onAttachSession(node.session.name);
        } else if (node.type === "new-session" && node.projectPath && node.projectName) {
          onNewSession(node.projectPath, node.projectName);
        }
      },
      onExpand: handleExpand,
      onCollapse: handleCollapse,
      onToggleExpand: handleToggleExpand,
    },
  );

  // Loading state - skeleton matching tree item layout
  if (loading && !data) {
    return (
      <div className={`flex flex-col animate-pulse overflow-hidden ${className}`}>
        {Array.from({ length: 8 }).map((_, i) => {
          const isProject = i % 3 === 0;
          return (
            <div
              key={i}
              className={`flex items-center gap-1.5 py-1 pr-2 ${isProject ? "pl-2" : "pl-6"}`}
            >
              {isProject && <div className="h-3 w-3 bg-gray-800/20 rounded" />}
              <div className="h-3.5 w-3.5 bg-gray-800/35 rounded shrink-0" />
              <div
                className="h-3.5 bg-gray-800/50 rounded"
                style={{ width: `${isProject ? 100 + (i % 2) * 40 : 60 + (i % 4) * 20}px` }}
              />
              {!isProject && <div className="h-3 w-8 bg-gray-800/20 rounded ml-auto" />}
            </div>
          );
        })}
      </div>
    );
  }

  // Empty state: tmux server not running or no data
  if (
    !loading &&
    (!data ||
      (data.registered.length === 0 &&
        data.registeredNoSessions.length === 0 &&
        data.unregistered.length === 0))
  ) {
    return (
      <div className={`flex flex-col items-center justify-center h-full gap-2 ${className}`}>
        <Terminal className="w-6 h-6 text-muted" />
        <p className="text-muted text-sm">tmux server not running</p>
      </div>
    );
  }

  // Error state (only when no data is available at all)
  if (error && !data) {
    return (
      <div className={`flex flex-col items-center justify-center h-full gap-2 ${className}`}>
        <Terminal className="w-6 h-6 text-muted" />
        <p className="text-muted text-sm">Failed to load sessions</p>
      </div>
    );
  }

  return (
    <div className={`flex flex-col h-full ${className}`}>
      <ul
        ref={treeRef}
        role="tree"
        aria-label="Project Sessions"
        className="flex-1 overflow-y-auto py-1 text-sm font-mono"
        onKeyDown={handleKeyDown}
      >
        {renderHierarchicalTree(
          flatNodes,
          focusedIndex,
          setFocusedIndex,
          handleToggleExpand,
          onAttachSession,
          onNewSession,
          setContextMenu,
        )}
      </ul>

      {contextMenu !== null && (
        <ContextMenu
          x={contextMenu.x}
          y={contextMenu.y}
          onAttach={(): void => {
            onAttachSession(contextMenu.sessionName);
            setContextMenu(null);
          }}
          onKill={(): void => {
            onKillSession(contextMenu.sessionName);
            setContextMenu(null);
          }}
          onRename={(): void => {
            onRenameSession(contextMenu.sessionName);
            setContextMenu(null);
          }}
          onClose={(): void => setContextMenu(null)}
        />
      )}
    </div>
  );
}

// ── Hierarchical Rendering ───────────────────────────────────────────

/**
 * Render the tree with proper nesting: project `<li>` nodes contain
 * `<ul role="group">` wrapped in ExpandableGroup for CSS transition.
 * This maintains correct ARIA parent-child relationships while enabling
 * the `grid-template-rows` animation.
 */
function renderHierarchicalTree(
  flatNodes: FlatTreeNode[],
  focusedIndex: number,
  setFocusedIndex: (index: number) => void,
  toggleExpand: (path: string) => void,
  onAttachSession: (name: string) => void,
  onNewSession: (path: string, name: string) => void,
  setContextMenu: (state: ContextMenuState | null) => void,
): ReactNode[] {
  const elements: ReactNode[] = [];
  let i = 0;

  while (i < flatNodes.length) {
    const node = flatNodes[i];

    if (node.type === "project") {
      // Collect all children of this project
      const children: Array<{ node: FlatTreeNode; flatIndex: number }> = [];
      for (let j = i + 1; j < flatNodes.length; j++) {
        if (flatNodes[j].level <= node.level) break;
        children.push({ node: flatNodes[j], flatIndex: j });
      }

      const projectFlatIndex = i;

      elements.push(
        <li
          key={node.key}
          role="treeitem"
          aria-expanded={node.isExpanded}
          aria-selected={focusedIndex === projectFlatIndex}
          aria-level={node.level}
          aria-setsize={node.setSize}
          aria-posinset={node.posInSet}
          tabIndex={focusedIndex === projectFlatIndex ? 0 : -1}
          onFocus={(): void => setFocusedIndex(projectFlatIndex)}
          onClick={(): void => {
            setFocusedIndex(projectFlatIndex);
            toggleExpand(node.projectPath!);
          }}
          className="outline-none"
        >
          <ProjectRow node={node} isFocused={focusedIndex === projectFlatIndex} />
          <ExpandableGroup isExpanded={node.isExpanded}>
            {children.map(({ node: childNode, flatIndex }) => (
              <TreeItem
                key={childNode.key}
                node={childNode}
                isFocused={focusedIndex === flatIndex}
                tabIndex={focusedIndex === flatIndex ? 0 : -1}
                onFocus={(): void => setFocusedIndex(flatIndex)}
                onClick={(): void => {
                  setFocusedIndex(flatIndex);
                  if (childNode.type === "session" && childNode.session) {
                    onAttachSession(childNode.session.name);
                  } else if (
                    childNode.type === "new-session" &&
                    childNode.projectPath &&
                    childNode.projectName
                  ) {
                    onNewSession(childNode.projectPath, childNode.projectName);
                  }
                }}
                onContextMenu={(e: React.MouseEvent): void => {
                  if (childNode.type === "session" && childNode.session) {
                    e.preventDefault();
                    setContextMenu({
                      x: e.clientX,
                      y: e.clientY,
                      sessionName: childNode.session.name,
                    });
                  }
                }}
              />
            ))}
          </ExpandableGroup>
        </li>,
      );

      // Skip past the children we already rendered
      i += children.length + 1;
    } else {
      // Non-project top-level nodes (unregistered-header, unregistered sessions)
      elements.push(
        <TreeItem
          key={node.key}
          node={node}
          isFocused={focusedIndex === i}
          tabIndex={focusedIndex === i ? 0 : -1}
          onFocus={(): void => setFocusedIndex(i)}
          onClick={(): void => {
            setFocusedIndex(i);
            if (node.type === "session" && node.session) {
              onAttachSession(node.session.name);
            }
          }}
          onContextMenu={(e: React.MouseEvent): void => {
            if (node.type === "session" && node.session) {
              e.preventDefault();
              setContextMenu({
                x: e.clientX,
                y: e.clientY,
                sessionName: node.session.name,
              });
            }
          }}
        />,
      );
      i++;
    }
  }

  return elements;
}

// ── Build Flat Nodes ─────────────────────────────────────────────────

/**
 * Build a flat node list from the SessionTree response.
 * Mirrors the TUI TreeView.rebuildFlatList() algorithm from
 * `packages/tmux-manager/src/ui/tree-view.ts`.
 *
 * @param data - The SessionTreeResponse from the REST API
 * @param expandedProjects - Set of expanded project paths
 * @returns Ordered flat list of visible tree nodes
 */
function buildFlatNodes(
  data: SessionTreeResponse | null,
  expandedProjects: Set<string>,
  sessionStates?: Map<string, SessionStateChangePayload>,
): FlatTreeNode[] {
  if (!data) return [];

  const nodes: FlatTreeNode[] = [];
  let sessionColorIndex = 0;

  // All projects: those with sessions first, then those without
  const allProjects = [...data.registered, ...data.registeredNoSessions];
  const hasUnregistered = data.unregistered.length > 0;
  const totalTopLevel = allProjects.length + (hasUnregistered ? 1 : 0);

  allProjects.forEach((pn, projectIndex) => {
    const isExpanded = expandedProjects.has(pn.project.path);
    const sessionCount = pn.sessions.length;
    const childCount = sessionCount + 1; // +1 for "new session" action

    // Project node (level 1)
    nodes.push({
      key: `project-${pn.project.path}`,
      type: "project",
      label: pn.project.name,
      level: 1,
      posInSet: projectIndex + 1,
      setSize: totalTopLevel,
      projectPath: pn.project.path,
      projectName: pn.project.name,
      isExpandable: true,
      isExpanded,
      hasNotification: false,
      isAttached: false,
      childCount: sessionCount,
    });

    // Only include children in the flat list when expanded
    if (isExpanded) {
      pn.sessions.forEach((session, sessionIndex) => {
        nodes.push({
          key: `session-${session.name}`,
          type: "session",
          label: session.name,
          level: 2,
          posInSet: sessionIndex + 1,
          setSize: childCount,
          projectPath: pn.project.path,
          projectName: pn.project.name,
          session,
          isExpandable: false,
          isExpanded: false,
          hasNotification: session.hasNotification,
          isAttached: session.attached > 0,
          childCount: 0,
          sessionState: sessionStates?.get(session.name)?.state,
          errorMessage: sessionStates?.get(session.name)?.errorMessage,
          cumulativeTokens: sessionStates?.get(session.name)?.cumulativeTokens,
          colorIndex: sessionColorIndex++,
        });
      });

      // "+ new session" action node
      nodes.push({
        key: `new-${pn.project.path}`,
        type: "new-session",
        label: "+ new session",
        level: 2,
        posInSet: childCount,
        setSize: childCount,
        projectPath: pn.project.path,
        projectName: pn.project.name,
        isExpandable: false,
        isExpanded: false,
        hasNotification: false,
        isAttached: false,
        childCount: 0,
      });
    }
  });

  // Unregistered sessions section
  if (hasUnregistered) {
    nodes.push({
      key: "unregistered-header",
      type: "unregistered-header",
      label: "Unregistered Sessions",
      level: 1,
      posInSet: totalTopLevel,
      setSize: totalTopLevel,
      isExpandable: false,
      isExpanded: false,
      hasNotification: false,
      isAttached: false,
      childCount: 0,
    });

    data.unregistered.forEach((session, index) => {
      nodes.push({
        key: `unreg-${session.name}`,
        type: "session",
        label: session.name,
        level: 2,
        posInSet: index + 1,
        setSize: data.unregistered.length,
        session,
        isExpandable: false,
        isExpanded: false,
        hasNotification: session.hasNotification,
        isAttached: session.attached > 0,
        childCount: 0,
        sessionState: sessionStates?.get(session.name)?.state,
        errorMessage: sessionStates?.get(session.name)?.errorMessage,
        cumulativeTokens: sessionStates?.get(session.name)?.cumulativeTokens,
        colorIndex: sessionColorIndex++,
      });
    });
  }

  return nodes;
}
