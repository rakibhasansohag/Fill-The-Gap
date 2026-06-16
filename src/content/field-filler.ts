/**
 * field-filler.ts
 * Bypasses synthetic event systems (React/Vue/Angular) to correctly auto-fill form inputs.
 */

import type { FieldValueMap } from '@shared/types';
import { FILLED_FIELD_CLASS, MANUAL_FILLED_CLASS } from '@shared/constants';
import { logger } from '@utils/logger';
import { isLikelyCustomPicker } from './field-scanner';

// Native setter references — needed to bypass React's synthetic system
const nativeInputValueSetter = Object.getOwnPropertyDescriptor(
  HTMLInputElement.prototype,
  'value'
)?.set;

const nativeTextAreaValueSetter = Object.getOwnPropertyDescriptor(
  HTMLTextAreaElement.prototype,
  'value'
)?.set;

// Exported API functions

export interface FillResult {
  filledCount: number;
  skippedCount: number;
  manualCount: number;
  errors: string[];
}

/**
 * Fill form fields on the page using the provided value map.
 * Handles React/Vue/Angular synthetic event systems.
 *
 * @param values - Map of CSS selector → value to fill
 * @param manualSelectors - Set of selectors filled from manual storage
 */
export async function fillFields(
  values: FieldValueMap,
  manualSelectors: Set<string> = new Set()
): Promise<FillResult> {
  const result: FillResult = {
    filledCount: 0,
    skippedCount: 0,
    manualCount: 0,
    errors: [],
  };

  for (const [selector, value] of Object.entries(values)) {
    if (!value || value.trim() === '') {
      result.skippedCount++;
      continue;
    }

    try {
      const element = findFieldElement(selector);
      if (!element) {
        logger.warn(`Element not found for selector: ${selector}`);
        result.skippedCount++;
        continue;
      }

      const isManual = manualSelectors.has(selector);
      await fillSingleElement(element, value, isManual);

      if (isManual) {
        result.manualCount++;
      } else {
        result.filledCount++;
      }
    } catch (error) {
      const msg = `Failed to fill "${selector}": ${error instanceof Error ? error.message : String(error)}`;
      logger.warn(msg);
      result.errors.push(msg);
      result.skippedCount++;
    }
  }

  return result;
}

// Individual element filling dispatcher

async function fillSingleElement(
  element: HTMLElement,
  value: string,
  isManual: boolean
): Promise<void> {
  // Small delay between fills for natural feel
  await sleep(30 + Math.random() * 50);

  if (element instanceof HTMLSelectElement) {
    fillSelect(element, value);
  } else if (element instanceof HTMLTextAreaElement) {
    fillTextArea(element, value);
  } else if (element instanceof HTMLInputElement) {
    fillInput(element, value);
  }

  // Apply visual highlight
  applyHighlight(element, isManual);
}

// Specialized input handlers (handling dates, times, custom datepickers, and select elements)

function normalizeString(str: string): string {
  return str.replace(/[\s\u00a0]+/g, ' ').trim().toLowerCase();
}

function fillInput(input: HTMLInputElement, value: string): void {
  const type = (input.type || 'text').toLowerCase();

  // Format dates/times appropriately for native HTML5 inputs
  if (type === 'date') {
    const d = new Date(value);
    if (!isNaN(d.getTime())) {
      const yyyy = d.getFullYear();
      const mm = String(d.getMonth() + 1).padStart(2, '0');
      const dd = String(d.getDate()).padStart(2, '0');
      value = `${yyyy}-${mm}-${dd}`;
    }
  } else if (type === 'datetime-local') {
    const d = new Date(value);
    if (!isNaN(d.getTime())) {
      const yyyy = d.getFullYear();
      const mm = String(d.getMonth() + 1).padStart(2, '0');
      const dd = String(d.getDate()).padStart(2, '0');
      const hh = String(d.getHours()).padStart(2, '0');
      const min = String(d.getMinutes()).padStart(2, '0');
      value = `${yyyy}-${mm}-${dd}T${hh}:${min}`;
    }
  } else if (type === 'month') {
    const d = new Date(value);
    if (!isNaN(d.getTime())) {
      const yyyy = d.getFullYear();
      const mm = String(d.getMonth() + 1).padStart(2, '0');
      value = `${yyyy}-${mm}`;
    }
  } else if (type === 'time') {
    const d = new Date(value);
    if (!isNaN(d.getTime())) {
      const hh = String(d.getHours()).padStart(2, '0');
      const min = String(d.getMinutes()).padStart(2, '0');
      value = `${hh}:${min}`;
    } else {
      const match = value.match(/(\d+):(\d+)(?:\s*(am|pm))?/i);
      if (match) {
        let hh = parseInt(match[1], 10);
        const min = match[2].padStart(2, '0');
        const ampm = match[3];
        if (ampm) {
          if (ampm.toLowerCase() === 'pm' && hh < 12) hh += 12;
          if (ampm.toLowerCase() === 'am' && hh === 12) hh = 0;
        }
        value = `${String(hh).padStart(2, '0')}:${min}`;
      }
    }
  } else if (type === 'week') {
    const d = new Date(value);
    if (!isNaN(d.getTime())) {
      const yyyy = d.getFullYear();
      const tempDate = new Date(d.valueOf());
      tempDate.setDate(tempDate.getDate() + 4 - (tempDate.getDay() || 7));
      const yearStart = new Date(tempDate.getFullYear(), 0, 1);
      const weekNo = Math.ceil((((tempDate.getTime() - yearStart.getTime()) / 86400000) + 1) / 7);
      value = `${yyyy}-W${String(weekNo).padStart(2, '0')}`;
    }
  } else if (type === 'text' && isLikelyCustomPicker(input)) {
    const d = new Date(value);
    if (!isNaN(d.getTime())) {
      const yyyy = d.getFullYear();
      const mm = String(d.getMonth() + 1).padStart(2, '0');
      const dd = String(d.getDate()).padStart(2, '0');

      const placeholder = (input.getAttribute('placeholder') || '').toLowerCase();
      if (placeholder.includes('dd') && placeholder.includes('mm')) {
        const sep = placeholder.includes('/') ? '/' : placeholder.includes('-') ? '-' : placeholder.includes('.') ? '.' : '/';
        if (placeholder.indexOf('dd') < placeholder.indexOf('mm')) {
          value = `${dd}${sep}${mm}${sep}${yyyy}`;
        } else {
          value = `${mm}${sep}${dd}${sep}${yyyy}`;
        }
      } else {
        // Default to MM/DD/YYYY standard format for custom pickers
        value = `${mm}/${dd}/${yyyy}`;
      }
    }
  }

  // Use native setter to bypass React's property proxy
  if (nativeInputValueSetter) {
    nativeInputValueSetter.call(input, value);
  } else {
    input.value = value;
  }

  dispatchAllEvents(input);
}

function fillTextArea(textarea: HTMLTextAreaElement, value: string): void {
  if (nativeTextAreaValueSetter) {
    nativeTextAreaValueSetter.call(textarea, value);
  } else {
    textarea.value = value;
  }

  dispatchAllEvents(textarea);
}

function fillSelect(select: HTMLSelectElement, value: string): void {
  const normValue = normalizeString(value);

  // Try exact match on value or label
  let matchedOption = Array.from(select.options).find(
    (opt) => opt.value === value || opt.text === value
  );

  // Try case-insensitive exact match
  if (!matchedOption) {
    const valueLower = value.toLowerCase();
    matchedOption = Array.from(select.options).find(
      (opt) => opt.value.toLowerCase() === valueLower || opt.text.toLowerCase() === valueLower
    );
  }

  // Try normalized exact match
  if (!matchedOption) {
    matchedOption = Array.from(select.options).find(
      (opt) => normalizeString(opt.value) === normValue || normalizeString(opt.text) === normValue
    );
  }

  if (matchedOption) {
    select.value = matchedOption.value;
  } else {
    // Fuzzy match: find closest option
    const fuzzyOption = findClosestOption(select, value);
    if (fuzzyOption) {
      select.value = fuzzyOption.value;
    } else {
      logger.warn(`No matching option for select value: "${value}"`);
      return;
    }
  }

  dispatchAllEvents(select);
}

function findClosestOption(
  select: HTMLSelectElement,
  targetValue: string
): HTMLOptionElement | null {
  const options = Array.from(select.options).filter((o) => o.value !== '');
  if (options.length === 0) return null;

  const targetNorm = normalizeString(targetValue);
  const words = targetNorm.split(/\s+/);

  // Score: how many words in the target appear in the option text or value
  const scored = options.map((opt) => {
    const optTextNorm = normalizeString(opt.text + ' ' + opt.value);
    const matches = words.filter((w) => optTextNorm.includes(w)).length;
    return { opt, score: matches };
  });

  scored.sort((a, b) => b.score - a.score);
  return scored[0].score > 0 ? scored[0].opt : options[0];
}

// Framework event dispatching (dispatches standard events to trigger updates in frameworks)

/**
 * Dispatch the full chain of events that React/Vue/Angular
 * use to detect value changes. Order matters.
 */
function dispatchAllEvents(element: HTMLElement): void {
  const events = ['focus', 'input', 'change', 'blur'];
  for (const eventName of events) {
    element.dispatchEvent(
      new Event(eventName, { bubbles: true, cancelable: true })
    );
  }

  // Also dispatch a KeyboardEvent for frameworks that track keystrokes
  element.dispatchEvent(
    new KeyboardEvent('keyup', { key: 'End', bubbles: true })
  );
}

// Visual highlight helper methods

function applyHighlight(element: HTMLElement, isManual: boolean): void {
  const cssClass = isManual ? MANUAL_FILLED_CLASS : FILLED_FIELD_CLASS;

  element.classList.add(cssClass);

  // Remove highlight after 3 seconds
  setTimeout(() => {
    element.classList.remove(cssClass);
  }, 3000);
}

// Inject custom CSS styling

/**
 * Inject the highlight CSS into the page.
 * Called once when the content script initializes.
 */
export function injectHighlightStyles(): void {
  const styleId = 'aiff-highlight-styles';
  if (document.getElementById(styleId)) return;

  const style = document.createElement('style');
  style.id = styleId;
  style.textContent = `
    .${FILLED_FIELD_CLASS} {
      outline: 2px solid #6c63ff !important;
      outline-offset: 2px !important;
      box-shadow: 0 0 0 4px rgba(108, 99, 255, 0.15) !important;
      transition: outline 0.3s ease, box-shadow 0.3s ease !important;
      animation: aiff-pulse 0.5s ease !important;
    }

    .${MANUAL_FILLED_CLASS} {
      outline: 2px solid #00d4ff !important;
      outline-offset: 2px !important;
      box-shadow: 0 0 0 4px rgba(0, 212, 255, 0.15) !important;
      transition: outline 0.3s ease, box-shadow 0.3s ease !important;
      animation: aiff-pulse 0.5s ease !important;
    }

    @keyframes aiff-pulse {
      0% { transform: scale(1); }
      50% { transform: scale(1.01); }
      100% { transform: scale(1); }
    }
  `;
  document.head.appendChild(style);
}

// Helper functions

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Remove all highlight classes from the page */
export function clearAllHighlights(): void {
  function clear(root: ParentNode) {
    root.querySelectorAll(`.${FILLED_FIELD_CLASS}, .${MANUAL_FILLED_CLASS}`)
      .forEach((el) => {
        el.classList.remove(FILLED_FIELD_CLASS, MANUAL_FILLED_CLASS);
      });
    
    root.querySelectorAll('*').forEach((el) => {
      if (el.shadowRoot) {
        clear(el.shadowRoot);
      }
      if (el instanceof HTMLIFrameElement) {
        try {
          const doc = el.contentDocument || el.contentWindow?.document;
          if (doc) clear(doc);
        } catch (e) {}
      }
    });
  }
  clear(document);
}

/** Helper function to find element in standard DOM, Shadow DOM, and same-origin frames */
function findFieldElement(selector: string): HTMLElement | null {
  try {
    const mainEl = document.querySelector<HTMLElement>(selector);
    if (mainEl) return mainEl;
  } catch (e) {}

  let found: HTMLElement | null = null;
  
  function search(root: ParentNode) {
    if (found) return;

    try {
      const el = root.querySelector<HTMLElement>(selector);
      if (el) {
        found = el;
        return;
      }
    } catch (e) {}

    if (selector.startsWith('[data-aiff-idx="')) {
      const idxMatch = selector.match(/\[data-aiff-idx="([^"]+)"\]/);
      if (idxMatch) {
        const targetIdx = idxMatch[1];
        try {
          const el = root.querySelector<HTMLElement>(`[data-aiff-idx="${targetIdx}"]`);
          if (el) {
            found = el;
            return;
          }
        } catch (e) {}
      }
    }

    const all = root.querySelectorAll<HTMLElement>('*');
    for (const el of Array.from(all)) {
      if (el.shadowRoot) {
        search(el.shadowRoot);
        if (found) return;
      }
      if (el instanceof HTMLIFrameElement) {
        try {
          const doc = el.contentDocument || el.contentWindow?.document;
          if (doc) {
            search(doc);
            if (found) return;
          }
        } catch (e) {}
      }
    }
  }

  search(document);
  return found;
}
