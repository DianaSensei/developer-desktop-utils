/**
 * Centralized business configuration for the app.
 *
 * This is the single source of truth for tunable *behavioral* numbers — things
 * that affect how features behave, NOT framework/build settings (those live in
 * tauri.conf.json, vite.config.ts, etc.).
 *
 * Every value here is editable at runtime from Settings → Configuration. Add a
 * new value by (1) extending `AppConfig` + `DEFAULT_APP_CONFIG`, then (2) adding
 * a matching entry to `CONFIG_FIELDS` so it appears in the editor automatically.
 */

export interface AppConfig {
  updates: {
    /** Default hour (0–23, local) for the daily update check when the user hasn't picked one. */
    defaultCheckHour: number;
    /** Abort a download if no progress arrives for this many seconds. */
    downloadTimeoutSeconds: number;
  };
  editor: {
    /** Debounce (ms) for grouping keystrokes into a single undo/redo step. */
    historyDebounceMs: number;
    /** How long (ms) the "Copied" confirmation stays visible after copying. */
    copyFeedbackMs: number;
  };
  generator: {
    /** Maximum count when generating random numbers in one batch. */
    maxNumberCount: number;
    /** Maximum count when generating random text strings in one batch. */
    maxTextCount: number;
    /** Maximum length of a single generated random text string. */
    maxTextLength: number;
  };
  kafka: {
    /** Maximum messages fetched in a single Kafka range/poll request. */
    maxFetchMessages: number;
  };
}

export const DEFAULT_APP_CONFIG: AppConfig = {
  updates: {
    defaultCheckHour: 6,
    downloadTimeoutSeconds: 60,
  },
  editor: {
    historyDebounceMs: 400,
    copyFeedbackMs: 1500,
  },
  generator: {
    maxNumberCount: 1000,
    maxTextCount: 500,
    maxTextLength: 1024,
  },
  kafka: {
    maxFetchMessages: 500,
  },
};

// ---------------------------------------------------------------------------
// Field metadata — drives the generic Settings → Configuration editor.
// ---------------------------------------------------------------------------

export type ConfigSection = keyof AppConfig;

export interface ConfigField {
  section: ConfigSection;
  /** Key within the section. */
  key: string;
  label: string;
  description: string;
  min: number;
  max: number;
  step?: number;
  /** Short unit suffix shown next to the input (e.g. "s", "ms"). */
  unit?: string;
}

export const SECTION_LABELS: Record<ConfigSection, string> = {
  updates: 'Updates',
  editor: 'Editor',
  generator: 'Generators',
  kafka: 'Kafka',
};

export const CONFIG_FIELDS: ConfigField[] = [
  { section: 'updates', key: 'defaultCheckHour', label: 'Default check hour', description: 'Hour of day (0–23) used for the daily update check until you pick a time.', min: 0, max: 23, step: 1 },
  { section: 'updates', key: 'downloadTimeoutSeconds', label: 'Download timeout', description: 'Cancel an update download if it stalls for this long.', min: 10, max: 600, step: 5, unit: 's' },
  { section: 'editor', key: 'historyDebounceMs', label: 'Undo grouping delay', description: 'How long to wait before grouping edits into one undo step.', min: 100, max: 2000, step: 50, unit: 'ms' },
  { section: 'editor', key: 'copyFeedbackMs', label: 'Copied feedback', description: 'Duration the "Copied" confirmation stays visible.', min: 500, max: 5000, step: 100, unit: 'ms' },
  { section: 'generator', key: 'maxNumberCount', label: 'Max numbers', description: 'Largest batch of random numbers generated at once.', min: 10, max: 100000, step: 10 },
  { section: 'generator', key: 'maxTextCount', label: 'Max strings', description: 'Largest batch of random text strings generated at once.', min: 10, max: 100000, step: 10 },
  { section: 'generator', key: 'maxTextLength', label: 'Max string length', description: 'Maximum length of a single generated random string.', min: 16, max: 65536, step: 16 },
  { section: 'kafka', key: 'maxFetchMessages', label: 'Max fetch messages', description: 'Maximum messages fetched in one Kafka range/poll request.', min: 10, max: 100000, step: 10 },
];

/** Deep-merge a (possibly partial / stale) stored config onto the defaults. */
export function mergeConfig(stored: unknown): AppConfig {
  const base: AppConfig = structuredClone(DEFAULT_APP_CONFIG);
  if (!stored || typeof stored !== 'object') return base;
  for (const section of Object.keys(base) as ConfigSection[]) {
    const incoming = (stored as Record<string, unknown>)[section];
    if (incoming && typeof incoming === 'object') {
      Object.assign(base[section], incoming);
    }
  }
  return base;
}
