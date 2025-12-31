/**
 * Date Parser Utility
 *
 * Converts natural language dates from Layer 2 entities to ISO format for database storage.
 * Handles various formats: "JAN. 3, 2026", "JANUARY 03, 2026", "2026-01-03", etc.
 */

/**
 * Parse natural language date to ISO format (YYYY-MM-DD)
 * Returns null if parsing fails
 */
export function parseEntityDate(dateString: string | undefined | null): string | null {
  if (!dateString) return null;

  // Already in ISO format (YYYY-MM-DD) - exact match
  const isoPattern = /^\d{4}-\d{2}-\d{2}$/;
  if (isoPattern.test(dateString)) {
    return dateString;
  }

  // ISO datetime format (YYYY-MM-DDTHH:MM:SS) - extract date portion
  const isoDateTimePattern = /^(\d{4}-\d{2}-\d{2})T\d{2}:\d{2}:\d{2}/;
  const isoDateTimeMatch = dateString.match(isoDateTimePattern);
  if (isoDateTimeMatch) {
    return isoDateTimeMatch[1];
  }

  // Clean up the string
  let cleaned = dateString.trim().toUpperCase();

  // Remove ordinal indicators (1ST, 2ND, 3RD, 4TH, 21ST, etc.)
  // But preserve the case to not break month names like "DECEMBER"
  cleaned = cleaned.replace(/(\d+)(ST|ND|RD|TH)\b/gi, '$1');

  // Remove time portion if present (e.g., "30/12/2025 02:00 AM" -> "30/12/2025")
  cleaned = cleaned.replace(/\s+\d{1,2}:\d{2}(\s*(AM|PM))?.*$/i, '');

  // Handle DD-MM-YYYY or DD/MM/YYYY format
  const ddMmYyyy = cleaned.match(/^(\d{1,2})[-\/](\d{1,2})[-\/](\d{4})$/);
  if (ddMmYyyy) {
    const [_, day, month, year] = ddMmYyyy;
    // Validate day and month ranges
    const dayNum = parseInt(day);
    const monthNum = parseInt(month);
    if (dayNum >= 1 && dayNum <= 31 && monthNum >= 1 && monthNum <= 12) {
      return `${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`;
    }
  }

  // Handle MM/DD/YYYY format (American style)
  const mmDdYyyy = cleaned.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (mmDdYyyy) {
    const [_, first, second, year] = mmDdYyyy;
    const firstNum = parseInt(first);
    const secondNum = parseInt(second);

    // If first number > 12, it must be day (DD/MM/YYYY)
    if (firstNum > 12 && secondNum <= 12) {
      return `${year}-${second.padStart(2, '0')}-${first.padStart(2, '0')}`;
    }
    // If second number > 12, it must be day (MM/DD/YYYY)
    else if (secondNum > 12 && firstNum <= 12) {
      return `${year}-${first.padStart(2, '0')}-${second.padStart(2, '0')}`;
    }
    // Both could be valid, default to DD/MM/YYYY for international format
    else if (firstNum <= 31 && secondNum <= 12) {
      return `${year}-${second.padStart(2, '0')}-${first.padStart(2, '0')}`;
    }
  }

  // Handle DD-Mon or DD-Mon-YY format (e.g., "21-Dec" or "21-Dec-25")
  const dayMonthShort = cleaned.match(/^(\d{1,2})[-\s]([A-Z]{3})(?:[-\s](\d{2,4}))?/);
  if (dayMonthShort) {
    const [_, day, monthAbbr, yearPart] = dayMonthShort;
    let year: number;

    if (yearPart) {
      // Handle 2-digit or 4-digit year
      year = yearPart.length === 2 ? 2000 + parseInt(yearPart) : parseInt(yearPart);
    } else {
      // No year provided - assume current year if month is in future, next year if in past
      const currentDate = new Date();
      const currentYear = currentDate.getFullYear();
      const currentMonth = currentDate.getMonth();

      const testDate = new Date(`${monthAbbr} ${day}, ${currentYear}`);
      if (!isNaN(testDate.getTime())) {
        const testMonth = testDate.getMonth();

        // If the month is significantly in the past (more than 3 months ago), use next year
        // This handles cases like "5th Jan" in December
        if (testMonth < currentMonth - 3) {
          year = currentYear + 1;
        } else {
          year = currentYear;
        }
      } else {
        year = currentYear;
      }
    }

    const fullDate = new Date(`${monthAbbr} ${day}, ${year}`);
    if (!isNaN(fullDate.getTime())) {
      const month = String(fullDate.getMonth() + 1).padStart(2, '0');
      return `${year}-${month}-${day.padStart(2, '0')}`;
    }
  }

  // Try standard Date parsing as last resort
  try {
    // Replace common separators with spaces for better parsing
    const normalized = cleaned.replace(/[,\-]/g, ' ').replace(/\s+/g, ' ');
    const parsed = new Date(normalized);

    // Check if valid date
    if (isNaN(parsed.getTime())) {
      return null;
    }

    // Convert to ISO format (YYYY-MM-DD)
    const year = parsed.getFullYear();
    const month = String(parsed.getMonth() + 1).padStart(2, '0');
    const day = String(parsed.getDate()).padStart(2, '0');

    // Sanity check - year should be reasonable (2020-2030)
    if (year < 2020 || year > 2030) {
      return null;
    }

    return `${year}-${month}-${day}`;
  } catch (error) {
    console.warn(`Failed to parse date: "${dateString}"`, error);
    return null;
  }
}

/**
 * Parse multiple dates and return first valid one
 */
export function parseFirstValidDate(dates: (string | undefined | null)[]): string | null {
  for (const date of dates) {
    const parsed = parseEntityDate(date);
    if (parsed) return parsed;
  }
  return null;
}

/**
 * Parse datetime with time preservation (for cutoffs)
 * Returns ISO 8601 datetime string with timezone
 *
 * Use this for cutoff dates where time matters (e.g., SI cutoff at 17:00)
 */
export function parseEntityDateTime(dateTimeString: string | undefined | null): string | null {
  if (!dateTimeString) return null;

  // Already in ISO datetime format - return as-is with UTC timezone
  const isoDateTimePattern = /^(\d{4}-\d{2}-\d{2})T(\d{2}:\d{2}:\d{2})/;
  const isoDateTimeMatch = dateTimeString.match(isoDateTimePattern);
  if (isoDateTimeMatch) {
    // Return full datetime with timezone
    return `${isoDateTimeMatch[1]}T${isoDateTimeMatch[2]}+00:00`;
  }

  // Handle date with time (e.g., "30/12/2025 02:00 AM" or "Dec 31, 2025 17:00")
  const dateWithTime = dateTimeString.match(/(.+?)\s+(\d{1,2}):(\d{2})(?:\s*(AM|PM))?/i);
  if (dateWithTime) {
    const datePart = dateWithTime[1];
    let hours = parseInt(dateWithTime[2]);
    const minutes = dateWithTime[3];
    const ampm = dateWithTime[4]?.toUpperCase();

    // Handle AM/PM
    if (ampm === 'PM' && hours < 12) hours += 12;
    if (ampm === 'AM' && hours === 12) hours = 0;

    // Parse the date part
    const parsedDate = parseEntityDate(datePart);
    if (parsedDate) {
      return `${parsedDate}T${String(hours).padStart(2, '0')}:${minutes}:00+00:00`;
    }
  }

  // Fall back to date-only parsing with midnight time
  const dateOnly = parseEntityDate(dateTimeString);
  if (dateOnly) {
    return `${dateOnly}T00:00:00+00:00`;
  }

  return null;
}
