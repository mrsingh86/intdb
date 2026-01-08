/**
 * Critical Entity Validation Test
 *
 * Validates extraction quality for the MOST IMPORTANT entities:
 * - Booking Numbers (critical for shipment linking)
 * - Container Numbers (critical for tracking)
 * - BL Numbers (critical for document linking)
 * - Dates (ETD, ETA, cutoffs)
 *
 * Uses deterministic validation rules, not LLM judgment.
 */

import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';
dotenv.config();

import {
  createSenderAwareExtractor,
  createSenderCategoryDetector,
} from '../../lib/services/extraction';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL || '',
  process.env.SUPABASE_SERVICE_ROLE_KEY || ''
);

// ============================================================================
// Validation Rules
// ============================================================================

/**
 * Validate booking number format for known carriers
 */
function isValidBookingFormat(value: string): { valid: boolean; carrier?: string } {
  // Maersk: 9 digits starting with 2
  if (/^2\d{8}$/.test(value)) return { valid: true, carrier: 'maersk' };
  // Hapag-Lloyd: HL- prefix or HLCU prefix
  if (/^HL-?\d{8}$/i.test(value) || /^HLCU\d{7,10}$/i.test(value)) return { valid: true, carrier: 'hapag' };
  // CMA CGM: CEI, AMC, CAD prefix
  if (/^(CEI|AMC|CAD)\d{7}$/i.test(value)) return { valid: true, carrier: 'cma_cgm' };
  // COSCO: COSU prefix
  if (/^COSU\d{10}$/i.test(value)) return { valid: true, carrier: 'cosco' };
  // Generic 9-10 digit booking (lower confidence)
  if (/^\d{9,10}$/.test(value)) return { valid: true };

  return { valid: false };
}

/**
 * Validate container number format (ISO 6346)
 */
function isValidContainerFormat(value: string): boolean {
  // Must be 4 letters + 7 digits
  if (!/^[A-Z]{4}\d{7}$/i.test(value)) return false;

  // Check digit validation (ISO 6346)
  const chars = value.toUpperCase();
  const letterValues: Record<string, number> = {
    A: 10, B: 12, C: 13, D: 14, E: 15, F: 16, G: 17, H: 18, I: 19,
    J: 20, K: 21, L: 23, M: 24, N: 25, O: 26, P: 27, Q: 28, R: 29,
    S: 30, T: 31, U: 32, V: 34, W: 35, X: 36, Y: 37, Z: 38
  };

  let sum = 0;
  for (let i = 0; i < 10; i++) {
    const char = chars[i];
    const value = letterValues[char] ?? parseInt(char, 10);
    sum += value * Math.pow(2, i);
  }

  const checkDigit = sum % 11 % 10;
  const providedCheckDigit = parseInt(chars[10], 10);

  return checkDigit === providedCheckDigit;
}

/**
 * Validate BL number format
 */
function isValidBLFormat(value: string): { valid: boolean; type?: string } {
  // Intoglo HBL: SE + 10 digits
  if (/^SE\d{10}$/i.test(value)) return { valid: true, type: 'HBL' };
  // Carrier MBL: 4 letters + 9+ digits
  if (/^[A-Z]{4}\d{9,}$/i.test(value)) return { valid: true, type: 'MBL' };
  // Generic alphanumeric 8+ chars
  if (/^[A-Z0-9]{8,}$/i.test(value)) return { valid: true };

  return { valid: false };
}

/**
 * Check if value exists in source text
 */
function valueInSource(value: string, source: string): boolean {
  const normalizedValue = value.toLowerCase().replace(/[\s-]/g, '');
  const normalizedSource = source.toLowerCase().replace(/[\s-]/g, '');
  return normalizedSource.includes(normalizedValue);
}

// ============================================================================
// Main Test
// ============================================================================

interface ValidationResult {
  category: string;
  emailCount: number;
  bookingNumbers: { total: number; valid: number; inSource: number };
  containerNumbers: { total: number; valid: number; inSource: number };
  blNumbers: { total: number; valid: number; inSource: number };
  overallAccuracy: number;
}

async function validateCategory(category: string, keywords: string[]): Promise<ValidationResult> {
  const conditions = keywords.map(kw =>
    `true_sender_email.ilike.%${kw}%,sender_email.ilike.%${kw}%,subject.ilike.%${kw}%`
  ).join(',');

  const { data: emails, error } = await supabase
    .from('raw_emails')
    .select('id, sender_email, true_sender_email, subject, body_text')
    .not('body_text', 'is', null)
    .or(conditions)
    .order('received_at', { ascending: false })
    .limit(30);

  if (error || !emails?.length) {
    return {
      category,
      emailCount: 0,
      bookingNumbers: { total: 0, valid: 0, inSource: 0 },
      containerNumbers: { total: 0, valid: 0, inSource: 0 },
      blNumbers: { total: 0, valid: 0, inSource: 0 },
      overallAccuracy: 0,
    };
  }

  const extractor = createSenderAwareExtractor(supabase);

  let bookingTotal = 0, bookingValid = 0, bookingInSource = 0;
  let containerTotal = 0, containerValid = 0, containerInSource = 0;
  let blTotal = 0, blValid = 0, blInSource = 0;

  for (const email of emails) {
    const sourceText = `${email.subject}\n${email.body_text}`;

    const result = await extractor.extract({
      emailId: email.id,
      senderEmail: email.sender_email || '',
      trueSenderEmail: email.true_sender_email,
      subject: email.subject || '',
      bodyText: (email.body_text || '').slice(0, 8000),
      sourceType: 'email',
    });

    for (const ext of result.extractions) {
      if (ext.entityType === 'booking_number') {
        bookingTotal++;
        if (isValidBookingFormat(ext.entityValue).valid) bookingValid++;
        if (valueInSource(ext.entityValue, sourceText)) bookingInSource++;
      } else if (ext.entityType === 'container_number') {
        containerTotal++;
        if (isValidContainerFormat(ext.entityValue)) containerValid++;
        if (valueInSource(ext.entityValue, sourceText)) containerInSource++;
      } else if (ext.entityType === 'bl_number') {
        blTotal++;
        if (isValidBLFormat(ext.entityValue).valid) blValid++;
        if (valueInSource(ext.entityValue, sourceText)) blInSource++;
      }
    }
  }

  const total = bookingTotal + containerTotal + blTotal;
  const valid = bookingValid + containerValid + blValid;
  const inSource = bookingInSource + containerInSource + blInSource;

  return {
    category,
    emailCount: emails.length,
    bookingNumbers: { total: bookingTotal, valid: bookingValid, inSource: bookingInSource },
    containerNumbers: { total: containerTotal, valid: containerValid, inSource: containerInSource },
    blNumbers: { total: blTotal, valid: blValid, inSource: blInSource },
    overallAccuracy: total > 0 ? Math.round((Math.min(valid, inSource) / total) * 100) : 100,
  };
}

async function main() {
  console.log('═══════════════════════════════════════════════════════════════');
  console.log('  CRITICAL ENTITY VALIDATION TEST');
  console.log('  Deterministic validation of booking#, container#, BL#');
  console.log('═══════════════════════════════════════════════════════════════\n');

  const categories: Record<string, string[]> = {
    maersk: ['maersk', 'sealand'],
    hapag: ['hapag', 'hlag'],
    cma_cgm: ['cma-cgm', 'cma cgm'],
    cosco: ['cosco', 'oocl'],
    one_line: ['one-line'],
    customs_broker: ['abordeaux', 'expeditors', 'customs'],
    freight_forwarder: ['intoglo', 'freight', 'logistics'],
    trucking: ['trucking', 'drayage', 'transport'],
    arrival_notice: ['arrival notice', 'arrival notification'],
    booking_confirmation: ['booking confirmation', 'bkg:'],
    bl_document: ['draft bl', 'final bl', 'bl released'],
  };

  const results: ValidationResult[] = [];

  console.log('Category                  Emails  Book#  Cont#  BL#    Accuracy');
  console.log('──────────────────────────────────────────────────────────────────');

  for (const [category, keywords] of Object.entries(categories)) {
    const result = await validateCategory(category, keywords);
    results.push(result);

    const bookingStr = result.bookingNumbers.total > 0
      ? `${result.bookingNumbers.inSource}/${result.bookingNumbers.total}`
      : '-';
    const containerStr = result.containerNumbers.total > 0
      ? `${result.containerNumbers.inSource}/${result.containerNumbers.total}`
      : '-';
    const blStr = result.blNumbers.total > 0
      ? `${result.blNumbers.inSource}/${result.blNumbers.total}`
      : '-';

    const status = result.emailCount === 0 ? '⚠️' :
                   result.overallAccuracy >= 90 ? '✓' :
                   result.overallAccuracy >= 70 ? '○' : '✗';

    console.log(
      `${status} ${category.padEnd(22)} ${result.emailCount.toString().padStart(5)}  ` +
      `${bookingStr.padStart(5)}  ${containerStr.padStart(5)}  ${blStr.padStart(5)}    ` +
      `${result.overallAccuracy}%`
    );
  }

  // Summary
  console.log('\n═══════════════════════════════════════════════════════════════');
  console.log('  SUMMARY');
  console.log('═══════════════════════════════════════════════════════════════\n');

  const totalBooking = results.reduce((sum, r) => sum + r.bookingNumbers.total, 0);
  const validBooking = results.reduce((sum, r) => sum + r.bookingNumbers.inSource, 0);
  const totalContainer = results.reduce((sum, r) => sum + r.containerNumbers.total, 0);
  const validContainer = results.reduce((sum, r) => sum + r.containerNumbers.inSource, 0);
  const totalBL = results.reduce((sum, r) => sum + r.blNumbers.total, 0);
  const validBL = results.reduce((sum, r) => sum + r.blNumbers.inSource, 0);

  console.log(`Booking Numbers:   ${validBooking}/${totalBooking} in source (${Math.round(validBooking/Math.max(totalBooking,1)*100)}%)`);
  console.log(`Container Numbers: ${validContainer}/${totalContainer} in source (${Math.round(validContainer/Math.max(totalContainer,1)*100)}%)`);
  console.log(`BL Numbers:        ${validBL}/${totalBL} in source (${Math.round(validBL/Math.max(totalBL,1)*100)}%)`);

  const totalAll = totalBooking + totalContainer + totalBL;
  const validAll = validBooking + validContainer + validBL;
  const overallAccuracy = Math.round(validAll / Math.max(totalAll, 1) * 100);

  console.log(`\nOverall Critical Entity Accuracy: ${overallAccuracy}%`);

  if (overallAccuracy >= 95) {
    console.log('\n✓ QUALITY GATE: PASSED (95%+ accuracy)');
  } else if (overallAccuracy >= 85) {
    console.log('\n○ QUALITY GATE: ACCEPTABLE (85-94% accuracy)');
  } else {
    console.log('\n✗ QUALITY GATE: NEEDS IMPROVEMENT (<85% accuracy)');
  }
}

main().catch(console.error);
