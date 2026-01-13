/**
 * Chronicle V2 - Attachment Download API
 *
 * Fetches PDF attachments from Gmail and serves them for viewing/download.
 */

import { NextRequest, NextResponse } from 'next/server';
import { createChronicleGmailService } from '@/lib/chronicle';

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ messageId: string; attachmentId: string }> }
) {
  try {
    const { messageId, attachmentId } = await params;

    if (!messageId || !attachmentId) {
      return NextResponse.json(
        { error: 'Missing messageId or attachmentId' },
        { status: 400 }
      );
    }

    // Initialize Gmail service
    const gmailService = createChronicleGmailService();

    // Fetch attachment content
    const content = await gmailService.fetchAttachmentContent(messageId, attachmentId);

    if (!content) {
      return NextResponse.json(
        { error: 'Attachment not found' },
        { status: 404 }
      );
    }

    // Get filename from query param or use default
    const filename = request.nextUrl.searchParams.get('filename') || 'attachment.pdf';

    // Convert Buffer to Uint8Array for NextResponse compatibility
    const uint8Array = new Uint8Array(content);

    // Return PDF content
    return new NextResponse(uint8Array, {
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': `inline; filename="${filename}"`,
        'Content-Length': content.length.toString(),
      },
    });
  } catch (error) {
    console.error('[API] Attachment fetch error:', error);
    return NextResponse.json(
      { error: 'Failed to fetch attachment' },
      { status: 500 }
    );
  }
}
