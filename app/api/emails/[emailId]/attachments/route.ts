/**
 * Email Attachments API
 *
 * GET /api/emails/[emailId]/attachments
 *   - Returns all attachments for an email with extracted text
 *
 * GET /api/emails/[emailId]/attachments?id=<attachmentId>&download=true
 *   - Returns the raw file data for download
 */

import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

interface AttachmentResponse {
  id: string;
  filename: string;
  mime_type: string;
  file_size: number;
  extracted_text: string | null;
  extraction_status: string | null;
  extracted_at: string | null;
  created_at: string;
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ emailId: string }> }
) {
  try {
    const { emailId } = await params;
    const { searchParams } = new URL(request.url);
    const attachmentId = searchParams.get('id');
    const download = searchParams.get('download') === 'true';

    // If specific attachment requested for download
    if (attachmentId && download) {
      const { data: attachment, error } = await supabase
        .from('raw_attachments')
        .select('filename, mime_type, file_data')
        .eq('id', attachmentId)
        .eq('email_id', emailId)
        .single();

      if (error || !attachment) {
        return NextResponse.json(
          { error: 'Attachment not found' },
          { status: 404 }
        );
      }

      if (!attachment.file_data) {
        return NextResponse.json(
          { error: 'File data not available' },
          { status: 404 }
        );
      }

      // Decode base64 and return as file
      const buffer = Buffer.from(attachment.file_data, 'base64');

      return new NextResponse(buffer, {
        headers: {
          'Content-Type': attachment.mime_type || 'application/octet-stream',
          'Content-Disposition': `attachment; filename="${attachment.filename}"`,
          'Content-Length': buffer.length.toString()
        }
      });
    }

    // Return list of attachments with metadata (no file_data to reduce payload)
    const { data: attachments, error } = await supabase
      .from('raw_attachments')
      .select(`
        id,
        filename,
        mime_type,
        size_bytes,
        extracted_text,
        extraction_status,
        extracted_at,
        created_at
      `)
      .eq('email_id', emailId)
      .order('created_at', { ascending: true });

    if (error) {
      console.error('[API] Error fetching attachments:', error);
      return NextResponse.json(
        { error: 'Failed to fetch attachments' },
        { status: 500 }
      );
    }

    // Format response
    const response: AttachmentResponse[] = (attachments || []).map(att => ({
      id: att.id,
      filename: att.filename,
      mime_type: att.mime_type,
      file_size: att.size_bytes || 0,
      extracted_text: att.extracted_text,
      extraction_status: att.extraction_status,
      extracted_at: att.extracted_at,
      created_at: att.created_at
    }));

    return NextResponse.json({
      emailId,
      attachments: response,
      count: response.length
    });

  } catch (error: any) {
    console.error('[API] Attachments error:', error);
    return NextResponse.json(
      { error: error.message || 'Internal server error' },
      { status: 500 }
    );
  }
}
