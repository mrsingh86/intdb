/**
 * Container Number Validation Utilities
 *
 * ISO 6346 container number format: 4 letters + 6 digits + 1 check digit
 * Example: MSKU5710280, FANU3190317
 *
 * Validates and normalizes container numbers to prevent garbage data.
 */

/**
 * Valid container number pattern
 * - 4 letters (owner code + category)
 * - 6-7 digits (serial + optional check digit)
 */
const CONTAINER_NUMBER_REGEX = /^[A-Z]{4}\d{6,7}$/;

/**
 * Booking number pattern (should NOT be in container field)
 * COSCO: COSU followed by 10 digits
 */
const BOOKING_NUMBER_REGEX = /^[A-Z]{4}\d{9,}$/;

/**
 * Check if a value is a valid container number
 */
export function isValidContainerNumber(value: string | null | undefined): boolean {
  if (!value) return false;

  const normalized = normalizeContainerNumber(value);
  return CONTAINER_NUMBER_REGEX.test(normalized);
}

/**
 * Normalize container number (remove spaces, hyphens, uppercase)
 */
export function normalizeContainerNumber(value: string): string {
  return value.replace(/[\s-]+/g, '').toUpperCase();
}

/**
 * Check if value looks like a booking number (wrong field)
 */
export function isBookingNumberFormat(value: string): boolean {
  const normalized = value.replace(/[\s-]+/g, '').toUpperCase();
  return BOOKING_NUMBER_REGEX.test(normalized);
}

/**
 * Validate container number for storage
 * Returns undefined if invalid (prevents garbage data)
 */
export function sanitizeContainerNumber(
  value: string | null | undefined
): string | undefined {
  if (!value) return undefined;

  const normalized = normalizeContainerNumber(value);

  // Reject obvious garbage
  if (normalized.length < 10) return undefined;
  if (/^\d+$/.test(normalized)) return undefined; // Only digits
  if (/^[A-Z]+$/.test(normalized)) return undefined; // Only letters

  // Reject booking numbers stored in wrong field
  if (isBookingNumberFormat(value)) {
    console.warn(
      `[ContainerValidator] Rejecting booking number in container field: ${value}`
    );
    return undefined;
  }

  // Valid container
  if (isValidContainerNumber(value)) {
    return normalized;
  }

  console.warn(`[ContainerValidator] Invalid container format: ${value}`);
  return undefined;
}
