// ============================================================
// options.ts — Options page logic (settings management)
// ============================================================

import './options.css';
import type { ApiKeyEntry, ManualFields, GenerationStyle } from '@shared/types';
import {
  getApiKeys, setApiKeys, buildApiKeyEntries, parseApiKeyString,
  getManualFields, upsertManualField, deleteManualField,
  getGenerationStyle, setGenerationStyle,
  getCurrentKeyIndex,
} from '@shared/storage';
import { logger } from '@utils/logger';

// ── DOM refs ──────────────────────────────────────────────────

// Sidebar
const navItems = document.querySelectorAll<HTMLAnchorElement>('.nav-item');
const tabs = document.querySelectorAll<HTMLElement>('.tab-content');
const manualFieldsBadge = document.getElementById('manual-fields-badge') as HTMLSpanElement;

// API Keys tab
const keysInput = document.getElementById('keys-input') as HTMLTextAreaElement;
const importKeysBtn = document.getElementById('import-keys-btn') as HTMLButtonElement;
const clearKeysBtn = document.getElementById('clear-keys-btn') as HTMLButtonElement;
const keysList = document.getElementById('keys-list') as HTMLDivElement;
const totalKeysLabel = document.getElementById('total-keys-label') as HTMLSpanElement;

// Manual Fields tab
const newKeyInput = document.getElementById('new-key-input') as HTMLInputElement;
const newValInput = document.getElementById('new-val-input') as HTMLInputElement;
const addFieldBtn = document.getElementById('add-field-btn') as HTMLButtonElement;
const fieldsList = document.getElementById('fields-list') as HTMLDivElement;
const fieldCountLabel = document.getElementById('field-count-label') as HTMLSpanElement;

// AI Settings tab
const saveStyleBtn = document.getElementById('save-style-btn') as HTMLButtonElement;

// Toast
const toastContainer = document.getElementById('toast-container') as HTMLDivElement;

// ── Tab Navigation ────────────────────────────────────────────

navItems.forEach((item) => {
  item.addEventListener('click', (e) => {
    e.preventDefault();
    const tabId = item.dataset.tab;
    if (!tabId) return;
    activateTab(tabId);
    navItems.forEach((i) => i.classList.remove('active'));
    item.classList.add('active');
  });
});

function activateTab(tabId: string): void {
  tabs.forEach((tab) => {
    tab.classList.toggle('active', tab.id === `tab-${tabId}`);
  });
}

// ── API Keys ──────────────────────────────────────────────────

importKeysBtn.addEventListener('click', async () => {
  const raw = keysInput.value.trim();
  if (!raw) { showToast('Please paste your API keys first.', 'error'); return; }

  const keyStrings = parseApiKeyString(raw);
  if (keyStrings.length === 0) {
    showToast('No valid keys found. Check the format.', 'error');
    return;
  }

  // Merge with existing keys (avoid duplicates)
  const existing = await getApiKeys();
  const existingKeys = new Set(existing.map((k) => k.key));
  const newEntries = buildApiKeyEntries(keyStrings.filter((k) => !existingKeys.has(k)));
  const merged = [...existing, ...newEntries];

  await setApiKeys(merged);
  keysInput.value = '';
  await renderKeysList();
  showToast(`✓ Imported ${newEntries.length} new keys (${merged.length} total)`, 'success');
});

clearKeysBtn.addEventListener('click', async () => {
  if (!confirm('Are you sure you want to delete ALL API keys?')) return;
  await setApiKeys([]);
  await renderKeysList();
  showToast('All keys cleared', 'info');
});

async function renderKeysList(): Promise<void> {
  const [keys, currentIndex] = await Promise.all([
    getApiKeys(),
    getCurrentKeyIndex(),
  ]);

  totalKeysLabel.textContent = `${keys.length} key${keys.length !== 1 ? 's' : ''}`;

  if (keys.length === 0) {
    keysList.innerHTML = '<div class="empty-state">No API keys configured yet.</div>';
    return;
  }

  keysList.innerHTML = '';
  keys.forEach((key, index) => {
    const item = buildKeyItem(key, index, currentIndex);
    keysList.appendChild(item);
  });
}

function buildKeyItem(key: ApiKeyEntry, index: number, currentIndex: number): HTMLElement {
  const div = document.createElement('div');
  div.className = 'key-item';

  const isCurrent = index === currentIndex;
  const isOnCooldown = key.cooldownUntil !== null && Date.now() < key.cooldownUntil;
  const state = isCurrent ? 'current' : isOnCooldown ? 'cooldown' : key.errorCount >= 3 ? 'error' : 'active';

  const cooldownRemaining = isOnCooldown && key.cooldownUntil
    ? Math.ceil((key.cooldownUntil - Date.now()) / 60000)
    : 0;

  div.innerHTML = `
    <span class="key-index">${index + 1}</span>
    <span class="key-status-dot ${state}"></span>
    <span class="key-masked" style="word-break: break-all;">${maskKey(key.key)}</span>
    <div class="key-meta-row" style="margin-left: 12px;">
      <span class="key-meta">${stateLabel(state, cooldownRemaining)}</span>
      <span class="key-meta">${key.totalCalls} calls</span>
    </div>
    <div class="key-actions" style="display: flex; gap: 6px; align-items: center; margin-left: 12px; flex-shrink: 0;">
      <button class="action-btn toggle-key-btn" title="Show/Hide Key">
        <svg class="eye-open" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
          <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/>
          <circle cx="12" cy="12" r="3"/>
        </svg>
        <svg class="eye-closed hidden" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
          <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"/>
          <line x1="1" y1="1" x2="23" y2="23"/>
        </svg>
      </button>
      <button class="action-btn copy-key-btn" title="Copy Key">
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
          <rect x="9" y="9" width="13" height="13" rx="2" ry="2"/>
          <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>
        </svg>
      </button>
      <button class="btn-danger remove-key-btn" data-index="${index}">Remove</button>
    </div>
  `;

  const keyMaskedSpan = div.querySelector('.key-masked') as HTMLSpanElement;
  const toggleBtn = div.querySelector('.toggle-key-btn') as HTMLButtonElement;
  const copyBtn = div.querySelector('.copy-key-btn') as HTMLButtonElement;
  const eyeOpen = toggleBtn.querySelector('.eye-open') as SVGElement;
  const eyeClosed = toggleBtn.querySelector('.eye-closed') as SVGElement;

  let isRevealed = false;

  toggleBtn.addEventListener('click', () => {
    isRevealed = !isRevealed;
    if (isRevealed) {
      keyMaskedSpan.textContent = key.key;
      eyeOpen.classList.add('hidden');
      eyeClosed.classList.remove('hidden');
    } else {
      keyMaskedSpan.textContent = maskKey(key.key);
      eyeOpen.classList.remove('hidden');
      eyeClosed.classList.add('hidden');
    }
  });

  copyBtn.addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText(key.key);
      showToast('Key copied to clipboard!', 'success');
    } catch (err) {
      showToast('Failed to copy key.', 'error');
    }
  });

  div.querySelector('.remove-key-btn')?.addEventListener('click', async () => {
    const keys = await getApiKeys();
    keys.splice(index, 1);
    await setApiKeys(keys);
    await renderKeysList();
    showToast(`Key ${index + 1} removed`, 'info');
  });

  return div;
}

function stateLabel(state: string, cooldownMin: number): string {
  switch (state) {
    case 'current': return 'Active (current)';
    case 'cooldown': return `Cooldown (${cooldownMin}m left)`;
    case 'error': return 'Too many errors';
    default: return 'Ready';
  }
}

function maskKey(key: string): string {
  if (key.length <= 8) return '••••••••';
  return `${key.slice(0, 6)}•••••${key.slice(-4)}`;
}

// ── Manual Fields ─────────────────────────────────────────────

addFieldBtn.addEventListener('click', handleAddField);
newValInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') handleAddField(); });

async function handleAddField(): Promise<void> {
  const key = newKeyInput.value.trim();
  const value = newValInput.value.trim();

  if (!key) { showToast('Field key is required', 'error'); newKeyInput.focus(); return; }
  if (!value) { showToast('Field value is required', 'error'); newValInput.focus(); return; }

  await upsertManualField(key, value);
  newKeyInput.value = '';
  newValInput.value = '';
  await renderFieldsList();
  showToast(`"${key.toLowerCase()}" saved!`, 'success');
}

async function renderFieldsList(): Promise<void> {
  const fields = await getManualFields();
  const entries = Object.entries(fields);

  fieldCountLabel.textContent = `${entries.length} field${entries.length !== 1 ? 's' : ''}`;

  // Update sidebar badge
  if (entries.length > 0) {
    manualFieldsBadge.textContent = String(entries.length);
    manualFieldsBadge.classList.remove('hidden');
  } else {
    manualFieldsBadge.classList.add('hidden');
  }

  if (entries.length === 0) {
    fieldsList.innerHTML = '<div class="empty-state">No manual fields stored yet.</div>';
    return;
  }

  fieldsList.innerHTML = '';
  const sensitiveKeys = new Set(['password', 'pass', 'pwd', 'secret', 'token', 'key', 'pin', 'cvv']);

  entries.forEach(([key, value]) => {
    const isSensitive = sensitiveKeys.has(key.toLowerCase());
    const item = document.createElement('div');
    item.className = 'field-item';

    const displayValue = isSensitive ? '••••••••' : value;
    item.innerHTML = `
      <span class="field-item-key">${escapeHtml(key)}</span>
      <span class="field-item-val ${isSensitive ? 'masked' : ''}" title="${isSensitive ? '(hidden)' : escapeHtml(value)}">
        ${escapeHtml(displayValue)}
      </span>
      <div class="field-item-actions">
        <button class="action-btn edit-btn" data-key="${escapeHtml(key)}" title="Edit">
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
            <path d="M12 20h9M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"/>
          </svg>
        </button>
        <button class="action-btn delete-btn" data-key="${escapeHtml(key)}" title="Delete">
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
            <polyline points="3 6 5 6 21 6"/>
            <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>
            <line x1="10" y1="11" x2="10" y2="17"/>
            <line x1="14" y1="11" x2="14" y2="17"/>
          </svg>
        </button>
      </div>
    `;

    item.querySelector('.edit-btn')?.addEventListener('click', async () => {
      const fields = await getManualFields();
      const current = fields[key] || '';
      const newVal = prompt(`Update value for "${key}":`, isSensitive ? '' : current);
      if (newVal !== null && newVal.trim() !== '') {
        await upsertManualField(key, newVal.trim());
        await renderFieldsList();
        showToast(`"${key}" updated!`, 'success');
      }
    });

    item.querySelector('.delete-btn')?.addEventListener('click', async () => {
      if (!confirm(`Delete the "${key}" field?`)) return;
      await deleteManualField(key);
      await renderFieldsList();
      showToast(`"${key}" deleted`, 'info');
    });

    fieldsList.appendChild(item);
  });
}

// ── AI Settings ───────────────────────────────────────────────

saveStyleBtn.addEventListener('click', async () => {
  const selectedRadio = document.querySelector<HTMLInputElement>('input[name="gen-style"]:checked');
  if (!selectedRadio) return;
  await setGenerationStyle(selectedRadio.value as GenerationStyle);
  showToast('Style preference saved!', 'success');
});

async function loadGenerationStyle(): Promise<void> {
  const style = await getGenerationStyle();
  const radio = document.querySelector<HTMLInputElement>(`input[name="gen-style"][value="${style}"]`);
  if (radio) radio.checked = true;
}

// ── Toast ─────────────────────────────────────────────────────

function showToast(message: string, type: 'success' | 'error' | 'info' = 'info'): void {
  const toast = document.createElement('div');
  toast.className = `toast ${type}`;
  toast.textContent = message;
  toastContainer.appendChild(toast);
  setTimeout(() => toast.remove(), 3000);
}

// ── Utilities ─────────────────────────────────────────────────

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// ── Bootstrap ─────────────────────────────────────────────────

async function init(): Promise<void> {
  // Bind quick add templates chips
  const chips = document.querySelectorAll<HTMLButtonElement>('.schema-chip');
  chips.forEach((chip) => {
    chip.addEventListener('click', () => {
      const key = chip.dataset.key;
      if (key) {
        newKeyInput.value = key;
        newValInput.focus();
        showToast(`Template "${key}" loaded. Fill in the value.`, 'info');
      }
    });
  });

  await Promise.all([
    renderKeysList(),
    renderFieldsList(),
    loadGenerationStyle(),
  ]);
}

init().catch(logger.error);
