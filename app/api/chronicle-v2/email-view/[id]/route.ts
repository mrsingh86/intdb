/**
 * Chronicle V2 - Email Content Viewer
 *
 * Returns email content as a formatted HTML page for viewing.
 * Matches Intoglo/Pulse theme with back navigation.
 */

import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;

    if (!id) {
      return new NextResponse('Missing document ID', { status: 400 });
    }

    // Fetch document from chronicle
    const { data: doc, error } = await supabase
      .from('chronicle')
      .select(`
        id,
        subject,
        from_address,
        from_party,
        occurred_at,
        document_type,
        summary,
        snippet,
        body_preview,
        booking_number,
        mbl_number,
        container_numbers,
        vessel_name,
        voyage_number,
        pol_location,
        pod_location,
        etd,
        eta,
        shipper_name,
        consignee_name
      `)
      .eq('id', id)
      .single();

    if (error || !doc) {
      return new NextResponse('Document not found', { status: 404 });
    }

    // Format the date
    const date = new Date(doc.occurred_at).toLocaleString('en-US', {
      weekday: 'long',
      year: 'numeric',
      month: 'long',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });

    // Build extracted data section
    const extractedData: string[] = [];
    if (doc.booking_number) extractedData.push(`<strong>Booking:</strong> ${doc.booking_number}`);
    if (doc.mbl_number) extractedData.push(`<strong>MBL:</strong> ${doc.mbl_number}`);
    if (doc.container_numbers?.length) extractedData.push(`<strong>Containers:</strong> ${doc.container_numbers.join(', ')}`);
    if (doc.vessel_name) extractedData.push(`<strong>Vessel:</strong> ${doc.vessel_name}${doc.voyage_number ? ` / ${doc.voyage_number}` : ''}`);
    if (doc.pol_location && doc.pod_location) extractedData.push(`<strong>Route:</strong> ${doc.pol_location} → ${doc.pod_location}`);
    if (doc.etd) extractedData.push(`<strong>ETD:</strong> ${new Date(doc.etd).toLocaleDateString()}`);
    if (doc.eta) extractedData.push(`<strong>ETA:</strong> ${new Date(doc.eta).toLocaleDateString()}`);
    if (doc.shipper_name) extractedData.push(`<strong>Shipper:</strong> ${doc.shipper_name}`);
    if (doc.consignee_name) extractedData.push(`<strong>Consignee:</strong> ${doc.consignee_name}`);

    // Get email content (prefer body_preview, fallback to snippet)
    const emailContent = doc.body_preview || doc.snippet || 'No content available';

    // Build back URL - try to go back to Pulse with booking number
    const backUrl = doc.booking_number ? `/pulse?search=${encodeURIComponent(doc.booking_number)}` : '/pulse';

    // Build HTML page with Intoglo theme
    const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${escapeHtml(doc.subject || 'Email')} - Intoglo Pulse</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      background: #030712;
      color: #e5e7eb;
      line-height: 1.6;
      min-height: 100vh;
    }
    .top-bar {
      position: sticky;
      top: 0;
      z-index: 10;
      background: #111827;
      border-bottom: 1px solid #1f2937;
      padding: 12px 16px;
    }
    .top-bar-inner {
      max-width: 800px;
      margin: 0 auto;
      display: flex;
      align-items: center;
      gap: 12px;
    }
    .back-btn {
      display: inline-flex;
      align-items: center;
      gap: 8px;
      padding: 8px 16px;
      background: rgba(231, 37, 102, 0.1);
      border: 1px solid rgba(231, 37, 102, 0.3);
      border-radius: 8px;
      color: #E72566;
      text-decoration: none;
      font-size: 14px;
      font-weight: 500;
      transition: all 0.2s;
    }
    .back-btn:hover {
      background: rgba(231, 37, 102, 0.2);
      border-color: rgba(231, 37, 102, 0.5);
    }
    .back-btn svg {
      width: 16px;
      height: 16px;
    }
    .logo {
      display: flex;
      align-items: center;
      gap: 8px;
      margin-left: auto;
    }
    .logo svg {
      width: 24px;
      height: 24px;
    }
    .logo-text {
      font-size: 16px;
      font-weight: 700;
      color: white;
    }
    .logo-pulse {
      color: #E72566;
      margin-left: 8px;
      padding-left: 8px;
      border-left: 1px solid #374151;
    }
    .container {
      max-width: 800px;
      margin: 0 auto;
      padding: 20px 16px;
    }
    .card {
      background: #111827;
      border-radius: 12px;
      border: 1px solid #1f2937;
      overflow: hidden;
      margin-bottom: 16px;
    }
    .header {
      background: linear-gradient(to right, rgba(231, 37, 102, 0.15), #111827);
      padding: 20px 24px;
      border-bottom: 1px solid rgba(231, 37, 102, 0.2);
    }
    .doc-type {
      display: inline-block;
      background: #E72566;
      color: white;
      padding: 4px 12px;
      border-radius: 4px;
      font-size: 11px;
      font-weight: 600;
      text-transform: uppercase;
      letter-spacing: 0.5px;
      margin-bottom: 12px;
    }
    .subject {
      font-size: 18px;
      font-weight: 600;
      color: #fff;
      margin-bottom: 12px;
      line-height: 1.4;
    }
    .meta {
      font-size: 14px;
      color: #9ca3af;
    }
    .meta strong { color: #e5e7eb; }
    .section {
      padding: 16px 24px;
      border-bottom: 1px solid #1f2937;
    }
    .section:last-child {
      border-bottom: none;
    }
    .section-title {
      font-size: 11px;
      font-weight: 600;
      text-transform: uppercase;
      letter-spacing: 0.5px;
      color: #E72566;
      margin-bottom: 12px;
    }
    .extracted-grid {
      display: grid;
      grid-template-columns: repeat(auto-fill, minmax(180px, 1fr));
      gap: 12px;
    }
    .extracted-item {
      font-size: 13px;
      color: #d1d5db;
      background: #030712;
      padding: 8px 12px;
      border-radius: 6px;
    }
    .extracted-item strong {
      color: #9ca3af;
      font-weight: 500;
    }
    .summary-section {
      background: rgba(231, 37, 102, 0.05);
    }
    .summary-text {
      font-size: 14px;
      color: #e5e7eb;
    }
    .content-text {
      font-size: 14px;
      color: #d1d5db;
      white-space: pre-wrap;
      background: #030712;
      padding: 16px;
      border-radius: 8px;
      max-height: 500px;
      overflow-y: auto;
      border: 1px solid #1f2937;
    }
  </style>
</head>
<body>
  <div class="top-bar">
    <div class="top-bar-inner">
      <a href="${backUrl}" class="back-btn">
        <svg fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 19l-7-7 7-7"/>
        </svg>
        Back to Pulse
      </a>
      <div class="logo">
        <svg viewBox="0 0 520 601" fill="none">
          <path d="M0 600.517L346.711 0L520.064 300.259L346.711 600.517H0Z" fill="#E72566"/>
          <path d="M0 0L346.711 600.518L520.064 300.258L346.711 0H0Z" fill="#E72566"/>
          <path d="M129.111 376.892L173.355 300.257L346.711 600.517L129.111 376.892Z" fill="#8B001D"/>
        </svg>
        <span class="logo-text">intoglo<span class="logo-pulse">PULSE</span></span>
      </div>
    </div>
  </div>

  <div class="container">
    <div class="card">
      <div class="header">
        <div class="doc-type">${escapeHtml(formatDocType(doc.document_type))}</div>
        <div class="subject">${escapeHtml(doc.subject || 'No Subject')}</div>
        <div class="meta">
          <strong>From:</strong> ${escapeHtml(doc.from_address || 'Unknown')} (${escapeHtml(doc.from_party || 'unknown')})<br>
          <strong>Date:</strong> ${date}
        </div>
      </div>

      ${extractedData.length > 0 ? `
      <div class="section">
        <div class="section-title">Extracted Data</div>
        <div class="extracted-grid">
          ${extractedData.map(item => `<div class="extracted-item">${item}</div>`).join('')}
        </div>
      </div>
      ` : ''}

      ${doc.summary ? `
      <div class="section summary-section">
        <div class="section-title">AI Summary</div>
        <div class="summary-text">${escapeHtml(doc.summary)}</div>
      </div>
      ` : ''}

      <div class="section">
        <div class="section-title">Email Content</div>
        <div class="content-text">${escapeHtml(emailContent)}</div>
      </div>
    </div>
  </div>
</body>
</html>`;

    return new NextResponse(html, {
      headers: {
        'Content-Type': 'text/html; charset=utf-8',
      },
    });
  } catch (error) {
    console.error('[API] Email view error:', error);
    return new NextResponse('Failed to load email', { status: 500 });
  }
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function formatDocType(type: string): string {
  const labels: Record<string, string> = {
    'arrival_notice': 'Arrival Notice',
    'booking_confirmation': 'Booking Confirmation',
    'booking_amendment': 'Booking Amendment',
    'shipping_instructions': 'Shipping Instructions',
    'si_confirmation': 'SI Confirmation',
    'vgm_confirmation': 'VGM Confirmation',
    'draft_bl': 'Draft BL',
    'final_bl': 'Final BL',
    'telex_release': 'Telex Release',
    'delivery_order': 'Delivery Order',
    'invoice': 'Invoice',
  };
  return labels[type] || type?.replace(/_/g, ' ') || 'Email';
}
