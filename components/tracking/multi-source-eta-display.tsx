'use client';

/**
 * Multi-Source ETA/ETD Display Component
 * Shows dates from multiple document sources with conflict detection
 * Color-coded: Green = matching, Red = conflict
 */

import { DocumentType } from '@/types/email-intelligence'
import {
  Calendar,
  AlertTriangle,
  CheckCircle,
  Clock,
  Ship,
  FileCheck,
  Anchor,
  ChevronDown,
  ChevronUp
} from 'lucide-react'
import { useState } from 'react'

export interface DateSource {
  documentType: DocumentType
  value: string // ISO date string
  extractedAt: string
  emailSubject?: string
  confidence: number
}

interface MultiSourceETADisplayProps {
  label: 'ETD' | 'ETA'
  sources: DateSource[]
  selectedValue?: string
  onSelectSource?: (source: DateSource) => void
  compact?: boolean
}

const SOURCE_PRIORITY: DocumentType[] = [
  'arrival_notice',
  'bill_of_lading',
  'booking_confirmation',
  'booking_amendment',
  'vessel_schedule'
]

const documentTypeLabels: Record<string, string> = {
  booking_confirmation: 'Booking',
  booking_amendment: 'Amendment',
  arrival_notice: 'Arrival Notice',
  bill_of_lading: 'B/L',
  vessel_schedule: 'Schedule'
}

const documentTypeIcons: Record<string, any> = {
  booking_confirmation: FileCheck,
  booking_amendment: Clock,
  arrival_notice: Ship,
  bill_of_lading: Anchor,
  vessel_schedule: Calendar
}

function formatDate(dateString: string): string {
  try {
    const date = new Date(dateString)
    return date.toLocaleDateString('en-US', {
      day: '2-digit',
      month: 'short',
      year: 'numeric'
    })
  } catch {
    return dateString
  }
}

function detectConflicts(sources: DateSource[]): boolean {
  if (sources.length < 2) return false
  const uniqueDates = new Set(
    sources.map(s => new Date(s.value).toDateString())
  )
  return uniqueDates.size > 1
}

function getPrimarySource(sources: DateSource[]): DateSource | null {
  if (sources.length === 0) return null

  // Sort by priority (lower index = higher priority)
  const sorted = [...sources].sort((a, b) => {
    const aPriority = SOURCE_PRIORITY.indexOf(a.documentType)
    const bPriority = SOURCE_PRIORITY.indexOf(b.documentType)
    const aIdx = aPriority === -1 ? 999 : aPriority
    const bIdx = bPriority === -1 ? 999 : bPriority
    return aIdx - bIdx
  })

  return sorted[0]
}

export function MultiSourceETADisplay({
  label,
  sources,
  selectedValue,
  onSelectSource,
  compact = false
}: MultiSourceETADisplayProps) {
  const [expanded, setExpanded] = useState(false)
  const hasConflict = detectConflicts(sources)
  const primary = getPrimarySource(sources)

  if (sources.length === 0) {
    return (
      <div className="text-gray-400 text-sm">
        No {label} data
      </div>
    )
  }

  if (compact) {
    return (
      <CompactView
        label={label}
        sources={sources}
        primary={primary}
        hasConflict={hasConflict}
      />
    )
  }

  return (
    <div className="rounded-lg border border-gray-200 bg-white overflow-hidden">
      {/* Header */}
      <div
        className={`
          flex items-center justify-between px-4 py-3 cursor-pointer
          ${hasConflict ? 'bg-red-50' : 'bg-green-50'}
        `}
        onClick={() => setExpanded(!expanded)}
      >
        <div className="flex items-center gap-3">
          <Calendar className={`h-5 w-5 ${hasConflict ? 'text-red-600' : 'text-green-600'}`} />
          <div>
            <span className="text-sm font-medium text-gray-700">{label}</span>
            {primary && (
              <p className="text-lg font-semibold text-gray-900">
                {formatDate(primary.value)}
              </p>
            )}
          </div>
        </div>

        <div className="flex items-center gap-2">
          {hasConflict ? (
            <span className="inline-flex items-center gap-1 px-2 py-1 rounded-full text-xs font-medium bg-red-100 text-red-700">
              <AlertTriangle className="h-3 w-3" />
              {sources.length} sources conflict
            </span>
          ) : (
            <span className="inline-flex items-center gap-1 px-2 py-1 rounded-full text-xs font-medium bg-green-100 text-green-700">
              <CheckCircle className="h-3 w-3" />
              {sources.length} sources match
            </span>
          )}
          {sources.length > 1 && (
            expanded ? <ChevronUp className="h-4 w-4 text-gray-500" /> : <ChevronDown className="h-4 w-4 text-gray-500" />
          )}
        </div>
      </div>

      {/* Expanded Sources List */}
      {expanded && sources.length > 0 && (
        <div className="divide-y divide-gray-100">
          {sources.map((source, idx) => {
            const Icon = documentTypeIcons[source.documentType] || Calendar
            const isSelected = selectedValue === source.value
            const isPrimary = source === primary

            return (
              <div
                key={idx}
                className={`
                  flex items-center justify-between px-4 py-3 hover:bg-gray-50 transition-colors
                  ${isSelected ? 'bg-blue-50' : ''}
                  ${onSelectSource ? 'cursor-pointer' : ''}
                `}
                onClick={() => onSelectSource?.(source)}
              >
                <div className="flex items-center gap-3">
                  <div className={`
                    rounded-lg p-2
                    ${isPrimary ? 'bg-blue-100' : 'bg-gray-100'}
                  `}>
                    <Icon className={`h-4 w-4 ${isPrimary ? 'text-blue-600' : 'text-gray-600'}`} />
                  </div>
                  <div>
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-medium text-gray-900">
                        {documentTypeLabels[source.documentType] || source.documentType}
                      </span>
                      {isPrimary && (
                        <span className="px-1.5 py-0.5 rounded text-xs bg-blue-100 text-blue-700">
                          Primary
                        </span>
                      )}
                    </div>
                    {source.emailSubject && (
                      <p className="text-xs text-gray-500 truncate max-w-[200px]">
                        {source.emailSubject}
                      </p>
                    )}
                  </div>
                </div>

                <div className="text-right">
                  <p className={`
                    text-sm font-semibold
                    ${hasConflict && source !== primary ? 'text-red-600' : 'text-gray-900'}
                  `}>
                    {formatDate(source.value)}
                  </p>
                  <p className="text-xs text-gray-500">
                    {source.confidence}% confidence
                  </p>
                </div>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}

function CompactView({
  label,
  sources,
  primary,
  hasConflict
}: {
  label: string
  sources: DateSource[]
  primary: DateSource | null
  hasConflict: boolean
}) {
  return (
    <div className="inline-flex items-center gap-2">
      <span className="text-xs font-medium text-gray-500">{label}</span>
      {primary && (
        <span className={`
          text-sm font-semibold
          ${hasConflict ? 'text-red-600' : 'text-gray-900'}
        `}>
          {formatDate(primary.value)}
        </span>
      )}
      {hasConflict && (
        <span title={`${sources.length} conflicting sources`}>
          <AlertTriangle className="h-3 w-3 text-red-500" />
        </span>
      )}
      {!hasConflict && sources.length > 1 && (
        <span title={`${sources.length} matching sources`}>
          <CheckCircle className="h-3 w-3 text-green-500" />
        </span>
      )}
    </div>
  )
}
