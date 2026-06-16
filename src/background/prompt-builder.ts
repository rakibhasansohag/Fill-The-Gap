/**
 * prompt-builder.ts
 * Builds Gemini prompts for form filling, ensuring coherence and type conformity.
 */

import type { DetectedField, ManualFields, GenerationStyle } from '@shared/types';

/**
 * Build the complete Gemini prompt for form field value generation.
 * 
 * Key behaviors:
 * - Sends ALL fields in one request for context coherence
 * - Excludes manual fields from AI generation
 * - Instructs Gemini to maintain coherent context (e.g., if one field = "banana", all fields should be banana-related)
 * - Returns strict JSON: { [selector]: value }
 */
export function buildFieldFillPrompt(
  fields: DetectedField[],
  manualFields: ManualFields,
  pageUrl: string,
  pageTitle: string,
  style: GenerationStyle
): string {
  const manualKeys = Object.keys(manualFields);
  const fieldsToGenerate = fields.filter(
    (f) => !shouldUseManualField(f, manualFields)
  );

  const fieldDescriptions = fieldsToGenerate.map((f) => {
    const base: Record<string, any> = {
      selector: f.selector,
      label: f.labelText || '(no label)',
      type: f.inputType || f.tag.toLowerCase(),
    };
    if (f.options && f.options.length > 0) {
      base.options = f.options.map((o) => ({ value: o.value, label: o.label }));
    }
    return base;
  });

  const styleInstructions: Record<GenerationStyle, string> = {
    professional: 'Use professional, realistic, industry-standard values.',
    casual: 'Use casual, everyday, relatable values.',
    random: 'Use creative, varied, interesting values.',
  };

  const prompt = `You are an expert web form data generator. Your task is to generate realistic, coherent data for ALL form fields below.

## Page Context
- URL: ${pageUrl}
- Page Title: ${pageTitle}

## Critical Rules
1. CONTEXT COHERENCE: If one field reveals a topic (e.g., "banana", "mountain bike", "laptop"), ALL other fields MUST be consistent with that same topic/product/subject.
2. Generate values for ALL fields listed below.
3. For <select> fields, the output value MUST be one of the "value" strings listed in "options" exactly.
4. Do NOT generate values for these field types (they are filled manually): ${manualKeys.length > 0 ? manualKeys.join(', ') : 'none'}.
5. ${styleInstructions[style]}
6. For product names/SKUs: be specific (e.g., "Organic Cavendish Banana Bunch" not just "Banana").
7. For descriptions: write 2-3 professional sentences.
8. For prices: use realistic market values.
9. For tags/keywords: generate 3-5 relevant comma-separated tags.
10. For date/time fields, return standard, recognizable date values (e.g., "2026-06-11").
11. VARIETY & AVOID PLACEHOLDERS: Do NOT copy the placeholder values or example texts (e.g., from the field labels, placeholders, or descriptions) literally. Instead, generate a brand new, unique, and random product/entity (e.g., pick a different type/category of product like a 'Waterproof Sports Action Camera', 'Wireless Mechanical Keyboard', 'Gourmet Coffee Beans Bag', etc.) with its corresponding unique details (price, SKU, description). Every time this prompt is run, the generated product and values must be different and fresh.

## Fields to Generate

${JSON.stringify(fieldDescriptions, null, 2)}

## Required Output Format
Respond with ONLY a valid JSON object. No markdown, no explanation.
The keys must be the exact "selector" values from the fields above.
Example: { "#product-name": "Organic Cavendish Banana Bunch", "#sku": "BAN-CAV-001" }

Generate the JSON now:`;

  return prompt;
}

/**
 * Check if a detected field should be filled from manual storage
 * instead of AI generation.
 * 
 * Matching strategy: fuzzy match between field label and manual field keys.
 */
export function shouldUseManualField(
  field: DetectedField,
  manualFields: ManualFields
): boolean {
  const manualKeys = Object.keys(manualFields);
  if (manualKeys.length === 0) return false;

  const fieldLabel = (field.labelText + ' ' + field.selector).toLowerCase();

  for (const key of manualKeys) {
    const normalizedKey = key.toLowerCase().trim();
    if (
      fieldLabel.includes(normalizedKey) ||
      field.selector.toLowerCase().includes(normalizedKey) ||
      field.inputType === normalizedKey
    ) {
      return true;
    }
  }
  return false;
}

/**
 * Get the matching manual field value for a detected field.
 * Returns null if no match found.
 */
export function getManualValueForField(
  field: DetectedField,
  manualFields: ManualFields
): string | null {
  const manualKeys = Object.keys(manualFields);
  const fieldLabel = (field.labelText + ' ' + field.selector).toLowerCase();

  for (const key of manualKeys) {
    const normalizedKey = key.toLowerCase().trim();
    if (
      fieldLabel.includes(normalizedKey) ||
      field.selector.toLowerCase().includes(normalizedKey) ||
      field.inputType === normalizedKey
    ) {
      return manualFields[key];
    }
  }
  return null;
}
