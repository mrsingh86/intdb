import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/utils/supabase/server'
import { EmailRepository } from '@/lib/repositories/email-repository'
import { ClassificationRepository } from '@/lib/repositories/classification-repository'
import { EntityRepository } from '@/lib/repositories/entity-repository'
import { EmailIntelligenceService } from '@/lib/services/email-intelligence-service'
import { EmailFilteringService } from '@/lib/services/email-filtering-service'
import { withAuth } from '@/lib/auth/server-auth'

/**
 * GET /api/emails
 *
 * Fetch emails with classifications and entities.
 * Clean architecture: Route orchestrates services, no business logic here.
 * Requires authentication.
 */
export const GET = withAuth(async (request, { user }) => {
  try {
    const supabase = createClient()

    // Initialize repositories
    const emailRepo = new EmailRepository(supabase)
    const classificationRepo = new ClassificationRepository(supabase)
    const entityRepo = new EntityRepository(supabase)

    // Initialize services
    const intelligenceService = new EmailIntelligenceService(
      emailRepo,
      classificationRepo,
      entityRepo
    )
    const filteringService = new EmailFilteringService()

    // Parse request parameters
    const { filters, pagination } = parseRequestParams(request)

    // Fetch emails with intelligence
    const result = await intelligenceService.fetchEmailsWithIntelligence(
      filters,
      pagination
    )

    // Apply client-side filtering
    const filteredEmails = filteringService.filterEmails(result.data, {
      documentType: filters.documentType,
      confidenceLevel: filters.confidenceLevel,
      needsReview: filters.needsReview,
    })

    return NextResponse.json({
      emails: filteredEmails,
      pagination: result.pagination,
    })
  } catch (error) {
    console.error('[API:GET /emails] Error:', error)
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    )
  }
});

/**
 * Parse and validate request parameters
 * Small helper function (< 20 lines)
 */
function parseRequestParams(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams

  return {
    filters: {
      threadId: searchParams.get('thread_id') || undefined,
      hasAttachments: searchParams.get('has_attachments') === 'true' ? true : undefined,
      search: searchParams.get('search') || undefined,
      documentType: searchParams.get('document_type')?.split(','),
      confidenceLevel: searchParams.get('confidence_level')?.split(','),
      needsReview: searchParams.get('needs_review') === 'true',
    },
    pagination: {
      page: parseInt(searchParams.get('page') || '1'),
      limit: parseInt(searchParams.get('limit') || '20'),
    },
  }
}

/**
 * POST /api/emails
 *
 * Create a new email record.
 * Idempotent: Checks for duplicates before inserting.
 * Requires authentication.
 */
export const POST = withAuth(async (request, { user }) => {
  try {
    const supabase = createClient()
    const emailRepo = new EmailRepository(supabase)

    const body = await request.json()
    const { gmail_message_id, subject, sender_email, body_text, received_at } = body

    // Idempotency check: Don't insert duplicates
    const existing = await emailRepo.findByGmailMessageId(gmail_message_id)
    if (existing) {
      return NextResponse.json(
        { error: 'Email already exists', id: existing.id },
        { status: 409 }
      )
    }

    // Create new email
    const email = await emailRepo.create({
      gmail_message_id,
      subject,
      sender_email,
      body_text,
      snippet: body_text.substring(0, 200),
      received_at,
      has_attachments: body.has_attachments || false,
      thread_id: body.thread_id || gmail_message_id,
      thread_position: body.thread_position || 1,
    })

    // TODO: Trigger AI classification and entity extraction

    return NextResponse.json(email, { status: 201 })
  } catch (error) {
    console.error('[API:POST /emails] Error:', error)
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    )
  }
});