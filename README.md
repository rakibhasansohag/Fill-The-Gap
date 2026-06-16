# ⚡ Fill The Gap — Chrome Extension

Intelligent Form Autofill Powered by **Gemini AI** with **Seamless API Key Rotation**.

![Fill The Gap Showcase](C:/Users/drdev/.gemini/antigravity-ide/brain/49a36767-75ac-4ba9-b17c-afbd55847799/showcase_banner_1781615853756.png)

---

## 📖 Overview

**Fill The Gap** is a high-performance developer tool and utility extension that scans complex form layouts (standard DOM, Shadow DOM, and same-origin frames) and fills them with coherent, context-aware mock data. Leveraging the Gemini API, it dynamically recognizes page context and generates fields that align perfectly with the target page. 

It contains an enterprise-grade **multi-key rotation layer** that recovers from rate limits, client errors, or quota exhaustion seamlessly by cycling through a pool of configured keys.

---

## ⚡ System Architecture

```mermaid
graph TD
    User([User Clicks Icon]) --> SW[Service Worker Orchestrator]
    SW -->|GET_FIELD_SCAN| CS[Content Script Scanner]
    CS -->|Scan DOM / Shadow DOM / Iframes| Scanner[field-scanner.ts]
    Scanner -->|Return Detected Fields| CS
    CS -->|Fields & Page Context| SW
    
    SW -->|Local Storage Check| Storage[(chrome.storage.local)]
    Storage -->|Manual Field Overrides| SW
    
    subgraph AI Generation Pipeline
        SW -->|Clean non-manual fields| PB[prompt-builder.ts]
        PB -->|Construct Coherent Prompt| Rotator[api-rotator.ts]
        Rotator -->|Key Rotation / Fallback| Client[gemini-client.ts]
        Client -->|REST generateContent| Gemini(Gemini API)
        Gemini -->|Strict JSON| Client
        Client -->|Repair truncated JSON| Rotator
    end
    
    Rotator -->|Aggregated Map| SW
    SW -->|VALUES_READY| CS
    CS -->|Bypass Framework Setters| Filler[field-filler.ts]
    Filler -->|Trigger Native Events| Input[Form Inputs]
    Filler -->|Apply Style Highlights| Input
```

---

## ✨ Key Features

| Feature | Description |
| :--- | :--- |
| **🤖 Universal DOM Scanner** | Evaluates explicit labels, placeholders, aria attributes, name, id, and nearby context tags recursively. |
| **🔄 13-Key API Rotator** | Automatic load balancing and error recovery. Rotates keys on HTTP `429` / `RESOURCE_EXHAUSTED` with circuit breakers. |
| **🔒 Manual Field Bypass** | Local storage cache for sensitive data (passwords, emails). These bypass Gemini entirely and are filled instantly. |
| **🎨 Context Coherence** | Evaluates the entire page context in a single request, ensuring SKUs, descriptions, prices, and names belong to the same product category. |
| **⚛️ Virtual DOM Compatibility** | Directly manipulates native property descriptors to bypass React, Vue, Svelte, and Angular event tracking. |

---

## 🚀 Quick Start

### 1. Install Dependencies
```bash
npm install
```

### 2. Generate Extension Icons
```bash
npm run generate-icons
```

### 3. Build the Extension
```bash
# Production Bundle
npm run build

# Development Mode (watch files)
npm run dev
```

### 4. Load in Google Chrome
1. Navigate to `chrome://extensions/` in your browser.
2. Toggle **Developer mode** in the top-right corner.
3. Click **Load unpacked** in the top-left.
4. Select the output `dist/` directory created in your workspace root.

---

## ⚙️ Configuration & Key Rotation

Access the extension **Settings** to set up:

* **API Keys:** Paste your raw Gemini API keys (comma-separated or `GEMINI_KEYS=` export format). The engine handles round-robin key switching. If a key generates 3 consecutive errors, it is placed on a **15-minute cooldown** before re-entering rotation.
* **Manual Fields:** Define templates (like `email`, `first_name`, `password`) that represent personal or static mock data. Any field matching these keys will bypass AI generation and inject your stored string natively.

---

## 🛡️ Security & Privacy

* **Zero-Knowledge Architecture:** Manual fields (passwords, usernames, phone numbers) are processed directly inside your browser container using `chrome.storage.local`. They are **never** bundled in payload context sent to Google Gemini endpoints.
* **Strict Local Scope:** Your API keys are stored entirely in local browser sandboxes and are only transmitted directly to Google's official Gemini API REST endpoints.
