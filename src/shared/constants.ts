// ============================================================
// constants.ts — Application-wide constants
// ============================================================

/** Gemini API base URL */
export const GEMINI_API_BASE = 'https://generativelanguage.googleapis.com/v1beta/models';

/** Default Gemini model to use */
export const GEMINI_MODEL = 'gemini-2.5-flash-lite';

/** Max consecutive errors before a key is put on cooldown */
export const MAX_KEY_ERRORS = 3;

/** Cooldown duration in milliseconds (15 minutes) */
export const KEY_COOLDOWN_MS = 15 * 60 * 1000;

/** How long to wait before retrying all keys (60 seconds) */
export const ALL_KEYS_EXHAUSTED_WAIT_MS = 60 * 1000;

/** Max retries across all keys before giving up */
export const MAX_TOTAL_RETRIES = 3;

/** CSS class added to AI-filled fields */
export const FILLED_FIELD_CLASS = 'aiff-filled';

/** CSS class added to manually-filled fields */
export const MANUAL_FILLED_CLASS = 'aiff-manual-filled';

/** CSS class for the injected context menu */
export const CONTEXT_MENU_CLASS = 'aiff-context-menu';

/** Storage keys */
export const STORAGE_KEYS = {
  API_KEYS: 'apiKeys',
  CURRENT_KEY_INDEX: 'currentKeyIndex',
  MANUAL_FIELDS: 'manualFields',
  GENERATION_STYLE: 'generationStyle',
} as const;

/** Input types that should ALWAYS be skipped */
export const SKIP_INPUT_TYPES = new Set([
  'file',
  'submit',
  'reset',
  'button',
  'image',
  'hidden',
  'checkbox',
  'radio',
  'range',
  'color',
]);

/** HTML element IDs for popup */
export const POPUP_IDS = {
  FILL_BTN: 'fill-btn',
  STATUS_TEXT: 'status-text',
  STATUS_ICON: 'status-icon',
  FILLED_COUNT: 'filled-count',
  MANUAL_COUNT: 'manual-count',
  SETTINGS_BTN: 'settings-btn',
  LOADING_SPINNER: 'loading-spinner',
  RESULT_PANEL: 'result-panel',
  KEY_STATUS: 'key-status',
} as const;
