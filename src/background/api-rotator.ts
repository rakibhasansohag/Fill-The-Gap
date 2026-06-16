/**
 * api-rotator.ts
 * Manages Gemini API key rotation, error tracking, and backoff/cooldown states.
 */

import type { ApiKeyEntry } from '@shared/types';
import {
  getApiKeys,
  setApiKeys,
  getCurrentKeyIndex,
  setCurrentKeyIndex,
  updateApiKeyEntry,
} from '@shared/storage';
import {
  MAX_KEY_ERRORS,
  KEY_COOLDOWN_MS,
  MAX_TOTAL_RETRIES,
  ALL_KEYS_EXHAUSTED_WAIT_MS,
} from '@shared/constants';
import {
  callGeminiApi,
  extractJsonFromResponse,
  shouldRotateOnError,
  GeminiApiError,
} from '@utils/gemini-client';
import { logger } from '@utils/logger';

// Core state helpers

function isKeyCooledDown(entry: ApiKeyEntry): boolean {
  if (!entry.cooldownUntil) return false;
  return Date.now() < entry.cooldownUntil;
}

function maskKey(key: string): string {
  if (key.length <= 8) return '****';
  return `${key.slice(0, 4)}...${key.slice(-4)}`;
}

/**
 * Rotates API keys on failures (e.g. rate limits or server errors) and tracks key health.
 */

export class ApiRotator {
  private keys: ApiKeyEntry[] = [];
  private currentIndex: number = 0;

  /** Load state from chrome.storage */
  async initialize(): Promise<void> {
    this.keys = await getApiKeys();
    this.currentIndex = await getCurrentKeyIndex();
    logger.info(
      `ApiRotator initialized: ${this.keys.length} keys, current index: ${this.currentIndex}`
    );
  }

  /** Persist state to chrome.storage */
  private async persist(): Promise<void> {
    await setApiKeys(this.keys);
    await setCurrentKeyIndex(this.currentIndex);
  }

  /** Get the next available (non-cooldown) key index */
  private getNextAvailableIndex(startFrom: number): number | null {
    const total = this.keys.length;
    for (let i = 0; i < total; i++) {
      const index = (startFrom + i) % total;
      const entry = this.keys[index];
      if (!isKeyCooledDown(entry)) {
        return index;
      }
    }
    return null; // all keys on cooldown
  }

  /** Mark the current key as errored; apply cooldown if threshold exceeded */
  private async markError(index: number): Promise<void> {
    const entry = this.keys[index];
    const newErrorCount = entry.errorCount + 1;
    const updates: Partial<ApiKeyEntry> = { errorCount: newErrorCount };

    if (newErrorCount >= MAX_KEY_ERRORS) {
      updates.cooldownUntil = Date.now() + KEY_COOLDOWN_MS;
      logger.warn(
        `Key ${maskKey(entry.key)} placed on cooldown (${MAX_KEY_ERRORS} errors)`
      );
    }

    this.keys[index] = { ...entry, ...updates };
    await updateApiKeyEntry(index, updates);
  }

  /** Reset error count on successful call */
  private async markSuccess(index: number): Promise<void> {
    const updates: Partial<ApiKeyEntry> = {
      errorCount: 0,
      cooldownUntil: null,
      totalCalls: (this.keys[index].totalCalls || 0) + 1,
      lastUsed: Date.now(),
    };
    this.keys[index] = { ...this.keys[index], ...updates };
    await updateApiKeyEntry(index, updates);
  }

  /** Rotate to the next available key */
  private async rotateNext(): Promise<boolean> {
    const nextIndex = this.getNextAvailableIndex(
      (this.currentIndex + 1) % this.keys.length
    );
    if (nextIndex === null) return false;

    logger.info(
      `Rotating from key[${this.currentIndex}] → key[${nextIndex}]`
    );
    this.currentIndex = nextIndex;
    await setCurrentKeyIndex(this.currentIndex);
    return true;
  }

  /**
   * Call Gemini with automatic key rotation on errors.
   * Tries each available key up to MAX_TOTAL_RETRIES times.
   * Returns the text response from Gemini.
   */
  async callWithRotation(prompt: string, temperature = 0.7): Promise<string> {
    if (this.keys.length === 0) {
      throw new Error('No API keys configured. Please add keys in the extension settings.');
    }

    // Refresh state from storage (may have changed in another context)
    await this.initialize();

    let attempts = 0;
    const maxAttempts = Math.min(this.keys.length, MAX_TOTAL_RETRIES * this.keys.length);

    while (attempts < maxAttempts) {
      const availableIndex = this.getNextAvailableIndex(this.currentIndex);

      if (availableIndex === null) {
        // All keys on cooldown — wait and retry
        logger.warn(
          `All ${this.keys.length} keys on cooldown. Waiting ${ALL_KEYS_EXHAUSTED_WAIT_MS / 1000}s...`
        );
        await sleep(ALL_KEYS_EXHAUSTED_WAIT_MS);
        await this.initialize(); // reload after cooldowns may have expired
        attempts++;
        continue;
      }

      this.currentIndex = availableIndex;
      const currentKey = this.keys[this.currentIndex];

      try {
        logger.debug(`Using key[${this.currentIndex}]: ${maskKey(currentKey.key)}`);
        const result = await callGeminiApi(currentKey.key, prompt, temperature);
        await this.markSuccess(this.currentIndex);
        return result;
      } catch (error) {
        const errorMsg = error instanceof Error ? error.message : String(error);
        logger.warn(
          `Key[${this.currentIndex}] failed:`,
          errorMsg
        );

        if (shouldRotateOnError(error)) {
          const entry = this.keys[this.currentIndex];
          const isCooledDown = (entry.errorCount + 1) >= MAX_KEY_ERRORS;

          chrome.runtime.sendMessage({
            type: 'ROTATION_WARNING',
            keyIndex: this.currentIndex,
            error: errorMsg,
            isCooledDown,
          }).catch(() => {});

          await this.markError(this.currentIndex);
          const rotated = await this.rotateNext();
          if (!rotated) {
            logger.warn('Could not rotate — all keys exhausted or on cooldown.');
          }
        } else {
          // Non-rotatable error (e.g., bad prompt, invalid JSON) — don't rotate
          throw error;
        }
      }

      attempts++;
    }

    throw new Error(
      `All API keys failed after ${attempts} attempts. ` +
      `Check your keys in the extension settings or wait for cooldowns to expire.`
    );
  }

  /**
   * Generate form field values using Gemini with rotation.
   * Returns a parsed FieldValueMap.
   */
  async generateFieldValues(prompt: string): Promise<Record<string, string>> {
    const rawResponse = await this.callWithRotation(prompt, 0.8);
    const parsed = extractJsonFromResponse(rawResponse);

    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
      throw new Error(`Gemini returned unexpected structure: ${typeof parsed}`);
    }

    // Sanitize: ensure all values are strings
    const result: Record<string, string> = {};
    for (const [key, value] of Object.entries(parsed as Record<string, unknown>)) {
      result[key] = String(value);
    }
    return result;
  }

  /** Get status of all keys for the options page */
  getKeyStatuses(): Array<{
    index: number;
    maskedKey: string;
    errorCount: number;
    isOnCooldown: boolean;
    cooldownRemainingMs: number;
    totalCalls: number;
    isCurrent: boolean;
  }> {
    return this.keys.map((entry, index) => ({
      index,
      maskedKey: maskKey(entry.key),
      errorCount: entry.errorCount,
      isOnCooldown: isKeyCooledDown(entry),
      cooldownRemainingMs: entry.cooldownUntil
        ? Math.max(0, entry.cooldownUntil - Date.now())
        : 0,
      totalCalls: entry.totalCalls,
      isCurrent: index === this.currentIndex,
    }));
  }
}

// Singleton instance shared across the service worker lifecycle
export const apiRotator = new ApiRotator();

// Helper functions

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
