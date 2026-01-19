# Scripts

Development and debugging scripts. Not part of production code.

## Directories

### `/analysis/`
Data analysis scripts for understanding email processing results.
```bash
npx ts-node scripts/analysis/analyze-emails.ts
npx ts-node scripts/analysis/analyze-extractions.ts
```

### `/debugging/`
Debug and verification scripts for troubleshooting.
```bash
npx ts-node scripts/debugging/check-schema.ts
npx ts-node scripts/debugging/debug-gmail-fetch.ts
```

### `/reports/`
Report generation scripts.
```bash
npx ts-node scripts/reports/generate-extraction-report.ts
```

## Running Scripts

Most scripts require environment variables from `.env.local`:
```bash
# Load env and run
npx ts-node -r dotenv/config scripts/analysis/analyze-emails.ts
```
