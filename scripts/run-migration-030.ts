#!/usr/bin/env npx tsx
/**
 * Run Migration 030: Fix Workflow Trigger
 *
 * Fixes the workflow journey trigger to handle NULL values properly
 * and adds a reset function for backfill operations.
 */

import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';
import * as fs from 'fs';
import * as path from 'path';

dotenv.config({ path: '.env' });

const supabaseUrl = process.env.SUPABASE_URL!;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;

const supabase = createClient(supabaseUrl, supabaseKey);

async function runMigration() {
  console.log('');
  console.log('═══════════════════════════════════════════════════════════════════════════════');
  console.log('MIGRATION 030: Fix Workflow Trigger for NULL handling');
  console.log('═══════════════════════════════════════════════════════════════════════════════');
  console.log('');

  // Read the migration file
  const migrationPath = path.join(__dirname, '..', 'database', 'migrations', '030_fix_workflow_trigger.sql');
  const sql = fs.readFileSync(migrationPath, 'utf-8');

  console.log('Migration SQL:');
  console.log('─'.repeat(60));
  console.log(sql);
  console.log('─'.repeat(60));
  console.log('');
  console.log('⚠️  Please run this SQL in Supabase Dashboard SQL Editor:');
  console.log('   https://supabase.com/dashboard/project/fdmcdbvkfdmrdowfjrcz/sql');
  console.log('');

  // Copy to clipboard if pbcopy is available
  try {
    const { execSync } = require('child_process');
    execSync('pbcopy', { input: sql });
    console.log('✅ SQL copied to clipboard!');
    console.log('');
  } catch (e) {
    // pbcopy not available
  }

  console.log('After running the migration, you can run:');
  console.log('   npx tsx scripts/backfill-workflow-states.ts');
  console.log('');
}

runMigration().catch(console.error);
