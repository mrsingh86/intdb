import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const pdfParse = require('pdf-parse');

console.log('Type:', typeof pdfParse);
console.log('Keys:', Object.keys(pdfParse));
console.log('Default:', typeof pdfParse.default);
console.log('Is callable:', typeof pdfParse === 'function');
console.log('Value:', pdfParse);
