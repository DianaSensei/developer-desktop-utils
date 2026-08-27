import { MOD_KEY } from './platform';

/**
 * Reference data for the Settings → Keyboard Shortcuts section. Not run
 * through i18n (same precedent as `appPermissions.ts`'s permission
 * descriptions) — this is reference text, not app chrome.
 *
 * Only lists shortcuts bound at the window/document level (a user can't
 * discover these just by looking at the tool, unlike e.g. arrow-key history
 * inside a focused CLI input, which is the expected behavior of that kind of
 * control). Verified against each handler's actual key check, not guessed —
 * update this alongside the handler if the keys ever change.
 */
export interface Shortcut {
  keys: string[];
  /** How to read multiple `keys` entries: 'combo' (press together, joined with
   *  "+") or 'either' (any one of them, joined with "/"). Defaults to 'combo'. */
  join?: 'combo' | 'either';
  description: string;
}

export interface ShortcutGroup {
  /** A TOOL_DEFS id this group's shortcuts apply to, or null for shortcuts
   *  that work everywhere in the app regardless of the open tool. */
  toolId: string | null;
  shortcuts: Shortcut[];
}

export function getShortcutGroups(): ShortcutGroup[] {
  return [
    {
      toolId: null,
      shortcuts: [
        { keys: [MOD_KEY, 'K'], description: 'Open the command palette to search and jump to any tool' },
        { keys: [MOD_KEY, 'V'], description: "Quick-paste the clipboard into a tool's primary input" },
        { keys: [MOD_KEY, 'Z'], description: 'Undo the last edit' },
        { keys: [MOD_KEY, '⇧', 'Z'], description: 'Redo' },
      ],
    },
    {
      toolId: 'api-client',
      shortcuts: [
        { keys: [MOD_KEY, '↵'], description: 'Send the active request' },
        { keys: [MOD_KEY, 'B'], description: 'Create a new request' },
        { keys: [MOD_KEY, 'E'], description: 'Open environments' },
        { keys: [MOD_KEY, 'W'], description: 'Close the active tab' },
      ],
    },
    {
      toolId: 'container-manager',
      shortcuts: [
        { keys: [MOD_KEY, 'F'], description: 'Focus the log search box' },
      ],
    },
    {
      toolId: 'task-tracker',
      shortcuts: [
        { keys: [MOD_KEY, '↵'], description: 'Start or stop the timer, from anywhere in the tool' },
      ],
    },
    {
      toolId: 'network',
      shortcuts: [
        { keys: ['←', '↑', '→', '↓'], join: 'either', description: "Switch between Network Tools' sub-tools" },
        { keys: ['1–9'], description: 'Jump straight to a sub-tool by its position' },
      ],
    },
  ];
}
