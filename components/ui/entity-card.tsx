import { EntityExtraction, EntityType } from '@/types/email-intelligence'
import { ConfidenceBadge } from './confidence-badge'
import {
  Hash,
  Ship,
  MapPin,
  Calendar,
  Package,
  Building,
  User,
  Weight,
  DollarSign,
  FileText,
  Lock,
  CheckCircle,
  AlertCircle,
  HelpCircle
} from 'lucide-react'

interface EntityCardProps {
  entity: EntityExtraction
  onVerify?: () => void
  onEdit?: () => void
  compact?: boolean
}

const entityTypeConfig: Record<string, { label: string; icon: any; color: string }> = {
  booking_number: { label: 'Booking #', icon: Hash, color: 'text-blue-600' },
  bl_number: { label: 'B/L #', icon: FileText, color: 'text-purple-600' },
  vessel_name: { label: 'Vessel', icon: Ship, color: 'text-cyan-600' },
  voyage_number: { label: 'Voyage', icon: Ship, color: 'text-cyan-600' },
  port_of_loading: { label: 'POL', icon: MapPin, color: 'text-green-600' },
  port_of_discharge: { label: 'POD', icon: MapPin, color: 'text-red-600' },
  etd: { label: 'ETD', icon: Calendar, color: 'text-orange-600' },
  eta: { label: 'ETA', icon: Calendar, color: 'text-orange-600' },
  container_number: { label: 'Container', icon: Package, color: 'text-indigo-600' },
  carrier: { label: 'Carrier', icon: Building, color: 'text-gray-600' },
  shipper: { label: 'Shipper', icon: User, color: 'text-teal-600' },
  consignee: { label: 'Consignee', icon: User, color: 'text-teal-600' },
  commodity: { label: 'Commodity', icon: Package, color: 'text-amber-600' },
  weight: { label: 'Weight', icon: Weight, color: 'text-slate-600' },
  volume: { label: 'Volume', icon: Package, color: 'text-slate-600' },
  incoterms: { label: 'Incoterms', icon: FileText, color: 'text-violet-600' },
  payment_terms: { label: 'Payment', icon: DollarSign, color: 'text-emerald-600' },
  amount: { label: 'Amount', icon: DollarSign, color: 'text-emerald-600' },
  currency: { label: 'Currency', icon: DollarSign, color: 'text-emerald-600' },
  reference_number: { label: 'Reference', icon: Hash, color: 'text-rose-600' },
  seal_number: { label: 'Seal #', icon: Lock, color: 'text-zinc-600' },
  unknown: { label: 'Unknown', icon: HelpCircle, color: 'text-gray-600' }
}

export function EntityCard({ entity, onVerify, onEdit, compact = false }: EntityCardProps) {
  // Fallback to 'unknown' if entity type not found in config
  const config = entityTypeConfig[entity.entity_type] || entityTypeConfig.unknown
  const Icon = config.icon

  if (compact) {
    return (
      <div className="group relative inline-flex items-center gap-2 rounded-lg border border-gray-200 bg-white px-3 py-2 hover:border-gray-300 hover:shadow-sm transition-all">
        <Icon className={`h-4 w-4 ${config.color}`} />
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <span className="text-xs font-medium text-gray-500">{config.label}</span>
            {entity.is_verified && (
              <CheckCircle className="h-3 w-3 text-green-600" />
            )}
          </div>
          <p className="text-sm font-medium text-gray-900 truncate">{entity.entity_value}</p>
        </div>
        <ConfidenceBadge score={entity.confidence_score} size="sm" showIcon={false} />
      </div>
    )
  }

  return (
    <div className="group relative rounded-lg border border-gray-200 bg-white p-4 hover:border-gray-300 hover:shadow-md transition-all">
      {/* Header */}
      <div className="flex items-start justify-between mb-3">
        <div className="flex items-center gap-2">
          <div className={`rounded-lg p-2 bg-gray-50 ${config.color}`}>
            <Icon className="h-5 w-5" />
          </div>
          <div>
            <h4 className="text-sm font-medium text-gray-900">{config.label}</h4>
            <p className="text-xs text-gray-500">{entity.extraction_method}</p>
          </div>
        </div>
        <ConfidenceBadge score={entity.confidence_score} size="sm" />
      </div>

      {/* Value */}
      <div className="mb-3">
        <p className="text-base font-semibold text-gray-900 break-all">{entity.entity_value}</p>
      </div>

      {/* Context */}
      {entity.context_snippet && (
        <div className="mb-3 rounded-md bg-gray-50 p-2">
          <p className="text-xs text-gray-600 italic">
            "...{entity.context_snippet}..."
          </p>
        </div>
      )}

      {/* Actions */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          {entity.is_verified ? (
            <span className="inline-flex items-center gap-1 text-xs text-green-600">
              <CheckCircle className="h-3 w-3" />
              Verified
              {entity.verified_by && (
                <span className="text-gray-500">by {entity.verified_by}</span>
              )}
            </span>
          ) : (
            <span className="inline-flex items-center gap-1 text-xs text-yellow-600">
              <AlertCircle className="h-3 w-3" />
              Unverified
            </span>
          )}
        </div>

        <div className="flex gap-2 opacity-0 group-hover:opacity-100 transition-opacity">
          {!entity.is_verified && onVerify && (
            <button
              onClick={onVerify}
              className="rounded px-2 py-1 text-xs font-medium text-green-600 hover:bg-green-50 transition-colors"
            >
              Verify
            </button>
          )}
          {onEdit && (
            <button
              onClick={onEdit}
              className="rounded px-2 py-1 text-xs font-medium text-blue-600 hover:bg-blue-50 transition-colors"
            >
              Edit
            </button>
          )}
        </div>
      </div>
    </div>
  )
}