/**
 * Test script for UnifiedActionService
 * Run: npx tsx scripts/debugging/test-unified-action-service.ts
 */

import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';
import { resolve } from 'path';

dotenv.config({ path: resolve(process.cwd(), '.env') });

const supabase = createClient(
  process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || '',
  process.env.SUPABASE_SERVICE_ROLE_KEY || ''
);

// Inline the service for testing (avoids module resolution issues)
class UnifiedActionService {
  private ruleCache: Map<string, any> = new Map();
  private cacheExpiry: number = 0;
  private readonly CACHE_TTL_MS = 5 * 60 * 1000;

  constructor(private readonly db: any) {}

  async getRecommendation(
    documentType: string,
    fromParty: string,
    isReply: boolean,
    subject: string,
    body: string,
    emailDate: Date,
    shipmentContext?: any
  ) {
    await this.ensureCacheLoaded();
    const rule = this.findRule(documentType, fromParty, isReply);

    if (!rule) {
      return this.createFallbackRecommendation(documentType, fromParty);
    }

    const { hasAction, wasFlipped, flipKeyword } = this.applyFlipKeywords(rule, subject, body);
    const { priority, priorityLabel } = this.calculatePriority(rule, subject, body);
    const { deadline, deadlineSource } = this.calculateDeadline(rule, emailDate, shipmentContext);

    return {
      hasAction,
      wasFlipped,
      flipKeyword,
      actionType: hasAction ? rule.action_type : null,
      actionVerb: hasAction ? rule.action_verb : null,
      actionDescription: hasAction ? rule.action_description : null,
      toParty: hasAction ? rule.to_party : null,
      owner: rule.action_owner || 'operations',
      priority,
      priorityLabel,
      urgency: rule.urgency || 'normal',
      deadline,
      deadlineSource,
      autoResolveOn: rule.auto_resolve_on || [],
      autoResolveKeywords: rule.auto_resolve_keywords || [],
      requiresResponse: rule.requires_response,
      confidence: rule.confidence,
      source: wasFlipped ? 'rule_flipped' : 'rule',
      ruleId: rule.id,
    };
  }

  private findRule(documentType: string, fromParty: string, isReply: boolean) {
    const exactKey = `${documentType}|${fromParty}|${isReply}`;
    if (this.ruleCache.has(exactKey)) return this.ruleCache.get(exactKey);

    const withoutReplyKey = `${documentType}|${fromParty}|false`;
    if (this.ruleCache.has(withoutReplyKey)) return this.ruleCache.get(withoutReplyKey);

    const unknownKey = `${documentType}|unknown|false`;
    if (this.ruleCache.has(unknownKey)) return this.ruleCache.get(unknownKey);

    return null;
  }

  private applyFlipKeywords(rule: any, subject: string, body: string) {
    const searchText = `${subject} ${body}`.toLowerCase();
    let hasAction = rule.has_action;
    let wasFlipped = false;
    let flipKeyword: string | null = null;

    if (!hasAction && rule.flip_to_action_keywords?.length) {
      for (const kw of rule.flip_to_action_keywords) {
        if (searchText.includes(kw.toLowerCase())) {
          hasAction = true; wasFlipped = true; flipKeyword = kw; break;
        }
      }
    }

    if (hasAction && !wasFlipped && rule.flip_to_no_action_keywords?.length) {
      for (const kw of rule.flip_to_no_action_keywords) {
        if (searchText.includes(kw.toLowerCase())) {
          hasAction = false; wasFlipped = true; flipKeyword = kw; break;
        }
      }
    }

    return { hasAction, wasFlipped, flipKeyword };
  }

  private calculatePriority(rule: any, subject: string, body: string) {
    let priority = rule.priority_base || 60;
    const searchText = `${subject} ${body}`.toLowerCase();

    if (rule.priority_boost_keywords?.length) {
      if (rule.priority_boost_keywords.some((kw: string) => searchText.includes(kw.toLowerCase()))) {
        priority += rule.priority_boost_amount || 10;
      }
    }

    const urgentTerms = ['urgent', 'asap', 'immediately', 'critical'];
    if (urgentTerms.some(term => searchText.includes(term))) priority += 15;

    if (rule.urgency === 'critical') priority += 20;
    else if (rule.urgency === 'high') priority += 10;

    priority = Math.min(priority, 100);

    let priorityLabel: string;
    if (priority >= 85) priorityLabel = 'URGENT';
    else if (priority >= 70) priorityLabel = 'HIGH';
    else if (priority >= 50) priorityLabel = 'MEDIUM';
    else priorityLabel = 'LOW';

    return { priority, priorityLabel };
  }

  private calculateDeadline(rule: any, emailDate: Date, context?: any) {
    if (!rule.deadline_type) return { deadline: null, deadlineSource: null };

    if (rule.deadline_type === 'fixed_days' && rule.deadline_days) {
      const deadline = new Date(emailDate);
      deadline.setDate(deadline.getDate() + rule.deadline_days);
      return { deadline, deadlineSource: `${rule.deadline_days} day(s) from receipt` };
    }

    if (rule.deadline_type === 'urgent') {
      const deadline = new Date(emailDate);
      deadline.setDate(deadline.getDate() + 1);
      return { deadline, deadlineSource: 'Urgent - within 24 hours' };
    }

    return { deadline: null, deadlineSource: null };
  }

  private createFallbackRecommendation(documentType: string, fromParty: string) {
    const noActionTypes = ['tracking_update', 'acknowledgement', 'notification', 'booking_confirmation', 'vgm_confirmation', 'si_confirmation'];
    const hasAction = !noActionTypes.some(t => documentType.includes(t));

    return {
      hasAction,
      wasFlipped: false,
      flipKeyword: null,
      actionType: hasAction ? 'review' : null,
      actionVerb: hasAction ? 'Review' : null,
      actionDescription: hasAction ? `Review ${documentType.replace(/_/g, ' ')} from ${fromParty}` : null,
      toParty: null,
      owner: 'operations',
      priority: 50,
      priorityLabel: 'MEDIUM',
      urgency: 'normal',
      deadline: null,
      deadlineSource: null,
      autoResolveOn: [],
      autoResolveKeywords: [],
      requiresResponse: false,
      confidence: 50,
      source: 'fallback',
      ruleId: null,
    };
  }

  private async ensureCacheLoaded() {
    if (Date.now() < this.cacheExpiry && this.ruleCache.size > 0) return;

    const { data: rules, error } = await this.db
      .from('action_rules')
      .select('*')
      .eq('enabled', true);

    if (error) {
      console.error('Failed to load rules:', error.message);
      return;
    }

    this.ruleCache.clear();
    for (const rule of rules || []) {
      const key = `${rule.document_type}|${rule.from_party}|${rule.is_reply}`;
      this.ruleCache.set(key, rule);
    }

    this.cacheExpiry = Date.now() + this.CACHE_TTL_MS;
    console.log(`[UnifiedActionService] Loaded ${this.ruleCache.size} action rules`);
  }

  getCacheStats() {
    return { size: this.ruleCache.size, expiresIn: Math.max(0, this.cacheExpiry - Date.now()) };
  }
}

async function testService() {
  const service = new UnifiedActionService(supabase);

  console.log('\n========================================');
  console.log('UNIFIED ACTION SERVICE TEST');
  console.log('========================================\n');

  // Test cases
  const testCases = [
    { docType: 'draft_bl', fromParty: 'ocean_carrier', subject: 'Draft BL for review', body: 'Please review attached draft BL' },
    { docType: 'vgm_request', fromParty: 'ocean_carrier', subject: 'VGM Required URGENT', body: 'Submit VGM before cutoff' },
    { docType: 'si_request', fromParty: 'ocean_carrier', subject: 'SI Required', body: 'Please submit shipping instructions' },
    { docType: 'booking_confirmation', fromParty: 'ocean_carrier', subject: 'Booking Confirmed', body: 'Your booking has been confirmed' },
    { docType: 'arrival_notice', fromParty: 'nvocc', subject: 'Arrival Notice', body: 'Vessel arriving soon' },
    { docType: 'invoice', fromParty: 'ocean_carrier', subject: 'Invoice for freight charges', body: 'Please pay within 7 days' },
    { docType: 'checklist', fromParty: 'customs_broker', subject: 'Documents Required', body: 'Please provide the following documents' },
    { docType: 'unknown_type', fromParty: 'unknown', subject: 'Random email', body: 'Some content' },
  ];

  for (const tc of testCases) {
    console.log(`\n--- ${tc.docType} from ${tc.fromParty} ---`);

    const result = await service.getRecommendation(
      tc.docType,
      tc.fromParty,
      false, // isReply
      tc.subject,
      tc.body,
      new Date(),
      undefined // no shipment context
    );

    console.log(`  Has Action: ${result.hasAction ? '✅ YES' : '❌ NO'}`);
    if (result.hasAction) {
      console.log(`  Action: ${result.actionVerb} - ${result.actionDescription}`);
      console.log(`  Owner: ${result.owner}`);
      console.log(`  Priority: ${result.priorityLabel} (${result.priority})`);
      console.log(`  Urgency: ${result.urgency}`);
      if (result.deadline) {
        console.log(`  Deadline: ${result.deadline.toISOString().split('T')[0]} (${result.deadlineSource})`);
      }
      if (result.autoResolveOn.length > 0) {
        console.log(`  Auto-resolves on: ${result.autoResolveOn.join(', ')}`);
      }
    }
    console.log(`  Source: ${result.source} (confidence: ${result.confidence}%)`);
    if (result.wasFlipped) {
      console.log(`  ⚡ Flipped by keyword: "${result.flipKeyword}"`);
    }
  }

  // Test flip keywords
  console.log('\n\n========================================');
  console.log('FLIP KEYWORD TESTS');
  console.log('========================================');

  // Test that "confirmed" in body flips action to no
  const flipTest1 = await service.getRecommendation(
    'booking_amendment',
    'customer',
    false,
    'Booking Amendment Request',
    'This amendment has been confirmed and processed.',
    new Date()
  );
  console.log(`\n--- booking_amendment with "confirmed" in body ---`);
  console.log(`  Has Action: ${flipTest1.hasAction ? '✅ YES' : '❌ NO'}`);
  console.log(`  Was Flipped: ${flipTest1.wasFlipped ? '⚡ YES' : 'NO'}`);
  if (flipTest1.flipKeyword) console.log(`  Flip Keyword: "${flipTest1.flipKeyword}"`);

  // Cache stats
  console.log('\n\n========================================');
  console.log('CACHE STATS');
  console.log('========================================');
  const stats = service.getCacheStats();
  console.log(`  Rules cached: ${stats.size}`);
  console.log(`  Cache expires in: ${Math.round(stats.expiresIn / 1000)}s`);

  console.log('\n✅ Test completed!\n');
}

testService().catch(console.error);
