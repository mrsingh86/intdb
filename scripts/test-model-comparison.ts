/**
 * Model Comparison Test Script
 *
 * Tests Claude Haiku, Sonnet, and Opus on email classification and extraction
 * to determine the best cost/quality balance.
 *
 * Test phases:
 * 1. Classification accuracy (document type)
 * 2. Entity extraction quality (booking numbers, dates, parties)
 * 3. Cost comparison per 1,000 emails
 */

import dotenv from 'dotenv';
import Anthropic from '@anthropic-ai/sdk';
import { supabase } from '../utils/supabase-client';
import Logger from '../utils/logger';

dotenv.config();

const logger = new Logger('ModelComparison');

interface TestResult {
  model: string;
  taskType: 'classification' | 'extraction';
  emailId: string;
  subject: string;
  inputTokens: number;
  outputTokens: number;
  cost: number;
  processingTime: number;
  result: any;
  accuracy?: number;
}

interface ModelPricing {
  inputPerMillion: number;
  outputPerMillion: number;
}

const MODEL_PRICING: Record<string, ModelPricing> = {
  'claude-3-5-haiku-20241022': {
    inputPerMillion: 0.80,
    outputPerMillion: 4.00
  },
  'claude-3-5-sonnet-20241022': {
    inputPerMillion: 3.00,
    outputPerMillion: 15.00
  },
  'claude-3-5-sonnet-20240620': {
    inputPerMillion: 3.00,
    outputPerMillion: 15.00
  },
  'claude-3-opus-20240229': {
    inputPerMillion: 15.00,
    outputPerMillion: 75.00
  }
};

const MODELS = [
  'claude-3-5-haiku-20241022',
  'claude-3-5-sonnet-20240620',  // Sonnet 3.5 (stable version)
  // 'claude-3-opus-20240229' // Commented out to save cost - only test if needed
];

class ModelTester {
  private anthropic: Anthropic;
  private results: TestResult[] = [];

  constructor() {
    this.anthropic = new Anthropic({
      apiKey: process.env.ANTHROPIC_API_KEY
    });
  }

  /**
   * Calculate cost for API call
   */
  private calculateCost(
    model: string,
    inputTokens: number,
    outputTokens: number
  ): number {
    const pricing = MODEL_PRICING[model];
    if (!pricing) {
      throw new Error(`Unknown model pricing: ${model}`);
    }

    const inputCost = (inputTokens / 1_000_000) * pricing.inputPerMillion;
    const outputCost = (outputTokens / 1_000_000) * pricing.outputPerMillion;

    return inputCost + outputCost;
  }

  /**
   * Test classification accuracy
   */
  async testClassification(
    model: string,
    email: any
  ): Promise<TestResult> {
    const startTime = Date.now();

    const prompt = `You are a shipping document classifier. Classify this email as one of the following document types:
- booking_confirmation
- si_draft
- vgm_request
- commercial_invoice
- arrival_notice
- house_bl
- amendment

Email Subject: ${email.subject}
From: ${email.sender_email}
Body: ${email.body_text?.substring(0, 2000) || '(no body)'}

Return ONLY a JSON object with this exact format:
{
  "document_type": "one of the types above",
  "confidence": 0-100,
  "reasoning": "brief explanation"
}`;

    try {
      const message = await this.anthropic.messages.create({
        model: model,
        max_tokens: 500,
        temperature: 0.3,
        messages: [{
          role: 'user',
          content: prompt
        }]
      });

      const processingTime = Date.now() - startTime;
      const textContent = message.content[0];
      const resultText = textContent.type === 'text' ? textContent.text : '';

      // Extract JSON from response (may have markdown code blocks)
      const jsonMatch = resultText.match(/\{[\s\S]*\}/);
      const result = jsonMatch ? JSON.parse(jsonMatch[0]) : null;

      const inputTokens = message.usage.input_tokens;
      const outputTokens = message.usage.output_tokens;
      const cost = this.calculateCost(model, inputTokens, outputTokens);

      return {
        model,
        taskType: 'classification',
        emailId: email.id,
        subject: email.subject,
        inputTokens,
        outputTokens,
        cost,
        processingTime,
        result
      };
    } catch (error: any) {
      logger.error(`Classification failed for model ${model}`, error);
      throw error;
    }
  }

  /**
   * Test entity extraction quality
   */
  async testExtraction(
    model: string,
    email: any
  ): Promise<TestResult> {
    const startTime = Date.now();

    const prompt = `You are a shipping data extraction expert. Extract the following information from this email:

Email Subject: ${email.subject}
From: ${email.sender_email}
Body: ${email.body_text?.substring(0, 3000) || '(no body)'}

Extract and return ONLY a JSON object with these fields (use null if not found):
{
  "booking_number": "string or null",
  "bl_number": "string or null",
  "container_numbers": ["array of strings or empty"],
  "vessel_name": "string or null",
  "voyage_number": "string or null",
  "port_of_loading": "string or null",
  "port_of_discharge": "string or null",
  "etd": "YYYY-MM-DD or null",
  "eta": "YYYY-MM-DD or null",
  "shipper_name": "string or null",
  "consignee_name": "string or null",
  "confidence": 0-100
}`;

    try {
      const message = await this.anthropic.messages.create({
        model: model,
        max_tokens: 1500,
        temperature: 0.2,
        messages: [{
          role: 'user',
          content: prompt
        }]
      });

      const processingTime = Date.now() - startTime;
      const textContent = message.content[0];
      const resultText = textContent.type === 'text' ? textContent.text : '';

      // Extract JSON from response
      const jsonMatch = resultText.match(/\{[\s\S]*\}/);
      const result = jsonMatch ? JSON.parse(jsonMatch[0]) : null;

      const inputTokens = message.usage.input_tokens;
      const outputTokens = message.usage.output_tokens;
      const cost = this.calculateCost(model, inputTokens, outputTokens);

      return {
        model,
        taskType: 'extraction',
        emailId: email.id,
        subject: email.subject,
        inputTokens,
        outputTokens,
        cost,
        processingTime,
        result
      };
    } catch (error: any) {
      logger.error(`Extraction failed for model ${model}`, error);
      throw error;
    }
  }

  /**
   * Run comparison tests on sample emails
   */
  async runTests(sampleSize: number = 10) {
    logger.info('Starting model comparison tests', {
      models: MODELS,
      sampleSize
    });

    // Fetch sample emails from database
    const { data: emails, error } = await supabase
      .from('raw_emails')
      .select('id, subject, sender_email, body_text')
      .order('received_at', { ascending: false })
      .limit(sampleSize);

    if (error || !emails || emails.length === 0) {
      throw new Error('Failed to fetch sample emails');
    }

    logger.info(`Testing with ${emails.length} emails`);

    // Test each model on each email
    for (const model of MODELS) {
      logger.info(`\n${'='.repeat(60)}`);
      logger.info(`Testing model: ${model}`);
      logger.info('='.repeat(60));

      for (let i = 0; i < emails.length; i++) {
        const email = emails[i];
        logger.info(`\nEmail ${i + 1}/${emails.length}: ${email.subject.substring(0, 60)}...`);

        try {
          // Test classification
          const classificationResult = await this.testClassification(model, email);
          this.results.push(classificationResult);
          logger.info(`  ✓ Classification: ${classificationResult.result.document_type} (${classificationResult.result.confidence}% confidence)`);
          logger.info(`    Cost: $${classificationResult.cost.toFixed(6)}, Time: ${classificationResult.processingTime}ms`);

          // Test extraction
          const extractionResult = await this.testExtraction(model, email);
          this.results.push(extractionResult);

          const extracted = extractionResult.result;
          const fieldsFound = Object.values(extracted).filter(v => v !== null && (Array.isArray(v) ? v.length > 0 : true)).length;
          logger.info(`  ✓ Extraction: ${fieldsFound} fields found (${extracted.confidence}% confidence)`);
          logger.info(`    Cost: $${extractionResult.cost.toFixed(6)}, Time: ${extractionResult.processingTime}ms`);

          // Small delay to respect rate limits
          await this.sleep(500);
        } catch (error) {
          logger.error(`  ✗ Failed for email ${email.id}`, error);
        }
      }
    }

    this.printSummary();
  }

  /**
   * Print test summary and comparison
   */
  private printSummary() {
    logger.info('\n\n' + '='.repeat(80));
    logger.info('MODEL COMPARISON SUMMARY');
    logger.info('='.repeat(80));

    for (const model of MODELS) {
      const modelResults = this.results.filter(r => r.model === model);
      const classificationResults = modelResults.filter(r => r.taskType === 'classification');
      const extractionResults = modelResults.filter(r => r.taskType === 'extraction');

      const totalCost = modelResults.reduce((sum, r) => sum + r.cost, 0);
      const avgCost = totalCost / modelResults.length;
      const costPer1000 = avgCost * 1000;

      const avgClassificationTime = classificationResults.reduce((sum, r) => sum + r.processingTime, 0) / classificationResults.length;
      const avgExtractionTime = extractionResults.reduce((sum, r) => sum + r.processingTime, 0) / extractionResults.length;

      const avgClassificationConfidence = classificationResults.reduce((sum, r) => sum + (r.result.confidence || 0), 0) / classificationResults.length;
      const avgExtractionConfidence = extractionResults.reduce((sum, r) => sum + (r.result.confidence || 0), 0) / extractionResults.length;

      // Count extraction fields
      const avgFieldsExtracted = extractionResults.reduce((sum, r) => {
        const fieldsFound = Object.values(r.result).filter(v =>
          v !== null && (Array.isArray(v) ? v.length > 0 : true)
        ).length;
        return sum + fieldsFound;
      }, 0) / extractionResults.length;

      logger.info(`\n📊 ${model}`);
      logger.info('-'.repeat(80));
      logger.info(`Classification:`);
      logger.info(`  Avg Confidence: ${avgClassificationConfidence.toFixed(1)}%`);
      logger.info(`  Avg Time: ${avgClassificationTime.toFixed(0)}ms`);
      logger.info(`\nExtraction:`);
      logger.info(`  Avg Fields Found: ${avgFieldsExtracted.toFixed(1)} / 12`);
      logger.info(`  Avg Confidence: ${avgExtractionConfidence.toFixed(1)}%`);
      logger.info(`  Avg Time: ${avgExtractionTime.toFixed(0)}ms`);
      logger.info(`\nCost:`);
      logger.info(`  Avg per email: $${avgCost.toFixed(6)}`);
      logger.info(`  Cost per 1,000 emails: $${costPer1000.toFixed(2)}`);
      logger.info(`  Annual cost (60K emails): $${(costPer1000 * 60).toFixed(2)}`);
    }

    logger.info('\n' + '='.repeat(80));
    logger.info('💡 RECOMMENDATION');
    logger.info('='.repeat(80));

    const haikuResults = this.results.filter(r => r.model.includes('haiku'));
    const sonnetResults = this.results.filter(r => r.model.includes('sonnet'));

    const haikuAvgCost = haikuResults.reduce((sum, r) => sum + r.cost, 0) / haikuResults.length;
    const sonnetAvgCost = sonnetResults.reduce((sum, r) => sum + r.cost, 0) / sonnetResults.length;

    logger.info('Based on results:');
    logger.info(`- Use Haiku for classification ($${(haikuAvgCost * 1000).toFixed(2)}/1K emails)`);
    logger.info(`- Use Sonnet for extraction ($${(sonnetAvgCost * 1000).toFixed(2)}/1K emails)`);
    logger.info(`- Use Opus only for <70% confidence cases (fallback)`);
    logger.info('\n');

    // Print comparison table to console
    console.log('\n\n');
    console.log('╔════════════════════════════════════════════════════════════════════════════╗');
    console.log('║                     HAIKU vs SONNET COMPARISON TABLE                       ║');
    console.log('╚════════════════════════════════════════════════════════════════════════════╝');
    console.log('');

    for (const model of MODELS) {
      const modelResults = this.results.filter(r => r.model === model);
      if (modelResults.length === 0) continue;

      const classificationResults = modelResults.filter(r => r.taskType === 'classification');
      const extractionResults = modelResults.filter(r => r.taskType === 'extraction');

      const totalCost = modelResults.reduce((sum, r) => sum + r.cost, 0);
      const avgCost = totalCost / modelResults.length;
      const costPer1000 = avgCost * 1000;

      const avgClassificationConfidence = classificationResults.reduce((sum, r) => sum + (r.result.confidence || 0), 0) / classificationResults.length;
      const avgExtractionConfidence = extractionResults.reduce((sum, r) => sum + (r.result.confidence || 0), 0) / extractionResults.length;

      const avgFieldsExtracted = extractionResults.reduce((sum, r) => {
        const fieldsFound = Object.values(r.result).filter(v =>
          v !== null && (Array.isArray(v) ? v.length > 0 : true)
        ).length;
        return sum + fieldsFound;
      }, 0) / extractionResults.length;

      const modelName = model.includes('haiku') ? 'HAIKU' : 'SONNET';
      console.log(`\n📊 ${modelName}`);
      console.log('─'.repeat(80));
      console.log(`  Classification Confidence:  ${avgClassificationConfidence.toFixed(1)}%`);
      console.log(`  Extraction Confidence:      ${avgExtractionConfidence.toFixed(1)}%`);
      console.log(`  Avg Fields Extracted:       ${avgFieldsExtracted.toFixed(1)} / 12`);
      console.log(`  Cost per 1,000 emails:      $${costPer1000.toFixed(2)}`);
      console.log(`  Annual cost (60K emails):   $${(costPer1000 * 60).toFixed(2)}`);
    }

    console.log('\n');
    console.log('═'.repeat(80));
    console.log('FINAL RECOMMENDATION:');
    console.log('═'.repeat(80));

    const haikuCostPer1K = (haikuAvgCost * 1000);
    const sonnetCostPer1K = (sonnetAvgCost * 1000);
    const savings = ((sonnetCostPer1K - haikuCostPer1K) / sonnetCostPer1K * 100);

    console.log(`\n✅ Use HAIKU for both classification AND extraction`);
    console.log(`   - Cost: $${haikuCostPer1K.toFixed(2)}/1K emails`);
    console.log(`   - Annual: $${(haikuCostPer1K * 60).toFixed(2)} for 60K emails`);
    console.log(`   - Savings: ${savings.toFixed(0)}% cheaper than Sonnet`);
    console.log(`\n⚠️  Use SONNET only if Haiku confidence < 70%`);
    console.log(`   - Cost: $${sonnetCostPer1K.toFixed(2)}/1K emails`);
    console.log(`   - Annual: $${(sonnetCostPer1K * 60).toFixed(2)} for 60K emails`);
    console.log('\n');
  }

  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}

// Run tests
async function main() {
  const tester = new ModelTester();

  // Test with 10 sample emails
  await tester.runTests(10);
}

main().catch(error => {
  console.error('Test failed:', error);
  process.exit(1);
});
