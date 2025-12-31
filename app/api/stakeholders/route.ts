import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/utils/supabase/server';
import { StakeholderRepository, StakeholderQueryFilters } from '@/lib/repositories/stakeholder-repository';
import { PartyType } from '@/types/intelligence-platform';
import { withAuth } from '@/lib/auth/server-auth';

/**
 * GET /api/stakeholders
 *
 * List stakeholders with filtering and pagination.
 * Requires authentication.
 */
export const GET = withAuth(async (request, { user }) => {
  try {
    const supabase = createClient();
    const repository = new StakeholderRepository(supabase);

    const { filters, pagination } = parseStakeholderFilters(request);

    const result = await repository.findAll(filters, pagination);

    return NextResponse.json({
      stakeholders: result.data,
      pagination: result.pagination,
    });
  } catch (error) {
    console.error('[API:GET /stakeholders] Error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
});

/**
 * POST /api/stakeholders
 *
 * Create a new stakeholder.
 * Requires authentication.
 */
export const POST = withAuth(async (request, { user }) => {
  try {
    const supabase = createClient();
    const repository = new StakeholderRepository(supabase);

    const body = await request.json();

    // Validate required fields
    if (!body.party_name || !body.party_type) {
      return NextResponse.json(
        { error: 'party_name and party_type are required' },
        { status: 400 }
      );
    }

    const stakeholder = await repository.create({
      party_name: body.party_name,
      party_type: body.party_type,
      address: body.address,
      city: body.city,
      country: body.country,
      postal_code: body.postal_code,
      contact_email: body.contact_email,
      contact_phone: body.contact_phone,
      tax_id: body.tax_id,
      is_customer: body.is_customer || false,
      customer_relationship: body.customer_relationship,
      email_domains: body.email_domains || [],
    });

    return NextResponse.json({ stakeholder }, { status: 201 });
  } catch (error) {
    console.error('[API:POST /stakeholders] Error:', error);

    if (error instanceof Error && error.name === 'DuplicateStakeholderError') {
      return NextResponse.json(
        { error: error.message },
        { status: 409 }
      );
    }

    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
});

/**
 * Parse query parameters into filters
 */
function parseStakeholderFilters(request: NextRequest): {
  filters: StakeholderQueryFilters;
  pagination: { page: number; limit: number };
} {
  const searchParams = request.nextUrl.searchParams;

  // Parse party types
  const typeParam = searchParams.get('type');
  const partyTypes = typeParam
    ? (typeParam.split(',') as PartyType[])
    : undefined;

  // Parse is_customer
  const customerParam = searchParams.get('is_customer');
  const isCustomer = customerParam === 'true' ? true :
                     customerParam === 'false' ? false :
                     undefined;

  return {
    filters: {
      party_type: partyTypes,
      is_customer: isCustomer,
      search: searchParams.get('search') || undefined,
      min_reliability_score: searchParams.get('min_reliability')
        ? parseFloat(searchParams.get('min_reliability')!)
        : undefined,
      has_email_domain: searchParams.get('domain') || undefined,
    },
    pagination: {
      page: parseInt(searchParams.get('page') || '1'),
      limit: parseInt(searchParams.get('limit') || '20'),
    },
  };
}
