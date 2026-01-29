'use client';

import { useState, useEffect } from 'react';
import {
  X,
  Send,
  Copy,
  Check,
  User,
  Mail,
  Clock,
  AlertTriangle,
  Sparkles,
} from 'lucide-react';
import type { StakeholderSummary, NarrativeChain, ChainOfThoughtRecommendation } from '@/lib/chronicle-v2';

interface DraftEmailModalProps {
  isOpen: boolean;
  onClose: () => void;
  stakeholder: StakeholderSummary | null;
  shipmentId: string;
  bookingNumber: string | null;
  recommendation?: ChainOfThoughtRecommendation | null;
  relatedChain?: NarrativeChain | null;
}

/**
 * DraftEmailModal
 *
 * Modal for drafting emails to stakeholders with:
 * - Pre-populated recipient from stakeholder
 * - Context-aware subject line suggestions
 * - AI-generated draft based on chain/recommendation
 * - Copy to clipboard functionality
 */
export function DraftEmailModal({
  isOpen,
  onClose,
  stakeholder,
  shipmentId,
  bookingNumber,
  recommendation,
  relatedChain,
}: DraftEmailModalProps) {
  const [to, setTo] = useState('');
  const [subject, setSubject] = useState('');
  const [body, setBody] = useState('');
  const [generating, setGenerating] = useState(false);
  const [copied, setCopied] = useState(false);

  // Initialize fields when modal opens
  useEffect(() => {
    if (isOpen && stakeholder) {
      setTo(stakeholder.contactEmail || '');
      generateInitialContent();
    }
  }, [isOpen, stakeholder, recommendation, relatedChain]);

  const generateInitialContent = () => {
    if (!stakeholder) return;

    const companyName = stakeholder.companyName || stakeholder.displayName;
    const bookingRef = bookingNumber ? `Booking ${bookingNumber}` : 'shipment';

    // Generate subject based on context
    let subjectLine = `Follow up - ${bookingRef}`;
    let bodyContent = '';

    if (recommendation) {
      // Use recommendation context
      subjectLine = `${recommendation.action} - ${bookingRef}`;
      bodyContent = generateBodyFromRecommendation(recommendation, companyName);
    } else if (relatedChain) {
      // Use chain context
      subjectLine = `${relatedChain.narrativeHeadline || 'Update'} - ${bookingRef}`;
      bodyContent = generateBodyFromChain(relatedChain, companyName);
    } else if (stakeholder.responsiveness.unansweredCount > 0) {
      // Follow-up for unanswered messages
      subjectLine = `Following up - ${bookingRef}`;
      bodyContent = generateFollowUpBody(stakeholder, companyName);
    } else {
      // Generic follow-up
      bodyContent = generateGenericBody(stakeholder, companyName);
    }

    setSubject(subjectLine);
    setBody(bodyContent);
  };

  const generateBodyFromRecommendation = (rec: ChainOfThoughtRecommendation, companyName: string): string => {
    const greeting = `Hi ${companyName} team,`;
    const context = rec.reason ? `\n\nRegarding: ${rec.reason}` : '';
    const action = `\n\nWe need to: ${rec.action}`;
    const chainOfThought = rec.chainOfThought
      ? `\n\nContext:\n${rec.chainOfThought.split('\n').slice(0, 3).join('\n')}`
      : '';
    const closing = '\n\nPlease advise on the next steps.\n\nBest regards,\n[Your name]';

    return `${greeting}${context}${action}${chainOfThought}${closing}`;
  };

  const generateBodyFromChain = (chain: NarrativeChain, companyName: string): string => {
    const greeting = `Hi ${companyName} team,`;
    const summary = chain.narrativeSummary
      ? `\n\nRegarding: ${chain.narrativeSummary}`
      : '';
    const currentState = chain.currentState
      ? `\n\nCurrent status: ${chain.currentState}`
      : '';
    const daysInState = chain.daysInCurrentState > 0
      ? `\n\nThis has been pending for ${chain.daysInCurrentState} day(s).`
      : '';
    const closing = '\n\nCould you please provide an update?\n\nBest regards,\n[Your name]';

    return `${greeting}${summary}${currentState}${daysInState}${closing}`;
  };

  const generateFollowUpBody = (stakeholder: StakeholderSummary, companyName: string): string => {
    const greeting = `Hi ${companyName} team,`;
    const context = `\n\nI'm following up on our previous communication.`;
    const unanswered = stakeholder.responsiveness.unansweredCount > 1
      ? `\n\nWe have ${stakeholder.responsiveness.unansweredCount} items pending your response.`
      : '\n\nWe have an item pending your response.';

    // Add recent communication context if available
    let recentContext = '';
    if (stakeholder.recentCommunications.length > 0) {
      const recent = stakeholder.recentCommunications[0];
      if (recent.hasPendingAction) {
        recentContext = `\n\nMost recent: "${recent.summary}"`;
      }
    }

    const closing = '\n\nPlease let us know the status at your earliest convenience.\n\nBest regards,\n[Your name]';

    return `${greeting}${context}${unanswered}${recentContext}${closing}`;
  };

  const generateGenericBody = (stakeholder: StakeholderSummary, companyName: string): string => {
    const greeting = `Hi ${companyName} team,`;
    const intro = '\n\nHope this email finds you well.';

    let context = '';
    if (stakeholder.stats.daysSinceLastContact && stakeholder.stats.daysSinceLastContact > 3) {
      context = `\n\nIt's been ${stakeholder.stats.daysSinceLastContact} days since our last communication.`;
    }

    const closing = '\n\nPlease let me know if there are any updates.\n\nBest regards,\n[Your name]';

    return `${greeting}${intro}${context}${closing}`;
  };

  const handleCopy = () => {
    const fullEmail = `To: ${to}\nSubject: ${subject}\n\n${body}`;
    navigator.clipboard.writeText(fullEmail);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleSendViaGmail = () => {
    const gmailUrl = `https://mail.google.com/mail/?view=cm&to=${encodeURIComponent(to)}&su=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
    window.open(gmailUrl, '_blank');
  };

  if (!isOpen || !stakeholder) return null;

  const roleLabel = stakeholder.partyRole === 'vendor' ? 'Vendor'
    : stakeholder.partyRole === 'customer' ? 'Customer'
    : stakeholder.partyRole === 'partner' ? 'Partner'
    : 'Internal';

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center"
      style={{ backgroundColor: 'rgba(0, 0, 0, 0.7)' }}
    >
      <div
        className="w-full max-w-2xl mx-4 rounded-lg border shadow-xl"
        style={{
          backgroundColor: 'var(--ink-surface)',
          borderColor: 'var(--ink-border-subtle)',
        }}
      >
        {/* Header */}
        <div
          className="flex items-center justify-between p-4 border-b"
          style={{ borderColor: 'var(--ink-border-subtle)' }}
        >
          <div className="flex items-center gap-3">
            <Mail size={20} style={{ color: 'var(--ink-accent)' }} />
            <div>
              <h2
                className="text-base font-semibold"
                style={{ color: 'var(--ink-text-primary)' }}
              >
                Draft Email
              </h2>
              <div className="flex items-center gap-2 text-xs" style={{ color: 'var(--ink-text-muted)' }}>
                <span>{stakeholder.companyName || stakeholder.displayName}</span>
                <span
                  className="px-1.5 py-0.5 rounded uppercase"
                  style={{
                    backgroundColor: 'var(--ink-elevated)',
                    color: 'var(--ink-text-muted)',
                  }}
                >
                  {roleLabel}
                </span>
              </div>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-2 rounded transition-colors"
            style={{ color: 'var(--ink-text-muted)' }}
          >
            <X size={20} />
          </button>
        </div>

        {/* Content */}
        <div className="p-4 space-y-4">
          {/* Stakeholder context */}
          <div
            className="flex items-center gap-4 p-3 rounded text-xs"
            style={{ backgroundColor: 'var(--ink-elevated)' }}
          >
            <div className="flex items-center gap-2">
              <User size={14} style={{ color: 'var(--ink-text-muted)' }} />
              <span style={{ color: 'var(--ink-text-secondary)' }}>
                {stakeholder.stats.totalEmails} emails
              </span>
            </div>
            <div className="flex items-center gap-2">
              <Clock size={14} style={{ color: 'var(--ink-text-muted)' }} />
              <span style={{ color: 'var(--ink-text-secondary)' }}>
                Avg response: {stakeholder.responsiveness.avgResponseHours
                  ? `${Math.round(stakeholder.responsiveness.avgResponseHours)}h`
                  : '—'}
              </span>
            </div>
            {stakeholder.responsiveness.unansweredCount > 0 && (
              <div className="flex items-center gap-2">
                <AlertTriangle size={14} style={{ color: 'var(--ink-warning)' }} />
                <span style={{ color: 'var(--ink-warning)' }}>
                  {stakeholder.responsiveness.unansweredCount} unanswered
                </span>
              </div>
            )}
          </div>

          {/* To field */}
          <div>
            <label
              className="block text-xs font-medium mb-1"
              style={{ color: 'var(--ink-text-muted)' }}
            >
              To
            </label>
            <input
              type="email"
              value={to}
              onChange={(e) => setTo(e.target.value)}
              className="w-full px-3 py-2 rounded border text-sm"
              style={{
                backgroundColor: 'var(--ink-elevated)',
                borderColor: 'var(--ink-border-subtle)',
                color: 'var(--ink-text-primary)',
              }}
              placeholder="recipient@example.com"
            />
          </div>

          {/* Subject field */}
          <div>
            <label
              className="block text-xs font-medium mb-1"
              style={{ color: 'var(--ink-text-muted)' }}
            >
              Subject
            </label>
            <input
              type="text"
              value={subject}
              onChange={(e) => setSubject(e.target.value)}
              className="w-full px-3 py-2 rounded border text-sm"
              style={{
                backgroundColor: 'var(--ink-elevated)',
                borderColor: 'var(--ink-border-subtle)',
                color: 'var(--ink-text-primary)',
              }}
              placeholder="Email subject"
            />
          </div>

          {/* Body field */}
          <div>
            <label
              className="block text-xs font-medium mb-1"
              style={{ color: 'var(--ink-text-muted)' }}
            >
              Message
            </label>
            <textarea
              value={body}
              onChange={(e) => setBody(e.target.value)}
              rows={10}
              className="w-full px-3 py-2 rounded border text-sm font-mono resize-none"
              style={{
                backgroundColor: 'var(--ink-elevated)',
                borderColor: 'var(--ink-border-subtle)',
                color: 'var(--ink-text-primary)',
              }}
              placeholder="Email body..."
            />
          </div>
        </div>

        {/* Footer */}
        <div
          className="flex items-center justify-between p-4 border-t"
          style={{ borderColor: 'var(--ink-border-subtle)' }}
        >
          <button
            onClick={handleCopy}
            className="flex items-center gap-2 text-sm px-4 py-2 rounded transition-colors"
            style={{
              backgroundColor: 'var(--ink-elevated)',
              color: 'var(--ink-text-secondary)',
            }}
          >
            {copied ? <Check size={16} /> : <Copy size={16} />}
            {copied ? 'Copied!' : 'Copy to Clipboard'}
          </button>

          <div className="flex items-center gap-2">
            <button
              onClick={onClose}
              className="text-sm px-4 py-2 rounded transition-colors"
              style={{
                backgroundColor: 'var(--ink-elevated)',
                color: 'var(--ink-text-secondary)',
              }}
            >
              Cancel
            </button>
            <button
              onClick={handleSendViaGmail}
              className="flex items-center gap-2 text-sm px-4 py-2 rounded transition-colors"
              style={{
                backgroundColor: 'var(--ink-accent)',
                color: 'white',
              }}
            >
              <Send size={16} />
              Open in Gmail
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
