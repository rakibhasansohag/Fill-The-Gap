// ============================================================
// storage.ts — Typed Chrome storage abstraction layer
// ============================================================

import type {
  ApiKeyEntry,
  ExtensionStorage,
  ManualFields,
  GenerationStyle,
} from './types';
import { STORAGE_KEYS } from './constants';

/** Default storage values */
const DEFAULTS: ExtensionStorage = {
  apiKeys: [],
  currentKeyIndex: 0,
  manualFields: {},
  fillingEnabled: true,
  generationStyle: 'professional',
};

// ── Generic helpers ──────────────────────────────────────────

async function get<T>(key: string, fallback: T): Promise<T> {
  return new Promise((resolve) => {
    chrome.storage.local.get(key, (result) => {
      resolve(result[key] !== undefined ? (result[key] as T) : fallback);
    });
  });
}

async function set<T>(key: string, value: T): Promise<void> {
  return new Promise((resolve) => {
    chrome.storage.local.set({ [key]: value }, resolve);
  });
}

// ── API Keys ─────────────────────────────────────────────────

/**
 * Parse a comma-separated key string like:
 * "GEMINI_KEYS=key1,key2,key3" or just "key1,key2,key3"
 */
export function parseApiKeyString(raw: string): string[] {
  const cleaned = raw.replace(/^GEMINI_KEYS\s*=\s*/i, '').trim();
  return cleaned
    .split(',')
    .map((k) => k.trim())
    .filter((k) => k.length > 0);
}

/** Convert raw key strings to ApiKeyEntry objects */
export function buildApiKeyEntries(keys: string[]): ApiKeyEntry[] {
  return keys.map((key) => ({
    key,
    errorCount: 0,
    cooldownUntil: null,
    totalCalls: 0,
    lastUsed: null,
  }));
}

export async function getApiKeys(): Promise<ApiKeyEntry[]> {
  return get<ApiKeyEntry[]>(STORAGE_KEYS.API_KEYS, DEFAULTS.apiKeys);
}

export async function setApiKeys(keys: ApiKeyEntry[]): Promise<void> {
  return set(STORAGE_KEYS.API_KEYS, keys);
}

export async function getCurrentKeyIndex(): Promise<number> {
  return get<number>(STORAGE_KEYS.CURRENT_KEY_INDEX, DEFAULTS.currentKeyIndex);
}

export async function setCurrentKeyIndex(index: number): Promise<void> {
  return set(STORAGE_KEYS.CURRENT_KEY_INDEX, index);
}

/** Update a single key entry by index */
export async function updateApiKeyEntry(
  index: number,
  updates: Partial<ApiKeyEntry>
): Promise<void> {
  const keys = await getApiKeys();
  if (index >= 0 && index < keys.length) {
    keys[index] = { ...keys[index], ...updates };
    await setApiKeys(keys);
  }
}

// ── Manual Fields ────────────────────────────────────────────

export async function getManualFields(): Promise<ManualFields> {
  return get<ManualFields>(STORAGE_KEYS.MANUAL_FIELDS, DEFAULTS.manualFields);
}

export async function setManualFields(fields: ManualFields): Promise<void> {
  return set(STORAGE_KEYS.MANUAL_FIELDS, fields);
}

/**
 * Add or update a single manual field.
 * Key is normalized to lowercase, trimmed — enforces uniqueness.
 */
export async function upsertManualField(key: string, value: string): Promise<void> {
  const fields = await getManualFields();
  const normalizedKey = key.toLowerCase().trim();
  fields[normalizedKey] = value;
  await setManualFields(fields);
}

/** Remove a manual field by key */
export async function deleteManualField(key: string): Promise<void> {
  const fields = await getManualFields();
  const normalizedKey = key.toLowerCase().trim();
  delete fields[normalizedKey];
  await setManualFields(fields);
}

// ── Generation Style ─────────────────────────────────────────

export async function getGenerationStyle(): Promise<GenerationStyle> {
  return get<GenerationStyle>(STORAGE_KEYS.GENERATION_STYLE, DEFAULTS.generationStyle);
}

export async function setGenerationStyle(style: GenerationStyle): Promise<void> {
  return set(STORAGE_KEYS.GENERATION_STYLE, style);
}

// ── Full State ───────────────────────────────────────────────

export async function getFullStorage(): Promise<ExtensionStorage> {
  const [apiKeys, currentKeyIndex, manualFields, generationStyle] = await Promise.all([
    getApiKeys(),
    getCurrentKeyIndex(),
    getManualFields(),
    getGenerationStyle(),
  ]);
  return {
    apiKeys,
    currentKeyIndex,
    manualFields,
    fillingEnabled: true,
    generationStyle,
  };
}
