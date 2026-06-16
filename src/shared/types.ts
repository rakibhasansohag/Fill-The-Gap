// ============================================================
// types.ts — All shared TypeScript interfaces and enums
// ============================================================

/** Represents a detected form field on the page */
export interface DetectedField {
  /** Unique CSS selector to target this element */
  selector: string;
  /** Element tag name */
  tag: 'INPUT' | 'TEXTAREA' | 'SELECT';
  /** Input type attribute (text, email, number, etc.) */
  inputType: string;
  /** Collected label/hint text for AI context */
  labelText: string;
  /** Current value (if any) */
  currentValue: string;
  /** Available options for <select> elements */
  options?: SelectOption[];
  /** ID of the frame this field resides in */
  frameId?: number;
}

/** Option in a <select> dropdown */
export interface SelectOption {
  value: string;
  label: string;
}

/** Map of field selectors to their AI-generated or manual values */
export type FieldValueMap = Record<string, string>;

/** Manual fields stored in extension memory (unique key → value) */
export type ManualFields = Record<string, string>;

/** A single Gemini API key with tracking metadata */
export interface ApiKeyEntry {
  key: string;
  errorCount: number;
  cooldownUntil: number | null; // Unix timestamp ms, or null if active
  totalCalls: number;
  lastUsed: number | null;
}

/** Extension storage schema */
export interface ExtensionStorage {
  /** Parsed API key entries */
  apiKeys: ApiKeyEntry[];
  /** Index of the currently active key */
  currentKeyIndex: number;
  /** User-defined manual fields (email, password, etc.) */
  manualFields: ManualFields;
  /** Whether filling is enabled on the current tab */
  fillingEnabled: boolean;
  /** Generation style preference */
  generationStyle: GenerationStyle;
}

/** Controls AI content generation style */
export type GenerationStyle = 'professional' | 'casual' | 'random';

// ============================================================
// Message types passed between popup ↔ background ↔ content
// ============================================================

export type MessageType =
  | 'TRIGGER_FILL'
  | 'FILL_COMPLETE'
  | 'FILL_ERROR'
  | 'GET_FIELD_SCAN'
  | 'FIELD_SCAN_RESULT'
  | 'GENERATE_VALUES'
  | 'VALUES_READY'
  | 'API_STATUS'
  | 'CLEAR_HIGHLIGHTS'
  | 'SHOW_CONTEXT_MENU'
  | 'HIDE_CONTEXT_MENU'
  | 'ROTATION_WARNING';

/** Base message structure */
export interface BaseMessage {
  type: MessageType;
}

/** Sent from popup → background to start filling */
export interface TriggerFillMessage extends BaseMessage {
  type: 'TRIGGER_FILL';
  tabId: number;
}

/** Sent from background → content with generated values */
export interface ValuesReadyMessage extends BaseMessage {
  type: 'VALUES_READY';
  values: FieldValueMap;
  manualSelectors: string[];
}

/** Sent from content → background with scanned field data */
export interface FieldScanResultMessage extends BaseMessage {
  type: 'FIELD_SCAN_RESULT';
  fields: DetectedField[];
  pageUrl: string;
  pageTitle: string;
}

/** Sent from content → popup to report fill completion */
export interface FillCompleteMessage extends BaseMessage {
  type: 'FILL_COMPLETE';
  filledCount: number;
  skippedCount: number;
  manualCount: number;
}

/** Error message */
export interface FillErrorMessage extends BaseMessage {
  type: 'FILL_ERROR';
  error: string;
}

/** API key status for options page */
export interface ApiStatusMessage extends BaseMessage {
  type: 'API_STATUS';
  keys: ApiKeyStatus[];
  currentIndex: number;
}

export interface ApiKeyStatus {
  index: number;
  maskedKey: string;
  errorCount: number;
  isOnCooldown: boolean;
  cooldownRemainingMs: number;
  totalCalls: number;
}

/** Sent from background → content to trigger a field scan */
export interface GetFieldScanMessage extends BaseMessage {
  type: 'GET_FIELD_SCAN';
}

/** Sent from background → content to clear highlights */
export interface ClearHighlightsMessage extends BaseMessage {
  type: 'CLEAR_HIGHLIGHTS';
}

/** Sent from background → popup when a key fails and rotation is triggered */
export interface RotationWarningMessage extends BaseMessage {
  type: 'ROTATION_WARNING';
  keyIndex: number;
  error: string;
  isCooledDown: boolean;
}

export type ExtensionMessage =
  | TriggerFillMessage
  | ValuesReadyMessage
  | FieldScanResultMessage
  | FillCompleteMessage
  | FillErrorMessage
  | ApiStatusMessage
  | GetFieldScanMessage
  | ClearHighlightsMessage
  | RotationWarningMessage;
