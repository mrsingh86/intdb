/**
 * Workflow Status Badge Component
 * Shows current workflow state with approval requirements
 */

import { WorkflowState, PartyType } from '@/types/email-intelligence'
import {
  Inbox,
  Search,
  Clock,
  CheckCircle,
  XCircle,
  Unlock,
  Send,
  CheckCheck,
  AlertCircle
} from 'lucide-react'

interface WorkflowStatusBadgeProps {
  state: WorkflowState
  requiresApprovalFrom?: PartyType | null
  size?: 'sm' | 'md' | 'lg'
  showApprovalInfo?: boolean
}

const workflowStateConfig: Record<WorkflowState, {
  icon: any
  label: string
  color: string
  bgColor: string
  borderColor: string
  description: string
}> = {
  received: {
    icon: Inbox,
    label: 'Received',
    color: 'text-gray-700',
    bgColor: 'bg-gray-100',
    borderColor: 'border-gray-200',
    description: 'Document received and logged'
  },
  pending_review: {
    icon: Search,
    label: 'Pending Review',
    color: 'text-blue-700',
    bgColor: 'bg-blue-100',
    borderColor: 'border-blue-200',
    description: 'Awaiting internal review'
  },
  pending_approval: {
    icon: Clock,
    label: 'Pending Approval',
    color: 'text-amber-700',
    bgColor: 'bg-amber-100',
    borderColor: 'border-amber-200',
    description: 'Awaiting approval'
  },
  approved: {
    icon: CheckCircle,
    label: 'Approved',
    color: 'text-green-700',
    bgColor: 'bg-green-100',
    borderColor: 'border-green-200',
    description: 'Approved and ready to proceed'
  },
  rejected: {
    icon: XCircle,
    label: 'Rejected',
    color: 'text-red-700',
    bgColor: 'bg-red-100',
    borderColor: 'border-red-200',
    description: 'Rejected - requires revision'
  },
  released: {
    icon: Unlock,
    label: 'Released',
    color: 'text-teal-700',
    bgColor: 'bg-teal-100',
    borderColor: 'border-teal-200',
    description: 'Released to recipient'
  },
  forwarded: {
    icon: Send,
    label: 'Forwarded',
    color: 'text-indigo-700',
    bgColor: 'bg-indigo-100',
    borderColor: 'border-indigo-200',
    description: 'Forwarded to next party'
  },
  completed: {
    icon: CheckCheck,
    label: 'Completed',
    color: 'text-emerald-700',
    bgColor: 'bg-emerald-100',
    borderColor: 'border-emerald-200',
    description: 'Workflow complete'
  }
}

const partyTypeLabels: Record<PartyType, string> = {
  shipping_line: 'Carrier',
  cha: 'CHA',
  custom_broker: 'Customs Broker',
  customs_broker: 'Customs Broker',
  consignee: 'Consignee',
  shipper: 'Shipper',
  forwarder: 'Forwarder',
  freight_forwarder: 'Freight Forwarder',
  notify_party: 'Notify Party',
  trucker: 'Trucker',
  warehouse: 'Warehouse',
  intoglo: 'Intoglo',
  agent: 'Agent',
  unknown: 'Unknown'
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

// Default config for unknown states
const defaultConfig = {
  icon: AlertCircle,
  label: 'Unknown',
  color: 'text-gray-700',
  bgColor: 'bg-gray-100',
  borderColor: 'border-gray-200',
  description: 'Unknown workflow state'
}

export function WorkflowStatusBadge({
  state,
  requiresApprovalFrom,
  size = 'md',
  showApprovalInfo = true
}: WorkflowStatusBadgeProps) {
  const config = workflowStateConfig[state] || defaultConfig
  const Icon = config.icon
  const sizes = sizeClasses[size]

  return (
    <div className="inline-flex items-center gap-2">
      <span
        className={`
          inline-flex items-center gap-1.5 rounded-md border font-medium
          ${config.bgColor} ${config.color} ${config.borderColor} ${sizes.badge}
        `}
        title={config.description}
      >
        <Icon className={sizes.icon} />
        <span>{config.label}</span>
      </span>

      {showApprovalInfo && requiresApprovalFrom && state === 'pending_approval' && (
        <span
          className={`
            inline-flex items-center gap-1 rounded-md border border-amber-200 bg-amber-50 font-medium text-amber-700
            ${sizes.badge}
          `}
        >
          <AlertCircle className={sizes.icon} />
          <span>Needs {partyTypeLabels[requiresApprovalFrom]} approval</span>
        </span>
      )}
    </div>
  )
}

// Workflow progress indicator for detailed view
export function WorkflowProgress({
  currentState,
  requiresApprovalFrom
}: {
  currentState: WorkflowState
  requiresApprovalFrom?: PartyType | null
}) {
  const steps: WorkflowState[] = ['received', 'pending_review', 'pending_approval', 'approved', 'released', 'completed']
  const currentIndex = steps.indexOf(currentState)
  const isRejected = currentState === 'rejected'
  const isForwarded = currentState === 'forwarded'

  return (
    <div className="w-full">
      <div className="flex items-center justify-between">
        {steps.map((step, idx) => {
          const config = workflowStateConfig[step]
          const Icon = config.icon
          const isComplete = idx < currentIndex
          const isCurrent = idx === currentIndex
          const isPending = idx > currentIndex

          return (
            <div key={step} className="flex flex-col items-center flex-1">
              {/* Connector line */}
              {idx > 0 && (
                <div
                  className={`
                    absolute h-0.5 w-full -translate-y-1/2 top-1/2
                    ${isComplete || isCurrent ? 'bg-green-400' : 'bg-gray-200'}
                  `}
                  style={{ left: '-50%', width: '100%', zIndex: 0 }}
                />
              )}

              {/* Step circle */}
              <div
                className={`
                  relative z-10 flex items-center justify-center w-8 h-8 rounded-full border-2
                  ${isComplete ? 'bg-green-500 border-green-500 text-white' : ''}
                  ${isCurrent ? `${config.bgColor} ${config.borderColor} ${config.color}` : ''}
                  ${isPending ? 'bg-gray-100 border-gray-200 text-gray-400' : ''}
                `}
              >
                {isComplete ? (
                  <CheckCircle className="h-4 w-4" />
                ) : (
                  <Icon className="h-4 w-4" />
                )}
              </div>

              {/* Step label */}
              <span
                className={`
                  mt-2 text-xs font-medium text-center
                  ${isCurrent ? config.color : 'text-gray-500'}
                `}
              >
                {config.label}
              </span>
            </div>
          )
        })}
      </div>

      {/* Special states */}
      {isRejected && (
        <div className="mt-4 flex items-center gap-2 px-3 py-2 rounded-md bg-red-50 border border-red-200">
          <XCircle className="h-4 w-4 text-red-600" />
          <span className="text-sm text-red-700">
            Document was rejected and requires revision
          </span>
        </div>
      )}

      {isForwarded && (
        <div className="mt-4 flex items-center gap-2 px-3 py-2 rounded-md bg-indigo-50 border border-indigo-200">
          <Send className="h-4 w-4 text-indigo-600" />
          <span className="text-sm text-indigo-700">
            Document was forwarded to another party
          </span>
        </div>
      )}

      {requiresApprovalFrom && currentState === 'pending_approval' && (
        <div className="mt-4 flex items-center gap-2 px-3 py-2 rounded-md bg-amber-50 border border-amber-200">
          <Clock className="h-4 w-4 text-amber-600" />
          <span className="text-sm text-amber-700">
            Awaiting approval from {partyTypeLabels[requiresApprovalFrom]}
          </span>
        </div>
      )}
    </div>
  )
}
