function isValidDateString(value: string | undefined): boolean {
  if (!value) return false;

  // Reject values that are too long (dates shouldn't exceed ~30 chars)
  if (value.length > 35) return false;

  // Reject values with obvious non-date keywords
  const garbagePatterns = [
    /Reference/i, /Number/i, /smart/i, /follow/i, /please/i,
    /delay/i, /arrival/i, /vessel/i, /berth/i, /schedule/i,
    /containers?/i, /result/i, /may/i, /change/i,
  ];
  if (garbagePatterns.some(p => p.test(value))) return false;

  // Must contain a REALISTIC year (2020-2030 range)
  const hasRealisticYear = /20(2[0-9]|30)/.test(value);

  // OR must match common date formats
  const dateFormats = [
    /^\d{4}-\d{2}-\d{2}/, // ISO: 2026-01-15
    /^\d{2}[-\/]\d{2}[-\/]\d{4}/, // DD-MM-YYYY
    /^\d{2}[-\/]\d{2}[-\/]\d{2}$/, // DD-MM-YY
    /^\d{1,2}\s+(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)/i, // 15 Jan 2026
    /^(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\s+\d{1,2}/i, // Jan 15, 2026
  ];
  const matchesDateFormat = dateFormats.some(f => f.test(value.trim()));

  return hasRealisticYear || matchesDateFormat;
}

// Test values
const testValues = [
  'smart Reference  Number: CC6404753886',
  'may change depending on vessel berth.',
  '. Any delay or early arrival of containers at the port may result in',
  '2026-01-17',
  'ons — please follow the original schedule.',
  '15 Jan 2026',
  'Jan 15, 2026',
  '2026-01-21T08:30:00',
  '21-01-2026',
];

console.log('=== IMPROVED isValidDateString TESTS ===\n');
testValues.forEach(v => {
  console.log('Value:', v.substring(0, 50));
  console.log('  isValid:', isValidDateString(v));
  console.log('');
});
