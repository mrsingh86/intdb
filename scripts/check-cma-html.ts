#!/usr/bin/env npx tsx
/**
 * Check CMA CGM email HTML content
 */

import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !supabaseKey) {
  throw new Error('Missing required environment variables');
}

const supabase = createClient(supabaseUrl, supabaseKey);

async function main() {
  // Get CMA CGM booking confirmation email for AMC2475813
  const { data: email } = await supabase
    .from('raw_emails')
    .select('subject, body_html')
    .ilike('subject', '%CMA CGM - Booking confirmation%AMC2475%')
    .single();

  if (!email) {
    console.log('Email not found');
    return;
  }

  console.log('Subject:', email.subject);
  console.log('\n═══ EXTRACTED TEXT FROM HTML ═══\n');

  // Extract meaningful text from HTML
  const html = email.body_html || '';

  // Remove style and script tags
  let clean = html
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
    .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '');

  // Replace common elements with newlines
  clean = clean
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/p>/gi, '\n\n')
    .replace(/<\/div>/gi, '\n')
    .replace(/<\/tr>/gi, '\n')
    .replace(/<\/td>/gi, ' | ')
    .replace(/<\/th>/gi, ' | ');

  // Remove remaining tags
  clean = clean.replace(/<[^>]+>/g, '');

  // Decode HTML entities
  clean = clean
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");

  // Clean up whitespace
  clean = clean
    .split('\n')
    .map(line => line.trim())
    .filter(line => line.length > 0)
    .join('\n');

  console.log(clean);

  // Also look for links
  console.log('\n═══ LINKS IN EMAIL ═══\n');
  const linkMatches = html.matchAll(/href="([^"]+)"/gi);
  for (const match of linkMatches) {
    const url = match[1];
    if (url.includes('cma-cgm') || url.includes('pdf') || url.includes('document')) {
      console.log(url.substring(0, 150));
    }
  }
}

main().catch(console.error);
