import type { FeishuToolsConfig } from "./types.js";

/**
 * Default tool configuration.
 * - doc, wiki, drive, scopes: enabled by default
 * - perm: enabled by default (permission management)
 */
export const DEFAULT_TOOLS_CONFIG: Required<FeishuToolsConfig> = {
  doc: true,
  wiki: true,
  drive: true,
  perm: true,
  scopes: true,
};

/**
 * Resolve tools config with defaults.
 */
export function resolveToolsConfig(cfg?: FeishuToolsConfig): Required<FeishuToolsConfig> {
  return { ...DEFAULT_TOOLS_CONFIG, ...cfg };
}
