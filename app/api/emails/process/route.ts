import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { withAuth } from '@/lib/auth/server-auth'
import { EmailProcessingOrchestrator } from '@/lib/services/email-processing-orchestrator'

/**
 * POST /api/emails/process
 *
 * Process emails through the unified pipeline:
 * - Classification
 * - Entity extraction
 * - Shipment linking (ONLY creates from direct carrier booking confirmations)
 * - Document lifecycle tracking
 *
 * Requires authentication.
 */
export const POST = withAuth(async (request, { user }) => {
  try {
    const { action, emailIds, limit = 100 } = await request.json()

    // Validate environment
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
    const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY
    const anthropicKey = process.env.ANTHROPIC_API_KEY

    if (!supabaseUrl || !supabaseKey) {
      return NextResponse.json(
        { error: 'Missing Supabase configuration' },
        { status: 500 }
      )
    }

    if (!anthropicKey) {
      return NextResponse.json(
        { error: 'Missing Anthropic API key' },
        { status: 500 }
      )
    }

    // Initialize orchestrator with direct carrier logic
    const orchestrator = new EmailProcessingOrchestrator(
      supabaseUrl,
      supabaseKey,
      anthropicKey
    )
    await orchestrator.initialize()

    if (action === 'process_new') {
      // Get emails needing processing
      const idsToProcess = await orchestrator.getEmailsNeedingProcessing(limit)

      if (idsToProcess.length === 0) {
        return NextResponse.json({
          success: true,
          message: 'No emails need processing',
          processed: 0
        })
      }

      console.log(`[Process API] Processing ${idsToProcess.length} emails...`)

      // Process batch
      const results = await orchestrator.processBatch(idsToProcess)

      const successful = results.filter(r => r.success).length
      const failed = results.filter(r => !r.success).length
      const shipmentsLinked = results.filter(r => r.shipmentId).length

      return NextResponse.json({
        success: true,
        message: `Processed ${idsToProcess.length} emails`,
        processed: idsToProcess.length,
        successful,
        failed,
        shipmentsLinked,
        results: results.slice(0, 10) // Return first 10 for debugging
      })
    }

    if (action === 'process_specific' && emailIds?.length > 0) {
      // Process specific email IDs
      console.log(`[Process API] Processing ${emailIds.length} specific emails...`)

      const results = await orchestrator.processBatch(emailIds)

      const successful = results.filter(r => r.success).length
      const failed = results.filter(r => !r.success).length
      const shipmentsLinked = results.filter(r => r.shipmentId).length

      return NextResponse.json({
        success: true,
        message: `Processed ${emailIds.length} emails`,
        processed: emailIds.length,
        successful,
        failed,
        shipmentsLinked,
        results
      })
    }

    return NextResponse.json(
      { error: 'Invalid action. Use "process_new" or "process_specific"' },
      { status: 400 }
    )
  } catch (error) {
    console.error('[Process API] Error:', error)
    return NextResponse.json(
      { error: 'Failed to process emails', details: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    )
  }
});
