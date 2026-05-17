import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

/**
 * Merge Tailwind class strings with conflict resolution.
 *
 * `clsx` filters falsy values; `twMerge` resolves conflicts so that
 * `cn("p-2", "p-4")` returns `"p-4"` instead of both.
 */
export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}
