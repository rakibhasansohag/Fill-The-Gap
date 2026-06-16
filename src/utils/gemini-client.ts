/**
 * gemini-client.ts
 * REST API client for Gemini API content generation and error handling.
 */

import { GEMINI_API_BASE, GEMINI_MODEL } from '@shared/constants';
import { logger } from './logger';

export interface GeminiResponse {
  candidates: Array<{
    content: {
      parts: Array<{ text: string }>;
    };
    finishReason: string;
  }>;
  usageMetadata?: {
    promptTokenCount: number;
    candidatesTokenCount: number;
  };
}

/** Errors that indicate a key should be rotated */
const ROTATABLE_ERROR_CODES = new Set([429, 503, 502, 500]);
const ROTATABLE_STATUS_STRINGS = [
  'RESOURCE_EXHAUSTED',
  'UNAVAILABLE',
  'RATE_LIMIT_EXCEEDED',
  'QUOTA_EXCEEDED',
  'too many requests',
  'high usage',
];

export class GeminiApiError extends Error {
  constructor(
    public readonly statusCode: number,
    public readonly statusText: string,
    public readonly body: string,
    public readonly shouldRotate: boolean
  ) {
    super(`Gemini API Error ${statusCode}: ${statusText}`);
    this.name = 'GeminiApiError';
  }
}

/**
 * Determine whether an error warrants rotating to the next API key.
 */
export function shouldRotateOnError(error: unknown): boolean {
  if (error instanceof GeminiApiError) return error.shouldRotate;
  if (error instanceof Error) {
    const msg = error.message.toLowerCase();
    return (
      ROTATABLE_STATUS_STRINGS.some((s) => msg.includes(s.toLowerCase())) ||
      msg.includes('failed to fetch') ||
      msg.includes('network error')
    );
  }
  return false;
}

/**
 * Make a single Gemini API call with a given key.
 * Throws GeminiApiError on non-2xx responses.
 */
export async function callGeminiApi(
  apiKey: string,
  prompt: string,
  temperature = 0.7
): Promise<string> {
  const url = `${GEMINI_API_BASE}/${GEMINI_MODEL}:generateContent?key=${apiKey}`;

  const body = {
    contents: [
      {
        parts: [{ text: prompt }],
      },
    ],
    generationConfig: {
      temperature,
      topK: 40,
      topP: 0.95,
      maxOutputTokens: 2048,
    },
  };

  logger.debug('Calling Gemini API', { model: GEMINI_MODEL });

  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const bodyText = await response.text();
    const shouldRotate =
      ROTATABLE_ERROR_CODES.has(response.status) ||
      ROTATABLE_STATUS_STRINGS.some((s) =>
        bodyText.toLowerCase().includes(s.toLowerCase())
      );

    throw new GeminiApiError(
      response.status,
      response.statusText,
      bodyText,
      shouldRotate
    );
  }

  const data: GeminiResponse = await response.json();
  const text = data.candidates?.[0]?.content?.parts?.[0]?.text;

  if (!text) {
    throw new Error('Gemini returned empty response');
  }

  logger.debug('Gemini response received', {
    tokens: data.usageMetadata?.candidatesTokenCount,
  });

  return text;
}

/**
 * Repair a JSON string that might be truncated or contain trailing non-JSON text.
 */
function repairJson(jsonStr: string): string {
  // Find the first '{' or '['
  const startIndex = jsonStr.indexOf('{');
  const startArrayIdx = jsonStr.indexOf('[');
  let start = -1;
  if (startIndex !== -1 && startArrayIdx !== -1) {
    start = Math.min(startIndex, startArrayIdx);
  } else {
    start = startIndex !== -1 ? startIndex : startArrayIdx;
  }
  if (start === -1) return jsonStr;

  const str = jsonStr.slice(start);
  const stack: string[] = [];
  let inString = false;
  let escaped = false;
  let cleanStr = '';

  for (let i = 0; i < str.length; i++) {
    const char = str[i];
    if (escaped) {
      cleanStr += char;
      escaped = false;
      continue;
    }
    if (char === '\\') {
      cleanStr += char;
      escaped = true;
      continue;
    }
    if (char === '"') {
      inString = !inString;
      cleanStr += char;
      continue;
    }
    if (!inString) {
      if (char === '{' || char === '[') {
        stack.push(char === '{' ? '}' : ']');
      } else if (char === '}' || char === ']') {
        if (stack.length > 0 && stack[stack.length - 1] === char) {
          stack.pop();
          if (stack.length === 0) {
            cleanStr += char;
            return cleanStr;
          }
        }
      }
    }
    cleanStr += char;
  }

  // If we ended while inString is true, the string was truncated inside a quote.
  if (inString) {
    if (cleanStr.endsWith('\\')) {
      cleanStr = cleanStr.slice(0, -1);
    }
    cleanStr += '"';
  }

  let trimmed = cleanStr.trim();
  let modified = true;
  while (modified) {
    modified = false;
    trimmed = trimmed.trim();

    if (trimmed.endsWith(',')) {
      trimmed = trimmed.slice(0, -1);
      modified = true;
      continue;
    }

    const colonMatch = trimmed.match(/"(?:[^"\\]|\\.)*"\s*:\s*$/);
    if (colonMatch) {
      trimmed = trimmed.slice(0, -colonMatch[0].length).trim();
      modified = true;
      continue;
    }

    if (stack.length > 0 && stack[stack.length - 1] === '}') {
      const trailingStringMatch = trimmed.match(/"(?:[^"\\]|\\.)*"\s*$/);
      if (trailingStringMatch) {
        const beforeStr = trimmed.slice(0, -trailingStringMatch[0].length).trim();
        if (!beforeStr.endsWith(':')) {
          trimmed = beforeStr;
          modified = true;
          continue;
        }
      }
    }
  }

  for (let j = stack.length - 1; j >= 0; j--) {
    trimmed += stack[j];
  }

  return trimmed;
}

/**
 * Extract JSON from a Gemini response that may contain markdown code fences
 * or be truncated/malformed.
 */
export function extractJsonFromResponse(text: string): unknown {
  const cleaned = repairJson(text);
  try {
    return JSON.parse(cleaned);
  } catch (err) {
    throw new Error(`Could not parse JSON from Gemini response: ${text.slice(0, 200)}`);
  }
}

