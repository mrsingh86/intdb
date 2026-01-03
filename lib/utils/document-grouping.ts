/**
 * Document Grouping Utilities
 * Shared logic for grouping and deduplicating shipment documents
 */

import { ShipmentDocument } from '@/types/shipment';
import { DocumentDirection, PartyType, WorkflowState } from '@/types/email-intelligence';

export interface DocumentWithFlow extends ShipmentDocument {
  gmail_message_id?: string;
  true_sender_email?: string;
  sender_email?: string;
  received_at?: string;
  classification?: {
    document_direction?: DocumentDirection;
    sender_party_type?: PartyType;
    receiver_party_type?: PartyType;
    workflow_state?: WorkflowState;
    requires_approval_from?: PartyType | null;
    revision_type?: 'original' | 'update' | 'amendment' | 'cancellation';
    revision_number?: number;
  };
}

export interface GroupedDocument {
  document_type: string;
  true_sender: string;
  sender_display: string;
  versions: DocumentWithFlow[];
  latest: DocumentWithFlow;
  version_count: number;
}

/**
 * Carrier domain to display name mapping
 */
const CARRIER_DISPLAY_NAMES: Record<string, string> = {
  maersk: 'Maersk',
  hapag: 'Hapag-Lloyd',
  msc: 'MSC',
  cma: 'CMA CGM',
  'one-line': 'ONE',
  evergreen: 'Evergreen',
  intoglo: 'Intoglo',
  cosco: 'COSCO',
  yangming: 'Yang Ming',
};

/**
 * Extract display-friendly sender name from email address
 */
export function extractSenderDisplayName(email: string): string {
  if (!email || email === 'unknown') return 'Unknown';

  const domain = email.split('@')[1] || email;

  for (const [pattern, name] of Object.entries(CARRIER_DISPLAY_NAMES)) {
    if (domain.includes(pattern)) return name;
  }

  // Fallback: capitalize first part of domain
  const domainPart = domain.split('.')[0];
  return domainPart.charAt(0).toUpperCase() + domainPart.slice(1);
}

/**
 * Deduplicate documents by gmail_message_id
 */
export function deduplicateByMessageId(docs: DocumentWithFlow[]): DocumentWithFlow[] {
  const seen = new Set<string>();
  return docs.filter((doc) => {
    if (doc.gmail_message_id && seen.has(doc.gmail_message_id)) {
      return false;
    }
    if (doc.gmail_message_id) {
      seen.add(doc.gmail_message_id);
    }
    return true;
  });
}

/**
 * Group documents by (document_type + true_sender_email)
 * Returns groups with latest document and version count
 */
export function groupDocumentsBySenderAndType(docs: DocumentWithFlow[]): GroupedDocument[] {
  const seen = new Set<string>();
  const groups = new Map<string, DocumentWithFlow[]>();

  for (const doc of docs) {
    // Skip duplicates
    if (doc.gmail_message_id && seen.has(doc.gmail_message_id)) {
      continue;
    }
    if (doc.gmail_message_id) {
      seen.add(doc.gmail_message_id);
    }

    const sender = doc.true_sender_email || doc.sender_email || 'unknown';
    const key = `${doc.document_type}|${sender}`;

    if (!groups.has(key)) {
      groups.set(key, []);
    }
    groups.get(key)!.push(doc);
  }

  return Array.from(groups.entries()).map(([key, versions]) => {
    // Sort by date descending (newest first)
    const sorted = versions.sort((a, b) => {
      const dateA = new Date(a.received_at || a.document_date || a.created_at || 0);
      const dateB = new Date(b.received_at || b.document_date || b.created_at || 0);
      return dateB.getTime() - dateA.getTime();
    });

    const [docType, sender] = key.split('|');

    return {
      document_type: docType,
      true_sender: sender,
      sender_display: extractSenderDisplayName(sender),
      versions: sorted,
      latest: sorted[0],
      version_count: sorted.length,
    };
  });
}

/**
 * Sort grouped documents by latest document date
 */
export function sortGroupsByLatestDate(groups: GroupedDocument[]): GroupedDocument[] {
  return [...groups].sort((a, b) => {
    const dateA = new Date(
      a.latest.received_at || a.latest.document_date || a.latest.created_at || 0
    );
    const dateB = new Date(
      b.latest.received_at || b.latest.document_date || b.latest.created_at || 0
    );
    return dateB.getTime() - dateA.getTime();
  });
}
