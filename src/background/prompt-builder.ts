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

  const prompt = `You are an expert web form data generator. Your task is to generate realistic, coherent, and completely random data for ALL form fields below.

## Page Context
- URL: ${pageUrl}
- Page Title: ${pageTitle}

## Critical Rules
1. CONTEXT COHERENCE: All generated field values must belong to the same coherent context. For example, if the form is about locations, all fields (name, address, city, phone) must make sense together for a single random location. If it is a product, all fields must correspond to a single random product.
2. Generate values for ALL fields listed below.
3. For <select> fields, the output value MUST be one of the "value" strings listed in "options" exactly.
4. Do NOT generate values for these field types (they are filled manually): ${manualKeys.length > 0 ? manualKeys.join(', ') : 'none'}.
5. ${styleInstructions[style]}
6. AVOID PLACEHOLDERS AND DUPLICATES: Do NOT copy any placeholder values, hints, or examples listed in the field labels, descriptions, or selectors (e.g., if a field label contains "e.g. Main Warehouse", you MUST NOT use "Main Warehouse"). Do not duplicate existing values. Every time you run this generation, you must invent a completely new, unique, and fresh set of data.
7. SPECIFIC RULES BY DATA TYPE:
   - For Location Names: Generate a random, unique facility name (e.g., "Northwest Distribution Center", "Metro Logistics Hub", "Central Depot", "Eastside Annex"). Do not use "Main Warehouse".
   - For Addresses: Generate a completely random street address (e.g., "892 Northway Blvd", "1540 Commerce Pkwy"). Do not use "456 Industrial Way" or "123 Main St".
   - For Cities/States: Generate a realistic city and state combination (e.g., "Seattle, WA", "Austin, TX", "Chicago, IL"). Do not use the exact example provided in the placeholder.
   - For Phone Numbers: Generate a random phone number with a realistic country code (e.g., "+1 206-555-0192", "+1 512-555-0143"). Do not use "+1 555-0100" or similar exact examples.
   - For Product Details: Be specific and generate unique items (e.g., "Waterproof Sports Action Camera" instead of just "Camera"), realistic market prices, and random alphanumeric SKUs.
   - For Descriptions: Write 2-3 realistic, coherent sentences.
   - For Date/Time fields: Use standard, recognizable date formats (e.g., "2026-06-11").

## Fields to Generate

${JSON.stringify(fieldDescriptions, null, 2)}

## Required Output Format
Respond with ONLY a valid JSON object. No markdown, no explanation.
The keys must be the exact "selector" values from the fields above.
Example: { "#location-name": "Northwest Distribution Center", "#address": "892 Northway Blvd" }

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
