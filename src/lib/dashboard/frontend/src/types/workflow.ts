/**
 * Workflow template metadata from built-in templates
 */
export interface WorkflowTemplate {
	/** Unique ID (filename without .yml/.yaml extension) */
	id: string;
	/** Workflow display name */
	name: string;
	/** Long-form description */
	description: string;
	/** Category tags for filtering */
	tags: string[];
	/** Number of phases in workflow */
	phases: number;
	/** Semantic version */
	version: string;
	/** Author (e.g., claude-workflow) */
	author: string;
	/** Entry command (e.g., /setup) */
	command?: string | null;
}

/**
 * Clone request payload
 */
export interface CloneWorkflowRequest {
	templateId: string;
	tier: "global" | "project";
	projectPath?: string;
}

/**
 * Clone response
 */
export interface CloneWorkflowResponse {
	success: boolean;
	path: string;
	message?: string;
}
