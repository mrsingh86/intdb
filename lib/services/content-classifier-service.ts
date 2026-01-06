/**
 * Content-First Hybrid Classification Service
 *
 * Philosophy: Classify documents by WHAT THEY ARE (content), not by email metadata.
 *
 * Flow:
 * 1. Deterministic: Check PDF content for known markers (fast, free)
 * 2. AI Fallback: Use Haiku for ambiguous documents (when deterministic fails)
 * 3. Judge Validation: Haiku validates email context vs document content
 *
 * @author Claude Opus 4.5
 * @date 2026-01-05
 */

import Anthropic from '@anthropic-ai/sdk';
import {
  DOCUMENT_TYPE_CONFIGS,
  DocumentTypeConfig,
  ContentMarker,
  SenderType,
  identifySenderType,
  getExpectedDocumentTypes,
} from '../config/content-classification-config';

// =============================================================================
// TYPES
// =============================================================================

export interface ContentClassificationResult {
  documentType: string;
  confidence: number;
  source: 'deterministic' | 'ai_haiku' | 'filename_hint';
  matchedMarkers?: string[];
  reasoning?: string;
}

export interface AttachmentClassification {
  attachmentId: string;
  filename: string;
  documentType: string;
  confidence: number;
  source: string;
  matchedMarkers?: string[];
  reasoning?: string;
}

export interface JudgeValidation {
  isValid: boolean;
  confidenceAdjustment: number;
  reason: string;
  suggestedType?: string;
}

export interface EmailClassificationResult {
  emailId: string;
  emailDocumentType: string;
  emailConfidence: number;
  senderType: SenderType;
  attachmentClassifications: AttachmentClassification[];
  judgeValidation?: JudgeValidation;
  requiresReview: boolean;
  reviewReason?: string;
}

// =============================================================================
// CONTENT CLASSIFIER SERVICE
// =============================================================================

export class ContentClassifierService {
  private anthropic: Anthropic | null = null;

  constructor() {
    if (process.env.ANTHROPIC_API_KEY) {
      this.anthropic = new Anthropic();
    }
  }

  // ===========================================================================
  // MAIN CLASSIFICATION METHOD
  // ===========================================================================

  /**
   * Classify an attachment by its content (hybrid approach)
   */
  async classifyAttachment(
    attachmentId: string,
    filename: string,
    extractedText: string | null,
    senderType: SenderType = 'unknown'
  ): Promise<AttachmentClassification> {

    // Step 1: Try deterministic classification first (free, fast)
    if (extractedText && extractedText.length > 50) {
      const deterministicResult = this.classifyByContent(extractedText);
      if (deterministicResult && deterministicResult.confidence >= 85) {
        return {
          attachmentId,
          filename,
          documentType: deterministicResult.documentType,
          confidence: deterministicResult.confidence,
          source: 'deterministic',
          matchedMarkers: deterministicResult.matchedMarkers,
        };
      }
    }

    // Step 2: Try filename hints (secondary signal)
    const filenameResult = this.classifyByFilename(filename);
    if (filenameResult && filenameResult.confidence >= 80) {
      // If we have extracted text, validate filename classification
      if (extractedText && extractedText.length > 50) {
        const validated = this.validateFilenameClassification(
          filenameResult.documentType,
          extractedText
        );
        if (validated) {
          return {
            attachmentId,
            filename,
            documentType: filenameResult.documentType,
            confidence: Math.min(filenameResult.confidence, 85),
            source: 'filename_hint',
            reasoning: 'Filename pattern matched and validated against content',
          };
        }
      } else {
        // No text to validate, use filename with lower confidence
        return {
          attachmentId,
          filename,
          documentType: filenameResult.documentType,
          confidence: Math.min(filenameResult.confidence - 10, 75),
          source: 'filename_hint',
          reasoning: 'Filename pattern matched (no content to validate)',
        };
      }
    }

    // Step 3: AI fallback for ambiguous documents
    if (this.anthropic && extractedText && extractedText.length > 50) {
      const aiResult = await this.classifyWithAI(extractedText, filename, senderType);
      if (aiResult) {
        return {
          attachmentId,
          filename,
          documentType: aiResult.documentType,
          confidence: aiResult.confidence,
          source: 'ai_haiku',
          reasoning: aiResult.reasoning,
        };
      }
    }

    // Step 4: Unknown - needs manual review
    return {
      attachmentId,
      filename,
      documentType: 'unknown',
      confidence: 0,
      source: 'deterministic',
      reasoning: 'No matching patterns found in content or filename',
    };
  }

  // ===========================================================================
  // DETERMINISTIC CLASSIFICATION (Fast, Free)
  // ===========================================================================

  /**
   * Classify document by content using deterministic markers
   */
  classifyByContent(extractedText: string): ContentClassificationResult | null {
    const textUpper = extractedText.toUpperCase();
    let bestMatch: ContentClassificationResult | null = null;

    for (const config of DOCUMENT_TYPE_CONFIGS) {
      for (const marker of config.contentMarkers) {
        const result = this.matchContentMarker(textUpper, marker, config);
        if (result && (!bestMatch || result.confidence > bestMatch.confidence)) {
          bestMatch = result;
        }
      }
    }

    return bestMatch;
  }

  /**
   * Check if text matches a content marker
   */
  private matchContentMarker(
    textUpper: string,
    marker: ContentMarker,
    config: DocumentTypeConfig
  ): ContentClassificationResult | null {
    // Check exclusions first
    if (marker.exclude) {
      for (const excludePattern of marker.exclude) {
        if (textUpper.includes(excludePattern.toUpperCase())) {
          return null;
        }
      }
    }

    // Check required patterns
    const matchedRequired: string[] = [];
    for (const required of marker.required) {
      if (textUpper.includes(required.toUpperCase())) {
        matchedRequired.push(required);
      } else {
        return null; // All required patterns must match
      }
    }

    // Calculate confidence boost from optional patterns
    let optionalBoost = 0;
    const matchedOptional: string[] = [];
    if (marker.optional) {
      for (const optional of marker.optional) {
        if (textUpper.includes(optional.toUpperCase())) {
          matchedOptional.push(optional);
          optionalBoost += 2; // +2% per optional match
        }
      }
    }

    const finalConfidence = Math.min(marker.confidence + optionalBoost, 99);

    return {
      documentType: config.type,
      confidence: finalConfidence,
      source: 'deterministic',
      matchedMarkers: [...matchedRequired, ...matchedOptional],
    };
  }

  /**
   * Classify by filename patterns
   */
  classifyByFilename(filename: string): ContentClassificationResult | null {
    for (const config of DOCUMENT_TYPE_CONFIGS) {
      if (config.filenamePatterns) {
        for (const pattern of config.filenamePatterns) {
          if (pattern.test(filename)) {
            return {
              documentType: config.type,
              confidence: 75, // Filename alone is less reliable
              source: 'filename_hint',
              matchedMarkers: [pattern.source],
            };
          }
        }
      }
    }
    return null;
  }

  /**
   * Validate filename classification against content
   */
  private validateFilenameClassification(
    documentType: string,
    extractedText: string
  ): boolean {
    const config = DOCUMENT_TYPE_CONFIGS.find(c => c.type === documentType);
    if (!config) return false;

    const textUpper = extractedText.toUpperCase();

    // Check if ANY content marker has at least one required pattern present
    for (const marker of config.contentMarkers) {
      const hasAnyRequired = marker.required.some(req =>
        textUpper.includes(req.toUpperCase())
      );
      if (hasAnyRequired) return true;
    }

    return false;
  }

  // ===========================================================================
  // AI CLASSIFICATION (Haiku Fallback)
  // ===========================================================================

  /**
   * Classify ambiguous documents using Claude Haiku
   */
  async classifyWithAI(
    extractedText: string,
    filename: string,
    senderType: SenderType
  ): Promise<ContentClassificationResult | null> {
    if (!this.anthropic) return null;

    // Get expected document types for this sender
    const expectedTypes = getExpectedDocumentTypes(senderType);
    const allTypes = DOCUMENT_TYPE_CONFIGS.map(c => ({
      type: c.type,
      displayName: c.displayName,
      description: c.description,
    }));

    const prompt = `You are a freight document classifier. Analyze this document content and classify it.

DOCUMENT CONTENT (first 2000 chars):
${extractedText.slice(0, 2000)}

FILENAME: ${filename}
SENDER TYPE: ${senderType}

EXPECTED DOCUMENT TYPES for this sender:
${expectedTypes.map(t => `- ${t.type}: ${t.description}`).join('\n')}

ALL POSSIBLE DOCUMENT TYPES:
${allTypes.map(t => `- ${t.type}: ${t.description}`).join('\n')}

Respond with JSON only:
{
  "document_type": "exact type from list above",
  "confidence": 0-100,
  "reasoning": "brief explanation of why this classification"
}

Rules:
- Prefer types from EXPECTED list if content matches
- Look for document headers, form numbers, key identifiers
- If unsure, use lower confidence score
- Use "unknown" only if truly unidentifiable`;

    try {
      const response = await this.anthropic.messages.create({
        model: 'claude-3-5-haiku-20241022',
        max_tokens: 300,
        messages: [{ role: 'user', content: prompt }],
      });

      const content = response.content[0];
      if (content.type !== 'text') return null;

      // Parse JSON response
      const jsonMatch = content.text.match(/\{[\s\S]*\}/);
      if (!jsonMatch) return null;

      const result = JSON.parse(jsonMatch[0]);
      return {
        documentType: result.document_type,
        confidence: result.confidence,
        source: 'ai_haiku',
        reasoning: result.reasoning,
      };
    } catch (error) {
      console.error('[ContentClassifier] AI classification failed:', error);
      return null;
    }
  }

  // ===========================================================================
  // JUDGE VALIDATION
  // ===========================================================================

  /**
   * Validate classification using LLM judge
   * Checks if email context matches document content
   */
  async validateWithJudge(
    emailSubject: string,
    emailBodyPreview: string,
    documentType: string,
    attachmentContentPreview: string,
    threadPosition?: number
  ): Promise<JudgeValidation> {
    if (!this.anthropic) {
      return {
        isValid: true,
        confidenceAdjustment: 0,
        reason: 'No AI available for validation',
      };
    }

    const prompt = `You are a freight document classification validator.

EMAIL SUBJECT: ${emailSubject}
EMAIL BODY PREVIEW: ${emailBodyPreview.slice(0, 300)}
THREAD POSITION: ${threadPosition || 'unknown'}

ATTACHMENT CLASSIFIED AS: ${documentType}
ATTACHMENT CONTENT PREVIEW: ${attachmentContentPreview.slice(0, 500)}

Task: Does the email context match the document classification?

Return JSON only:
{
  "is_valid": true/false,
  "confidence_adjustment": -30 to +10,
  "reason": "brief explanation",
  "suggested_type": "only if is_valid=false, suggest correct type"
}

RULES:
- If email says "invoice for duty" but attachment is CBP 7501 Entry Summary → is_valid=false, suggest "entry_summary"
- If email says "SOB confirmation" but attachment is Entry Summary → is_valid=false
- Wire receipts/payment receipts should NEVER be "general_correspondence"
- Thread position > 3 with same subject often means different document than subject suggests
- A reply "PFA" with an invoice attached is correctly an "invoice", not "general_correspondence"`;

    try {
      const response = await this.anthropic.messages.create({
        model: 'claude-3-5-haiku-20241022',
        max_tokens: 200,
        messages: [{ role: 'user', content: prompt }],
      });

      const content = response.content[0];
      if (content.type !== 'text') {
        return { isValid: true, confidenceAdjustment: 0, reason: 'Parse error' };
      }

      const jsonMatch = content.text.match(/\{[\s\S]*\}/);
      if (!jsonMatch) {
        return { isValid: true, confidenceAdjustment: 0, reason: 'Parse error' };
      }

      const result = JSON.parse(jsonMatch[0]);
      return {
        isValid: result.is_valid,
        confidenceAdjustment: result.confidence_adjustment,
        reason: result.reason,
        suggestedType: result.suggested_type,
      };
    } catch (error) {
      console.error('[ContentClassifier] Judge validation failed:', error);
      return { isValid: true, confidenceAdjustment: 0, reason: 'Validation error' };
    }
  }

  // ===========================================================================
  // FULL EMAIL CLASSIFICATION
  // ===========================================================================

  /**
   * Classify an email with all its attachments
   */
  async classifyEmailWithAttachments(
    emailId: string,
    senderEmail: string,
    emailSubject: string,
    emailBodyPreview: string,
    attachments: Array<{
      id: string;
      filename: string;
      extractedText: string | null;
    }>,
    threadPosition?: number
  ): Promise<EmailClassificationResult> {
    const senderType = identifySenderType(senderEmail);

    // Classify each attachment independently
    const attachmentClassifications = await Promise.all(
      attachments.map(att =>
        this.classifyAttachment(att.id, att.filename, att.extractedText, senderType)
      )
    );

    // Determine email-level classification from primary attachment
    const primaryAttachment = this.selectPrimaryAttachment(attachmentClassifications);
    const emailDocumentType = primaryAttachment?.documentType || 'general_correspondence';
    let emailConfidence = primaryAttachment?.confidence || 50;

    // Validate with judge for PDF attachments
    let judgeValidation: JudgeValidation | undefined;
    let requiresReview = false;
    let reviewReason: string | undefined;

    if (primaryAttachment && attachments.length > 0) {
      const primaryAtt = attachments.find(a => a.id === primaryAttachment.attachmentId);
      if (primaryAtt?.extractedText) {
        judgeValidation = await this.validateWithJudge(
          emailSubject,
          emailBodyPreview,
          emailDocumentType,
          primaryAtt.extractedText,
          threadPosition
        );

        // Apply confidence adjustment
        emailConfidence = Math.max(0, Math.min(100,
          emailConfidence + judgeValidation.confidenceAdjustment
        ));

        // Flag for review if judge says invalid
        if (!judgeValidation.isValid) {
          requiresReview = true;
          reviewReason = judgeValidation.reason;
        }
      }
    }

    // Flag for review if low confidence
    if (emailConfidence < 70) {
      requiresReview = true;
      reviewReason = reviewReason || 'Low confidence classification';
    }

    return {
      emailId,
      emailDocumentType,
      emailConfidence,
      senderType,
      attachmentClassifications,
      judgeValidation,
      requiresReview,
      reviewReason,
    };
  }

  /**
   * Select primary attachment for email-level classification
   * Priority: Highest confidence non-general document
   */
  private selectPrimaryAttachment(
    classifications: AttachmentClassification[]
  ): AttachmentClassification | null {
    if (classifications.length === 0) return null;

    // Sort by: non-unknown first, then by confidence
    const sorted = [...classifications].sort((a, b) => {
      if (a.documentType === 'unknown' && b.documentType !== 'unknown') return 1;
      if (a.documentType !== 'unknown' && b.documentType === 'unknown') return -1;
      return b.confidence - a.confidence;
    });

    return sorted[0];
  }
}

// =============================================================================
// SINGLETON EXPORT
// =============================================================================

let instance: ContentClassifierService | null = null;

export function getContentClassifier(): ContentClassifierService {
  if (!instance) {
    instance = new ContentClassifierService();
  }
  return instance;
}
