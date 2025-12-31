import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/utils/supabase/server'
import { withAuth } from '@/lib/auth/server-auth'

/**
 * GET /api/classifications
 *
 * Fetch document classifications.
 * Requires authentication.
 */
export const GET = withAuth(async (request, { user }) => {
  try {
    const searchParams = request.nextUrl.searchParams
    const emailId = searchParams.get('email_id')

    const supabase = createClient()

    let query = supabase
      .from('document_classifications')
      .select('*')
      .order('classified_at', { ascending: false })

    if (emailId) {
      query = query.eq('email_id', emailId)
    }

    const { data, error } = await query

    if (error) {
      console.error('Error fetching classifications:', error)
      return NextResponse.json(
        { error: 'Failed to fetch classifications' },
        { status: 500 }
      )
    }

    return NextResponse.json(data)
  } catch (error) {
    console.error('Error in classifications GET:', error)
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    )
  }
});

/**
 * POST /api/classifications
 *
 * Create a new classification.
 * Requires authentication.
 */
export const POST = withAuth(async (request, { user }) => {
  try {
    const body = await request.json()
    const {
      email_id,
      document_type,
      confidence_score,
      classification_reason,
      model_name = 'claude-3'
    } = body

    const supabase = createClient()

    // Check if email exists
    const { data: email } = await supabase
      .from('raw_emails')
      .select('id')
      .eq('id', email_id)
      .single()

    if (!email) {
      return NextResponse.json(
        { error: 'Email not found' },
        { status: 404 }
      )
    }

    // Create classification (immutable - new record for each classification)
    const { data, error } = await supabase
      .from('document_classifications')
      .insert({
        email_id,
        document_type,
        confidence_score,
        classification_reason,
        model_name,
        classified_at: new Date().toISOString(),
        is_manual_review: false
      })
      .select()
      .single()

    if (error) {
      console.error('Error creating classification:', error)
      return NextResponse.json(
        { error: 'Failed to create classification' },
        { status: 500 }
      )
    }

    return NextResponse.json(data, { status: 201 })
  } catch (error) {
    console.error('Error in classifications POST:', error)
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    )
  }
});

/**
 * PUT /api/classifications
 *
 * Update a classification (manual review).
 * Requires authentication.
 */
export const PUT = withAuth(async (request, { user }) => {
  try {
    const body = await request.json()
    const { email_id, document_type, reviewer_id = 'system' } = body

    if (!email_id || !document_type) {
      return NextResponse.json(
        { error: 'email_id and document_type are required' },
        { status: 400 }
      )
    }

    const supabase = createClient()

    // Get the latest classification for this email
    const { data: latestClassification } = await supabase
      .from('document_classifications')
      .select('*')
      .eq('email_id', email_id)
      .order('classified_at', { ascending: false })
      .limit(1)
      .single()

    // Create a new manual review classification (classifications are immutable)
    const { data, error } = await supabase
      .from('document_classifications')
      .insert({
        email_id,
        document_type,
        confidence_score: 100, // Manual review = 100% confidence
        classification_reason: `Manual review by ${reviewer_id}`,
        model_name: 'manual',
        classified_at: new Date().toISOString(),
        is_manual_review: true,
        reviewed_by: reviewer_id,
        reviewed_at: new Date().toISOString(),
        previous_classification: latestClassification?.document_type
      })
      .select()
      .single()

    if (error) {
      console.error('Error creating manual classification:', error)
      return NextResponse.json(
        { error: 'Failed to update classification' },
        { status: 500 }
      )
    }

    return NextResponse.json(data)
  } catch (error) {
    console.error('Error in classifications PUT:', error)
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    )
  }
});

/**
 * PATCH /api/classifications
 *
 * Get classification statistics.
 * Requires authentication.
 */
export const PATCH = withAuth(async (request, { user }) => {
  try {
    const supabase = createClient()

    // Get statistics
    const { data: stats, error } = await supabase
      .rpc('get_classification_stats')

    if (error) {
      // If the RPC doesn't exist, compute manually
      const { data: classifications } = await supabase
        .from('document_classifications')
        .select('document_type, confidence_score, is_manual_review')

      if (!classifications) {
        return NextResponse.json({ stats: {} })
      }

      // Compute stats manually
      const typeCount: Record<string, number> = {}
      let totalConfidence = 0
      let manualReviewCount = 0

      classifications.forEach(c => {
        typeCount[c.document_type] = (typeCount[c.document_type] || 0) + 1
        totalConfidence += c.confidence_score
        if (c.is_manual_review) manualReviewCount++
      })

      const computedStats = {
        total_classifications: classifications.length,
        document_type_distribution: Object.entries(typeCount).map(([type, count]) => ({
          type,
          count,
          percentage: (count / classifications.length) * 100
        })),
        average_confidence: totalConfidence / classifications.length,
        manual_review_count: manualReviewCount,
        manual_review_percentage: (manualReviewCount / classifications.length) * 100
      }

      return NextResponse.json({ stats: computedStats })
    }

    return NextResponse.json({ stats })
  } catch (error) {
    console.error('Error getting classification stats:', error)
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    )
  }
});