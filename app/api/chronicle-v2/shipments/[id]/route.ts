import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import {
  type ShipmentDetail,
  type ShipmentDetailResponse,
  type CutoffDetail,
  type IssueItem,
  type ActionItem,
  type TimelineItem,
  type Phase,
  buildAttentionComponents,
  calculateAttentionWithTier,
  getCutoffStatus,
  STAGE_TO_PHASE,
  detectDirection,
  getDocumentTypeLabel,
  PARTY_TYPE_LABELS,
} from '@/lib/chronicle-v2';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

/**
 * GET /api/chronicle-v2/shipments/[id]
 *
 * Fetches detailed shipment data with issues, actions, and document timeline.
 */
export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;

    // Step 1: Get shipment data
    const { data: ship, error: shipError } = await supabase
      .from('shipments')
      .select(
        `
        id,
        booking_number,
        mbl_number,
        hbl_number,
        shipper_name,
        shipper_address,
        consignee_name,
        consignee_address,
        notify_party_name,
        vessel_name,
        voyage_number,
        port_of_loading,
        port_of_loading_code,
        port_of_discharge,
        port_of_discharge_code,
        etd,
        eta,
        stage,
        status,
        carrier_name,
        si_cutoff,
        vgm_cutoff,
        cargo_cutoff,
        doc_cutoff,
        free_time_expires,
        container_number_primary,
        created_at
      `
      )
      .eq('id', id)
      .single();

    if (shipError || !ship) {
      return NextResponse.json({ error: 'Shipment not found' }, { status: 404 });
    }

    // Step 2: Get all chronicle documents for this shipment
    const { data: chronicles, error: chronError } = await supabase
      .from('chronicle')
      .select(
        `
        id,
        gmail_message_id,
        subject,
        from_address,
        from_party,
        carrier_name,
        document_type,
        message_type,
        summary,
        has_issue,
        issue_type,
        issue_description,
        has_action,
        action_description,
        action_owner,
        action_deadline,
        action_priority,
        action_completed_at,
        occurred_at,
        attachments,
        container_numbers
      `
      )
      .eq('shipment_id', id)
      .order('occurred_at', { ascending: false });

    if (chronError) throw chronError;

    const now = new Date();
    const yesterday = new Date(now);
    yesterday.setDate(yesterday.getDate() - 1);

    // Step 3: Build aggregates
    let issueCount = 0;
    const issueTypes: string[] = [];
    let pendingActions = 0;
    let overdueActions = 0;
    let maxPriority: string | null = null;
    let lastActivity: string | null = null;
    let totalDocs = 0;
    let recentDocs = 0;
    let latestDocSummary: string | null = null;
    let latestIssue: { description: string; occurredAt: string } | null = null;

    const issuesList: IssueItem[] = [];
    const actionsList: ActionItem[] = [];
    const timeline: TimelineItem[] = [];
    const containers = new Set<string>();
    const stakeholdersMap = new Map<string, { type: string; name: string | null; lastContact: string | null }>();

    // Add primary container if exists
    if (ship.container_number_primary) {
      containers.add(ship.container_number_primary);
    }

    const priorityOrder = { critical: 4, high: 3, medium: 2, low: 1 };

    for (const doc of chronicles || []) {
      totalDocs++;

      // Track recent docs
      if (doc.occurred_at && new Date(doc.occurred_at) > yesterday) {
        recentDocs++;
      }

      // Track last activity and latest summary
      if (!lastActivity || (doc.occurred_at && doc.occurred_at > lastActivity)) {
        lastActivity = doc.occurred_at;
        // Capture latest document summary for journey context
        if (doc.summary) {
          latestDocSummary = doc.summary;
        }
      }

      // Track containers
      if (doc.container_numbers) {
        for (const c of doc.container_numbers) {
          containers.add(c);
        }
      }

      // Track stakeholders from from_party (external parties only)
      // Skip: customer, shipper, consignee (trade parties), intoglo (us), nvocc (we are the NVOCC), unknown
      if (doc.from_party && !['customer', 'shipper', 'consignee', 'intoglo', 'nvocc', 'unknown'].includes(doc.from_party)) {
        // Skip Intoglo emails - that's us, not a stakeholder
        const isIntogloEmail = doc.from_address?.toLowerCase().includes('intoglo');
        if (isIntogloEmail) continue;

        // Extract stakeholder name based on party type
        let stakeholderName: string | null = null;

        if (doc.from_party === 'ocean_carrier') {
          // For shipping lines: use carrier_name field (Hapag-Lloyd, Maersk, etc.)
          stakeholderName = doc.carrier_name;
        } else {
          // For all other parties: extract from email domain
          if (doc.from_address) {
            const domainMatch = doc.from_address.match(/@([^.]+)\./);
            if (domainMatch) {
              const domain = domainMatch[1].toLowerCase();
              if (!['gmail', 'outlook', 'yahoo', 'hotmail', 'service'].includes(domain)) {
                const cleanName = domain
                  .replace(/cargo$/i, ' Cargo')
                  .replace(/logistics$/i, ' Logistics')
                  .replace(/transport$/i, ' Transport');
                stakeholderName = cleanName.charAt(0).toUpperCase() + cleanName.slice(1);
              }
            }
          }
        }

        const existing = stakeholdersMap.get(doc.from_party);
        const shouldUpdate = !existing ||
          (doc.occurred_at && (!existing.lastContact || doc.occurred_at > existing.lastContact)) ||
          (!existing.name && stakeholderName);

        if (shouldUpdate) {
          stakeholdersMap.set(doc.from_party, {
            type: doc.from_party,
            name: stakeholderName || existing?.name || null,
            lastContact: doc.occurred_at || existing?.lastContact || null,
          });
        }
      }

      // Build issue item
      if (doc.has_issue) {
        issueCount++;
        if (doc.issue_type && !issueTypes.includes(doc.issue_type)) {
          issueTypes.push(doc.issue_type);
        }
        // Track latest issue for recommendation
        const issueDesc = doc.issue_description || doc.summary || '';
        if (issueDesc && doc.occurred_at) {
          if (!latestIssue || doc.occurred_at > latestIssue.occurredAt) {
            latestIssue = { description: issueDesc, occurredAt: doc.occurred_at };
          }
        }
        issuesList.push({
          id: doc.id,
          type: doc.issue_type || 'unknown',
          description: issueDesc,
          documentId: doc.id,
          documentSubject: doc.subject || '',
          occurredAt: doc.occurred_at,
          resolved: false, // Could track this if we add resolution tracking
        });
      }

      // Build action item
      if (doc.has_action) {
        const completed = !!doc.action_completed_at;
        if (!completed) {
          pendingActions++;
          if (doc.action_deadline && new Date(doc.action_deadline) < now) {
            overdueActions++;
          }
          // Track max priority
          const currentPriority = priorityOrder[doc.action_priority as keyof typeof priorityOrder] || 0;
          const maxPriorityVal = priorityOrder[maxPriority as keyof typeof priorityOrder] || 0;
          if (currentPriority > maxPriorityVal) {
            maxPriority = doc.action_priority;
          }
        }

        actionsList.push({
          id: doc.id,
          description: doc.action_description || doc.summary || '',
          owner: doc.action_owner,
          deadline: doc.action_deadline,
          priority: (doc.action_priority as ActionItem['priority']) || 'medium',
          documentId: doc.id,
          documentSubject: doc.subject || '',
          completed,
          completedAt: doc.action_completed_at,
        });
      }

      // Build timeline item
      timeline.push({
        id: doc.id,
        type: getDocumentTypeLabel(doc.document_type || 'unknown'),
        subject: doc.subject || '',
        sender: doc.from_address || '',
        senderParty: PARTY_TYPE_LABELS[doc.from_party] || doc.from_party || 'Unknown',
        occurredAt: doc.occurred_at,
        hasIssue: doc.has_issue || false,
        hasAction: doc.has_action || false,
        issueType: doc.issue_type,
        actionDescription: doc.action_description,
        attachmentCount: Array.isArray(doc.attachments) ? doc.attachments.length : 0,
        summary: doc.summary || '',
      });
    }

    // Sort actions: incomplete first (by deadline), then completed
    actionsList.sort((a, b) => {
      if (a.completed !== b.completed) return a.completed ? 1 : -1;
      if (!a.completed && a.deadline && b.deadline) {
        return new Date(a.deadline).getTime() - new Date(b.deadline).getTime();
      }
      return 0;
    });

    // Sort issues by date (newest first)
    issuesList.sort((a, b) => new Date(b.occurredAt).getTime() - new Date(a.occurredAt).getTime());

    // Step 4: Build cutoff details
    const cutoffDetails: CutoffDetail[] = [];

    const addCutoff = (
      type: CutoffDetail['type'],
      label: string,
      date: string | null
    ) => {
      if (!date) {
        cutoffDetails.push({
          type,
          label,
          date: null,
          daysRemaining: null,
          status: 'unknown',
        });
        return;
      }

      const daysRemaining = Math.ceil(
        (new Date(date).getTime() - now.getTime()) / (1000 * 60 * 60 * 24)
      );
      const status = getCutoffStatus(daysRemaining) || 'unknown';

      cutoffDetails.push({
        type,
        label,
        date,
        daysRemaining,
        status,
      });
    };

    addCutoff('si', 'SI Cutoff', ship.si_cutoff);
    addCutoff('vgm', 'VGM Cutoff', ship.vgm_cutoff);
    addCutoff('cargo', 'Cargo Cutoff', ship.cargo_cutoff);
    addCutoff('doc', 'Doc Cutoff', ship.doc_cutoff);
    addCutoff('lfd', 'Last Free Day', ship.free_time_expires);

    // Sort cutoffs by date
    cutoffDetails.sort((a, b) => {
      if (!a.date) return 1;
      if (!b.date) return -1;
      return new Date(a.date).getTime() - new Date(b.date).getTime();
    });

    // Step 5: Calculate attention score
    const components = buildAttentionComponents({
      issueCount,
      issueTypes,
      pendingActions,
      overdueActions,
      maxPriority,
      lastActivity,
      etd: ship.etd,
      siCutoff: ship.si_cutoff,
      vgmCutoff: ship.vgm_cutoff,
      cargoCutoff: ship.cargo_cutoff,
    });

    const { score, tier } = calculateAttentionWithTier(components);

    // Determine phase and direction
    const shipPhase = (STAGE_TO_PHASE[ship.stage?.toUpperCase()] || 'origin') as Phase;
    const shipDirection = detectDirection(ship.port_of_loading_code, ship.port_of_discharge_code);

    // Find nearest cutoff for summary
    let nearestCutoff: { type: string; date: string; daysRemaining: number } | null = null;
    for (const c of cutoffDetails) {
      if (!c.date || c.daysRemaining === null) continue;
      if (!nearestCutoff || c.daysRemaining < nearestCutoff.daysRemaining) {
        nearestCutoff = { type: c.label, date: c.date, daysRemaining: c.daysRemaining };
      }
    }

    // Helper: Build journey info from stage with summary
    const STAGE_PROGRESS: Record<string, { label: string; progress: number }> = {
      PENDING: { label: 'Booking Pending', progress: 5 },
      BOOKED: { label: 'Booked', progress: 15 },
      SI_SUBMITTED: { label: 'SI Submitted', progress: 25 },
      SI_CONFIRMED: { label: 'SI Confirmed', progress: 35 },
      BL_DRAFT: { label: 'Draft BL', progress: 45 },
      BL_ISSUED: { label: 'BL Issued', progress: 55 },
      DEPARTED: { label: 'Departed', progress: 65 },
      IN_TRANSIT: { label: 'In Transit', progress: 70 },
      ARRIVED: { label: 'Arrived', progress: 80 },
      CUSTOMS_CLEARED: { label: 'Customs Cleared', progress: 90 },
      DELIVERED: { label: 'Delivered', progress: 100 },
      COMPLETED: { label: 'Completed', progress: 100 },
    };

    const stageUpper = (ship.stage || 'PENDING').toUpperCase();
    const stageInfo = STAGE_PROGRESS[stageUpper] || STAGE_PROGRESS.PENDING;

    // Build journey summary from latest doc summary or stage-based default
    let journeySummary: string | null = null;
    if (latestDocSummary) {
      journeySummary = latestDocSummary.length > 80 ? latestDocSummary.slice(0, 77) + '...' : latestDocSummary;
    } else {
      switch (stageUpper) {
        case 'PENDING': journeySummary = 'Awaiting booking confirmation'; break;
        case 'BOOKED': journeySummary = ship.etd ? `Booked, sailing ${new Date(ship.etd).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}` : 'Booking confirmed, awaiting schedule'; break;
        case 'SI_SUBMITTED': journeySummary = 'SI submitted, awaiting confirmation'; break;
        case 'SI_CONFIRMED': journeySummary = 'SI confirmed, BL in progress'; break;
        case 'BL_DRAFT': journeySummary = 'Draft BL received, review in progress'; break;
        case 'BL_ISSUED': journeySummary = 'BL issued, cargo ready for departure'; break;
        case 'DEPARTED': journeySummary = ship.eta ? `Departed, arriving ${new Date(ship.eta).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}` : 'Vessel departed, in transit'; break;
        case 'IN_TRANSIT': journeySummary = ship.eta ? `In transit, ETA ${new Date(ship.eta).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}` : 'In transit to destination'; break;
        case 'ARRIVED': journeySummary = 'Arrived at destination, awaiting clearance'; break;
        case 'CUSTOMS_CLEARED': journeySummary = 'Customs cleared, ready for delivery'; break;
        case 'DELIVERED': journeySummary = 'Delivered to consignee'; break;
        case 'COMPLETED': journeySummary = 'Shipment completed'; break;
        default: journeySummary = stageInfo.label;
      }
    }

    const journey = {
      stage: stageUpper,
      stageLabel: stageInfo.label,
      progress: stageInfo.progress,
      nextMilestone: null,
      nextMilestoneDate: null,
      summary: journeySummary,
    };

    // Build top actions for recommendation
    const topActions = actionsList
      .filter((a) => !a.completed)
      .map((a) => ({
        description: a.description,
        daysRemaining: a.deadline
          ? Math.ceil((new Date(a.deadline).getTime() - now.getTime()) / (1000 * 60 * 60 * 24))
          : null,
        isOverdue: a.deadline ? new Date(a.deadline) < now : false,
      }))
      .sort((a, b) => {
        if (a.isOverdue && !b.isOverdue) return -1;
        if (!a.isOverdue && b.isOverdue) return 1;
        if (a.daysRemaining !== null && b.daysRemaining !== null) {
          return a.daysRemaining - b.daysRemaining;
        }
        return 0;
      });

    // Calculate days since activity
    const daysSinceActivity = lastActivity
      ? Math.floor((now.getTime() - new Date(lastActivity).getTime()) / (1000 * 60 * 60 * 24))
      : 999;

    // Build smart recommendation
    type RecommendationPriority = 'critical' | 'high' | 'medium' | 'low';
    let recommendation: { action: string; priority: RecommendationPriority; reason: string } | null = null;

    if (overdueActions > 0 && topActions[0]?.isOverdue) {
      recommendation = {
        action: `Complete: ${topActions[0].description}`,
        priority: 'critical',
        reason: `${overdueActions} action${overdueActions > 1 ? 's' : ''} overdue`,
      };
    } else if (latestIssue && issueTypes.length > 0) {
      const issueAge = Math.floor((now.getTime() - new Date(latestIssue.occurredAt).getTime()) / (1000 * 60 * 60 * 24));
      if (issueTypes.includes('delay')) {
        recommendation = {
          action: 'Follow up on delay and get revised schedule',
          priority: 'high',
          reason: latestIssue.description.slice(0, 60),
        };
      } else if (issueTypes.includes('detention') || issueTypes.includes('demurrage')) {
        recommendation = {
          action: 'Resolve to avoid additional charges',
          priority: 'critical',
          reason: 'Detention/demurrage charges accumulating',
        };
      } else {
        recommendation = {
          action: 'Review and resolve issue',
          priority: issueAge <= 2 ? 'high' : 'medium',
          reason: latestIssue.description.slice(0, 60),
        };
      }
    } else if (topActions[0] && !topActions[0].isOverdue && topActions[0].daysRemaining !== null && topActions[0].daysRemaining <= 3) {
      recommendation = {
        action: topActions[0].description,
        priority: topActions[0].daysRemaining <= 1 ? 'high' : 'medium',
        reason: `Due in ${topActions[0].daysRemaining} day${topActions[0].daysRemaining !== 1 ? 's' : ''}`,
      };
    } else if (daysSinceActivity > 3 && pendingActions > 0) {
      recommendation = {
        action: 'Check status and follow up',
        priority: 'low',
        reason: `No activity for ${daysSinceActivity} days`,
      };
    }

    // Helper: Build stakeholders list from Map
    const STAKEHOLDER_LABELS: Record<string, string> = {
      ocean_carrier: 'Shipping Line',
      trucker: 'Trucking',
      customs_broker: 'Customs Broker',
      warehouse: 'Warehouse',
      nvocc: 'NVOCC',
      terminal: 'Terminal',
      freight_broker: 'Freight Broker',
      airline: 'Airline',
    };

    type StakeholderType = 'carrier' | 'trucker' | 'customs_broker' | 'warehouse' | 'terminal' | 'other';
    // Only external stakeholders - we are NVOCC, so don't show nvocc
    const stakeholderPriority = ['ocean_carrier', 'trucker', 'customs_broker', 'warehouse', 'terminal'];
    const stakeholders: Array<{ type: StakeholderType; label: string; name: string | null; lastContact: string | null }> = [];

    for (const partyType of stakeholderPriority) {
      const info = stakeholdersMap.get(partyType);
      if (info) {
        stakeholders.push({
          type: (partyType === 'ocean_carrier' ? 'carrier' : partyType) as StakeholderType,
          label: STAKEHOLDER_LABELS[partyType] || partyType,
          name: info.name,
          lastContact: info.lastContact,
        });
      }
    }

    // Step 6: Build response
    const shipmentDetail: ShipmentDetail = {
      id: ship.id,
      bookingNumber: ship.booking_number,
      mblNumber: ship.mbl_number,
      hblNumber: ship.hbl_number,
      route: {
        origin: ship.port_of_loading_code || '',
        destination: ship.port_of_discharge_code || '',
        originFull: ship.port_of_loading || '',
        destinationFull: ship.port_of_discharge || '',
      },
      shipper: ship.shipper_name,
      consignee: ship.consignee_name,
      shipperAddress: ship.shipper_address,
      consigneeAddress: ship.consignee_address,
      notifyParty: ship.notify_party_name,
      etd: ship.etd,
      eta: ship.eta,
      vessel: ship.vessel_name,
      voyage: ship.voyage_number,
      carrier: ship.carrier_name,
      stage: ship.stage || 'PENDING',
      phase: shipPhase,
      direction: shipDirection,
      attentionScore: score,
      signalTier: tier,
      issues: {
        count: issueCount,
        types: issueTypes,
        mostSevere: issueTypes[0] || null,
        latestSummary: issuesList[0]?.description || null,
      },
      actions: {
        pending: pendingActions,
        overdue: overdueActions,
        nextDeadline: actionsList.find((a) => !a.completed && a.deadline)?.deadline || null,
        topActions: topActions.slice(0, 2),
      },
      cutoffs: {
        nearest: nearestCutoff,
        overdueCount: cutoffDetails.filter((c) => c.status === 'overdue').length,
      },
      documents: {
        total: totalDocs,
        recent24h: recentDocs,
      },
      lastActivity,
      journey,
      recommendation,
      stakeholders: stakeholders.slice(0, 4),
      aiSummary: null, // TODO: Generate AI summary for detail view
      containers: Array.from(containers),
      cutoffDetails,
      issuesList,
      actionsList,
      timeline,
    };

    return NextResponse.json({
      shipment: shipmentDetail,
    } as ShipmentDetailResponse);
  } catch (error) {
    console.error('Error fetching shipment detail:', error);
    return NextResponse.json({ error: 'Failed to fetch shipment' }, { status: 500 });
  }
}
