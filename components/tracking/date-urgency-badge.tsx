'use client';

/**
 * Date Urgency Badge Component
 * Highlights dates based on urgency (overdue, today, approaching, upcoming)
 */

import { AlertTriangle, Clock, CheckCircle, AlertCircle } from 'lucide-react';

type UrgencyLevel = 'overdue' | 'today' | 'approaching' | 'upcoming' | 'normal';

interface DateUrgencyBadgeProps {
  date: string;
  label?: string;
  showIcon?: boolean;
  size?: 'sm' | 'md';
  approachingDays?: number; // Days to consider "approaching" (default 3)
}

const MILLISECONDS_PER_DAY = 24 * 60 * 60 * 1000;

function getUrgencyLevel(date: string, approachingDays: number = 3): UrgencyLevel {
  const targetDate = new Date(date);
  const now = new Date();

  // Reset time to compare dates only
  const target = new Date(targetDate.getFullYear(), targetDate.getMonth(), targetDate.getDate());
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());

  const diffMs = target.getTime() - today.getTime();
  const diffDays = Math.ceil(diffMs / MILLISECONDS_PER_DAY);

  if (diffDays < 0) return 'overdue';
  if (diffDays === 0) return 'today';
  if (diffDays <= approachingDays) return 'approaching';
  if (diffDays <= 7) return 'upcoming';
  return 'normal';
}

const urgencyConfig: Record<UrgencyLevel, {
  icon: any;
  bgColor: string;
  textColor: string;
  borderColor: string;
  label: string;
}> = {
  overdue: {
    icon: AlertCircle,
    bgColor: 'bg-red-100',
    textColor: 'text-red-800',
    borderColor: 'border-red-300',
    label: 'Overdue'
  },
  today: {
    icon: AlertTriangle,
    bgColor: 'bg-orange-100',
    textColor: 'text-orange-800',
    borderColor: 'border-orange-300',
    label: 'Today'
  },
  approaching: {
    icon: Clock,
    bgColor: 'bg-yellow-100',
    textColor: 'text-yellow-800',
    borderColor: 'border-yellow-300',
    label: 'Soon'
  },
  upcoming: {
    icon: Clock,
    bgColor: 'bg-blue-50',
    textColor: 'text-blue-700',
    borderColor: 'border-blue-200',
    label: 'Upcoming'
  },
  normal: {
    icon: CheckCircle,
    bgColor: 'bg-gray-50',
    textColor: 'text-gray-700',
    borderColor: 'border-gray-200',
    label: ''
  }
};

export function DateUrgencyBadge({
  date,
  label,
  showIcon = true,
  size = 'md',
  approachingDays = 3
}: DateUrgencyBadgeProps) {
  const urgency = getUrgencyLevel(date, approachingDays);
  const config = urgencyConfig[urgency];
  const Icon = config.icon;

  const sizeClasses = {
    sm: 'px-2 py-0.5 text-xs',
    md: 'px-2.5 py-1 text-sm'
  };

  const iconSizes = {
    sm: 'h-3 w-3',
    md: 'h-4 w-4'
  };

  const formattedDate = new Date(date).toLocaleDateString('en-US', {
    day: '2-digit',
    month: 'short',
    year: 'numeric'
  });

  // Only show badge styling for urgent items
  if (urgency === 'normal') {
    return (
      <span className="text-gray-900">
        {label && <span className="text-gray-500 mr-1">{label}:</span>}
        {formattedDate}
      </span>
    );
  }

  return (
    <span
      className={`
        inline-flex items-center gap-1.5 rounded-md border font-medium
        ${config.bgColor} ${config.textColor} ${config.borderColor} ${sizeClasses[size]}
      `}
    >
      {showIcon && <Icon className={iconSizes[size]} />}
      {label && <span className="font-normal opacity-75">{label}:</span>}
      <span>{formattedDate}</span>
      {config.label && <span className="opacity-75">({config.label})</span>}
    </span>
  );
}

/**
 * Get urgency level for a date - utility function for filtering
 */
export function getDateUrgency(date: string | null | undefined, approachingDays: number = 3): UrgencyLevel | null {
  if (!date) return null;
  return getUrgencyLevel(date, approachingDays);
}

/**
 * Check if a date is approaching or urgent (includes overdue)
 */
export function isDateUrgent(date: string | null | undefined, approachingDays: number = 3): boolean {
  if (!date) return false;
  const urgency = getUrgencyLevel(date, approachingDays);
  return urgency === 'overdue' || urgency === 'today' || urgency === 'approaching';
}

/**
 * Check if a date is in the future and approaching (NOT overdue)
 */
export function isDateApproaching(date: string | null | undefined, approachingDays: number = 3): boolean {
  if (!date) return false;
  const urgency = getUrgencyLevel(date, approachingDays);
  return urgency === 'today' || urgency === 'approaching';
}

/**
 * Check if a date is overdue (past)
 */
export function isDateOverdue(date: string | null | undefined): boolean {
  if (!date) return false;
  const urgency = getUrgencyLevel(date);
  return urgency === 'overdue';
}
