import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL || '',
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY || ''
)

interface SearchResult {
  id: string
  type: 'shipment' | 'document' | 'email' | 'stakeholder'
  title: string
  subtitle: string
  url: string
}

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url)
    const query = searchParams.get('q')

    if (!query || query.length < 2) {
      return NextResponse.json({ results: [] })
    }

    const searchTerm = query.toLowerCase()
    const results: SearchResult[] = []

    // Search shipments (booking number, BL number, status)
    const { data: shipments } = await supabase
      .from('shipments')
      .select('id, booking_number, bl_number, status, workflow_state')
      .or(`booking_number.ilike.%${searchTerm}%,bl_number.ilike.%${searchTerm}%`)
      .limit(5)

    if (shipments) {
      results.push(...shipments.map(s => ({
        id: s.id,
        type: 'shipment' as const,
        title: s.booking_number || s.bl_number || 'Unknown',
        subtitle: `${s.status || 'No status'} - ${s.workflow_state || 'No state'}`,
        url: `/shipments/${s.id}`
      })))
    }

    // Search stakeholders (name, email)
    const { data: stakeholders } = await supabase
      .from('parties')
      .select('id, name, email, party_type')
      .or(`name.ilike.%${searchTerm}%,email.ilike.%${searchTerm}%`)
      .limit(5)

    if (stakeholders) {
      results.push(...stakeholders.map(s => ({
        id: s.id,
        type: 'stakeholder' as const,
        title: s.name || 'Unknown',
        subtitle: `${s.party_type || 'Unknown type'} - ${s.email || 'No email'}`,
        url: `/stakeholders/${s.id}`
      })))
    }

    // Search emails (subject, sender)
    const { data: emails } = await supabase
      .from('raw_emails')
      .select('id, subject, sender_email')
      .or(`subject.ilike.%${searchTerm}%,sender_email.ilike.%${searchTerm}%`)
      .limit(5)

    if (emails) {
      results.push(...emails.map(e => ({
        id: e.id,
        type: 'email' as const,
        title: e.subject || 'No subject',
        subtitle: e.sender_email || 'Unknown sender',
        url: `/emails/${e.id}`
      })))
    }

    // Search documents (document type, related booking)
    const { data: documents } = await supabase
      .from('document_classifications')
      .select(`
        id,
        document_type,
        raw_emails!inner(subject)
      `)
      .ilike('document_type', `%${searchTerm}%`)
      .limit(5)

    if (documents) {
      results.push(...documents.map(d => ({
        id: d.id,
        type: 'document' as const,
        title: d.document_type || 'Unknown type',
        subtitle: (d.raw_emails as any)?.subject || 'No subject',
        url: `/documents/${d.id}`
      })))
    }

    // Sort by relevance (exact matches first)
    results.sort((a, b) => {
      const aExact = a.title.toLowerCase().includes(searchTerm) ? 0 : 1
      const bExact = b.title.toLowerCase().includes(searchTerm) ? 0 : 1
      return aExact - bExact
    })

    return NextResponse.json({ results: results.slice(0, 15) })
  } catch (error) {
    console.error('Search error:', error)
    return NextResponse.json({ error: 'Search failed', results: [] }, { status: 500 })
  }
}
