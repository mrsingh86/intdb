import { ConfidenceLevel, getConfidenceLevel } from '@/types/email-intelligence'
import { Shield, ShieldAlert, ShieldCheck } from 'lucide-react'

interface ConfidenceBadgeProps {
  score: number
  showIcon?: boolean
  showPercentage?: boolean
  size?: 'sm' | 'md' | 'lg'
}

export function ConfidenceBadge({
  score,
  showIcon = true,
  showPercentage = true,
  size = 'md'
}: ConfidenceBadgeProps) {
  const level = getConfidenceLevel(score)

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

  const colors = {
    [ConfidenceLevel.HIGH]: {
      bg: 'bg-green-100',
      text: 'text-green-800',
      border: 'border-green-200',
      icon: ShieldCheck
    },
    [ConfidenceLevel.MEDIUM]: {
      bg: 'bg-yellow-100',
      text: 'text-yellow-800',
      border: 'border-yellow-200',
      icon: Shield
    },
    [ConfidenceLevel.LOW]: {
      bg: 'bg-red-100',
      text: 'text-red-800',
      border: 'border-red-200',
      icon: ShieldAlert
    }
  }

  const config = colors[level]
  const Icon = config.icon

  return (
    <span
      className={`
        inline-flex items-center gap-1 rounded-full border font-medium
        ${config.bg} ${config.text} ${config.border} ${sizeClasses[size]}
      `}
    >
      {showIcon && <Icon className={iconSizes[size]} />}
      <span className="capitalize">{level}</span>
      {showPercentage && (
        <span className="ml-1 opacity-75">({Math.round(score)}%)</span>
      )}
    </span>
  )
}