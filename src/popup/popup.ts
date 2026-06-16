// ============================================================
// popup.ts — Popup UI logic
// ============================================================

import './popup.css';
import type {
  ExtensionMessage,
  FillCompleteMessage,
  FillErrorMessage,
  RotationWarningMessage,
} from '@shared/types';
import { getManualFields, getApiKeys, getCurrentKeyIndex } from '@shared/storage';
import { POPUP_IDS } from '@shared/constants';
import { logger } from '@utils/logger';

// ── DOM refs ──────────────────────────────────────────────────

const fillBtn       = document.getElementById('fill-btn') as HTMLButtonElement;
const statusBar     = document.getElementById('status-bar') as HTMLDivElement;
const statusText    = document.getElementById('status-text') as HTMLSpanElement;
const statusIcon    = document.getElementById('status-icon') as HTMLDivElement;
const loadingPanel  = document.getElementById('loading-panel') as HTMLDivElement;
const loadingText   = document.getElementById('loading-text') as HTMLDivElement;
const resultPanel   = document.getElementById('result-panel') as HTMLDivElement;
const errorPanel    = document.getElementById('error-panel') as HTMLDivElement;
const errorText     = document.getElementById('error-text') as HTMLDivElement;
const retryBtn      = document.getElementById('retry-btn') as HTMLButtonElement;
const aiCount       = document.getElementById('ai-count') as HTMLDivElement;
const manualCount   = document.getElementById('manual-count') as HTMLDivElement;
const skipCount     = document.getElementById('skip-count') as HTMLDivElement;
const keyIndicators = document.getElementById('key-indicators') as HTMLDivElement;
const settingsBtn   = document.getElementById('settings-btn') as HTMLButtonElement;
const clearBtn      = document.getElementById('clear-btn') as HTMLButtonElement;
const manualFieldsBtn = document.getElementById('manual-fields-btn') as HTMLButtonElement;
const manualBadge   = document.getElementById('manual-badge') as HTMLSpanElement;
const btnText       = document.getElementById('btn-text') as HTMLSpanElement;
const btnIcon       = document.getElementById('btn-icon') as HTMLSpanElement;
const loadingLogs   = document.getElementById('loading-logs') as HTMLDivElement;

// ── State ─────────────────────────────────────────────────────

type UIState = 'idle' | 'scanning' | 'generating' | 'filling' | 'success' | 'error';
let currentState: UIState = 'idle';
let currentTabId: number | null = null;

// ── Init ──────────────────────────────────────────────────────

async function init(): Promise<void> {
  // Get current tab
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  currentTabId = tab?.id ?? null;

  // Render key indicators
  await renderKeyIndicators();

  // Update manual fields badge
  await updateManualBadge();

  // Listen for messages from content script / background
  chrome.runtime.onMessage.addListener(handleIncomingMessage);

  // Read the last run results
  const data = await chrome.storage.local.get('lastRunResult');
  const lastRun = data.lastRunResult || { state: 'idle' };

  if (lastRun.state === 'success') {
    showResult(lastRun.filledCount || 0, lastRun.manualCount || 0, lastRun.skippedCount || 0);
    setUIState('success');
  } else if (lastRun.state === 'error') {
    showError(lastRun.error || 'Something went wrong');
    setUIState('error');
  } else {
    setUIState('idle');
  }

  // Clear popup mapping to allow onClicked listener in background to capture clicks again
  await chrome.action.setPopup({ popup: '' }).catch(() => {});
}

// ── Event handlers ────────────────────────────────────────────

fillBtn.addEventListener('click', handleFillClick);
retryBtn.addEventListener('click', handleFillClick);

settingsBtn.addEventListener('click', () => {
  chrome.runtime.openOptionsPage();
});

clearBtn.addEventListener('click', async () => {
  if (!currentTabId) return;
  await chrome.tabs.sendMessage(currentTabId, { type: 'CLEAR_HIGHLIGHTS' });
  setUIState('idle');
});

manualFieldsBtn.addEventListener('click', () => {
  chrome.runtime.openOptionsPage();
});

async function handleFillClick(): Promise<void> {
  if (!currentTabId) {
    showError('No active tab found. Please refresh and try again.');
    setUIState('error');
    return;
  }

  setUIState('scanning');

  try {
    const response = await chrome.runtime.sendMessage({
      type: 'TRIGGER_FILL',
      tabId: currentTabId,
    });
    if (response && response.error) {
      showError(response.error);
      setUIState('error');
    }
  } catch (err) {
    logger.error('Error starting form auto-fill:', err);
    showError(err instanceof Error ? err.message : String(err));
    setUIState('error');
  }
}

// ── Incoming message handler ──────────────────────────────────

function handleIncomingMessage(message: ExtensionMessage): void {
  switch (message.type) {
    case 'FIELD_SCAN_RESULT':
      setLoadingText('Generating values with AI...');
      setUIState('generating');
      break;

    case 'VALUES_READY':
      setLoadingText('Filling fields...');
      setUIState('filling');
      break;

    case 'FILL_COMPLETE': {
      const msg = message as FillCompleteMessage;
      showResult(msg.filledCount, msg.manualCount, msg.skippedCount);
      setUIState('success');
      renderKeyIndicators(); // Refresh key status
      break;
    }

    case 'FILL_ERROR': {
      const msg = message as FillErrorMessage;
      showError(msg.error);
      setUIState('error');
      break;
    }
    case 'ROTATION_WARNING': {
      const msg = message as RotationWarningMessage;
      if (msg.keyIndex === -1) {
        addLoadingLog(msg.error, 'info');
      } else {
        const keyLabel = `Key ${msg.keyIndex + 1}`;
        const statusLabel = msg.isCooledDown ? 'placed on cooldown (15m)' : 'failed';
        addLoadingLog(`${keyLabel} ${statusLabel}: ${msg.error}`, msg.isCooledDown ? 'error' : 'warn');
        renderKeyIndicators(); // Refresh key status
      }
      break;
    }
  }
}

function setBtnIcon(state: 'idle' | 'scanning' | 'success'): void {
  btnIcon.querySelectorAll('.icon-svg').forEach((icon) => icon.classList.add('hidden'));
  btnIcon.querySelector(`.${state}-icon`)?.classList.remove('hidden');
}

function setUIState(state: UIState): void {
  currentState = state;

  // Reset panels
  loadingPanel.classList.add('hidden');
  resultPanel.classList.add('hidden');
  errorPanel.classList.add('hidden');

  // Update status bar class
  statusBar.className = 'status-bar';

  switch (state) {
    case 'idle':
      setStatus('idle', 'Ready to fill');
      fillBtn.disabled = false;
      btnText.textContent = 'Auto-Fill This Page';
      setBtnIcon('idle');
      break;

    case 'scanning':
      setStatus('running', 'Scanning form fields...');
      fillBtn.disabled = true;
      btnText.textContent = 'Working...';
      setBtnIcon('scanning');
      loadingPanel.classList.remove('hidden');
      setLoadingText('Scanning fields...');
      loadingLogs.classList.add('hidden');
      loadingLogs.innerHTML = '';
      break;

    case 'generating':
      setStatus('running', 'Generating AI values...');
      loadingPanel.classList.remove('hidden');
      break;

    case 'filling':
      setStatus('running', 'Filling fields...');
      loadingPanel.classList.remove('hidden');
      break;

    case 'success':
      setStatus('success', 'Fill complete! ✓');
      fillBtn.disabled = false;
      btnText.textContent = 'Fill Again';
      setBtnIcon('success');
      resultPanel.classList.remove('hidden');
      break;

    case 'error':
      setStatus('error', 'Something went wrong');
      fillBtn.disabled = false;
      btnText.textContent = 'Auto-Fill This Page';
      setBtnIcon('idle');
      errorPanel.classList.remove('hidden');
      break;
  }
}

function setStatus(type: 'idle' | 'running' | 'success' | 'error', text: string): void {
  statusBar.className = `status-bar status-${type}`;
  statusText.textContent = text;
}

function setLoadingText(text: string): void {
  loadingText.textContent = text;
}

function showResult(filled: number, manual: number, skipped: number): void {
  animateCount(aiCount, filled);
  animateCount(manualCount, manual);
  animateCount(skipCount, skipped);
}

function animateCount(el: HTMLElement, target: number): void {
  let current = 0;
  const step = Math.ceil(target / 20);
  const interval = setInterval(() => {
    current = Math.min(current + step, target);
    el.textContent = String(current);
    if (current >= target) clearInterval(interval);
  }, 30);
}

function showError(message: string): void {
  errorText.textContent = message;
}

// ── Key Indicators ────────────────────────────────────────────

async function renderKeyIndicators(): Promise<void> {
  const [keys, currentIndex] = await Promise.all([
    getApiKeys(),
    getCurrentKeyIndex(),
  ]);

  keyIndicators.innerHTML = '';

  if (keys.length === 0) {
    keyIndicators.innerHTML = '<span style="font-size:11px;color:#475569">No keys configured</span>';
    return;
  }

  keys.forEach((key, index) => {
    const dot = document.createElement('div');
    dot.className = 'key-dot';

    let state: string;
    if (key.cooldownUntil && Date.now() < key.cooldownUntil) {
      state = 'cooldown';
    } else if (index === currentIndex) {
      state = 'current';
    } else if (key.errorCount >= 3) {
      state = 'error';
    } else {
      state = 'active';
    }

    dot.dataset.state = state;
    dot.title = `Key ${index + 1}: ${state} | Errors: ${key.errorCount} | Calls: ${key.totalCalls}`;
    keyIndicators.appendChild(dot);
  });
}

// ── Manual Badge ──────────────────────────────────────────────

async function updateManualBadge(): Promise<void> {
  const fields = await getManualFields();
  const count = Object.keys(fields).length;

  if (count > 0) {
    manualBadge.textContent = String(count);
    manualBadge.classList.remove('hidden');
  } else {
    manualBadge.classList.add('hidden');
  }
}

// ── Live Logger Helper ────────────────────────────────────────

function addLoadingLog(message: string, type: 'warn' | 'error' | 'success' | 'info' = 'info'): void {
  loadingLogs.classList.remove('hidden');

  const now = new Date();
  const timeStr = now.toTimeString().split(' ')[0]; // HH:MM:SS

  const line = document.createElement('div');
  line.className = 'log-line';

  const timeSpan = document.createElement('span');
  timeSpan.className = 'log-time';
  timeSpan.textContent = `[${timeStr}]`;

  const msgSpan = document.createElement('span');
  msgSpan.className = `log-msg ${type}`;
  msgSpan.textContent = message;

  line.appendChild(timeSpan);
  line.appendChild(msgSpan);

  loadingLogs.appendChild(line);
  loadingLogs.scrollTop = loadingLogs.scrollHeight;
}

// ── Bootstrap ─────────────────────────────────────────────────

init().catch(logger.error);
