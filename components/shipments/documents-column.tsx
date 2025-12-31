'use client';

import { useState, useEffect } from 'react';
import {
  ChevronDown,
  ChevronUp,
  ArrowRight,
  ArrowLeft,
  Star,
  Loader2,
  Ship,
  Building2,
  Landmark,
  Truck,
  Users,
  HelpCircle
} from 'lucide-react';

type PartyType = 'carrier' | 'internal' | 'government' | 'cha' | 'trucker' | 'partner' | 'customer' | 'unknown';

interface PartyInfo {
  type: PartyType;
  name: string;
  shortName: string;
  color: string;
}

interface DocumentSummary {
  total_count: number;
  latest_document: {
    type: string;
    direction: 'incoming' | 'outgoing';
    party: PartyInfo;
    sender: string;
    received_at: string;
    subject: string;
  } | null;
  by_type: {
    booking_confirmation: number;
    booking_amendment: number;
    bill_of_lading: number;
    shipping_instruction: number;
    invoice: number;
    other: number;
  };
}

interface Recipient {
  email: string;
  party: {
    type: PartyType;
    name: string;
    shortName: string;
  };
}

interface DocumentDetail {
  id: string;
  email_id: string;
  document_type: string;
  is_primary: boolean;
  sender: string;
  sender_party: PartyInfo;
  recipients: Recipient[];
  direction: 'incoming' | 'outgoing';
  received_at: string;
  subject: string;
}

interface DocumentsColumnProps {
  shipmentId: string;
  bookingNumber: string;
}

// Party type icons
const PartyIcon = ({ type, className }: { type: PartyType; className?: string }) => {
  const iconClass = className || 'h-3 w-3';
  switch (type) {
    case 'carrier':
      return <Ship className={iconClass} />;
    case 'internal':
      return <Building2 className={iconClass} />;
    case 'government':
      return <Landmark className={iconClass} />;
    case 'trucker':
      return <Truck className={iconClass} />;
    case 'customer':
    case 'partner':
      return <Users className={iconClass} />;
    default:
      return <HelpCircle className={iconClass} />;
  }
};

export function DocumentsColumn({ shipmentId, bookingNumber }: DocumentsColumnProps) {
  const [expanded, setExpanded] = useState(false);
  const [summary, setSummary] = useState<DocumentSummary | null>(null);
  const [details, setDetails] = useState<DocumentDetail[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingDetails, setLoadingDetails] = useState(false);

  useEffect(() => {
    fetchSummary();
  }, [shipmentId]);

  const fetchSummary = async () => {
    try {
      const response = await fetch(`/api/shipments/${shipmentId}/documents/summary`);
      const data = await response.json();
      setSummary(data);
    } catch (error) {
      console.error('Failed to fetch document summary:', error);
    } finally {
      setLoading(false);
    }
  };

  const fetchDetails = async () => {
    if (details.length > 0) return;

    setLoadingDetails(true);
    try {
      const response = await fetch(`/api/shipments/${shipmentId}/documents`);
      const data = await response.json();
      setDetails(data.documents || []);
    } catch (error) {
      console.error('Failed to fetch documents:', error);
    } finally {
      setLoadingDetails(false);
    }
  };

  const handleExpand = () => {
    if (!expanded) {
      fetchDetails();
    }
    setExpanded(!expanded);
  };

  if (loading) {
    return (
      <div className="flex items-center gap-1 text-gray-400">
        <Loader2 className="h-3 w-3 animate-spin" />
      </div>
    );
  }

  if (!summary || summary.total_count === 0) {
    return <span className="text-gray-400 text-sm">No docs</span>;
  }

  const formatDateTime = (dateStr: string) => {
    try {
      const date = new Date(dateStr);
      return {
        date: date.toLocaleDateString('en-US', { month: 'short', day: '2-digit' }),
        time: date.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: false })
      };
    } catch {
      return { date: dateStr, time: '' };
    }
  };

  const formatDocType = (type: string) => {
    const map: Record<string, string> = {
      booking_confirmation: 'Confirmation',
      booking_amendment: 'Amendment',
      bill_of_lading: 'B/L',
      shipping_instruction: 'SI',
      invoice: 'Invoice',
      arrival_notice: 'Arrival',
      other: 'Other'
    };
    return map[type] || type;
  };

  const latest = summary.latest_document;

  return (
    <div className="min-w-[220px]">
      {/* Summary Row */}
      <div
        onClick={handleExpand}
        className="flex items-center gap-1.5 cursor-pointer hover:bg-gray-50 rounded px-1 py-0.5 -mx-1"
      >
        {/* Direction Arrow */}
        {latest && (
          <span className="flex-shrink-0">
            {latest.direction === 'incoming' ? (
              <ArrowLeft className="h-3 w-3 text-green-600" />
            ) : (
              <ArrowRight className="h-3 w-3 text-blue-600" />
            )}
          </span>
        )}

        {/* Party Badge with Icon */}
        {latest && (
          <span className={`flex items-center gap-0.5 text-xs px-1 py-0.5 rounded font-medium ${latest.party.color}`}>
            <PartyIcon type={latest.party.type} className="h-2.5 w-2.5" />
            {latest.party.shortName}
          </span>
        )}

        {/* Document Type */}
        {latest && (
          <span className="text-xs text-gray-700">
            {formatDocType(latest.type)}
          </span>
        )}

        {/* Date & Time */}
        {latest && (
          <span className="text-xs text-gray-500">
            {formatDateTime(latest.received_at).date}
          </span>
        )}

        {/* Expand Button */}
        <button className="ml-auto flex items-center gap-1 text-xs text-gray-500 hover:text-gray-700">
          {summary.total_count > 1 && (
            <span className="text-gray-400">+{summary.total_count - 1}</span>
          )}
          {expanded ? (
            <ChevronUp className="h-3 w-3" />
          ) : (
            <ChevronDown className="h-3 w-3" />
          )}
        </button>
      </div>

      {/* Expanded Details */}
      {expanded && (
        <div className="mt-1 border-l-2 border-gray-200 pl-2 ml-1 space-y-0.5">
          {loadingDetails ? (
            <div className="flex items-center gap-2 text-gray-400 text-xs py-1">
              <Loader2 className="h-3 w-3 animate-spin" />
              Loading...
            </div>
          ) : (
            details.map((doc) => {
              const dt = formatDateTime(doc.received_at);
              return (
                <div
                  key={doc.id}
                  className="flex items-center gap-1 text-xs py-0.5"
                >
                  {/* Primary Star */}
                  {doc.is_primary && (
                    <Star className="h-2.5 w-2.5 text-yellow-500 fill-yellow-500 flex-shrink-0" />
                  )}

                  {/* Direction */}
                  <span className="flex-shrink-0">
                    {doc.direction === 'incoming' ? (
                      <ArrowLeft className="h-2.5 w-2.5 text-green-600" />
                    ) : (
                      <ArrowRight className="h-2.5 w-2.5 text-blue-600" />
                    )}
                  </span>

                  {/* Date */}
                  <span className="text-gray-500 w-12 flex-shrink-0">
                    {dt.date}
                  </span>

                  {/* Type */}
                  <span className="text-gray-700 flex-shrink-0">
                    {formatDocType(doc.document_type)}
                  </span>

                  {/* Sender Party */}
                  <span className={`flex items-center gap-0.5 px-1 py-0.5 rounded text-xs ${doc.sender_party.color}`}>
                    <PartyIcon type={doc.sender_party.type} className="h-2 w-2" />
                    {doc.sender_party.shortName}
                  </span>

                  {/* Recipients (if outgoing) */}
                  {doc.direction === 'outgoing' && doc.recipients.length > 0 && (
                    <>
                      <span className="text-gray-400">→</span>
                      {doc.recipients.slice(0, 2).map((r, i) => (
                        <span key={i} className="bg-gray-100 px-1 py-0.5 rounded text-xs">
                          {r.party.shortName}
                        </span>
                      ))}
                    </>
                  )}
                </div>
              );
            })
          )}
        </div>
      )}
    </div>
  );
}

/**
 * Compact version for table cells
 */
export function DocumentsBadges({ summary }: { summary: DocumentSummary | null }) {
  if (!summary || summary.total_count === 0) {
    return <span className="text-gray-400 text-xs">-</span>;
  }

  const badges = [];

  if (summary.by_type.booking_confirmation > 0) {
    badges.push({ label: 'Conf', count: summary.by_type.booking_confirmation, color: 'bg-blue-100 text-blue-800' });
  }
  if (summary.by_type.booking_amendment > 0) {
    badges.push({ label: 'Amend', count: summary.by_type.booking_amendment, color: 'bg-orange-100 text-orange-800' });
  }
  if (summary.by_type.bill_of_lading > 0) {
    badges.push({ label: 'B/L', count: summary.by_type.bill_of_lading, color: 'bg-green-100 text-green-800' });
  }
  if (summary.by_type.shipping_instruction > 0) {
    badges.push({ label: 'SI', count: summary.by_type.shipping_instruction, color: 'bg-purple-100 text-purple-800' });
  }

  return (
    <div className="flex flex-wrap gap-1">
      {badges.map((badge, i) => (
        <span
          key={i}
          className={`inline-flex items-center px-1.5 py-0.5 rounded text-xs font-medium ${badge.color}`}
        >
          {badge.count > 1 && <span className="mr-0.5">{badge.count}</span>}
          {badge.label}
        </span>
      ))}
    </div>
  );
}
