/**
 * Fix actions that have has_action=true but no action_description
 *
 * Problem: 14,652 actions flagged but only 71% have descriptions, only 3% have deadlines
 * Solution: Use AI to extract action details from the email content
 */
import * as dotenv from 'dotenv';
dotenv.config({ path: '.env' });
dotenv.config({ path: '.env.local' });

import { createClient } from '@supabase/supabase-js';
import Anthropic from '@anthropic-ai/sdk';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || '';
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || '';
const supabase = createClient(supabaseUrl, supabaseKey);

const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY,
});

interface ActionExtraction {
  action_description: string;
  action_deadline: string | null;
  action_priority: 'low' | 'medium' | 'high' | 'critical';
}

async function extractActionFromContent(subject: string, summary: string | null, bodyPreview: string | null): Promise<ActionExtraction | null> {
  const content = `Subject: ${subject}\n\nSummary: ${summary || 'N/A'}\n\nBody: ${bodyPreview?.slice(0, 2000) || 'N/A'}`;

  try {
    const response = await anthropic.messages.create({
      model: 'claude-3-5-haiku-20241022',
      max_tokens: 300,
      messages: [
        {
          role: 'user',
          content: `Extract the action required from this shipping email. Be specific about what needs to be done.

${content}

Return JSON only:
{
  "action_description": "Brief action required (e.g., 'Submit VGM declaration', 'Confirm SI details', 'Provide cargo manifest')",
  "action_deadline": "YYYY-MM-DD if mentioned, null otherwise",
  "action_priority": "low|medium|high|critical based on urgency"
}`,
        },
      ],
    });

    const text = response.content[0].type === 'text' ? response.content[0].text : '';
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) return null;

    const parsed = JSON.parse(jsonMatch[0]);
    return {
      action_description: parsed.action_description || null,
      action_deadline: parsed.action_deadline || null,
      action_priority: parsed.action_priority || 'medium',
    };
  } catch (error) {
    console.log('  AI extraction error:', (error as Error).message);
    return null;
  }
}

async function fixActionsWithoutDescriptions() {
  console.log('=== FIXING ACTIONS WITHOUT DESCRIPTIONS ===\n');

  // Get actions that have has_action=true but no description using PostgREST syntax
  const { data: badActions, error: queryError } = await supabase
    .from('chronicle')
    .select('id, subject, summary, body_preview, document_type')
    .eq('has_action', true)
    .is('action_description', null)
    .order('created_at', { ascending: false })
    .limit(100);

  if (queryError) {
    console.log('Query error:', queryError);
    return;
  }

  const count = badActions?.length || 0;
  console.log(`Found ${count} actions to process\n`);

  let fixed = 0;
  let failed = 0;

  for (const action of badActions || []) {
    // Skip if no subject
    if (!action.subject) {
      failed++;
      continue;
    }

    console.log(`  Processing: ${action.subject?.slice(0, 50)}...`);

    const extraction = await extractActionFromContent(
      action.subject,
      action.summary,
      action.body_preview
    );

    if (!extraction || !extraction.action_description) {
      // If can't extract action, mark has_action as false
      await supabase
        .from('chronicle')
        .update({ has_action: false })
        .eq('id', action.id);
      console.log('    → Marked as no action');
      failed++;
      continue;
    }

    // Update with extracted action
    const { error } = await supabase
      .from('chronicle')
      .update({
        action_description: extraction.action_description,
        action_deadline: extraction.action_deadline,
        action_priority: extraction.action_priority,
      })
      .eq('id', action.id);

    if (error) {
      console.log(`    Error: ${error.message}`);
      failed++;
    } else {
      console.log(`    → ${extraction.action_description.slice(0, 40)}...`);
      fixed++;
    }

    // Small delay to avoid rate limiting
    await new Promise((resolve) => setTimeout(resolve, 200));
  }

  console.log(`\n=== SUMMARY ===`);
  console.log(`Fixed: ${fixed} actions`);
  console.log(`Failed/No action: ${failed} entries`);
}

fixActionsWithoutDescriptions().catch(console.error);
