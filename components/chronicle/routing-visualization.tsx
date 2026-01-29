'use client';

import { Truck, Anchor, Ship, ArrowRight, MapPin } from 'lucide-react';

interface RoutingVisualizationProps {
  originInland?: string;
  originInlandCode?: string;
  portOfLoading?: string;
  portOfLoadingCode?: string;
  vesselName?: string;
  voyageNumber?: string;
  portOfDischarge?: string;
  portOfDischargeCode?: string;
  destinationInland?: string;
  destinationInlandCode?: string;
  placeOfReceipt?: string;
  placeOfDelivery?: string;
  variant?: 'full' | 'compact';
  showVessel?: boolean;
}

/**
 * RoutingVisualization - Shows the complete door-to-door shipping route
 *
 * Visual representation:
 * [Truck] ICD Delhi → [Anchor] INNSA → [Ship] MOL TREASURE → [Anchor] USLAX → [Truck] ICD Ontario
 *   Origin ICD         POL              Vessel                POD              Dest ICD
 */
export function RoutingVisualization({
  originInland,
  originInlandCode,
  portOfLoading,
  portOfLoadingCode,
  vesselName,
  voyageNumber,
  portOfDischarge,
  portOfDischargeCode,
  destinationInland,
  destinationInlandCode,
  placeOfReceipt,
  placeOfDelivery,
  variant = 'full',
  showVessel = true,
}: RoutingVisualizationProps) {
  // Use placeOfReceipt/placeOfDelivery as fallback for inland locations
  const origin = originInland || placeOfReceipt;
  const originCode = originInlandCode;
  const destination = destinationInland || placeOfDelivery;
  const destinationCode = destinationInlandCode;

  const hasOriginInland = Boolean(origin);
  const hasDestinationInland = Boolean(destination);
  const hasPorts = Boolean(portOfLoading || portOfDischarge);

  if (!hasPorts && !hasOriginInland && !hasDestinationInland) {
    return (
      <div className="flex items-center justify-center py-4 text-terminal-muted font-mono text-sm">
        No routing information available
      </div>
    );
  }

  if (variant === 'compact') {
    return (
      <div className="flex items-center gap-2 text-xs font-mono">
        {origin && (
          <>
            <span className="text-terminal-muted">{originCode || origin}</span>
            <ArrowRight className="h-3 w-3 text-terminal-muted" />
          </>
        )}
        <span className="text-terminal-blue font-medium">
          {portOfLoadingCode || portOfLoading || '---'}
        </span>
        <ArrowRight className="h-3 w-3 text-terminal-green" />
        <span className="text-terminal-blue font-medium">
          {portOfDischargeCode || portOfDischarge || '---'}
        </span>
        {destination && (
          <>
            <ArrowRight className="h-3 w-3 text-terminal-muted" />
            <span className="text-terminal-muted">{destinationCode || destination}</span>
          </>
        )}
      </div>
    );
  }

  return (
    <div className="rounded-lg border border-terminal-border bg-terminal-surface overflow-hidden">
      <div className="px-4 py-2.5 bg-terminal-elevated border-b border-terminal-border flex items-center gap-2">
        <span className="h-2 w-2 rounded-full bg-terminal-green" />
        <MapPin className="h-4 w-4 text-terminal-green" />
        <span className="font-medium text-terminal-text text-sm">Routing</span>
      </div>

      <div className="p-4">
        {/* Main Route Visualization */}
        <div className="flex items-center justify-between gap-2 overflow-x-auto pb-2">
          {/* Origin Inland (if exists) */}
          {hasOriginInland && (
            <>
              <RouteNode
                icon={Truck}
                label={origin!}
                code={originCode}
                sublabel="Origin ICD"
                color="muted"
              />
              <RouteConnector />
            </>
          )}

          {/* Port of Loading */}
          {portOfLoading && (
            <>
              <RouteNode
                icon={Anchor}
                label={portOfLoading}
                code={portOfLoadingCode}
                sublabel="POL"
                color="blue"
              />
              <RouteConnector type="sea" />
            </>
          )}

          {/* Vessel (optional) */}
          {showVessel && vesselName && (
            <>
              <RouteNode
                icon={Ship}
                label={vesselName}
                code={voyageNumber}
                sublabel="Vessel"
                color="purple"
                isVessel
              />
              <RouteConnector type="sea" />
            </>
          )}

          {/* Port of Discharge */}
          {portOfDischarge && (
            <RouteNode
              icon={Anchor}
              label={portOfDischarge}
              code={portOfDischargeCode}
              sublabel="POD"
              color="blue"
            />
          )}

          {/* Destination Inland (if exists) */}
          {hasDestinationInland && (
            <>
              <RouteConnector />
              <RouteNode
                icon={Truck}
                label={destination!}
                code={destinationCode}
                sublabel="Dest ICD"
                color="green"
              />
            </>
          )}
        </div>

        {/* Legend */}
        <div className="flex items-center gap-4 mt-4 pt-3 border-t border-terminal-border text-[10px] font-mono text-terminal-muted">
          <span className="flex items-center gap-1">
            <Truck className="h-3 w-3" /> Inland
          </span>
          <span className="flex items-center gap-1">
            <Anchor className="h-3 w-3" /> Port
          </span>
          <span className="flex items-center gap-1">
            <Ship className="h-3 w-3" /> Vessel
          </span>
        </div>
      </div>
    </div>
  );
}

interface RouteNodeProps {
  icon: React.ElementType;
  label: string;
  code?: string;
  sublabel: string;
  color: 'blue' | 'green' | 'purple' | 'muted';
  isVessel?: boolean;
}

function RouteNode({ icon: Icon, label, code, sublabel, color, isVessel }: RouteNodeProps) {
  const colorClasses = {
    blue: {
      bg: 'bg-terminal-blue/10',
      border: 'border-terminal-blue/30',
      icon: 'text-terminal-blue',
      text: 'text-terminal-blue',
    },
    green: {
      bg: 'bg-terminal-green/10',
      border: 'border-terminal-green/30',
      icon: 'text-terminal-green',
      text: 'text-terminal-green',
    },
    purple: {
      bg: 'bg-terminal-purple/10',
      border: 'border-terminal-purple/30',
      icon: 'text-terminal-purple',
      text: 'text-terminal-purple',
    },
    muted: {
      bg: 'bg-terminal-muted/10',
      border: 'border-terminal-border',
      icon: 'text-terminal-muted',
      text: 'text-terminal-muted',
    },
  };

  const classes = colorClasses[color];

  return (
    <div className="flex flex-col items-center min-w-[80px]">
      <div className={`w-10 h-10 rounded-full ${classes.bg} border ${classes.border} flex items-center justify-center mb-1.5`}>
        <Icon className={`h-5 w-5 ${classes.icon}`} />
      </div>
      <div className="text-center">
        <div className={`text-xs font-mono font-medium ${isVessel ? classes.text : 'text-terminal-text'} truncate max-w-[100px]`}>
          {code || label}
        </div>
        {code && label !== code && (
          <div className="text-[10px] font-mono text-terminal-muted truncate max-w-[100px]">
            {label}
          </div>
        )}
        <div className="text-[9px] font-mono text-terminal-muted uppercase tracking-wide mt-0.5">
          {sublabel}
        </div>
      </div>
    </div>
  );
}

interface RouteConnectorProps {
  type?: 'land' | 'sea';
}

function RouteConnector({ type = 'land' }: RouteConnectorProps) {
  return (
    <div className="flex-1 min-w-[20px] max-w-[60px] flex items-center justify-center">
      <div className={`h-0.5 w-full ${type === 'sea' ? 'bg-terminal-blue' : 'bg-terminal-border'}`}>
        <div className="relative w-full h-full">
          <ArrowRight className={`absolute right-0 top-1/2 -translate-y-1/2 h-3 w-3 ${type === 'sea' ? 'text-terminal-blue' : 'text-terminal-muted'}`} />
        </div>
      </div>
    </div>
  );
}

export default RoutingVisualization;
