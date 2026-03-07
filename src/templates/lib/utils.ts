import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

/**
 * Utility function to merge Tailwind CSS classes without conflicts.
 *
 * Combines clsx for conditional class composition with tailwind-merge
 * for intelligent deduplication of Tailwind utility classes.
 *
 * @example
 * ```tsx
 * // Basic usage
 * cn("px-2 py-1", "p-4")
 * // Returns: "p-4" (p-4 overrides px-2 py-1)
 *
 * // Conditional classes
 * cn("text-gray-500", isActive && "text-black")
 * // Returns: "text-black" when isActive is true
 *
 * // With variants
 * cn("hover:bg-gray-100", variant === "primary" && "hover:bg-blue-100")
 * // Properly handles Tailwind variants
 * ```
 */
export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}
