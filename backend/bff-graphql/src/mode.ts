export const DOCK_MODES = ['laptop', 'workspace'] as const;
export type DockMode = typeof DOCK_MODES[number];

/**
 * Which DOCK this server is. The laptop one keeps every page but chat: its bridge only reports the run ledger.
 * The workspace one runs inside a Coder workspace with chat, connects its own Google account, and has no Docker page.
 */
export function dockMode(): DockMode {
  const value = process.env.DOCK_MODE || 'laptop';
  if (!DOCK_MODES.includes(value as DockMode)) throw new Error(`DOCK_MODE must be one of ${DOCK_MODES.join(', ')}`);
  return value as DockMode;
}
