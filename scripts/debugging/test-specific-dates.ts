import { parseEntityDate } from '../lib/utils/date-parser';

// Test the problematic dates
const testCases = [
  "20TH DECEMBER, 2025",
  "24-December-2025",
  "5th Jan",
  "24/12/2025",
  "30/12/2025 11:00 PM",
  "30/12/2025 02:00 AM",
];

console.log('Testing date parsing:\n');

testCases.forEach(date => {
  const result = parseEntityDate(date);
  console.log(`"${date}" -> ${result}`);
});