'use client';

import { useState } from 'react';
import Link from 'next/link';
import {
  ChevronDown,
  ChevronRight,
  FileText,
  Mail,
  Ship,
  Anchor,
  Package,
  Truck,
  CheckCircle,
  Clock,
  AlertCircle,
  Calendar,
  User,
} from 'lucide-react';

type ChapterPhase = 'pre_departure' | 'in_transit' | 'arrival' | 'delivery';

interface ChapterEvent {
  id: string;
  type: string;
  title: string;
  description?: string;
  timestamp: string;
  documentType?: string;
  emailId?: string;
  chronicleId?: string;
  actor?: string;
  isKeyMilestone?: boolean;
}

interface JourneyChapterData {
  phase: ChapterPhase;
  title: string;
  subtitle?: string;
  status: 'completed' | 'active' | 'pending';
  startDate?: string;
  endDate?: string;
  events: ChapterEvent[];
  keyMetrics?: {
    label: string;
    value: string;
  }[];
}

interface JourneyChapterProps {
  chapter: JourneyChapterData;
  chapterNumber: number;
  isExpanded?: boolean;
  onToggle?: () => void;
}

/**
 * JourneyChapter - A storytelling component for shipment journey phases
 *
 * Each chapter represents a phase:
 * - Chapter 1: Pre-Departure (Booking, SI, VGM, Documentation)
 * - Chapter 2: In Transit (Sailed, Vessel tracking)
 * - Chapter 3: Arrival (Arrival notice, Customs, Discharge)
 * - Chapter 4: Delivery (Final mile, POD)
 */
export function JourneyChapter({
  chapter,
  chapterNumber,
  isExpanded: controlledExpanded,
  onToggle,
}: JourneyChapterProps) {
  const [internalExpanded, setInternalExpanded] = useState(chapter.status === 'active');
  const isExpanded = controlledExpanded ?? internalExpanded;
  const toggleExpanded = onToggle ?? (() => setInternalExpanded(!internalExpanded));

  const getPhaseConfig = (phase: ChapterPhase) => {
    switch (phase) {
      case 'pre_departure':
        return {
          icon: Package,
          color: 'blue',
          bgColor: 'bg-terminal-blue/10',
          borderColor: 'border-terminal-blue/30',
          textColor: 'text-terminal-blue',
          dotColor: 'bg-terminal-blue',
        };
      case 'in_transit':
        return {
          icon: Ship,
          color: 'purple',
          bgColor: 'bg-terminal-purple/10',
          borderColor: 'border-terminal-purple/30',
          textColor: 'text-terminal-purple',
          dotColor: 'bg-terminal-purple',
        };
      case 'arrival':
        return {
          icon: Anchor,
          color: 'amber',
          bgColor: 'bg-terminal-amber/10',
          borderColor: 'border-terminal-amber/30',
          textColor: 'text-terminal-amber',
          dotColor: 'bg-terminal-amber',
        };
      case 'delivery':
        return {
          icon: Truck,
          color: 'green',
          bgColor: 'bg-terminal-green/10',
          borderColor: 'border-terminal-green/30',
          textColor: 'text-terminal-green',
          dotColor: 'bg-terminal-green',
        };
    }
  };

  const getStatusBadge = (status: string) => {
    switch (status) {
      case 'completed':
        return {
          label: 'Complete',
          bgColor: 'bg-terminal-green/10',
          borderColor: 'border-terminal-green/30',
          textColor: 'text-terminal-green',
          icon: CheckCircle,
        };
      case 'active':
        return {
          label: 'In Progress',
          bgColor: 'bg-terminal-blue/10',
          borderColor: 'border-terminal-blue/30',
          textColor: 'text-terminal-blue',
          icon: Clock,
        };
      default:
        return {
          label: 'Pending',
          bgColor: 'bg-terminal-muted/10',
          borderColor: 'border-terminal-border',
          textColor: 'text-terminal-muted',
          icon: AlertCircle,
        };
    }
  };

  const phaseConfig = getPhaseConfig(chapter.phase);
  const statusBadge = getStatusBadge(chapter.status);
  const PhaseIcon = phaseConfig.icon;
  const StatusIcon = statusBadge.icon;

  return (
    <div className={`rounded-lg border ${chapter.status === 'active' ? phaseConfig.borderColor : 'border-terminal-border'} bg-terminal-surface overflow-hidden`}>
      {/* Chapter Header */}
      <button
        onClick={toggleExpanded}
        className={`w-full px-4 py-3 flex items-center gap-3 ${chapter.status === 'active' ? phaseConfig.bgColor : 'bg-terminal-elevated'} hover:opacity-90 transition-opacity`}
      >
        {/* Expand/Collapse */}
        {isExpanded ? (
          <ChevronDown className="h-4 w-4 text-terminal-muted flex-shrink-0" />
        ) : (
          <ChevronRight className="h-4 w-4 text-terminal-muted flex-shrink-0" />
        )}

        {/* Chapter Number */}
        <div className={`w-8 h-8 rounded-full ${phaseConfig.bgColor} border ${phaseConfig.borderColor} flex items-center justify-center flex-shrink-0`}>
          <span className={`text-sm font-mono font-bold ${phaseConfig.textColor}`}>
            {chapterNumber}
          </span>
        </div>

        {/* Phase Icon */}
        <PhaseIcon className={`h-5 w-5 ${phaseConfig.textColor} flex-shrink-0`} />

        {/* Title & Subtitle */}
        <div className="flex-1 text-left min-w-0">
          <div className={`text-sm font-medium ${chapter.status === 'pending' ? 'text-terminal-muted' : 'text-terminal-text'}`}>
            {chapter.title}
          </div>
          {chapter.subtitle && (
            <div className="text-xs font-mono text-terminal-muted truncate">
              {chapter.subtitle}
            </div>
          )}
        </div>

        {/* Status Badge */}
        <span className={`flex items-center gap-1 px-2 py-0.5 text-[10px] font-mono rounded ${statusBadge.bgColor} border ${statusBadge.borderColor} ${statusBadge.textColor}`}>
          <StatusIcon className="h-3 w-3" />
          {statusBadge.label}
        </span>

        {/* Event Count */}
        <span className="text-xs font-mono text-terminal-muted">
          [{chapter.events.length}]
        </span>
      </button>

      {/* Chapter Content */}
      {isExpanded && (
        <div className="px-4 py-3 border-t border-terminal-border">
          {/* Key Metrics */}
          {chapter.keyMetrics && chapter.keyMetrics.length > 0 && (
            <div className="flex flex-wrap gap-4 mb-4 pb-3 border-b border-terminal-border">
              {chapter.keyMetrics.map((metric, idx) => (
                <div key={idx} className="text-xs font-mono">
                  <span className="text-terminal-muted">{metric.label}: </span>
                  <span className={phaseConfig.textColor}>{metric.value}</span>
                </div>
              ))}
            </div>
          )}

          {/* Timeline */}
          {chapter.events.length > 0 ? (
            <div className="relative">
              {/* Vertical line */}
              <div className={`absolute left-4 top-2 bottom-2 w-0.5 ${chapter.status === 'pending' ? 'bg-terminal-border' : phaseConfig.dotColor}`} />

              <div className="space-y-3">
                {chapter.events.map((event, idx) => (
                  <EventItem
                    key={event.id}
                    event={event}
                    isLast={idx === chapter.events.length - 1}
                    phaseColor={phaseConfig.color}
                  />
                ))}
              </div>
            </div>
          ) : (
            <div className="text-center py-6 text-terminal-muted font-mono text-sm">
              No events recorded for this chapter yet
            </div>
          )}
        </div>
      )}
    </div>
  );
}

interface EventItemProps {
  event: ChapterEvent;
  isLast: boolean;
  phaseColor: string;
}

function EventItem({ event, isLast, phaseColor }: EventItemProps) {
  const getEventIcon = (type: string, documentType?: string) => {
    if (documentType) {
      return FileText;
    }
    if (type.includes('email') || type.includes('received')) return Mail;
    if (type.includes('sail') || type.includes('depart')) return Ship;
    if (type.includes('arriv') || type.includes('dock')) return Anchor;
    if (type.includes('deliver')) return Truck;
    if (type.includes('complete') || type.includes('confirm')) return CheckCircle;
    return Clock;
  };

  const EventIcon = getEventIcon(event.type, event.documentType);

  const dotColorMap: Record<string, string> = {
    blue: event.isKeyMilestone ? 'bg-terminal-blue' : 'bg-terminal-blue/50',
    purple: event.isKeyMilestone ? 'bg-terminal-purple' : 'bg-terminal-purple/50',
    amber: event.isKeyMilestone ? 'bg-terminal-amber' : 'bg-terminal-amber/50',
    green: event.isKeyMilestone ? 'bg-terminal-green' : 'bg-terminal-green/50',
  };

  return (
    <div className="relative pl-10">
      {/* Dot */}
      <div className={`absolute left-2.5 top-1.5 w-3 h-3 rounded-full ${dotColorMap[phaseColor] || 'bg-terminal-muted'} border-2 border-terminal-surface z-10`} />

      <div className="flex items-start gap-3">
        {/* Icon */}
        <div className="flex-shrink-0 w-6 h-6 rounded bg-terminal-elevated flex items-center justify-center border border-terminal-border">
          <EventIcon className="h-3.5 w-3.5 text-terminal-muted" />
        </div>

        {/* Content */}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className={`text-sm font-medium ${event.isKeyMilestone ? 'text-terminal-text' : 'text-terminal-muted'}`}>
              {event.title}
            </span>
            {event.documentType && (
              <span className="px-1.5 py-0.5 text-[10px] font-mono bg-terminal-blue/10 text-terminal-blue border border-terminal-blue/30 rounded">
                {event.documentType.replace(/_/g, ' ')}
              </span>
            )}
            {event.isKeyMilestone && (
              <span className="px-1.5 py-0.5 text-[10px] font-mono bg-terminal-green/10 text-terminal-green border border-terminal-green/30 rounded">
                Milestone
              </span>
            )}
          </div>

          {event.description && (
            <p className="text-xs text-terminal-muted mt-0.5">{event.description}</p>
          )}

          <div className="flex items-center gap-3 mt-1 text-[10px] font-mono text-terminal-muted">
            <span className="flex items-center gap-1">
              <Calendar className="h-3 w-3" />
              {new Date(event.timestamp).toLocaleString()}
            </span>
            {event.actor && (
              <span className="flex items-center gap-1">
                <User className="h-3 w-3" />
                {event.actor}
              </span>
            )}
            {event.emailId && (
              <Link
                href={`/emails/${event.emailId}`}
                className="text-terminal-blue hover:text-terminal-green transition-colors"
              >
                [view email]
              </Link>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

/**
 * JourneyStory - Full shipment journey as a story with all chapters
 */
interface JourneyStoryProps {
  chapters: JourneyChapterData[];
  bookingNumber?: string;
}

export function JourneyStory({ chapters, bookingNumber }: JourneyStoryProps) {
  const [expandedChapters, setExpandedChapters] = useState<Set<number>>(() => {
    // Initially expand active chapters
    const active = new Set<number>();
    chapters.forEach((ch, idx) => {
      if (ch.status === 'active') active.add(idx);
    });
    return active;
  });

  const toggleChapter = (index: number) => {
    setExpandedChapters(prev => {
      const next = new Set(prev);
      if (next.has(index)) {
        next.delete(index);
      } else {
        next.add(index);
      }
      return next;
    });
  };

  return (
    <div className="space-y-4">
      {/* Story Header */}
      <div className="flex items-center gap-3 pb-3 border-b border-terminal-border">
        <Ship className="h-5 w-5 text-terminal-purple" />
        <div>
          <h2 className="text-lg font-semibold text-terminal-text">
            The Journey of {bookingNumber || 'This Shipment'}
          </h2>
          <p className="text-xs font-mono text-terminal-muted">
            {chapters.filter(c => c.status === 'completed').length}/{chapters.length} chapters completed
          </p>
        </div>
      </div>

      {/* Chapters */}
      <div className="space-y-3">
        {chapters.map((chapter, index) => (
          <JourneyChapter
            key={chapter.phase}
            chapter={chapter}
            chapterNumber={index + 1}
            isExpanded={expandedChapters.has(index)}
            onToggle={() => toggleChapter(index)}
          />
        ))}
      </div>
    </div>
  );
}

export default JourneyChapter;
