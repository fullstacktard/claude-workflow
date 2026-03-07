/**
 * Client-side graph-to-YAML converter
 * Converts React Flow canvas nodes/edges to a YAML string for preview.
 * This is a lightweight client-side version - the authoritative server-side
 * version lives in dashboard/services/workflow-serializer.ts
 */

import type { Node, Edge } from '@xyflow/react';

/**
 * Convert React Flow nodes and edges to a workflow YAML string.
 * Handles the visual builder's node types (entry, phase, condition, agent, hook)
 * and produces a preview-quality YAML representation.
 */
export function canvasToYaml(nodes: Node[], edges: Edge[]): string {
  if (nodes.length === 0) {
    return '# Empty workflow\n# Drag nodes from the palette to get started\n';
  }

  const lines: string[] = [];

  // Find entry node for workflow name
  const entryNode = nodes.find((n) => n.type === 'entry');
  const workflowName = getString(entryNode?.data, 'label') || 'untitled-workflow';
  const workflowDescription = getString(entryNode?.data, 'description') || 'Workflow created in visual builder';

  lines.push(`name: "${workflowName}"`);
  lines.push(`description: "${workflowDescription}"`);
  lines.push('');

  // Collect phase nodes
  const phaseNodes = nodes.filter((n) => n.type === 'phase');
  const agentNodes = nodes.filter((n) => n.type === 'agent');
  const conditionNodes = nodes.filter((n) => n.type === 'condition');
  const hookNodes = nodes.filter((n) => n.type === 'hook');

  if (phaseNodes.length > 0 || agentNodes.length > 0) {
    lines.push('phases:');

    // Render phase nodes
    for (const node of phaseNodes) {
      const id = node.id;
      const label = getString(node.data, 'label') || node.id;
      const agent = getString(node.data, 'agent') || 'general-purpose';
      const description = getString(node.data, 'description');
      const count = getString(node.data, 'count') || '1';
      const nextPhaseId = getString(node.data, 'nextPhaseId');
      const timeoutMs = getNumber(node.data, 'timeoutMs');

      lines.push(`  - id: ${id}`);
      lines.push(`    agent: "${agent}"`);
      lines.push(`    count: ${count}`);
      if (description) {
        lines.push(`    description: "${description}"`);
      }

      // Find outgoing edges for next phase
      const outEdges = edges.filter((e) => e.source === id);
      const defaultNext = nextPhaseId || outEdges.find((e) => !e.data?.conditional)?.target;
      if (defaultNext) {
        lines.push(`    next: ${defaultNext}`);
      } else {
        lines.push('    next: null');
      }

      // Conditional edges
      const conditionalEdges = outEdges.filter((e) => e.data?.conditional);
      if (conditionalEdges.length > 0) {
        lines.push('    next_conditions:');
        for (const ce of conditionalEdges) {
          const condLabel = getString(ce.data, 'label') || 'all_successful';
          lines.push(`      - condition: "${condLabel}"`);
          lines.push(`        next_phase: ${ce.target}`);
        }
      }

      if (timeoutMs) {
        lines.push(`    timeout_ms: ${timeoutMs}`);
      }

      lines.push('');
    }

    // Render standalone agent nodes as phases
    for (const node of agentNodes) {
      const id = node.id;
      const label = getString(node.data, 'label') || node.id;
      const agent = getString(node.data, 'agent') || 'general-purpose';
      const description = getString(node.data, 'description');

      lines.push(`  - id: ${id}`);
      lines.push(`    agent: "${agent}"`);
      lines.push('    count: 1');
      if (description) {
        lines.push(`    description: "${description}"`);
      }

      const outEdges = edges.filter((e) => e.source === id);
      const defaultNext = outEdges.find((e) => !e.data?.conditional)?.target;
      lines.push(`    next: ${defaultNext || 'null'}`);
      lines.push('');
    }
  }

  // Render condition nodes as comments
  if (conditionNodes.length > 0) {
    lines.push('# Condition nodes:');
    for (const node of conditionNodes) {
      const label = getString(node.data, 'label') || node.id;
      const condition = getString(node.data, 'condition') || 'all_successful';
      lines.push(`#   ${node.id}: ${label} (${condition})`);
    }
    lines.push('');
  }

  // Render hook nodes as comments
  if (hookNodes.length > 0) {
    lines.push('# Hook nodes:');
    for (const node of hookNodes) {
      const label = getString(node.data, 'label') || node.id;
      const event = getString(node.data, 'event') || 'on_complete';
      lines.push(`#   ${node.id}: ${label} (${event})`);
    }
    lines.push('');
  }

  // Add connections summary
  if (edges.length > 0) {
    lines.push('# Connections:');
    for (const edge of edges) {
      const label = getString(edge.data, 'label');
      lines.push(`#   ${edge.source} -> ${edge.target}${label ? ` (${label})` : ''}`);
    }
    lines.push('');
  }

  return lines.join('\n');
}

function getString(data: unknown, key: string): string | undefined {
  if (data && typeof data === 'object' && key in data) {
    const val = (data as Record<string, unknown>)[key];
    return typeof val === 'string' ? val : undefined;
  }
  return undefined;
}

function getNumber(data: unknown, key: string): number | undefined {
  if (data && typeof data === 'object' && key in data) {
    const val = (data as Record<string, unknown>)[key];
    return typeof val === 'number' ? val : undefined;
  }
  return undefined;
}
