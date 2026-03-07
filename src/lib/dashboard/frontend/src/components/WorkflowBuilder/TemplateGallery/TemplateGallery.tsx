import { useEffect, useState } from "react";
import { Search, X } from "lucide-react";
import { TemplateCard } from "./TemplateCard";
import { WorkflowTemplate, CloneWorkflowResponse } from "../../../types/workflow";

export function TemplateGallery(): JSX.Element {
	const [templates, setTemplates] = useState<WorkflowTemplate[]>([]);
	const [loading, setLoading] = useState(true);
	const [selectedTags, setSelectedTags] = useState<string[]>([]);
	const [error, setError] = useState<string | null>(null);

	// Fetch templates on mount
	useEffect(() => {
		const fetchTemplates = async (): Promise<void> => {
			try {
				const response = await fetch("/api/workflows/templates");
				if (!response.ok) {
					throw new Error("Failed to fetch templates");
				}
				const data = (await response.json()) as WorkflowTemplate[];
				setTemplates(data);
			} catch (err) {
				setError(err instanceof Error ? err.message : "Unknown error");
			} finally {
				setLoading(false);
			}
		};

		void fetchTemplates();
	}, []);

	// Filter templates by selected tags
	const filteredTemplates =
		selectedTags.length === 0
			? templates
			: templates.filter((t) => t.tags.some((tag) => selectedTags.includes(tag)));

	// Handle tag filter toggle
	const toggleTag = (tag: string): void => {
		setSelectedTags((prev) =>
			prev.includes(tag) ? prev.filter((t) => t !== tag) : [...prev, tag]
		);
	};

	// Handle clone action
	const handleClone = async (
		templateId: string,
		tier: "global" | "project"
	): Promise<void> => {
		try {
			const response = await fetch("/api/workflows/clone", {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ templateId, tier }),
			});

			if (!response.ok) {
				const errorData = (await response.json()) as { message?: string };
				throw new Error(errorData.message || "Clone failed");
			}

			const data = (await response.json()) as CloneWorkflowResponse;

			// Show success toast
			showToast(`Workflow cloned to ${tier} directory`, "success");

			// TODO: Navigate to editor with cloned workflow when editor is implemented
			console.log("Cloned workflow path:", data.path);
		} catch (err) {
			showToast(
				err instanceof Error ? err.message : "Clone failed",
				"error"
			);
		}
	};

	// All unique tags from templates
	const allTags = Array.from(new Set(templates.flatMap((t) => t.tags))).sort();

	if (loading) {
		return (
			<div className="flex items-center justify-center py-12">
				<div className="text-muted">Loading templates...</div>
			</div>
		);
	}

	if (error) {
		return (
			<div className="flex items-center justify-center py-12">
				<div className="text-error">Error: {error}</div>
			</div>
		);
	}

	return (
		<div className="p-6">
			<div className="mb-6">
				<h2 className="text-2xl font-bold text-foreground mb-2">
					Workflow Templates
				</h2>
				<p className="text-muted">
					Browse and clone built-in workflows to get started quickly
				</p>
			</div>

			{/* Tag Filters */}
			{allTags.length > 0 && (
				<div className="mb-6">
					<div className="flex items-center gap-2 mb-2">
						<Search className="w-4 h-4 text-muted" />
						<span className="text-sm text-muted">Filter by tags:</span>
					</div>
					<div className="flex flex-wrap gap-2">
						{allTags.map((tag) => (
							<button
								key={tag}
								onClick={() => toggleTag(tag)}
								className={`
									px-3 py-1.5 rounded-lg text-sm transition-colors
									focus:outline-none focus:ring-2 focus:ring-primary focus:ring-offset-2
									${
										selectedTags.includes(tag)
											? "bg-primary text-primary-foreground"
											: "bg-accent text-foreground hover:bg-primary hover:text-primary-foreground"
									}
								`}
							>
								{tag}
								{selectedTags.includes(tag) && (
									<X className="inline-block w-3 h-3 ml-1" />
								)}
							</button>
						))}
					</div>
					{selectedTags.length > 0 && (
						<button
							onClick={() => setSelectedTags([])}
							className="mt-2 text-sm text-muted hover:text-foreground transition-colors"
						>
							Clear filters
						</button>
					)}
				</div>
			)}

			{/* Template Grid */}
			<div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
				{filteredTemplates.map((template) => (
					<TemplateCard
						key={template.id}
						template={template}
						onClone={handleClone}
						onTagClick={toggleTag}
					/>
				))}
			</div>

			{filteredTemplates.length === 0 && (
				<div className="text-center py-12 text-muted">
					No templates match your filters
				</div>
			)}
		</div>
	);
}

// Simple toast helper (can be replaced with global toast system)
function showToast(message: string, type: "success" | "error"): void {
	// TODO: Integrate with global Toast component from dashboard
	console.log(`[${type.toUpperCase()}] ${message}`);
	const prefix = type === "success" ? "✓" : "✗";
	alert(`${prefix} ${message}`);
}
