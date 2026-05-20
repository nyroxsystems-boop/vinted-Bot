// Photo helpers used by every listing/sales view.
// Single source of truth so a URL or filter change lands in one place.

import { apiUrl } from '../api/base';

// Absolute URL via apiUrl() — relative paths break inside the Tauri shell
// where the document origin is `tauri.localhost` (no /api proxy). Image
// requests need to hit the orchestrator directly the same way fetch() does.
export function photoUrl(p: string): string {
  return apiUrl(`/api/products/image?path=${encodeURIComponent(p)}`);
}

// Prefer AI-generated lifestyle shots, but fall back to source images if the
// folder has not been generated yet. Returns an empty array only when the
// listing truly has no photos at all.
export function listingPhotos(paths: string[] | null | undefined): string[] {
  if (!paths || paths.length === 0) return [];
  const generated = paths.filter((p) => p.includes('/generated/'));
  return generated.length > 0 ? generated : paths;
}

// True only if at least one path is from the AI-generated subfolder.
export function hasGeneratedPhotos(paths: string[] | null | undefined): boolean {
  if (!paths) return false;
  return paths.some((p) => p.includes('/generated/'));
}
