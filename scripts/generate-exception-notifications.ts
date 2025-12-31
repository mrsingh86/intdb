#!/usr/bin/env npx tsx
/**
 * Generate Notifications for Exception-Type Emails Only
 *
 * NOTIFICATIONS are for exceptions that require attention:
 * - Advisories (rate changes, cut-off changes)
 * - Rollovers
 * - Vessel delays/changes
 * - Port congestion
 * - Detention/demurrage alerts
 * - Customs holds
 *
 * NOT for regular documents like:
 * - Arrival notices
 * - Booking confirmations
 * - Bills of lading
 */

import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !supabaseKey) {
  console.error('Missing SUPABASE_URL or SUPABASE_SERVICE_KEY');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey);

// Exception patterns to detect
const EXCEPTION_PATTERNS = [
  { pattern: /\brollover\b/i, type: 'rollover', priority: 'critical' },
  { pattern: /\brolled\s*(over)?\b/i, type: 'rollover', priority: 'critical' },
  { pattern: /\badvisory\b/i, type: 'advisory', priority: 'high' },
  { pattern: /\brate\s*(increase|restoration|change)\b/i, type: 'rate_increase', priority: 'high' },
  { pattern: /\bGRI\b/, type: 'rate_increase', priority: 'high' },
  { pattern: /\bgeneral\s*rate\b/i, type: 'rate_increase', priority: 'high' },
  { pattern: /\bcongestion\b/i, type: 'port_congestion', priority: 'medium' },
  { pattern: /\bvessel\s*(delay|change|omission)\b/i, type: 'vessel_delay', priority: 'high' },
  { pattern: /\bdetention\b/i, type: 'detention_alert', priority: 'high' },
  { pattern: /\bdemurrage\b/i, type: 'detention_alert', priority: 'high' },
  { pattern: /\bcustoms\s*hold\b/i, type: 'customs_hold', priority: 'critical' },
  { pattern: /\bequipment\s*(shortage|unavailable)\b/i, type: 'equipment_shortage', priority: 'medium' },
  { pattern: /\bcut[\s-]*off\s*(change|revised|update)\b/i, type: 'deadline_change', priority: 'high' },
  { pattern: /\brevised\s*cut[\s-]*off\b/i, type: 'deadline_change', priority: 'high' },
];

// Exclude patterns (regular documents, not exceptions)
const EXCLUDE_PATTERNS = [
  /\barrival\s*notice\b/i,
  /\bbooking\s*confirmation\b/i,
  /\bbill\s*of\s*lading\b/i,
  /\bcommercial\s*invoice\b/i,
  /\bpacking\s*list\b/i,
];

function classifyException(subject: string, bodyText?: string): { type: string; priority: string } | null {
  const text = `${subject} ${bodyText || ''}`.toLowerCase();

  // Check exclusions first
  for (const pattern of EXCLUDE_PATTERNS) {
    if (pattern.test(subject)) {
      return null;
    }
  }

  // Check exception patterns
  for (const { pattern, type, priority } of EXCEPTION_PATTERNS) {
    if (pattern.test(subject) || pattern.test(text)) {
      return { type, priority };
    }
  }

  return null;
}

async function generateExceptionNotifications() {
  console.log('=== GENERATING EXCEPTION NOTIFICATIONS ===\n');

  // Get existing notification email_ids
  const { data: existingNotifs } = await supabase
    .from('notifications')
    .select('email_id');

  const existingEmailIds = new Set(existingNotifs?.map(n => n.email_id) || []);
  console.log('Existing notifications:', existingEmailIds.size);

  // Get all emails
  const { data: emails, error } = await supabase
    .from('raw_emails')
    .select('id, subject, body_text, received_at');

  if (error) {
    console.error('Error fetching emails:', error);
    return;
  }

  console.log('Total emails to scan:', emails?.length);

  // Find exception emails
  const exceptions: any[] = [];

  for (const email of emails || []) {
    // Skip if already has notification
    if (existingEmailIds.has(email.id)) continue;

    const classification = classifyException(email.subject || '', email.body_text);
    if (classification) {
      exceptions.push({
        email_id: email.id,
        notification_type: classification.type,
        title: email.subject?.substring(0, 500) || 'Exception Alert',
        summary: email.body_text?.substring(0, 200) || email.subject || 'No summary',
        priority: classification.priority,
        status: 'unread',
        received_at: email.received_at,
      });
    }
  }

  console.log('Exception emails found:', exceptions.length);

  // Group by type for display
  const byType: Record<string, number> = {};
  exceptions.forEach(e => {
    byType[e.notification_type] = (byType[e.notification_type] || 0) + 1;
  });

  console.log('\nBy exception type:');
  Object.entries(byType).forEach(([type, count]) => {
    console.log(`  ${type}: ${count}`);
  });

  // Insert notifications
  if (exceptions.length > 0) {
    const { data, error: insertError } = await supabase
      .from('notifications')
      .insert(exceptions)
      .select();

    if (insertError) {
      console.error('Insert error:', insertError.message);

      // Try inserting one by one for partial success
      let inserted = 0;
      for (const notif of exceptions) {
        const { error: singleError } = await supabase
          .from('notifications')
          .insert(notif);
        if (!singleError) inserted++;
      }
      console.log('Inserted (individually):', inserted);
    } else {
      console.log('\nNotifications created:', data?.length);
    }
  }

  // Final count
  const { count } = await supabase
    .from('notifications')
    .select('*', { count: 'exact', head: true });

  console.log('\nTotal notifications now:', count);
}

generateExceptionNotifications().catch(console.error);
