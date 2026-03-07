import { Copy, Layers } from "lucide-react";
import { WorkflowTemplate } from "../../../types/workflow";

interface TemplateCardProps {
	template: WorkflowTemplate;
	onClone: (templateId: string, tier: "global" | "project") => void;
	onTagClick?: (tag: string) => void;
}

export function TemplateCard({
	template,
	onClone,
	onTagClick,
}: TemplateCardProps): JSX.Element {
	return (
		<div className="border border-border rounded-lg p-4 bg-background hover:bg-accent transition-colors">
			<div className="flex items-start justify-between mb-2">
				<div className="flex items-center gap-2">
					<Layers className="w-5 h-5 text-primary" />
					<h3 className="text-foreground text-lg font-semibold">
						{template.name}
					</h3>
				</div>
				<span className="text-muted text-sm">{template.phases} phases</span>
			</div>

			<p className="text-muted text-sm mb-3 line-clamp-2">
				{template.description}
			</p>

			<div className="flex flex-wrap gap-2 mb-4">
				{template.tags.map((tag) => (
					<span
						key={tag}
						className="px-2 py-1 rounded text-xs bg-accent text-foreground cursor-pointer hover:bg-primary hover:text-primary-foreground transition-colors"
						onClick={() => onTagClick?.(tag)}
					>
						{tag}
					</span>
				))}
			</div>

			<div className="flex gap-2">
				<button
					onClick={() => onClone(template.id, "project")}
					className="flex-1 px-3 py-2 rounded-lg bg-primary text-primary-foreground hover:bg-primary-dark focus:outline-none focus:ring-2 focus:ring-primary focus:ring-offset-2 transition-colors flex items-center justify-center gap-2"
				>
					<Copy className="w-4 h-4" />
					Clone to Project
				</button>
				<button
					onClick={() => onClone(template.id, "global")}
					className="flex-1 px-3 py-2 rounded-lg border border-border bg-transparent hover:bg-accent focus:outline-none focus:ring-2 focus:ring-primary focus:ring-offset-2 transition-colors flex items-center justify-center gap-2"
				>
					<Copy className="w-4 h-4" />
					Clone to Global
				</button>
			</div>
		</div>
	);
}
