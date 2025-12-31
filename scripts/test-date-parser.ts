import { parseEntityDate } from '../lib/utils/date-parser';

// Test cases from actual entities
const testCases = [
  // Currently working
  "01/03/2026",
  "2025-02-15",
  "DEC. 4, 2025",
  "JAN. 3, 2026",
  "2026-01-03",
  "24-December-2025",

  // Currently failing
  "20TH DECEMBER, 2025",
  "30/12/2025 02:00 AM",
  "30-12-2025",
  "21-Dec",  // This gives wrong year (2001)
];

console.log('=== DATE PARSER TESTING ===\n');

testCases.forEach(dateStr => {
  const result = parseEntityDate(dateStr);
  console.log(`"${dateStr}" -> ${result || 'FAILED'}`);
});

// Test the enhanced parser
function parseEntityDateEnhanced(dateString: string | undefined | null): string | null {
  if (!dateString) return null;

  // Already in ISO format (YYYY-MM-DD)
  const isoPattern = /^\d{4}-\d{2}-\d{2}$/;
  if (isoPattern.test(dateString)) {
    return dateString;
  }

  // Clean up the string
  let cleaned = dateString.trim().toUpperCase();

  // Remove ordinal indicators (1ST, 2ND, 3RD, 4TH, etc.)
  cleaned = cleaned.replace(/(\d+)(ST|ND|RD|TH)/g, '$1');

  // Handle DD-MM-YYYY or DD/MM/YYYY
  const ddMmYyyy = cleaned.match(/^(\d{1,2})[-\/](\d{1,2})[-\/](\d{4})/);
  if (ddMmYyyy) {
    const [_, day, month, year] = ddMmYyyy;
    return `${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`;
  }

  // Handle MM/DD/YYYY (check if month is > 12 to distinguish from DD/MM/YYYY)
  const mmDdYyyy = cleaned.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/);
  if (mmDdYyyy) {
    const [_, first, second, year] = mmDdYyyy;
    // If first number > 12, it must be day
    if (parseInt(first) > 12) {
      return `${year}-${second.padStart(2, '0')}-${first.padStart(2, '0')}`;
    } else {
      // Assume MM/DD/YYYY format
      return `${year}-${first.padStart(2, '0')}-${second.padStart(2, '0')}`;
    }
  }

  // Handle DD-Mon format (assume current or next year)
  const dayMonth = cleaned.match(/^(\d{1,2})[-\s]([A-Z]{3})/);
  if (dayMonth) {
    const currentYear = new Date().getFullYear();
    const [_, day, monthAbbr] = dayMonth;

    // Try with current year first
    const dateWithCurrentYear = new Date(`${monthAbbr} ${day}, ${currentYear}`);
    if (!isNaN(dateWithCurrentYear.getTime())) {
      // If date is in the past, use next year
      if (dateWithCurrentYear < new Date()) {
        const nextYear = currentYear + 1;
        const dateWithNextYear = new Date(`${monthAbbr} ${day}, ${nextYear}`);
        if (!isNaN(dateWithNextYear.getTime())) {
          return `${nextYear}-${String(dateWithNextYear.getMonth() + 1).padStart(2, '0')}-${day.padStart(2, '0')}`;
        }
      }
      return `${currentYear}-${String(dateWithCurrentYear.getMonth() + 1).padStart(2, '0')}-${day.padStart(2, '0')}`;
    }
  }

  // Handle dates with time (remove time part)
  const dateWithTime = cleaned.match(/(.+?)\s+\d{1,2}:\d{2}/);
  if (dateWithTime) {
    cleaned = dateWithTime[1].trim();
  }

  // Try standard Date parsing
  try {
    const parsed = new Date(cleaned);

    // Check if valid date
    if (isNaN(parsed.getTime())) {
      return null;
    }

    // Convert to ISO format (YYYY-MM-DD)
    const year = parsed.getFullYear();
    const month = String(parsed.getMonth() + 1).padStart(2, '0');
    const day = String(parsed.getDate()).padStart(2, '0');

    return `${year}-${month}-${day}`;
  } catch (error) {
    console.warn(`Failed to parse date: "${dateString}"`, error);
    return null;
  }
}

console.log('\n=== ENHANCED PARSER TESTING ===\n');

testCases.forEach(dateStr => {
  const result = parseEntityDateEnhanced(dateStr);
  console.log(`"${dateStr}" -> ${result || 'FAILED'}`);
});

// Test more formats
console.log('\n=== ADDITIONAL TEST CASES ===\n');
const additionalTests = [
  "2025-12-30",
  "30-12-2025",
  "12/30/2025",
  "30/12/2025",
  "30-DEC-2025",
  "DEC 30, 2025",
  "DECEMBER 30, 2025",
  "30 DECEMBER 2025",
  "1st January 2026",
  "2nd February 2026",
  "3rd March 2026",
  "4th April 2026",
  "21st December 2025",
];

additionalTests.forEach(dateStr => {
  const result = parseEntityDateEnhanced(dateStr);
  console.log(`"${dateStr}" -> ${result || 'FAILED'}`);
});