/**
 * Revision Badge Component
 * Shows document revision status (original, 1st update, amendment, etc.)
 */

import {
  FileText,
  RefreshCw,
  Edit3,
  XCircle
} from 'lucide-react'

type RevisionType = 'original' | 'update' | 'amendment' | 'cancellation'

interface RevisionBadgeProps {
  revisionType: RevisionType
  revisionNumber?: number
  size?: 'sm' | 'md' | 'lg'
}

const revisionConfig: Record<RevisionType, {
  icon: any
  label: string
  color: string
  bgColor: string
  borderColor: string
}> = {
  original: {
    icon: FileText,
    label: 'Original',
    color: 'text-gray-700',
    bgColor: 'bg-gray-100',
    borderColor: 'border-gray-200'
  },
  update: {
    icon: RefreshCw,
    label: 'Update',
    color: 'text-blue-700',
    bgColor: 'bg-blue-100',
    borderColor: 'border-blue-200'
  },
  amendment: {
    icon: Edit3,
    label: 'Amendment',
    color: 'text-amber-700',
    bgColor: 'bg-amber-100',
    borderColor: 'border-amber-200'
  },
  cancellation: {
    icon: XCircle,
    label: 'Cancelled',
    color: 'text-red-700',
    bgColor: 'bg-red-100',
    borderColor: 'border-red-200'
  }
}

const sizeClasses = {
  sm: {
    badge: 'px-2 py-0.5 text-xs',
    icon: 'h-3 w-3'
  },
  md: {
    badge: 'px-2.5 py-1 text-sm',
    icon: 'h-4 w-4'
  },
  lg: {
    badge: 'px-3 py-1.5 text-base',
    icon: 'h-5 w-5'
  }
}

function getOrdinalSuffix(num: number): string {
  const j = num % 10
  const k = num % 100
  if (j === 1 && k !== 11) return 'st'
  if (j === 2 && k !== 12) return 'nd'
  if (j === 3 && k !== 13) return 'rd'
  return 'th'
}

export function RevisionBadge({
  revisionType,
  revisionNumber = 0,
  size = 'md'
}: RevisionBadgeProps) {
  // Fallback to 'original' if revisionType is unknown
  const safeRevisionType = revisionConfig[revisionType] ? revisionType : 'original'
  const config = revisionConfig[safeRevisionType]
  const Icon = config.icon
  const sizes = sizeClasses[size]

  // For original, just show "Original"
  if (safeRevisionType === 'original') {
    return (
      <span
        className={`
          inline-flex items-center gap-1.5 rounded-md border font-medium
          ${config.bgColor} ${config.color} ${config.borderColor} ${sizes.badge}
        `}
      >
        <Icon className={sizes.icon} />
        <span>{config.label}</span>
      </span>
    )
  }

  // For updates, show "1st Update", "2nd Update", etc.
  const displayNumber = revisionNumber > 0 ? revisionNumber : 1
  const ordinalLabel = safeRevisionType === 'update'
    ? `${displayNumber}${getOrdinalSuffix(displayNumber)} ${config.label}`
    : safeRevisionType === 'amendment' && revisionNumber > 1
      ? `${config.label} ${revisionNumber}`
      : config.label

  return (
    <span
      className={`
        inline-flex items-center gap-1.5 rounded-md border font-medium
        ${config.bgColor} ${config.color} ${config.borderColor} ${sizes.badge}
      `}
    >
      <Icon className={sizes.icon} />
      <span>{ordinalLabel}</span>
    </span>
  )
}
