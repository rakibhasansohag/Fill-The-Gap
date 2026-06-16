/**
 * field-scanner.ts
 * Scans the DOM for fillable fields and aggregates label context, option list, and selectors.
 */

import type { DetectedField, SelectOption } from '@shared/types';
import { SKIP_INPUT_TYPES } from '@shared/constants';

// Core field scanning engine

/**
 * Scan the entire document for all fillable form fields.
 * Returns an array of DetectedField with unique selectors and label context.
 */
export function scanAllFields(): DetectedField[] {
  // Skip scanning tiny frames (e.g. recaptcha badges, tracker pixels, ads)
  const isTinyViewport = window.self !== window.top && (window.innerWidth < 100 || window.innerHeight < 100);
  if (isTinyViewport) {
    console.log(`[Fill-The-Gap] Skipped scanning frame: viewport is too small (${window.innerWidth}x${window.innerHeight})`);
    return [];
  }

  const frameSessionId = Math.random().toString(36).substring(2, 8);
  const fields: DetectedField[] = [];
  const usedSelectors = new Set<string>();
  let fallbackIndex = 0;

  function traverse(root: ParentNode) {
    const elements = root.querySelectorAll<HTMLElement>('*');

    elements.forEach((element) => {
      // 1. Traverse shadow DOM if present
      if (element.shadowRoot) {
        traverse(element.shadowRoot);
      }

      // 2. Traverse same-origin iframe content
      if (element instanceof HTMLIFrameElement) {
        try {
          const iframeDoc = element.contentDocument || element.contentWindow?.document;
          if (iframeDoc) {
            traverse(iframeDoc);
          }
        } catch (e) {
          // Ignore cross-origin iframes
        }
      }

      // 3. Process form controls
      if (
        element instanceof HTMLInputElement ||
        element instanceof HTMLTextAreaElement ||
        element instanceof HTMLSelectElement
      ) {
        const tag = element.tagName;
        const type = element instanceof HTMLInputElement ? element.type : '';
        const id = element.id || '(no id)';
        const name = element.getAttribute('name') || '(no name)';

        const isHidden = isElementHidden(element);
        let skipReason = '';

        if (isHidden) {
          skipReason = 'Element is hidden (display: none, visibility: hidden, or closest [hidden])';
        } else if (element instanceof HTMLInputElement) {
          const inputType = (element.type || 'text').toLowerCase();
          if (SKIP_INPUT_TYPES.has(inputType)) {
            skipReason = `Input type "${inputType}" is in skip list`;
          } else if (element.disabled) {
            skipReason = `Input is disabled`;
          } else if (element.readOnly && !isLikelyCustomPicker(element)) {
            skipReason = `Input is readOnly and not identified as a custom picker`;
          }
        } else if (element instanceof HTMLTextAreaElement) {
          if (element.readOnly || element.disabled) {
            skipReason = `Textarea is readOnly (${element.readOnly}) or disabled (${element.disabled})`;
          }
        } else if (element instanceof HTMLSelectElement) {
          if (element.disabled) {
            skipReason = 'Select is disabled';
          }
        }
        
        if (!skipReason) {
          const currentValue = getCurrentValue(element);
          if (!isDummyOrEmpty(currentValue)) {
            skipReason = `Field is already filled with non-dummy content: "${currentValue}"`;
          }
        }

        if (skipReason) {
          console.log(`[Fill-The-Gap] Skipped: tag=${tag}, id=${id}, name=${name}, type=${type}. Reason: ${skipReason}`);
          return;
        }

        const selector = buildUniqueSelector(element, fallbackIndex, usedSelectors, frameSessionId);
        if (!selector) {
          console.log(`[Fill-The-Gap] Skipped: tag=${tag}, id=${id}, name=${name}, type=${type}. Reason: Could not generate unique selector`);
          return;
        }

        fallbackIndex++;
        usedSelectors.add(selector);
        const field = extractFieldData(element, selector);
        if (field) {
          console.log(`[Fill-The-Gap] Detected: tag=${tag}, id=${id}, name=${name}, selector=${selector}`);
          fields.push(field);
        }
      }
    });
  }

  console.log('[Fill-The-Gap] Starting field scan...');
  traverse(document);
  console.log('[Fill-The-Gap] Finished field scan. Total fields:', fields.length);

  return fields;
}

// Form control filtering rules

function shouldSkipElement(element: HTMLElement): boolean {
  if (isElementHidden(element)) return true;

  if (element instanceof HTMLInputElement) {
    const type = (element.type || 'text').toLowerCase();
    if (SKIP_INPUT_TYPES.has(type)) return true;
    if (element.disabled) return true;
    if (element.readOnly && !isLikelyCustomPicker(element)) return true;
  }

  if (element instanceof HTMLTextAreaElement) {
    if (element.readOnly || element.disabled) return true;
  }

  if (element instanceof HTMLSelectElement) {
    if (element.disabled) return true;
  }

  return false;
}

/**
 * Detect whether an input is a custom picker (like a date picker or custom select dropdown)
 * that is set to readOnly to prevent browser default keyboard/interaction.
 */
export function isLikelyCustomPicker(input: HTMLInputElement): boolean {
  // Check class name
  const className = (input.className || '').toLowerCase();
  if (
    className.includes('picker') ||
    className.includes('date') ||
    className.includes('time') ||
    className.includes('calendar') ||
    className.includes('flatpickr') ||
    className.includes('select')
  ) {
    return true;
  }

  // Check attributes
  if (
    input.hasAttribute('aria-haspopup') ||
    input.hasAttribute('data-datepicker') ||
    input.hasAttribute('data-flatpickr') ||
    input.getAttribute('role') === 'combobox'
  ) {
    return true;
  }

  // Check placeholder
  const placeholder = (input.getAttribute('placeholder') || '').toLowerCase();
  if (
    placeholder.includes('date') ||
    placeholder.includes('select') ||
    placeholder.includes('choose') ||
    placeholder.includes('time') ||
    placeholder.includes('year') ||
    placeholder.includes('month') ||
    placeholder.includes('day') ||
    placeholder.includes('calendar')
  ) {
    return true;
  }

  // Check label/context text
  const labelText = collectLabelContext(input).toLowerCase();
  if (
    labelText.includes('date') ||
    labelText.includes('time') ||
    labelText.includes('deadline') ||
    labelText.includes('schedule') ||
    labelText.includes('birthday') ||
    labelText.includes('dob') ||
    labelText.includes('start') ||
    labelText.includes('end') ||
    labelText.includes('select')
  ) {
    return true;
  }

  return false;
}

function isElementHidden(element: HTMLElement): boolean {
  const style = window.getComputedStyle(element);
  if (style.display === 'none' || style.visibility === 'hidden') return true;
  if (element.closest('[hidden]') !== null) return true;

  // Do not skip form controls just because of 0x0 rect size.
  // Custom form UI libraries often hide original inputs this way.
  const isFormControl = ['INPUT', 'TEXTAREA', 'SELECT'].includes(element.tagName);
  if (isFormControl) {
    return false;
  }

  const rect = element.getBoundingClientRect();
  return rect.width === 0 && rect.height === 0;
}

// Data extraction from form elements

function extractFieldData(
  element: HTMLElement,
  selector: string
): DetectedField | null {
  const tag = element.tagName as 'INPUT' | 'TEXTAREA' | 'SELECT';
  const inputType =
    element instanceof HTMLInputElement
      ? (element.type || 'text').toLowerCase()
      : tag.toLowerCase();

  const labelText = collectLabelContext(element);
  const currentValue = getCurrentValue(element);
  const options =
    element instanceof HTMLSelectElement ? extractSelectOptions(element) : undefined;

  return {
    selector,
    tag,
    inputType,
    labelText,
    currentValue,
    options,
  };
}

// Label context extraction (resolves associated labels, aria labels, and nearby headers)

/**
 * Collect all available contextual text for a field.
 * Priority: explicit <label>, aria-label, placeholder, name, id, parent text
 */
function collectLabelContext(element: HTMLElement): string {
  const parts: string[] = [];

  // 1. Explicit <label for="..."> or wrapping <label>
  const labelText = findLabelText(element);
  if (labelText) parts.push(labelText);

  // 2. aria-label attribute
  const ariaLabel = element.getAttribute('aria-label');
  if (ariaLabel) parts.push(ariaLabel);

  // 3. aria-labelledby (reference to another element)
  const labelledById = element.getAttribute('aria-labelledby');
  if (labelledById) {
    const referenced = document.getElementById(labelledById);
    if (referenced?.textContent) parts.push(referenced.textContent.trim());
  }

  // 4. placeholder
  const placeholder = element.getAttribute('placeholder');
  if (placeholder) parts.push(placeholder);

  // 5. name attribute
  const name = element.getAttribute('name');
  if (name) parts.push(name.replace(/[-_]/g, ' '));

  // 6. id attribute (humanize)
  const id = element.getAttribute('id');
  if (id) parts.push(id.replace(/[-_]/g, ' '));

  // 7. Surrounding heading/label text (climb up 3 levels)
  const parentContext = getParentContext(element);
  if (parentContext) parts.push(parentContext);

  // Deduplicate and join
  const unique = [...new Set(parts.map((p) => p.trim()).filter(Boolean))];
  return unique.join(' | ');
}

function findLabelText(element: HTMLElement): string | null {
  // Check if element is inside a <label>
  const wrappingLabel = element.closest('label');
  if (wrappingLabel) {
    // Get label text without the input's own text
    const clone = wrappingLabel.cloneNode(true) as HTMLElement;
    clone.querySelectorAll('input, textarea, select').forEach((el) => el.remove());
    const text = clone.textContent?.trim();
    if (text) return text;
  }

  // Check for explicit <label for="id">
  const id = element.getAttribute('id');
  if (id) {
    const label = document.querySelector<HTMLLabelElement>(`label[for="${CSS.escape(id)}"]`);
    if (label?.textContent) return label.textContent.trim();
  }

  return null;
}

function getParentContext(element: HTMLElement): string | null {
  let parent = element.parentElement;
  let depth = 0;

  while (parent && depth < 4) {
    // Look for heading elements nearby
    const heading = parent.querySelector('h1, h2, h3, h4, legend, .label, [class*="label"], [class*="title"]');
    if (heading && !heading.contains(element) && heading.textContent?.trim()) {
      return heading.textContent.trim().slice(0, 80);
    }
    parent = parent.parentElement;
    depth++;
  }
  return null;
}

// Option lists resolver for Select fields

function extractSelectOptions(select: HTMLSelectElement): SelectOption[] {
  return Array.from(select.options)
    .filter((opt) => opt.value && opt.value !== '')
    .map((opt) => ({
      value: opt.value,
      label: opt.text.trim(),
    }));
}

// Current element value resolver

function getCurrentValue(element: HTMLElement): string {
  if (element instanceof HTMLInputElement) return element.value;
  if (element instanceof HTMLTextAreaElement) return element.value;
  if (element instanceof HTMLSelectElement) return element.value;
  return '';
}

// CSS selector resolver (generates unique selectors using ID, name, or index attributes)

/**
 * Build the most reliable unique CSS selector for an element.
 * Priority: #id > [name] > nth-of-type path
 */
function buildUniqueSelector(
  element: HTMLElement,
  fallbackIndex: number,
  usedSelectors: Set<string>,
  frameSessionId: string
): string | null {
  const root = element.getRootNode() as ParentNode;

  // 1. Prefer unique ID
  const id = element.getAttribute('id');
  if (id) {
    const selector = `#${CSS.escape(id)}`;
    if (!usedSelectors.has(selector) && root.querySelectorAll(selector).length === 1) {
      return selector;
    }
  }

  // 2. Tag + name attribute
  const name = element.getAttribute('name');
  if (name) {
    const selector = `${element.tagName.toLowerCase()}[name="${CSS.escape(name)}"]`;
    if (!usedSelectors.has(selector) && root.querySelectorAll(selector).length === 1) {
      return selector;
    }
  }

  // 3. Fallback: data-aiff index attribute with unique session ID (injected by us)
  // We skip pathSelector because it's extremely long, resource-intensive, and prone to truncation in Gemini responses.
  const key = `${frameSessionId}-${fallbackIndex}`;
  const attrSelector = `[data-aiff-idx="${key}"]`;
  element.setAttribute('data-aiff-idx', key);
  return attrSelector;
}

function buildPathSelector(element: HTMLElement): string {
  const parts: string[] = [];
  let current: HTMLElement | null = element;

  while (current && current !== document.body) {
    const tag = current.tagName.toLowerCase();
    const id = current.getAttribute('id');

    if (id) {
      parts.unshift(`#${CSS.escape(id)}`);
      break;
    }

    const siblings = current.parentElement
      ? Array.from(current.parentElement.children).filter(
          (c) => c.tagName === current!.tagName
        )
      : [];

    if (siblings.length > 1) {
      const idx = siblings.indexOf(current) + 1;
      parts.unshift(`${tag}:nth-of-type(${idx})`);
    } else {
      parts.unshift(tag);
    }

    current = current.parentElement;
  }

  return parts.join(' > ');
}

// Pre-fill / placeholder validation checks

/**
 * Returns true if the value is empty or represents a common dummy/default placeholder value.
 * Allowed defaults: empty, "0", "1", "1.0", "stock 1", "items 1", "test", "dummy", etc.
 */
export function isDummyOrEmpty(val: string): boolean {
  const clean = val.trim().toLowerCase();
  if (!clean) return true;

  const dummyPatterns = [
    /^0$/,
    /^1$/,
    /^1\.0+$/,
    /^0\.0+$/,
    /^test$/i,
    /^dummy$/i,
    /^placeholder$/i,
    /^sample$/i,
    /^example$/i,
    /^temp$/i,
    /^stock\s*1$/i,
    /^item\s*1$/i,
    /^items\s*1$/i
  ];

  return dummyPatterns.some((pattern) => pattern.test(clean));
}

