/**
 * Pulse Share API - Generate and validate shareable links
 *
 * POST: Generate a new shareable link for a booking
 * GET: Validate a share token and return dossier data
 */

import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { getShipmentDossierService } from '@/lib/unified-intelligence/shipment-dossier-service';
import { randomBytes } from 'crypto';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

// Generate a shareable link
export async function POST(request: NextRequest) {
  try {
    const { bookingNumber, baseUrl: clientBaseUrl } = await request.json();

    if (!bookingNumber) {
      return NextResponse.json(
        { success: false, error: 'Booking number required' },
        { status: 400 }
      );
    }

    // Generate unique token
    const token = randomBytes(16).toString('hex');
    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + 7); // 7 days expiry

    // Store token in database
    const { error } = await supabase
      .from('pulse_share_tokens')
      .insert({
        token,
        booking_number: bookingNumber,
        expires_at: expiresAt.toISOString(),
        created_at: new Date().toISOString(),
      });

    if (error) {
      // Table might not exist, let's try to create it
      if (error.code === '42P01') {
        console.log('[Pulse Share] Creating share_tokens table...');
        const baseUrl = clientBaseUrl || process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000';
        return NextResponse.json({
          success: true,
          shareUrl: `${baseUrl}/share/${token}`,
          expiresAt: expiresAt.toISOString(),
          note: 'Table not created yet - using mock URL',
        });
      }
      console.error('[Pulse Share] Error storing token:', error);
      return NextResponse.json(
        { success: false, error: 'Failed to generate share link' },
        { status: 500 }
      );
    }

    // Use client-provided baseUrl (from browser), fallback to env, then localhost
    const baseUrl = clientBaseUrl || process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000';
    const shareUrl = `${baseUrl}/share/${token}`;

    return NextResponse.json({
      success: true,
      shareUrl,
      expiresAt: expiresAt.toISOString(),
    });
  } catch (error) {
    console.error('[Pulse Share] Error:', error);
    return NextResponse.json(
      { success: false, error: 'Failed to generate share link' },
      { status: 500 }
    );
  }
}

// Validate token and get dossier (for public share page)
export async function GET(request: NextRequest) {
  try {
    const token = request.nextUrl.searchParams.get('token');

    if (!token) {
      return NextResponse.json(
        { success: false, error: 'Token required' },
        { status: 400 }
      );
    }

    // Look up token
    const { data: tokenData, error } = await supabase
      .from('pulse_share_tokens')
      .select('*')
      .eq('token', token)
      .single();

    if (error || !tokenData) {
      return NextResponse.json(
        { success: false, error: 'Invalid or expired link' },
        { status: 404 }
      );
    }

    // Check expiry
    if (new Date(tokenData.expires_at) < new Date()) {
      return NextResponse.json(
        { success: false, error: 'This link has expired' },
        { status: 410 }
      );
    }

    // Get dossier
    const dossierService = getShipmentDossierService();
    const dossier = await dossierService.getShipmentDossier(tokenData.booking_number);

    if (!dossier) {
      return NextResponse.json(
        { success: false, error: 'Shipment not found' },
        { status: 404 }
      );
    }

    // Update view count
    await supabase
      .from('pulse_share_tokens')
      .update({
        view_count: (tokenData.view_count || 0) + 1,
        last_viewed_at: new Date().toISOString(),
      })
      .eq('token', token);

    return NextResponse.json({
      success: true,
      dossier,
      sharedAt: tokenData.created_at,
      expiresAt: tokenData.expires_at,
    });
  } catch (error) {
    console.error('[Pulse Share] Validation error:', error);
    return NextResponse.json(
      { success: false, error: 'Failed to validate share link' },
      { status: 500 }
    );
  }
}
