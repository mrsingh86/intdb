/**
 * Document Flow Badge Component
 * Shows document direction and party types
 * Visual representation of document flow: sender → receiver
 */

import { PartyType, DocumentDirection } from '@/types/email-intelligence'
import {
  ArrowDownLeft,
  ArrowUpRight,
  RefreshCw,
  Ship,
  Building2,
  Briefcase,
  User,
  Users,
  Truck,
  Globe,
  UserCheck,
  HelpCircle
} from 'lucide-react'

interface DocumentFlowBadgeProps {
  direction: DocumentDirection
  senderPartyType?: PartyType
  receiverPartyType?: PartyType
  size?: 'sm' | 'md' | 'lg'
  showLabels?: boolean
  variant?: 'default' | 'compact' | 'detailed'
}

const directionConfig = {
  inbound: {
    icon: ArrowDownLeft,
    label: 'Inbound',
    color: 'text-blue-600',
    bgColor: 'bg-blue-100',
    borderColor: 'border-blue-200'
  },
  outbound: {
    icon: ArrowUpRight,
    label: 'Outbound',
    color: 'text-green-600',
    bgColor: 'bg-green-100',
    borderColor: 'border-green-200'
  },
  internal: {
    icon: RefreshCw,
    label: 'Internal',
    color: 'text-gray-600',
    bgColor: 'bg-gray-100',
    borderColor: 'border-gray-200'
  }
}

const partyTypeConfig: Record<PartyType, { icon: any; label: string; shortLabel: string; color: string }> = {
  shipping_line: {
    icon: Ship,
    label: 'Shipping Line',
    shortLabel: 'Carrier',
    color: 'text-cyan-600'
  },
  cha: {
    icon: Building2,
    label: 'Clearing Agent',
    shortLabel: 'CHA',
    color: 'text-orange-600'
  },
  custom_broker: {
    icon: Briefcase,
    label: 'Customs Broker',
    shortLabel: 'Broker',
    color: 'text-amber-600'
  },
  consignee: {
    icon: User,
    label: 'Consignee',
    shortLabel: 'Consignee',
    color: 'text-purple-600'
  },
  shipper: {
    icon: Users,
    label: 'Shipper',
    shortLabel: 'Shipper',
    color: 'text-indigo-600'
  },
  forwarder: {
    icon: Truck,
    label: 'Freight Forwarder',
    shortLabel: 'Forwarder',
    color: 'text-teal-600'
  },
  intoglo: {
    icon: Globe,
    label: 'Intoglo',
    shortLabel: 'Intoglo',
    color: 'text-blue-600'
  },
  agent: {
    icon: UserCheck,
    label: 'Agent',
    shortLabel: 'Agent',
    color: 'text-emerald-600'
  },
  unknown: {
    icon: HelpCircle,
    label: 'Unknown',
    shortLabel: 'Unknown',
    color: 'text-gray-400'
  }
}

const sizeClasses = {
  sm: {
    badge: 'px-2 py-1 text-xs',
    icon: 'h-3 w-3',
    arrow: 'h-3 w-3'
  },
  md: {
    badge: 'px-3 py-1.5 text-sm',
    icon: 'h-4 w-4',
    arrow: 'h-4 w-4'
  },
  lg: {
    badge: 'px-4 py-2 text-base',
    icon: 'h-5 w-5',
    arrow: 'h-5 w-5'
  }
}

export function DocumentFlowBadge({
  direction,
  senderPartyType,
  receiverPartyType,
  size = 'md',
  showLabels = true,
  variant = 'default'
}: DocumentFlowBadgeProps) {
  const dirConfig = directionConfig[direction]
  const DirectionIcon = dirConfig.icon
  const sizes = sizeClasses[size]

  if (variant === 'compact') {
    return (
      <span
        className={`
          inline-flex items-center gap-1 rounded-full border font-medium
          ${dirConfig.bgColor} ${dirConfig.color} ${dirConfig.borderColor} ${sizes.badge}
        `}
        title={`${dirConfig.label}${senderPartyType ? ` from ${partyTypeConfig[senderPartyType].label}` : ''}`}
      >
        <DirectionIcon className={sizes.icon} />
        {showLabels && <span>{dirConfig.label}</span>}
      </span>
    )
  }

  if (variant === 'detailed' && senderPartyType && receiverPartyType) {
    return <DetailedFlowBadge
      direction={direction}
      senderPartyType={senderPartyType}
      receiverPartyType={receiverPartyType}
      size={size}
    />
  }

  // Default variant
  const SenderIcon = senderPartyType ? partyTypeConfig[senderPartyType].icon : null
  const senderConfig = senderPartyType ? partyTypeConfig[senderPartyType] : null

  return (
    <div className="inline-flex items-center gap-2">
      <span
        className={`
          inline-flex items-center gap-1.5 rounded-md border font-medium
          ${dirConfig.bgColor} ${dirConfig.color} ${dirConfig.borderColor} ${sizes.badge}
        `}
      >
        <DirectionIcon className={sizes.icon} />
        <span>{dirConfig.label}</span>
      </span>

      {senderConfig && SenderIcon && (
        <span
          className={`
            inline-flex items-center gap-1.5 rounded-md border border-gray-200 bg-white font-medium
            ${senderConfig.color} ${sizes.badge}
          `}
        >
          <SenderIcon className={sizes.icon} />
          <span>from {showLabels ? senderConfig.label : senderConfig.shortLabel}</span>
        </span>
      )}
    </div>
  )
}

function DetailedFlowBadge({
  direction,
  senderPartyType,
  receiverPartyType,
  size
}: {
  direction: DocumentDirection
  senderPartyType: PartyType
  receiverPartyType: PartyType
  size: 'sm' | 'md' | 'lg'
}) {
  const senderConfig = partyTypeConfig[senderPartyType]
  const receiverConfig = partyTypeConfig[receiverPartyType]
  const SenderIcon = senderConfig.icon
  const ReceiverIcon = receiverConfig.icon
  const sizes = sizeClasses[size]

  return (
    <div className="inline-flex items-center gap-2 rounded-lg border border-gray-200 bg-white px-3 py-2">
      {/* Sender */}
      <div className="flex items-center gap-1.5">
        <div className={`rounded-full p-1 bg-gray-100`}>
          <SenderIcon className={`${sizes.icon} ${senderConfig.color}`} />
        </div>
        <span className="text-sm font-medium text-gray-700">
          {senderConfig.shortLabel}
        </span>
      </div>

      {/* Arrow */}
      <div className="flex items-center px-2">
        <div className="h-px w-4 bg-gray-300" />
        <svg
          className={`${sizes.arrow} text-gray-400`}
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
        >
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
        </svg>
      </div>

      {/* Receiver */}
      <div className="flex items-center gap-1.5">
        <div className={`rounded-full p-1 bg-gray-100`}>
          <ReceiverIcon className={`${sizes.icon} ${receiverConfig.color}`} />
        </div>
        <span className="text-sm font-medium text-gray-700">
          {receiverConfig.shortLabel}
        </span>
      </div>
    </div>
  )
}

// Standalone party type badge for use in tables/lists
export function PartyTypeBadge({
  partyType,
  size = 'sm'
}: {
  partyType: PartyType
  size?: 'sm' | 'md'
}) {
  const config = partyTypeConfig[partyType]
  const Icon = config.icon
  const sizes = sizeClasses[size]

  return (
    <span
      className={`
        inline-flex items-center gap-1 rounded-md border border-gray-200 bg-white font-medium
        ${config.color} ${sizes.badge}
      `}
    >
      <Icon className={sizes.icon} />
      <span>{config.shortLabel}</span>
    </span>
  )
}
