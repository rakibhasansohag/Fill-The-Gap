/**
 * service-worker.ts
 * Background service worker handling message routing and fill orchestration.
 */

import type {
  ExtensionMessage,
  FieldScanResultMessage,
  TriggerFillMessage,
  ValuesReadyMessage,
  FillCompleteMessage,
  FillErrorMessage,
} from '@shared/types';
import {
  getManualFields,
  getGenerationStyle,
} from '@shared/storage';
import { apiRotator } from './api-rotator';
import { buildFieldFillPrompt, getManualValueForField, shouldUseManualField } from './prompt-builder';
import { logger } from '@utils/logger';

// Extension lifecycle events

chrome.runtime.onInstalled.addListener(async () => {
  logger.info('Extension installed/updated');
  await apiRotator.initialize();
});

chrome.runtime.onStartup.addListener(async () => {
  await apiRotator.initialize();
});

// Message Routing

chrome.runtime.onMessage.addListener(
  (message: ExtensionMessage, sender, sendResponse) => {
    handleMessage(message, sender).then(sendResponse).catch((err) => {
      logger.error('Message handler error:', err);
      sendResponse({ error: String(err) });
    });
    return true; // Keep channel open for async response
  }
);

async function handleMessage(
  message: ExtensionMessage,
  sender: chrome.runtime.MessageSender
): Promise<unknown> {
  switch (message.type) {
    case 'TRIGGER_FILL':
      return handleTriggerFill((message as TriggerFillMessage).tabId, false);

    case 'API_STATUS':
      await apiRotator.initialize();
      return { statuses: apiRotator.getKeyStatuses() };

    default:
      logger.warn('Unknown message type:', (message as { type: string }).type);
      return null;
  }
}

// Action click event handling (badge and popup control)

let lastClickTime = 0;
let clickTimeoutId: any = null;

chrome.action.onClicked.addListener(async (tab) => {
  if (!tab.id) return;

  const now = Date.now();
  const timeDiff = now - lastClickTime;
  lastClickTime = now;

  if (timeDiff < 300) {
    // Double click: clear single-click timeout
    if (clickTimeoutId) {
      clearTimeout(clickTimeoutId);
      clickTimeoutId = null;
    }

    logger.info(`Double click detected on tab ${tab.id}. Opening popup in idle mode.`);

    // Set popup state to idle (user can trigger manually or inspect config)
    await chrome.storage.local.set({
      lastRunResult: { state: 'idle', filledCount: 0, manualCount: 0, skippedCount: 0 }
    });

    // Map popup and open programmatically
    await chrome.action.setPopup({ tabId: tab.id, popup: 'popup/popup.html' });
    await chrome.action.openPopup().catch((err) => {
      logger.error('Failed to open popup on double click:', err);
    });
  } else {
    // Single click: queue single click handler
    const currentTabId = tab.id;
    clickTimeoutId = setTimeout(async () => {
      logger.info(`Single click detected on tab ${currentTabId}. Running background fill...`);

      // Set working badge
      await chrome.action.setBadgeText({ tabId: currentTabId, text: '...' }).catch(() => { });
      await chrome.action.setBadgeBackgroundColor({ tabId: currentTabId, color: '#8b5cf6' }).catch(() => { });

      // Trigger background fill
      await handleTriggerFill(currentTabId, true);
      clickTimeoutId = null;
    }, 300);
  }
});

// Fill Orchestration logic

async function handleTriggerFill(tabId: number, isBackgroundRun: boolean): Promise<void> {
  try {
    logger.info(`Starting multi-frame fill orchestration for tab ${tabId}...`);

    // 1. Get all frames in the tab using webNavigation
    const frames = await chrome.webNavigation.getAllFrames({ tabId });
    if (!frames || frames.length === 0) {
      throw new Error('No active frames found in the tab.');
    }

    logger.info(`Found ${frames.length} frames in tab ${tabId}`);

    // 2. Scan all frames in parallel
    const scanPromises = frames.map(async (frame) => {
      try {
        const response = await chrome.tabs.sendMessage(
          tabId,
          { type: 'GET_FIELD_SCAN' },
          { frameId: frame.frameId }
        );
        return { frameId: frame.frameId, response };
      } catch (err) {
        const errStr = String(err);
        if (
          errStr.includes('Could not establish connection') ||
          errStr.includes('Receiving end does not exist')
        ) {
          logger.info(`Content script not active in frame ${frame.frameId}. Injecting...`);
          try {
            await chrome.scripting.executeScript({
              target: { tabId, frameIds: [frame.frameId] },
              files: ['content/content-script.js'],
            });
            // Small delay for initialization
            await new Promise((resolve) => setTimeout(resolve, 150));
            const response = await chrome.tabs.sendMessage(
              tabId,
              { type: 'GET_FIELD_SCAN' },
              { frameId: frame.frameId }
            );
            return { frameId: frame.frameId, response };
          } catch (injectErr) {
            logger.debug(`Skipping frame ${frame.frameId} (injection/scan failed):`, injectErr);
            return null;
          }
        }
        logger.debug(`Error scanning frame ${frame.frameId}:`, err);
        return null;
      }
    });

    const scanResults = (await Promise.all(scanPromises)).filter(Boolean) as Array<{
      frameId: number;
      response: { fields: any[]; pageUrl: string; pageTitle: string };
    }>;

    // 3. Aggregate fields from all frames
    const allFields: any[] = [];
    let pageUrl = '';
    let pageTitle = '';

    for (const { frameId, response } of scanResults) {
      if (response && response.fields && response.fields.length > 0) {
        // Prefer main frame (frameId === 0) for URL and title context
        if (!pageUrl || frameId === 0) {
          pageUrl = response.pageUrl;
          pageTitle = response.pageTitle;
        }
        for (const field of response.fields) {
          field.frameId = frameId;
          allFields.push(field);
        }
      }
    }

    logger.info(`Scanned all frames. Aggregated fields: ${allFields.length}`);

    const mainFrameCount = allFields.filter((f) => f.frameId === 0).length;
    const subFrameCount = allFields.filter((f) => f.frameId !== 0).length;

    await chrome.runtime.sendMessage({
      type: 'ROTATION_WARNING',
      keyIndex: -1,
      error: `Scanned ${scanResults.length} frames. Found: Main Frame (${mainFrameCount} fields), Subframes (${subFrameCount} fields).`,
      isCooledDown: false,
    }).catch(() => { });

    if (allFields.length === 0) {
      const errMsg: FillErrorMessage = {
        type: 'FILL_ERROR',
        error: 'No fillable fields found on this page.',
      };
      if (isBackgroundRun) {
        await chrome.storage.local.set({
          lastRunResult: {
            state: 'error',
            error: errMsg.error,
            filledCount: 0,
            manualCount: 0,
            skippedCount: 0
          }
        });
        await chrome.action.setBadgeText({ tabId, text: '' }).catch(() => { });
        await chrome.action.setPopup({ tabId, popup: 'popup/popup.html' });
        await chrome.action.openPopup().catch(() => { });
      } else {
        await chrome.runtime.sendMessage(errMsg).catch(() => { });
      }
      return;
    }

    // 4. Fetch settings
    const [manualFields, generationStyle] = await Promise.all([
      getManualFields(),
      getGenerationStyle(),
    ]);

    // 5. Separate manual vs AI fields
    const manualMap: Record<string, string> = {};
    const aiFields = allFields.filter((f) => {
      if (shouldUseManualField(f, manualFields)) {
        const value = getManualValueForField(f, manualFields);
        if (value !== null) {
          manualMap[f.selector] = value;
        }
        return false;
      }
      return true;
    });

    let aiGeneratedMap: Record<string, string> = {};

    // 6. Perform AI generation if there are fields that need it
    if (aiFields.length > 0) {
      await apiRotator.initialize();
      const prompt = buildFieldFillPrompt(
        aiFields,
        manualFields,
        pageUrl,
        pageTitle,
        generationStyle
      );

      // Notify popup that AI generation has started
      await chrome.runtime.sendMessage({
        type: 'FIELD_SCAN_RESULT',
      }).catch(() => { });

      logger.info(`Sending ${aiFields.length} fields to Gemini...`);
      aiGeneratedMap = await apiRotator.generateFieldValues(prompt);
    }

    // Merge manual + AI values
    const allValues = { ...aiGeneratedMap, ...manualMap };

    logger.info(
      `Values ready: ${Object.keys(aiGeneratedMap).length} AI + ${Object.keys(manualMap).length} manual`
    );

    // Group values and manual selectors by target frame ID
    const frameValues: Record<number, Record<string, string>> = {};
    const frameManualSelectors: Record<number, string[]> = {};

    for (const field of allFields) {
      const fId = field.frameId ?? 0;
      const val = allValues[field.selector];
      if (val !== undefined) {
        if (!frameValues[fId]) {
          frameValues[fId] = {};
        }
        frameValues[fId][field.selector] = val;
      }

      if (manualMap[field.selector] !== undefined) {
        if (!frameManualSelectors[fId]) {
          frameManualSelectors[fId] = [];
        }
        frameManualSelectors[fId].push(field.selector);
      }
    }

    // Notify popup that values are ready to be filled (sets state to 'filling')
    await chrome.runtime.sendMessage({
      type: 'VALUES_READY',
    }).catch(() => { });

    // 7. Send fill messages to each target frame
    const fillPromises = Object.keys(frameValues).map(async (fIdStr) => {
      const fId = Number(fIdStr);
      const valuesMsg: ValuesReadyMessage = {
        type: 'VALUES_READY',
        values: frameValues[fId],
        manualSelectors: frameManualSelectors[fId] || [],
      };
      try {
        const result = await chrome.tabs.sendMessage(tabId, valuesMsg, { frameId: fId });
        return result;
      } catch (err) {
        logger.error(`Error sending fill message to frame ${fId}:`, err);
        return null;
      }
    });

    const fillResults = (await Promise.all(fillPromises)).filter(Boolean);

    // 8. Collate counts and send completion status to popup
    let totalFilled = 0;
    let totalManual = 0;
    let totalSkipped = 0;

    for (const res of fillResults) {
      totalFilled += res.filledCount || 0;
      totalManual += res.manualCount || 0;
      totalSkipped += res.skippedCount || 0;
    }

    const completionMsg: FillCompleteMessage = {
      type: 'FILL_COMPLETE',
      filledCount: totalFilled,
      skippedCount: totalSkipped,
      manualCount: totalManual,
    };

    if (isBackgroundRun) {
      await chrome.storage.local.set({
        lastRunResult: {
          state: 'success',
          filledCount: totalFilled,
          skippedCount: totalSkipped,
          manualCount: totalManual,
        }
      });
      await chrome.action.setBadgeText({ tabId, text: '' }).catch(() => { });
      await chrome.action.setPopup({ tabId, popup: 'popup/popup.html' });
      await chrome.action.openPopup().catch((err) => {
        logger.error('Failed to open popup on single click complete:', err);
      });
    } else {
      await chrome.runtime.sendMessage(completionMsg).catch(() => { });
    }

  } catch (error) {
    const errorMsg: FillErrorMessage = {
      type: 'FILL_ERROR',
      error: error instanceof Error ? error.message : String(error),
    };

    if (isBackgroundRun) {
      await chrome.storage.local.set({
        lastRunResult: {
          state: 'error',
          error: errorMsg.error,
          filledCount: 0,
          manualCount: 0,
          skippedCount: 0
        }
      });
      await chrome.action.setBadgeText({ tabId, text: '' }).catch(() => { });
      await chrome.action.setPopup({ tabId, popup: 'popup/popup.html' });
      await chrome.action.openPopup().catch((err) => {
        logger.error('Failed to open popup on single click error:', err);
      });
    } else {
      await chrome.runtime.sendMessage(errorMsg).catch(() => { });
    }
  }
}
