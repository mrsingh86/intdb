import { DocumentType } from '@/types/email-intelligence'
import {
  FileText,
  FileEdit,
  Ship,
  Anchor,
  ClipboardList,
  Receipt,
  Package,
  FileBox,
  FileCheck,
  DollarSign,
  Calendar,
  Truck,
  CreditCard,
  HelpCircle,
  XCircle
} from 'lucide-react'

interface DocumentTypeBadgeProps {
  type: DocumentType
  size?: 'sm' | 'md' | 'lg'
  showIcon?: boolean
  variant?: 'default' | 'outline'
}

const documentTypeConfig = {
  booking_confirmation: {
    label: 'Booking Confirmation',
    color: 'blue',
    icon: FileCheck
  },
  booking_amendment: {
    label: 'Amendment',
    color: 'amber',
    icon: FileEdit
  },
  general_correspondence: {
    label: 'Correspondence',
    color: 'slate',
    icon: FileText
  },
  sob_confirmation: {
    label: 'SOB Confirmation',
    color: 'cyan',
    icon: Ship
  },
  shipment_notice: {
    label: 'Shipment Notice',
    color: 'sky',
    icon: FileText
  },
  si_draft: {
    label: 'SI Draft',
    color: 'indigo',
    icon: ClipboardList
  },
  arrival_notice: {
    label: 'Arrival Notice',
    color: 'green',
    icon: Ship
  },
  bill_of_lading: {
    label: 'Bill of Lading',
    color: 'purple',
    icon: Anchor
  },
  shipping_instruction: {
    label: 'Shipping Instruction',
    color: 'indigo',
    icon: ClipboardList
  },
  invoice: {
    label: 'Invoice',
    color: 'emerald',
    icon: Receipt
  },
  delivery_order: {
    label: 'Delivery Order',
    color: 'teal',
    icon: Truck
  },
  proof_of_delivery: {
    label: 'Proof of Delivery',
    color: 'green',
    icon: FileCheck
  },
  pod_confirmation: {
    label: 'POD Confirmation',
    color: 'green',
    icon: FileCheck
  },
  cargo_manifest: {
    label: 'Cargo Manifest',
    color: 'cyan',
    icon: Package
  },
  customs_document: {
    label: 'Customs',
    color: 'orange',
    icon: FileBox
  },
  rate_confirmation: {
    label: 'Rate Confirmation',
    color: 'lime',
    icon: DollarSign
  },
  vessel_schedule: {
    label: 'Vessel Schedule',
    color: 'sky',
    icon: Calendar
  },
  container_release: {
    label: 'Container Release',
    color: 'violet',
    icon: Package
  },
  freight_invoice: {
    label: 'Freight Invoice',
    color: 'rose',
    icon: CreditCard
  },
  vgm_submission: {
    label: 'VGM Submission',
    color: 'violet',
    icon: FileCheck
  },
  booking_cancellation: {
    label: 'Cancellation',
    color: 'rose',
    icon: XCircle
  },
  rate_quote: {
    label: 'Rate Quote',
    color: 'lime',
    icon: DollarSign
  },
  si_submission: {
    label: 'SI Submission',
    color: 'indigo',
    icon: ClipboardList
  },
  pickup_notification: {
    label: 'Pickup Notice',
    color: 'teal',
    icon: Truck
  },
  railment_status: {
    label: 'Rail Status',
    color: 'orange',
    icon: Truck
  },
  isf_submission: {
    label: 'ISF Submission',
    color: 'amber',
    icon: FileBox
  },
  unknown: {
    label: 'Unknown',
    color: 'gray',
    icon: HelpCircle
  },
  not_shipping: {
    label: 'Not Shipping',
    color: 'slate',
    icon: XCircle
  }
}

export function DocumentTypeBadge({
  type,
  size = 'md',
  showIcon = true,
  variant = 'default'
}: DocumentTypeBadgeProps) {
  // Fallback to 'unknown' if type not found in config
  const config = documentTypeConfig[type] || documentTypeConfig.unknown
  const Icon = config.icon

  const sizeClasses = {
    sm: 'px-2 py-0.5 text-xs',
    md: 'px-2.5 py-1 text-sm',
    lg: 'px-3 py-1.5 text-base'
  }

  const iconSizes = {
    sm: 'h-3 w-3',
    md: 'h-4 w-4',
    lg: 'h-5 w-5'
  }

  const colorClasses = {
    default: {
      blue: 'bg-blue-100 text-blue-800 border-blue-200',
      amber: 'bg-amber-100 text-amber-800 border-amber-200',
      green: 'bg-green-100 text-green-800 border-green-200',
      purple: 'bg-purple-100 text-purple-800 border-purple-200',
      indigo: 'bg-indigo-100 text-indigo-800 border-indigo-200',
      emerald: 'bg-emerald-100 text-emerald-800 border-emerald-200',
      teal: 'bg-teal-100 text-teal-800 border-teal-200',
      cyan: 'bg-cyan-100 text-cyan-800 border-cyan-200',
      orange: 'bg-orange-100 text-orange-800 border-orange-200',
      lime: 'bg-lime-100 text-lime-800 border-lime-200',
      sky: 'bg-sky-100 text-sky-800 border-sky-200',
      violet: 'bg-violet-100 text-violet-800 border-violet-200',
      rose: 'bg-rose-100 text-rose-800 border-rose-200',
      gray: 'bg-gray-100 text-gray-800 border-gray-200',
      slate: 'bg-slate-100 text-slate-800 border-slate-200'
    },
    outline: {
      blue: 'bg-transparent text-blue-600 border-blue-600',
      amber: 'bg-transparent text-amber-600 border-amber-600',
      green: 'bg-transparent text-green-600 border-green-600',
      purple: 'bg-transparent text-purple-600 border-purple-600',
      indigo: 'bg-transparent text-indigo-600 border-indigo-600',
      emerald: 'bg-transparent text-emerald-600 border-emerald-600',
      teal: 'bg-transparent text-teal-600 border-teal-600',
      cyan: 'bg-transparent text-cyan-600 border-cyan-600',
      orange: 'bg-transparent text-orange-600 border-orange-600',
      lime: 'bg-transparent text-lime-600 border-lime-600',
      sky: 'bg-transparent text-sky-600 border-sky-600',
      violet: 'bg-transparent text-violet-600 border-violet-600',
      rose: 'bg-transparent text-rose-600 border-rose-600',
      gray: 'bg-transparent text-gray-600 border-gray-600',
      slate: 'bg-transparent text-slate-600 border-slate-600'
    }
  }

  return (
    <span
      className={`
        inline-flex items-center gap-1.5 rounded-md border font-medium
        ${colorClasses[variant][config.color as keyof typeof colorClasses.default]} ${sizeClasses[size]}
      `}
    >
      {showIcon && <Icon className={iconSizes[size]} />}
      <span>{config.label}</span>
    </span>
  )
}