/**
 * content-script.ts
 * Content script entry point loaded in target pages.
 * Handles DOM scanning and form filling operations.
 */

import type {
  ExtensionMessage,
  ValuesReadyMessage,
  FillCompleteMessage,
  FillErrorMessage,
  DetectedField,
} from '@shared/types';
import { scanAllFields } from './field-scanner';
import { fillFields, injectHighlightStyles, clearAllHighlights } from './field-filler';
import { logger } from '@utils/logger';

// Initialize content script

// Inject highlight CSS as soon as content script loads
injectHighlightStyles();

logger.info('Content script initialized on:', window.location.href);

// Message listeners for popup/service worker communications

chrome.runtime.onMessage.addListener(
  (message: ExtensionMessage, _sender, sendResponse) => {
    handleMessage(message).then(sendResponse).catch((err) => {
      logger.error('Content script message error:', err);
      sendResponse({ error: String(err) });
    });
    return true; // Keep async channel open
  }
);

async function handleMessage(message: ExtensionMessage): Promise<unknown> {
  switch (message.type) {
    case 'GET_FIELD_SCAN':
      return handleFieldScan();

    case 'VALUES_READY':
      return handleValuesReady(message as ValuesReadyMessage);

    case 'FILL_ERROR':
      return handleFillError(message as FillErrorMessage);

    case 'CLEAR_HIGHLIGHTS':
      clearAllHighlights();
      return { ok: true };

    default:
      return null;
  }
}

// Field Scan Execution

async function handleFieldScan(): Promise<{ fields: DetectedField[]; pageUrl: string; pageTitle: string }> {
  logger.group('Field Scan');

  const fields = scanAllFields();
  logger.info(`Found ${fields.length} fillable fields`);
  logger.debug('Fields:', fields);
  logger.groupEnd();

  return {
    fields,
    pageUrl: window.location.href,
    pageTitle: document.title,
  };
}

// Field Fill Execution

async function handleValuesReady(message: ValuesReadyMessage): Promise<any> {
  const { values, manualSelectors } = message;
  logger.info(`Filling ${Object.keys(values).length} fields...`);

  try {
    const result = await fillFields(values, new Set(manualSelectors));
    logger.info('Fill complete:', result);
    return result;
  } catch (error) {
    logger.error('Fill error:', error);
    return {
      filledCount: 0,
      skippedCount: Object.keys(values).length,
      manualCount: 0,
      errors: [error instanceof Error ? error.message : String(error)],
    };
  }
}

// Error Handling

function handleFillError(message: FillErrorMessage): void {
  logger.error('Fill error:', message.error);
}
