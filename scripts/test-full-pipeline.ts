/**
 * Full Pipeline Test - Raw Emails → Classification → Extraction
 *
 * Tests the complete flow:
 * 1. Fetch emails from raw_emails table
 * 2. Classify using Haiku (save to document_classifications)
 * 3. Extract entities using Haiku (save to entity_extractions)
 * 4. Display results in readable format
 */

import dotenv from 'dotenv';
import Anthropic from '@anthropic-ai/sdk';
import { supabase } from '../utils/supabase-client';
import Logger from '../utils/logger';

dotenv.config();

const logger = new Logger('FullPipelineTest');

const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY
});

const HAIKU_MODEL = 'claude-3-5-haiku-20241022';

interface ClassificationResult {
  email_id: string;
  document_type: string;
  confidence_score: number;
  ai_reasoning?: string;
  model_used: string;
  input_tokens: number;
  output_tokens: number;
  processing_time_ms: number;
}

interface ExtractionResult {
  email_id: string;
  entity_type: string;
  entity_value: string;
  confidence_score: number;
  extraction_method: string;
}

class PipelineTester {
  private totalCost = 0;

  /**
   * Classify email using Haiku
   */
  async classifyEmail(email: any): Promise<ClassificationResult | null> {
    const startTime = Date.now();

    const prompt = `You are a shipping document classifier. Analyze this email and classify it.

Email Subject: ${email.subject}
From: ${email.sender_email}
Body: ${email.body_text?.substring(0, 2000) || '(no body)'}

Classify as ONE of these document types:
- booking_confirmation
- si_draft
- vgm_request
- commercial_invoice
- arrival_notice
- house_bl
- amendment
- shipping_instruction
- delivery_order

Return ONLY valid JSON:
{
  "document_type": "type from list above",
  "confidence": 0-100,
  "reasoning": "brief explanation"
}`;

    try {
      const message = await anthropic.messages.create({
        model: HAIKU_MODEL,
        max_tokens: 500,
        temperature: 0.3,
        messages: [{ role: 'user', content: prompt }]
      });

      const processingTime = Date.now() - startTime;
      const textContent = message.content[0];
      const resultText = textContent.type === 'text' ? textContent.text : '';

      const jsonMatch = resultText.match(/\{[\s\S]*\}/);
      if (!jsonMatch) {
        logger.warn('No JSON found in classification response');
        return null;
      }

      const result = JSON.parse(jsonMatch[0]);

      // Calculate cost
      const inputTokens = message.usage.input_tokens;
      const outputTokens = message.usage.output_tokens;
      const cost = (inputTokens / 1_000_000) * 0.80 + (outputTokens / 1_000_000) * 4.00;
      this.totalCost += cost;

      return {
        email_id: email.id,
        document_type: result.document_type,
        confidence_score: result.confidence,
        ai_reasoning: result.reasoning,
        model_used: HAIKU_MODEL,
        input_tokens: inputTokens,
        output_tokens: outputTokens,
        processing_time_ms: processingTime
      };
    } catch (error: any) {
      logger.error(`Classification failed for email ${email.id}`, error);
      return null;
    }
  }

  /**
   * Extract entities using Haiku
   */
  async extractEntities(email: any): Promise<ExtractionResult[]> {
    const prompt = `Extract shipping data from this email. Return ONLY valid JSON.

Email Subject: ${email.subject}
From: ${email.sender_email}
Body: ${email.body_text?.substring(0, 3000) || '(no body)'}

Extract these fields (use null if not found):
{
  "booking_number": "string or null",
  "bl_number": "string or null",
  "container_numbers": ["array or empty"],
  "vessel_name": "string or null",
  "voyage_number": "string or null",
  "port_of_loading": "string or null",
  "port_of_discharge": "string or null",
  "etd": "YYYY-MM-DD or null",
  "eta": "YYYY-MM-DD or null",
  "shipper_name": "string or null",
  "consignee_name": "string or null",
  "commodity": "string or null",
  "confidence": 0-100
}`;

    try {
      const message = await anthropic.messages.create({
        model: HAIKU_MODEL,
        max_tokens: 1500,
        temperature: 0.2,
        messages: [{ role: 'user', content: prompt }]
      });

      const textContent = message.content[0];
      const resultText = textContent.type === 'text' ? textContent.text : '';

      const jsonMatch = resultText.match(/\{[\s\S]*\}/);
      if (!jsonMatch) {
        logger.warn('No JSON found in extraction response');
        return [];
      }

      const extracted = JSON.parse(jsonMatch[0]);

      // Calculate cost
      const inputTokens = message.usage.input_tokens;
      const outputTokens = message.usage.output_tokens;
      const cost = (inputTokens / 1_000_000) * 0.80 + (outputTokens / 1_000_000) * 4.00;
      this.totalCost += cost;

      // Convert to entity_extractions format
      const entities: ExtractionResult[] = [];
      const confidence = extracted.confidence || 0;

      // Map each field to an entity
      const fieldMapping: Record<string, string> = {
        booking_number: 'booking_number',
        bl_number: 'bl_number',
        vessel_name: 'vessel_name',
        voyage_number: 'voyage_number',
        port_of_loading: 'port_of_loading',
        port_of_discharge: 'port_of_discharge',
        etd: 'estimated_departure_date',
        eta: 'estimated_arrival_date',
        shipper_name: 'shipper_name',
        consignee_name: 'consignee_name',
        commodity: 'commodity'
      };

      for (const [extractedField, entityType] of Object.entries(fieldMapping)) {
        let value = extracted[extractedField];

        // Handle container numbers array
        if (extractedField === 'container_numbers' && extracted.container_numbers) {
          for (const container of extracted.container_numbers) {
            if (container) {
              entities.push({
                email_id: email.id,
                entity_type: 'container_number',
                entity_value: container,
                confidence_score: confidence,
                extraction_method: 'ai_extraction'
              });
            }
          }
          continue;
        }

        if (value !== null && value !== undefined && value !== '') {
          entities.push({
            email_id: email.id,
            entity_type: entityType,
            entity_value: String(value),
            confidence_score: confidence,
            extraction_method: 'ai_extraction'
          });
        }
      }

      return entities;
    } catch (error: any) {
      logger.error(`Extraction failed for email ${email.id}`, error);
      return [];
    }
  }

  /**
   * Save classification to database
   */
  async saveClassification(classification: ClassificationResult): Promise<void> {
    const { error } = await supabase
      .from('document_classifications')
      .insert({
        email_id: classification.email_id,
        document_type: classification.document_type,
        confidence_score: classification.confidence_score,
        model_name: 'claude-3-5-haiku',
        model_version: '20241022',
        classification_reason: classification.ai_reasoning,
        matched_patterns: {
          input_tokens: classification.input_tokens,
          output_tokens: classification.output_tokens,
          processing_time_ms: classification.processing_time_ms
        }
      });

    if (error) {
      logger.error(`Failed to save classification for ${classification.email_id}`, error);
    }
  }

  /**
   * Save extractions to database
   */
  async saveExtractions(extractions: ExtractionResult[]): Promise<void> {
    if (extractions.length === 0) return;

    const { error } = await supabase
      .from('entity_extractions')
      .insert(extractions);

    if (error) {
      logger.error(`Failed to save extractions`, error);
    }
  }

  /**
   * Display results in readable format
   */
  displayResults(
    email: any,
    classification: ClassificationResult | null,
    extractions: ExtractionResult[]
  ): void {
    console.log('\n' + '═'.repeat(100));
    console.log(`📧 EMAIL: ${email.subject.substring(0, 80)}`);
    console.log('═'.repeat(100));

    console.log(`\n📋 RAW EMAIL DATA (from raw_emails table):`);
    console.log(`   ID: ${email.id}`);
    console.log(`   From: ${email.sender_email}`);
    console.log(`   Subject: ${email.subject}`);
    console.log(`   Received: ${new Date(email.received_at).toLocaleString()}`);
    console.log(`   Body Length: ${email.body_text?.length || 0} chars`);

    if (classification) {
      console.log(`\n🏷️  CLASSIFICATION (saved to document_classifications table):`);
      console.log(`   Document Type: ${classification.document_type}`);
      console.log(`   Confidence: ${classification.confidence_score}%`);
      console.log(`   Reasoning: ${classification.ai_reasoning}`);
      console.log(`   Processing Time: ${classification.processing_time_ms}ms`);
      console.log(`   Tokens: ${classification.input_tokens} in / ${classification.output_tokens} out`);
    }

    if (extractions.length > 0) {
      console.log(`\n📊 EXTRACTED ENTITIES (saved to entity_extractions table):`);
      extractions.forEach((entity, idx) => {
        console.log(`   ${idx + 1}. ${entity.entity_type}: ${entity.entity_value} (${entity.confidence_score}% confidence)`);
      });
    } else {
      console.log(`\n📊 EXTRACTED ENTITIES: None found`);
    }

    console.log('\n');
  }

  /**
   * Run full pipeline test
   */
  async runPipelineTest(emailLimit: number = 10): Promise<void> {
    console.log('\n');
    console.log('╔════════════════════════════════════════════════════════════════════════════════════════════════╗');
    console.log('║                          FULL PIPELINE TEST - RAW → CLASSIFICATION → EXTRACTION                ║');
    console.log('╚════════════════════════════════════════════════════════════════════════════════════════════════╝');
    console.log('');

    logger.info(`Fetching ${emailLimit} emails from raw_emails table...`);

    // Fetch emails from database
    const { data: emails, error } = await supabase
      .from('raw_emails')
      .select('*')
      .order('received_at', { ascending: false })
      .limit(emailLimit);

    if (error || !emails || emails.length === 0) {
      logger.error('Failed to fetch emails', error);
      return;
    }

    logger.info(`Processing ${emails.length} emails through the pipeline...\n`);

    let processedCount = 0;
    let classifiedCount = 0;
    let extractedCount = 0;

    for (const email of emails) {
      // Classify
      const classification = await this.classifyEmail(email);
      if (classification) {
        await this.saveClassification(classification);
        classifiedCount++;
      }

      // Extract entities
      const extractions = await this.extractEntities(email);
      if (extractions.length > 0) {
        await this.saveExtractions(extractions);
        extractedCount += extractions.length;
      }

      // Display results
      this.displayResults(email, classification, extractions);

      processedCount++;

      // Small delay to respect rate limits
      await this.sleep(500);
    }

    // Final summary
    console.log('╔════════════════════════════════════════════════════════════════════════════════════════════════╗');
    console.log('║                                       PIPELINE TEST SUMMARY                                     ║');
    console.log('╚════════════════════════════════════════════════════════════════════════════════════════════════╝');
    console.log('');
    console.log(`📧 Emails Processed:           ${processedCount}`);
    console.log(`🏷️  Classifications Saved:     ${classifiedCount}`);
    console.log(`📊 Entities Extracted:         ${extractedCount}`);
    console.log(`💰 Total Cost:                 $${this.totalCost.toFixed(4)}`);
    console.log(`📈 Cost per Email:             $${(this.totalCost / processedCount).toFixed(6)}`);
    console.log(`📈 Cost per 1,000 Emails:      $${((this.totalCost / processedCount) * 1000).toFixed(2)}`);
    console.log(`📈 Annual Cost (60K emails):   $${((this.totalCost / processedCount) * 60000).toFixed(2)}`);
    console.log('');
    console.log('✅ Pipeline test completed successfully!');
    console.log('');
    console.log('📂 Data saved to:');
    console.log('   - document_classifications table');
    console.log('   - entity_extractions table');
    console.log('');
  }

  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}

// Run the test
async function main() {
  const tester = new PipelineTester();

  // Get email limit from command line argument or default to 10
  const emailLimit = parseInt(process.argv[2]) || 10;

  await tester.runPipelineTest(emailLimit);
}

main().catch(error => {
  console.error('Pipeline test failed:', error);
  process.exit(1);
});
