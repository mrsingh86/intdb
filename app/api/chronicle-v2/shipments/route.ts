import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import {
  type ShipmentListItem,
  type ShipmentListResponse,
  type Direction,
  type Phase,
  type TimeWindow,
  buildAttentionComponents,
  calculateAttentionWithTier,
  STAGE_TO_PHASE,
  PHASE_STAGES,
  SIGNAL_THRESHOLDS,
  PAGINATION,
  detectDirection,
} from '@/lib/chronicle-v2';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

/**
 * GET /api/chronicle-v2/shipments
 *
 * Fetches shipments with attention scoring and aggregated signals.
 * Sorted by attention score (highest first) by default.
 *
 * Query params:
 * - direction: 'all' | 'export' | 'import'
 * - phase: 'all' | 'origin' | 'in_transit' | 'destination' | 'completed'
 * - timeWindow: 'today' | '3days' | '7days' | 'all'
 * - search: string
 * - minScore: number (default: 0, set to 35 for main view only)
 * - showWatchlist: boolean (include 15-34 score items)
 * - page: number
 * - pageSize: number
 */
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);

    // Parse query params
    const direction = (searchParams.get('direction') || 'all') as Direction;
    const phase = (searchParams.get('phase') || 'all') as Phase;
    const timeWindow = (searchParams.get('timeWindow') || 'all') as TimeWindow;
    const search = searchParams.get('search') || '';
    const minScore = parseInt(searchParams.get('minScore') || '0');
    const showWatchlist = searchParams.get('showWatchlist') === 'true';
    const page = parseInt(searchParams.get('page') || '1');
    const pageSize = Math.min(
      parseInt(searchParams.get('pageSize') || String(PAGINATION.DEFAULT_PAGE_SIZE)),
      PAGINATION.MAX_PAGE_SIZE
    );

    // Step 1: Get document aggregates per shipment
    const { data: docAggregates, error: aggError } = await supabase.rpc('get_shipment_document_aggregates');

    if (aggError) {
      // Fallback to manual aggregation if RPC doesn't exist
      console.log('RPC not available, using manual aggregation');
    }

    // Step 2: Get base shipment data
    let query = supabase
      .from('shipments')
      .select(
        `
        id,
        booking_number,
        mbl_number,
        hbl_number,
        shipper_name,
        consignee_name,
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
        created_at
      `,
        { count: 'exact' }
      )
      .not('status', 'eq', 'cancelled');

    // Apply phase filter
    if (phase !== 'all') {
      const stages = PHASE_STAGES[phase];
      if (stages.length > 0) {
        query = query.in('stage', stages);
      }
    }

    // Apply search filter
    if (search) {
      query = query.or(
        `booking_number.ilike.%${search}%,mbl_number.ilike.%${search}%,hbl_number.ilike.%${search}%,vessel_name.ilike.%${search}%,shipper_name.ilike.%${search}%,consignee_name.ilike.%${search}%`
      );
    }

    // Apply time window filter (based on ETD/ETA)
    const now = new Date();
    if (timeWindow === 'today') {
      const todayStart = new Date(now);
      todayStart.setHours(0, 0, 0, 0);
      const todayEnd = new Date(now);
      todayEnd.setHours(23, 59, 59, 999);
      // Include today's ETD or past ETDs (for overdue)
      query = query.or(`etd.lte.${todayEnd.toISOString()},eta.lte.${todayEnd.toISOString()}`);
    } else if (timeWindow === '3days') {
      const future = new Date(now);
      future.setDate(future.getDate() + 3);
      query = query.or(`etd.lte.${future.toISOString()},eta.lte.${future.toISOString()}`);
    } else if (timeWindow === '7days') {
      const future = new Date(now);
      future.setDate(future.getDate() + 7);
      query = query.or(`etd.lte.${future.toISOString()},eta.lte.${future.toISOString()}`);
    }

    // Get shipments - order by ETD descending to prioritize today/recent shipments first
    // nullsFirst: false ensures shipments WITH dates come before those without
    query = query.order('etd', { ascending: false, nullsFirst: false }).limit(500);

    const { data: shipments, error: shipError, count } = await query;

    if (shipError) throw shipError;

    if (!shipments || shipments.length === 0) {
      return NextResponse.json({
        shipments: [],
        total: 0,
        page,
        pageSize,
        scoreDistribution: { strong: 0, medium: 0, weak: 0, noise: 0 },
      } as ShipmentListResponse);
    }

    // Step 3: Get document aggregates using raw SQL for better performance
    const shipmentIds = shipments.map((s) => s.id);

    // Step 3a: Get AI summaries for these shipments (batch to avoid URL length limits)
    type AISummaryRow = {
      shipment_id: string;
      // V2 fields (tight narrative format)
      narrative: string | null;
      owner: string | null;
      owner_type: string | null;
      key_deadline: string | null;
      key_insight: string | null;
      // V1 fields (legacy)
      story: string;
      current_blocker: string | null;
      blocker_owner: string | null;
      next_action: string | null;
      action_owner: string | null;
      action_priority: string | null;
      financial_impact: string | null;
      customer_impact: string | null;
      risk_level: 'red' | 'amber' | 'green';
      risk_reason: string | null;
    };
    let aiSummaries: AISummaryRow[] = [];
    const aiSummaryBatchSize = 50; // Batch to avoid URL length limits

    for (let i = 0; i < shipmentIds.length; i += aiSummaryBatchSize) {
      const batch = shipmentIds.slice(i, i + aiSummaryBatchSize);
      const { data: batchData } = await supabase
        .from('shipment_ai_summaries')
        .select('shipment_id, narrative, owner, owner_type, key_deadline, key_insight, story, current_blocker, blocker_owner, next_action, action_owner, action_priority, financial_impact, customer_impact, risk_level, risk_reason')
        .in('shipment_id', batch);

      if (batchData) {
        aiSummaries.push(...(batchData as AISummaryRow[]));
      }
    }

    // Build AI summary map
    type AISummaryData = {
      // V2 fields (tight narrative format)
      narrative: string | null;
      owner: string | null;
      ownerType: 'shipper' | 'consignee' | 'carrier' | 'intoglo' | null;
      keyDeadline: string | null;
      keyInsight: string | null;
      // V1 fields (legacy)
      story: string;
      currentBlocker: string | null;
      blockerOwner: string | null;
      nextAction: string | null;
      actionOwner: string | null;
      actionPriority: 'critical' | 'high' | 'medium' | 'low' | null;
      financialImpact: string | null;
      customerImpact: string | null;
      riskLevel: 'red' | 'amber' | 'green';
      riskReason: string | null;
    };
    const aiSummaryMap = new Map<string, AISummaryData>();
    if (aiSummaries) {
      for (const s of aiSummaries) {
        aiSummaryMap.set(s.shipment_id, {
          // V2 fields
          narrative: s.narrative,
          owner: s.owner,
          ownerType: s.owner_type as 'shipper' | 'consignee' | 'carrier' | 'intoglo' | null,
          keyDeadline: s.key_deadline,
          keyInsight: s.key_insight,
          // V1 fields
          story: s.story,
          currentBlocker: s.current_blocker,
          blockerOwner: s.blocker_owner,
          nextAction: s.next_action,
          actionOwner: s.action_owner,
          actionPriority: s.action_priority as 'critical' | 'high' | 'medium' | 'low' | null,
          financialImpact: s.financial_impact,
          customerImpact: s.customer_impact,
          riskLevel: s.risk_level,
          riskReason: s.risk_reason,
        });
      }
    }

    // Use raw SQL for efficient aggregation
    const { data: aggregateData, error: rpcError } = await supabase.rpc('get_chronicle_aggregates', {
      shipment_ids: shipmentIds,
    });

    // Fallback to individual queries if RPC doesn't exist
    // Define chronicle record type
    type ChronicleRecord = {
      shipment_id: string;
      has_issue: boolean;
      issue_type: string | null;
      issue_description: string | null;
      has_action: boolean;
      action_description: string | null;
      action_completed_at: string | null;
      action_deadline: string | null;
      action_priority: string | null;
      occurred_at: string | null;
      shipper_name: string | null;
      consignee_name: string | null;
      from_party: string | null;
      from_address: string | null;
      carrier_name: string | null;
      summary: string | null;
      document_type: string | null;
    };

    let chronicles: ChronicleRecord[] = [];

    if (rpcError || !aggregateData) {
      // RPC not available, use direct query with batching
      const batchSize = 50;

      for (let i = 0; i < shipmentIds.length; i += batchSize) {
        const batch = shipmentIds.slice(i, i + batchSize);
        const { data: batchData } = await supabase
          .from('chronicle')
          .select(
            `
            shipment_id,
            has_issue,
            issue_type,
            issue_description,
            has_action,
            action_description,
            action_completed_at,
            action_deadline,
            action_priority,
            occurred_at,
            shipper_name,
            consignee_name,
            from_party,
            from_address,
            carrier_name,
            summary,
            document_type
          `
          )
          .in('shipment_id', batch);

        if (batchData) {
          chronicles.push(...(batchData as ChronicleRecord[]));
        }
      }
    }

    // Step 3b: Get narrative chains (Chain of Thought) for story headlines
    const { data: narrativeChains } = await supabase
      .from('shipment_narrative_chains')
      .select(`
        shipment_id,
        chain_type,
        chain_status,
        narrative_headline,
        narrative_summary,
        current_state,
        current_state_party,
        days_in_current_state,
        trigger_event_type,
        trigger_summary,
        delay_impact_days,
        financial_impact_usd,
        resolution_required,
        resolution_deadline,
        confidence_score,
        updated_at
      `)
      .in('shipment_id', shipmentIds)
      .eq('chain_status', 'active')
      .order('updated_at', { ascending: false });

    // Build chain data map (most important chain per shipment)
    type ChainData = {
      headline: string | null;
      summary: string | null;
      currentState: string | null;
      currentStateParty: string | null;
      daysInState: number | null;
      chainType: string;
      triggerType: string | null;
      triggerSummary: string | null;
      delayDays: number | null;
      financialImpact: number | null;
      resolutionRequired: boolean;
      resolutionDeadline: string | null;
      confidence: number | null;
      activeChainCount: number;
    };

    const chainDataMap = new Map<string, ChainData>();

    // Group chains by shipment and pick the most important one
    // Only use chains that are recent (updated in last 3 days) - focus on TODAY
    const chainCutoff = new Date(now);
    chainCutoff.setDate(chainCutoff.getDate() - 3);

    if (narrativeChains) {
      const shipmentChainCounts = new Map<string, number>();

      for (const chain of narrativeChains) {
        if (!chain.shipment_id) continue;

        // Skip chains that haven't been updated recently (stale) - only last 3 days
        const chainUpdated = chain.updated_at ? new Date(chain.updated_at) : null;
        const isRecentChain = chainUpdated && chainUpdated > chainCutoff;
        if (!isRecentChain) continue;

        // Count active recent chains per shipment
        shipmentChainCounts.set(
          chain.shipment_id,
          (shipmentChainCounts.get(chain.shipment_id) || 0) + 1
        );

        // Only keep the first (most recent) chain per shipment
        if (!chainDataMap.has(chain.shipment_id)) {
          chainDataMap.set(chain.shipment_id, {
            headline: chain.narrative_headline,
            summary: chain.narrative_summary,
            currentState: chain.current_state,
            currentStateParty: chain.current_state_party,
            daysInState: chain.days_in_current_state,
            chainType: chain.chain_type,
            triggerType: chain.trigger_event_type,
            triggerSummary: chain.trigger_summary,
            delayDays: chain.delay_impact_days,
            financialImpact: chain.financial_impact_usd,
            resolutionRequired: chain.resolution_required,
            resolutionDeadline: chain.resolution_deadline,
            confidence: chain.confidence_score,
            activeChainCount: 0, // Will be updated
          });
        }
      }

      // Update chain counts
      for (const [shipmentId, count] of shipmentChainCounts) {
        const data = chainDataMap.get(shipmentId);
        if (data) {
          data.activeChainCount = count;
        }
      }
    }

    // Build aggregates per shipment
    type ActionSummary = {
      description: string;
      deadline: string | null;
      priority: string | null;
    };

    type StakeholderInfo = {
      type: string;
      name: string | null;
      lastContact: string | null;
    };

    const aggregateMap = new Map<
      string,
      {
        issueCount: number;
        issueTypes: string[];
        latestIssue: { description: string; occurredAt: string } | null;
        pendingActions: number;
        overdueActions: number;
        maxPriority: string | null;
        lastActivity: string | null;
        totalDocs: number;
        recentDocs: number;
        shipperName: string | null;
        consigneeName: string | null;
        actionsList: ActionSummary[];
        stakeholders: Map<string, StakeholderInfo>;
        latestDocSummary: string | null; // Most recent document summary for journey context
      }
    >();

    const yesterday = new Date(now);
    yesterday.setDate(yesterday.getDate() - 1);

    // Use RPC aggregateData if available, otherwise process chronicles
    if (aggregateData && Array.isArray(aggregateData)) {
      // Use pre-aggregated data from RPC
      for (const agg of aggregateData) {
        aggregateMap.set(agg.shipment_id, {
          issueCount: agg.issue_count || 0,
          issueTypes: agg.issue_types || [],
          latestIssue: agg.latest_issue || null,
          pendingActions: agg.pending_actions || 0,
          overdueActions: agg.overdue_actions || 0,
          maxPriority: agg.max_priority || null,
          lastActivity: agg.last_activity || null,
          totalDocs: agg.total_docs || 0,
          recentDocs: agg.recent_docs || 0,
          shipperName: agg.shipper_name || null,
          consigneeName: agg.consignee_name || null,
          actionsList: agg.actions_list || [],
          stakeholders: new Map(), // RPC doesn't return stakeholders yet
          latestDocSummary: agg.latest_doc_summary || null,
        });
      }
    } else {
      // Process individual chronicle records
      for (const doc of chronicles || []) {
        if (!doc.shipment_id) continue;

        let agg = aggregateMap.get(doc.shipment_id);
        if (!agg) {
          agg = {
            issueCount: 0,
            issueTypes: [],
            latestIssue: null,
            pendingActions: 0,
            overdueActions: 0,
            maxPriority: null,
            lastActivity: null,
            totalDocs: 0,
            recentDocs: 0,
            shipperName: null,
            consigneeName: null,
            actionsList: [],
            stakeholders: new Map(),
            latestDocSummary: null,
          };
          aggregateMap.set(doc.shipment_id, agg);
        }

        agg.totalDocs++;

        // Track recent docs
        if (doc.occurred_at && new Date(doc.occurred_at) > yesterday) {
          agg.recentDocs++;
        }

        // Track last activity
        if (!agg.lastActivity || (doc.occurred_at && doc.occurred_at > agg.lastActivity)) {
          agg.lastActivity = doc.occurred_at;
        }

        // Capture latest document summary for journey context (only if recent - last 3 days)
        const threeDaysAgo = new Date(now);
        threeDaysAgo.setDate(threeDaysAgo.getDate() - 3);
        const docDate = doc.occurred_at ? new Date(doc.occurred_at) : null;
        if (doc.summary && docDate && docDate > threeDaysAgo) {
          // This document is recent - use its summary if we don't have one yet
          // (documents are already sorted by occurred_at desc in query)
          if (!agg.latestDocSummary) {
            agg.latestDocSummary = doc.summary;
          }
        }

        // Track shipper/consignee (use first non-null value found)
        if (!agg.shipperName && doc.shipper_name) {
          agg.shipperName = doc.shipper_name;
        }
        if (!agg.consigneeName && doc.consignee_name) {
          agg.consigneeName = doc.consignee_name;
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
            // For all other parties (trucker, customs_broker, etc.): extract from email domain
            // carrier_name field contains the shipment's carrier, NOT the sender's company
            if (doc.from_address) {
              const domainMatch = doc.from_address.match(/@([^.]+)\./);
              if (domainMatch) {
                const domain = domainMatch[1].toLowerCase();
                // Skip generic email providers
                if (!['gmail', 'outlook', 'yahoo', 'hotmail', 'service'].includes(domain)) {
                  // Clean up and capitalize
                  const cleanName = domain
                    .replace(/cargo$/i, ' Cargo')
                    .replace(/logistics$/i, ' Logistics')
                    .replace(/transport$/i, ' Transport');
                  stakeholderName = cleanName.charAt(0).toUpperCase() + cleanName.slice(1);
                }
              }
            }
          }

          const existing = agg.stakeholders.get(doc.from_party);
          const shouldUpdate = !existing ||
            (doc.occurred_at && (!existing.lastContact || doc.occurred_at > existing.lastContact)) ||
            (!existing.name && stakeholderName);

          if (shouldUpdate) {
            agg.stakeholders.set(doc.from_party, {
              type: doc.from_party,
              name: stakeholderName || existing?.name || null,
              lastContact: doc.occurred_at || existing?.lastContact || null,
            });
          }
        }

        // Track issues - only count TODAY's issues or last 3 days as relevant
        if (doc.has_issue) {
          const issueDate = doc.occurred_at ? new Date(doc.occurred_at) : null;
          const threeDaysAgo = new Date(now);
          threeDaysAgo.setDate(threeDaysAgo.getDate() - 3);
          const isRecentIssue = issueDate && issueDate > threeDaysAgo;

          if (isRecentIssue) {
            agg.issueCount++;
            if (doc.issue_type && !agg.issueTypes.includes(doc.issue_type)) {
              agg.issueTypes.push(doc.issue_type);
            }
            // Track latest RECENT issue (most recent by date, within 3 days)
            if (doc.issue_description && doc.occurred_at) {
              if (!agg.latestIssue || doc.occurred_at > agg.latestIssue.occurredAt) {
                agg.latestIssue = {
                  description: doc.issue_description,
                  occurredAt: doc.occurred_at,
                };
              }
            }
          }
        }

        // Track actions - only if RECENTLY overdue (last 5 days) OR deadline within next 5 days
        // Actions that are 20+ days overdue are stale and should NOT show
        if (doc.has_action && !doc.action_completed_at) {
          const actionDeadline = doc.action_deadline ? new Date(doc.action_deadline) : null;
          const fiveDaysFromNow = new Date(now);
          fiveDaysFromNow.setDate(fiveDaysFromNow.getDate() + 5);
          const fiveDaysAgo = new Date(now);
          fiveDaysAgo.setDate(fiveDaysAgo.getDate() - 5);

          const isOverdue = actionDeadline && actionDeadline < now;
          const isRecentlyOverdue = isOverdue && actionDeadline > fiveDaysAgo; // Only overdue within last 5 days
          const isDueSoon = actionDeadline && actionDeadline <= fiveDaysFromNow && actionDeadline >= now;

          // Relevant = recently overdue OR due soon. Old overdue (>5 days) = stale, skip
          const isRelevantAction = isRecentlyOverdue || isDueSoon;

          if (isRelevantAction) {
            agg.pendingActions++;

            // Check if overdue (recently)
            if (isRecentlyOverdue) {
              agg.overdueActions++;
            }

            // Track max priority
            const priorityOrder = { critical: 4, high: 3, medium: 2, low: 1 };
            const currentPriority = priorityOrder[doc.action_priority as keyof typeof priorityOrder] || 0;
            const maxPriority = priorityOrder[agg.maxPriority as keyof typeof priorityOrder] || 0;
            if (currentPriority > maxPriority) {
              agg.maxPriority = doc.action_priority;
            }

            // Add to actions list for summary (only relevant ones)
            if (doc.action_description) {
              agg.actionsList.push({
                description: doc.action_description,
                deadline: doc.action_deadline,
                priority: doc.action_priority,
              });
            }
          }
        }
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

    const buildJourneyInfo = (stage: string | null, latestDocSummary: string | null, etd: string | null, eta: string | null, chainData: ChainData | null) => {
      const stageUpper = (stage || 'PENDING').toUpperCase();
      const info = STAGE_PROGRESS[stageUpper] || STAGE_PROGRESS.PENDING;

      // Build a smart summary based on chain data, latest activity, or stage
      let summary: string | null = null;

      // Priority 1: Use chain headline/summary if available (Chain of Thought)
      if (chainData && chainData.headline) {
        const chainInfo = chainData.activeChainCount > 1
          ? ` (+${chainData.activeChainCount - 1} more)`
          : '';
        summary = chainData.headline + chainInfo;
        if (summary.length > 80) {
          summary = summary.slice(0, 77) + '...';
        }
      } else if (chainData && chainData.summary) {
        summary = chainData.summary.length > 80
          ? chainData.summary.slice(0, 77) + '...'
          : chainData.summary;
      } else if (latestDocSummary) {
        // Priority 2: Use latest document summary if available
        summary = latestDocSummary.length > 80 ? latestDocSummary.slice(0, 77) + '...' : latestDocSummary;
      } else {
        // Generate summary based on stage
        switch (stageUpper) {
          case 'PENDING':
            summary = 'Awaiting booking confirmation';
            break;
          case 'BOOKED':
            summary = etd ? `Booked, sailing ${new Date(etd).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}` : 'Booking confirmed, awaiting schedule';
            break;
          case 'SI_SUBMITTED':
            summary = 'SI submitted, awaiting confirmation';
            break;
          case 'SI_CONFIRMED':
            summary = 'SI confirmed, BL in progress';
            break;
          case 'BL_DRAFT':
            summary = 'Draft BL received, review in progress';
            break;
          case 'BL_ISSUED':
            summary = 'BL issued, cargo ready for departure';
            break;
          case 'DEPARTED':
            summary = eta ? `Departed, arriving ${new Date(eta).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}` : 'Vessel departed, in transit';
            break;
          case 'IN_TRANSIT':
            summary = eta ? `In transit, ETA ${new Date(eta).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}` : 'In transit to destination';
            break;
          case 'ARRIVED':
            summary = 'Arrived at destination, awaiting clearance';
            break;
          case 'CUSTOMS_CLEARED':
            summary = 'Customs cleared, ready for delivery';
            break;
          case 'DELIVERED':
            summary = 'Delivered to consignee';
            break;
          case 'COMPLETED':
            summary = 'Shipment completed';
            break;
          default:
            summary = info.label;
        }
      }

      return {
        stage: stageUpper,
        stageLabel: info.label,
        progress: info.progress,
        nextMilestone: null,
        nextMilestoneDate: null,
        summary,
      };
    };

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

    const buildStakeholdersList = (stakeholdersMap: Map<string, StakeholderInfo>) => {
      const stakeholders: Array<{ type: StakeholderType; label: string; name: string | null; lastContact: string | null }> = [];
      // Only external stakeholders: Shipping Line, Trucking, Customs Broker, Warehouse, Terminal
      // We are NVOCC, so don't show nvocc
      const priority = ['ocean_carrier', 'trucker', 'customs_broker', 'warehouse', 'terminal'];

      for (const partyType of priority) {
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

      return stakeholders.slice(0, 4); // Max 4 stakeholders shown
    };

    // Helper: Build smart action recommendation based on current state and chain data
    const buildRecommendation = (
      stage: string,
      issueTypes: string[],
      latestIssue: { description: string; occurredAt: string } | null,
      overdueActions: number,
      pendingActions: number,
      topAction: { description: string; daysRemaining: number | null; isOverdue: boolean } | null,
      daysSinceActivity: number,
      chainData: ChainData | null
    ): ShipmentListItem['recommendation'] => {
      // Use chain-of-thought data if available
      if (chainData && chainData.headline) {
        // Build recommendation from chain data
        let action = '';
        let priority: 'critical' | 'high' | 'medium' | 'low' = 'medium';
        let reason = chainData.summary || chainData.headline;

        // Determine priority and action based on chain type and state
        if (chainData.delayDays && chainData.delayDays > 0) {
          priority = chainData.delayDays > 5 ? 'critical' : 'high';
          action = `Follow up: ${chainData.currentStateParty || 'carrier'} - ${chainData.daysInState || 0}d pending`;
        } else if (chainData.chainType === 'escalation_chain') {
          priority = 'critical';
          action = `Escalate: ${chainData.currentState || 'Issue pending'}`;
        } else if (chainData.resolutionRequired && chainData.resolutionDeadline) {
          const daysToDeadline = Math.ceil(
            (new Date(chainData.resolutionDeadline).getTime() - now.getTime()) / (1000 * 60 * 60 * 24)
          );
          priority = daysToDeadline <= 1 ? 'critical' : daysToDeadline <= 3 ? 'high' : 'medium';
          action = `Resolve by ${new Date(chainData.resolutionDeadline).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}`;
        } else if (chainData.daysInState && chainData.daysInState > 3) {
          priority = chainData.daysInState > 7 ? 'high' : 'medium';
          action = chainData.currentStateParty
            ? `Follow up with ${chainData.currentStateParty}`
            : `Check status - ${chainData.daysInState}d stale`;
        } else {
          action = chainData.currentState || 'Review chain';
        }

        // Truncate reason
        reason = reason.length > 60 ? reason.slice(0, 57) + '...' : reason;

        return { action, priority, reason };
      }
      // Critical: Overdue actions - transform to follow-up language, don't show stale "by past date" text
      if (overdueActions > 0 && topAction?.isOverdue && topAction.daysRemaining !== null) {
        // Clean the action description - remove date references like "by 9th January", "by Jan 9", etc.
        let cleanAction = topAction.description
          .replace(/\s*by\s+\d{1,2}(st|nd|rd|th)?\s+(january|february|march|april|may|june|july|august|september|october|november|december)/gi, '')
          .replace(/\s*by\s+(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)\s+\d{1,2}/gi, '')
          .replace(/\s*by\s+\d{1,2}\/\d{1,2}/gi, '')
          .replace(/\s*within\s+\d+\s+(day|hour|working day)s?/gi, '')
          .trim();

        // If cleaning removed too much, use a generic description
        if (cleanAction.length < 10) {
          cleanAction = 'Pending action';
        }

        const daysOverdue = Math.abs(topAction.daysRemaining);
        return {
          action: `Follow up: ${cleanAction}`,
          priority: 'critical',
          reason: `Was due ${daysOverdue} day${daysOverdue !== 1 ? 's' : ''} ago`,
        };
      }

      // High: Active issues
      if (latestIssue && issueTypes.length > 0) {
        const issueAge = Math.floor((now.getTime() - new Date(latestIssue.occurredAt).getTime()) / (1000 * 60 * 60 * 24));
        if (issueTypes.includes('delay')) {
          return {
            action: 'Follow up on delay and get revised schedule',
            priority: 'high',
            reason: latestIssue.description.slice(0, 60),
          };
        }
        if (issueTypes.includes('detention') || issueTypes.includes('demurrage')) {
          return {
            action: 'Resolve to avoid additional charges',
            priority: 'critical',
            reason: 'Detention/demurrage charges accumulating',
          };
        }
        return {
          action: 'Review and resolve issue',
          priority: issueAge <= 2 ? 'high' : 'medium',
          reason: latestIssue.description.slice(0, 60),
        };
      }

      // Medium: Pending actions with deadline within 3 days
      if (topAction && !topAction.isOverdue && topAction.daysRemaining !== null && topAction.daysRemaining <= 3) {
        // Clean the action description - remove embedded date references
        let cleanAction = topAction.description
          .replace(/\s*by\s+\d{1,2}(st|nd|rd|th)?\s+(january|february|march|april|may|june|july|august|september|october|november|december)/gi, '')
          .replace(/\s*by\s+(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)\s+\d{1,2}/gi, '')
          .replace(/\s*by\s+\d{1,2}\/\d{1,2}/gi, '')
          .replace(/\s*within\s+\d+\s+(day|hour|working day)s?/gi, '')
          .trim();

        if (cleanAction.length < 10) {
          cleanAction = 'Pending action';
        }

        const dueText = topAction.daysRemaining === 0 ? 'Due today' : `Due in ${topAction.daysRemaining} day${topAction.daysRemaining !== 1 ? 's' : ''}`;
        return {
          action: cleanAction,
          priority: topAction.daysRemaining <= 1 ? 'high' : 'medium',
          reason: dueText,
        };
      }

      // Don't show generic "no activity" recommendations - only show when there's real action needed
      return null;
    };

    // Step 4: Transform and score shipments
    const scoredShipments: ShipmentListItem[] = shipments.map((ship) => {
      const agg = aggregateMap.get(ship.id) || {
        issueCount: 0,
        issueTypes: [],
        latestIssue: null,
        pendingActions: 0,
        overdueActions: 0,
        maxPriority: null,
        lastActivity: null,
        totalDocs: 0,
        recentDocs: 0,
        shipperName: null,
        consigneeName: null,
        actionsList: [],
        stakeholders: new Map(),
        latestDocSummary: null,
      };

      // Build attention components
      const components = buildAttentionComponents({
        issueCount: agg.issueCount,
        issueTypes: agg.issueTypes,
        pendingActions: agg.pendingActions,
        overdueActions: agg.overdueActions,
        maxPriority: agg.maxPriority,
        lastActivity: agg.lastActivity,
        etd: ship.etd,
        siCutoff: ship.si_cutoff,
        vgmCutoff: ship.vgm_cutoff,
        cargoCutoff: ship.cargo_cutoff,
      });

      // Calculate score
      const { score, tier } = calculateAttentionWithTier(components);

      // Determine phase from stage
      const shipPhase = (STAGE_TO_PHASE[ship.stage?.toUpperCase()] || 'origin') as Phase;

      // Determine direction
      const shipDirection = detectDirection(ship.port_of_loading_code, ship.port_of_discharge_code);

      // Find nearest cutoff
      let nearestCutoff: ShipmentListItem['cutoffs']['nearest'] = null;
      const cutoffs = [
        { type: 'SI', date: ship.si_cutoff },
        { type: 'VGM', date: ship.vgm_cutoff },
        { type: 'Cargo', date: ship.cargo_cutoff },
      ];

      for (const c of cutoffs) {
        if (!c.date) continue;
        const daysRemaining = Math.ceil(
          (new Date(c.date).getTime() - now.getTime()) / (1000 * 60 * 60 * 24)
        );
        if (!nearestCutoff || daysRemaining < nearestCutoff.daysRemaining) {
          nearestCutoff = { type: c.type, date: c.date, daysRemaining };
        }
      }

      // Build top actions (sorted by deadline, overdue first, then soonest)
      const topActions = (agg.actionsList || [])
        .map((action) => {
          const daysRemaining = action.deadline
            ? Math.ceil((new Date(action.deadline).getTime() - now.getTime()) / (1000 * 60 * 60 * 24))
            : null;
          return {
            description: action.description,
            daysRemaining,
            isOverdue: daysRemaining !== null && daysRemaining < 0,
          };
        })
        .sort((a, b) => {
          // Overdue first
          if (a.isOverdue && !b.isOverdue) return -1;
          if (!a.isOverdue && b.isOverdue) return 1;
          // Then by days remaining (soonest first)
          if (a.daysRemaining !== null && b.daysRemaining !== null) {
            return a.daysRemaining - b.daysRemaining;
          }
          return 0;
        })
        .slice(0, 2); // Top 2 most urgent

      // Calculate days since last activity for recommendation
      const daysSinceActivity = agg.lastActivity
        ? Math.floor((now.getTime() - new Date(agg.lastActivity).getTime()) / (1000 * 60 * 60 * 24))
        : 999; // No activity = treat as very old

      // Get chain data for this shipment
      const chainData = chainDataMap.get(ship.id) || null;

      // Build smart recommendation (use chain data if available)
      const recommendation = buildRecommendation(
        ship.stage || 'PENDING',
        agg.issueTypes,
        agg.latestIssue,
        agg.overdueActions,
        agg.pendingActions,
        topActions[0] || null,
        daysSinceActivity,
        chainData
      );

      return {
        id: ship.id,
        bookingNumber: ship.booking_number,
        mblNumber: ship.mbl_number,
        hblNumber: ship.hbl_number,
        route: {
          origin: ship.port_of_loading_code || ship.port_of_loading || '',
          destination: ship.port_of_discharge_code || ship.port_of_discharge || '',
          originFull: ship.port_of_loading || '',
          destinationFull: ship.port_of_discharge || '',
        },
        shipper: ship.shipper_name || agg.shipperName,
        consignee: ship.consignee_name || agg.consigneeName,
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
          count: agg.issueCount,
          types: agg.issueTypes,
          mostSevere: agg.issueTypes[0] || null,
          latestSummary: agg.latestIssue?.description || null,
        },
        actions: {
          pending: agg.pendingActions,
          overdue: agg.overdueActions,
          nextDeadline: topActions[0]?.daysRemaining !== null && topActions[0]?.daysRemaining !== undefined
            ? new Date(now.getTime() + topActions[0].daysRemaining * 24 * 60 * 60 * 1000).toISOString()
            : null,
          topActions,
        },
        cutoffs: {
          nearest: nearestCutoff,
          overdueCount: cutoffs.filter(
            (c) => c.date && new Date(c.date) < now
          ).length,
        },
        documents: {
          total: agg.totalDocs,
          recent24h: agg.recentDocs,
        },
        lastActivity: agg.lastActivity,
        journey: buildJourneyInfo(ship.stage, agg.latestDocSummary, ship.etd, ship.eta, chainData),
        recommendation,
        stakeholders: buildStakeholdersList(agg.stakeholders),
        // AI-powered summary (from Haiku)
        aiSummary: aiSummaryMap.get(ship.id) || null,
      };
    });

    // Step 5: Apply direction filter (in memory since it's computed)
    let filteredShipments = scoredShipments;
    if (direction !== 'all') {
      filteredShipments = scoredShipments.filter((s) => s.direction === direction);
    }

    // Step 6: Apply score filter
    const effectiveMinScore = showWatchlist ? SIGNAL_THRESHOLDS.WEAK : minScore;
    filteredShipments = filteredShipments.filter((s) => s.attentionScore >= effectiveMinScore);

    // Step 7: Calculate score distribution (before pagination)
    const scoreDistribution = {
      strong: filteredShipments.filter((s) => s.attentionScore >= SIGNAL_THRESHOLDS.STRONG).length,
      medium: filteredShipments.filter(
        (s) => s.attentionScore >= SIGNAL_THRESHOLDS.MEDIUM && s.attentionScore < SIGNAL_THRESHOLDS.STRONG
      ).length,
      weak: filteredShipments.filter(
        (s) => s.attentionScore >= SIGNAL_THRESHOLDS.WEAK && s.attentionScore < SIGNAL_THRESHOLDS.MEDIUM
      ).length,
      noise: filteredShipments.filter((s) => s.attentionScore < SIGNAL_THRESHOLDS.WEAK).length,
    };

    // Step 8: Sort by attention score (highest first)
    filteredShipments.sort((a, b) => {
      // Primary: attention score descending
      if (b.attentionScore !== a.attentionScore) {
        return b.attentionScore - a.attentionScore;
      }
      // Secondary: ETD ascending (earlier first)
      if (a.etd && b.etd) {
        return new Date(a.etd).getTime() - new Date(b.etd).getTime();
      }
      return 0;
    });

    // Step 9: Paginate
    const total = filteredShipments.length;
    const start = (page - 1) * pageSize;
    const paginatedShipments = filteredShipments.slice(start, start + pageSize);

    return NextResponse.json({
      shipments: paginatedShipments,
      total,
      page,
      pageSize,
      scoreDistribution,
    } as ShipmentListResponse);
  } catch (error) {
    console.error('Error fetching shipments:', error);
    return NextResponse.json({ error: 'Failed to fetch shipments' }, { status: 500 });
  }
}
