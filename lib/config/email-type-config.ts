/**
 * Email Type Configuration
 *
 * Defines email types based on sender category and content patterns.
 * Email type represents the INTENT/ACTION of the email, parallel to document type.
 *
 * Email types answer: "What is the sender trying to communicate/achieve?"
 * Document types answer: "What document is attached/referenced?"
 *
 * Both contribute to shipment intelligence and workflow state.
 */

// =============================================================================
// SENDER CATEGORIES
// =============================================================================

export type SenderCategory =
  | 'carrier'           // Shipping lines (Maersk, Hapag, CMA CGM, etc.)
  | 'cha_india'         // Customs House Agents in India
  | 'customs_broker_us' // US Customs Brokers
  | 'shipper'           // Shippers/Exporters
  | 'consignee'         // Consignees/Importers
  | 'trucker'           // Trucking companies
  | 'warehouse'         // Warehouses/CFS
  | 'partner'           // Logistics partners (SMIL, etc.)
  | 'platform'          // Platforms (ODeX, etc.)
  | 'intoglo'           // Internal Intoglo team
  | 'unknown';          // Unknown sender

/**
 * Sender category patterns for classification.
 * Order matters - more specific patterns first.
 */
export const SENDER_CATEGORY_PATTERNS: Array<{
  category: SenderCategory;
  patterns: RegExp[];
  description: string;
}> = [
  // Carriers (shipping lines) - from real email data
  {
    category: 'carrier',
    patterns: [
      // Maersk (184+ emails: in.export@maersk.com, donotreply@maersk.com, autonotificationimports@, maerskfmcspot@, automatedreportsnoreply@)
      /maersk/i,
      // Hapag-Lloyd (85+ emails: india@service.hlag.com, usa@service.hlag.com, uae@service.hlag.com, noreply@hlag.cloud, doc.in@csd.hlag.com, doc.gb@csd.hlag.com, nuren.shah@ext.hlag.com, no_reply@hlag.com, do-not-reply@hlag.com)
      /hapag|hlag|@service\.hlag|@csd\.hlag|@ext\.hlag|hlag\.cloud/i,
      // CMA CGM (28+ emails: ind.service@cma-cgm.com, website-noreply@cma-cgm.com, mycustomerservice-noreply@cma-cgm.com)
      /cma.?cgm/i,
      // COSCO (23+ emails: please-no-reply-iris-4@coscon.com)
      /cosco|coscon/i,
      // Other carriers
      /one-line|ocean.?network/i,
      /evergreen/i,
      /\bmsc\b|mediterranean.?shipping/i,
      /yang.?ming|yml/i,
      /\bzim\b/i,
      /oocl/i,
      /\bapl\b/i,
      /pabordar|abordar/i,  // Carrier portal
    ],
    description: 'Shipping lines and carriers',
  },

  // Intoglo (internal) - many emails from @intoglo.com
  {
    category: 'intoglo',
    patterns: [
      /@intoglo\.com/i,
      /@intoglo\.in/i,
    ],
    description: 'Intoglo internal team',
  },

  // Government / Customs Authorities
  {
    category: 'platform',
    patterns: [
      // US CBP (32 emails: cbp@info.cbp.dhs.gov)
      /cbp\.dhs\.gov/i,
      // Canada CBSA (31 emails: cbsa-asfc@auth.canada.ca)
      /cbsa|auth\.canada\.ca/i,
      // FFFAI (18 emails: noreply@fffai.org)
      /fffai\.org/i,
      // Platforms
      /odexservices/i,  // 39 emails: notification@odexservices.com
      /shipcube/i,      // 24 emails: 'SHIPCUBE LLC' via accounts
      /scimplify/i,
      /softlinkglobal/i,
    ],
    description: 'Government authorities and logistics platforms',
  },

  // US Customs Brokers - from real email data
  {
    category: 'customs_broker_us',
    patterns: [
      // Portside (customs broker)
      /portside/i,
      // Artemus CHB (19 emails: CHBentries@outlook.com)
      /chbentries|artemus/i,
      // JMD Customs (13 emails: pars1@jmdcustoms.com)
      /jmdcustoms/i,
      // SSS USA (12 emails: accountsdept@sssusainc.com)
      /sssusainc/i,
      // Others
      /cometclearing/i,
    ],
    description: 'US customs brokers',
  },

  // India CHAs - from real email data + user corrections
  {
    category: 'cha_india',
    patterns: [
      // High volume from database
      /anscargo/i,           // ANS Cargo (38 emails)
      /aarishkalogistics/i,  // Aarishka Logistics (23 emails)
      /arglltd/i,            // ARGL Ltd (20 emails)
      /highwayroop/i,        // Highway Roop (16 emails)
      /klfintl/i,            // KLF International

      // User corrected CHAs
      /tulipshipping/i,      // Tulip Shipping Services
      /clairvoince/i,        // Clairvoince Pvt Ltd
      /ishtcorp/i,           // Ishtcorp Shipping
      /globaltrade/i,        // Globaltrade Shipping

      // Others
      /tulsilogistics/i,
      /vccfa/i,
      /triwaystransport/i,
      /jasliner/i,
      /arihantshipping/i,
      /transnautic|trnautic/i,
      /cometshipping\.in/i,
      /rajvilogistics/i,
      /ajsl\.in/i,           // AJSL (from test results)
      /bbcargo/i,            // BB Cargo
    ],
    description: 'Indian Customs House Agents',
  },

  // Trucking
  {
    category: 'trucker',
    patterns: [
      /carmeltransport/i,
      /meiborg/i,
      /champion.?logistics/i,
    ],
    description: 'Trucking and drayage companies',
  },

  // Partners / Freight Forwarders - from real email data
  {
    category: 'partner',
    patterns: [
      // Transjet Cargo (49 emails: p.james@transjetcargo.com)
      /transjetcargo/i,
      // Others
      /\bsmil\b/i,
      /go2wwl/i,
    ],
    description: 'Logistics partners and freight forwarders',
  },

  // Shippers (known customer domains) - from real email data
  {
    category: 'shipper',
    patterns: [
      // From database (high volume)
      /ideafasteners/i,       // 14 emails
      /matangiindustries/i,   // 13 emails
      /sonacomstar/i,         // 13 emails
      /northpole-industries/i, // 12 emails
      /starpipeproducts/i,    // 12 emails
      /pearlglobal/i,         // 13 emails
      /grasperglobal/i,
      // User corrected: Trade Partners is shipper
      /tradepartners\.us/i,   // 21+ emails: am4@tradepartners.us
      // From test results (unknown senders)
      /kirstutt/i,            // accounts@kirstutt.com
      /crafttrends/i,         // crafttrends.in
      /katyaniexport/i,       // katyaniexport.com
      /raajtubes/i,           // raajtubes.com
      /srsinternational/i,    // srsinternational.co.in
      /silverplastomers/i,    // silverplastomers.com
      /sbenterprises/i,       // sbenterprisesindia.com
      // Others
      /ansabrakesgroup/i,
      /aryanint/i,
      /panoramicsourcing/i,
      /gfsolutions\.in/i,
      /eikowa/i,
      /globalautotec/i,
      /cetusengineering/i,
      /denovoinnovations/i,
    ],
    description: 'Known shipper/exporter domains',
  },

  // Consignees (known importer domains)
  {
    category: 'consignee',
    patterns: [
      /unimotion/i,           // UNIMOTION mentioned in arrival notices
      /blastr?eso/i,          // BLAST RESO mentioned in demurrage
      /gravityconcepts/i,     // gravityconcepts.us
      /meiborg/i,             // Meiborg Brothers Warehouse (also trucker)
    ],
    description: 'Known consignee/importer domains',
  },
];

// =============================================================================
// EMAIL TYPES
// =============================================================================

export type EmailType =
  // Approval flow
  | 'approval_request'      // Requesting approval (SI, checklist, BL draft)
  | 'approval_granted'      // Approval given
  | 'approval_rejected'     // Approval rejected with feedback

  // Status updates
  | 'stuffing_update'       // Factory stuffing status
  | 'gate_in_update'        // Container gated in at port/ICD
  | 'handover_update'       // CHA handover/railout status
  | 'departure_update'      // Vessel departed
  | 'transit_update'        // In-transit status
  | 'arrival_update'        // Vessel arrived

  // Pre-arrival / Customs
  | 'pre_alert'             // Pre-arrival alert to customs broker
  | 'clearance_initiation'  // Customs clearance started
  | 'clearance_complete'    // Customs cleared

  // Delivery
  | 'delivery_scheduling'   // Delivery appointment request/confirmation
  | 'pickup_scheduling'     // Pickup arrangement
  | 'delivery_complete'     // Delivery completed

  // Commercial
  | 'quote_request'         // Rate/freight quote request
  | 'quote_response'        // Rate/freight quote response
  | 'payment_request'       // Invoice/payment request
  | 'payment_confirmation'  // Payment confirmed

  // Changes
  | 'amendment_request'     // Requesting booking/SI changes
  | 'cancellation_notice'   // Booking cancelled

  // Communication
  | 'query'                 // Question/inquiry
  | 'reminder'              // Deadline reminder
  | 'urgent_action'         // Urgent request requiring immediate action
  | 'delay_notice'          // Delay notification
  | 'demurrage_action'      // Demurrage/detention notice
  | 'document_share'        // Sharing documents (PFA)
  | 'general_correspondence'// General discussion
  | 'acknowledgement'       // Acknowledging receipt/action
  | 'escalation'            // Escalated issue

  // Unknown
  | 'unknown';

// =============================================================================
// SENTIMENT TYPES
// =============================================================================

export type EmailSentiment =
  | 'urgent'      // Needs immediate attention
  | 'escalated'   // Complaint/issue escalated
  | 'negative'    // Disappointed, frustrated, complaint
  | 'neutral'     // Normal business communication
  | 'positive'    // Appreciation, thanks, satisfied
  | 'unknown';

export interface SentimentConfig {
  sentiment: EmailSentiment;
  subjectPatterns: Array<{
    patterns: string[];
    weight: number;  // -10 to +10
  }>;
  bodyPatterns?: Array<{
    patterns: string[];
    weight: number;
  }>;
  description: string;
}

export const SENTIMENT_CONFIGS: SentimentConfig[] = [
  {
    sentiment: 'urgent',
    subjectPatterns: [
      { patterns: ['URGENT', 'ASAP', 'IMMEDIATELY'], weight: 10 },
      { patterns: ['RUSH', 'PRIORITY', 'CRITICAL'], weight: 9 },
      { patterns: ['TIME SENSITIVE', 'DEADLINE'], weight: 8 },
      { patterns: ['NEED', 'TODAY'], weight: 6 },
      { patterns: ['EOD', 'END OF DAY'], weight: 7 },
    ],
    bodyPatterns: [
      { patterns: ['PLEASE EXPEDITE', 'NEED URGENTLY'], weight: 8 },
      { patterns: ['ASAP', 'AS SOON AS POSSIBLE'], weight: 7 },
    ],
    description: 'Urgent/time-sensitive requests',
  },
  {
    sentiment: 'escalated',
    subjectPatterns: [
      { patterns: ['ESCALATION', 'ESCALATE'], weight: 10 },
      { patterns: ['COMPLAINT', 'ISSUE'], weight: 8 },
      { patterns: ['UNRESOLVED', 'PENDING SINCE'], weight: 7 },
      { patterns: ['THIRD TIME', 'MULTIPLE TIMES'], weight: 8 },
      { patterns: ['STILL WAITING', 'NO RESPONSE'], weight: 7 },
    ],
    bodyPatterns: [
      { patterns: ['ESCALATING THIS', 'RAISING THIS'], weight: 9 },
      { patterns: ['NOT ACCEPTABLE', 'UNACCEPTABLE'], weight: 8 },
      { patterns: ['BEEN WAITING', 'FOLLOWING UP AGAIN'], weight: 6 },
    ],
    description: 'Escalated issues requiring attention',
  },
  {
    sentiment: 'negative',
    subjectPatterns: [
      { patterns: ['DISAPPOINTED', 'DISSATISFIED'], weight: -8 },
      { patterns: ['PROBLEM', 'ISSUE'], weight: -5 },
      { patterns: ['FAILED', 'ERROR', 'WRONG'], weight: -6 },
      { patterns: ['DELAYED', 'MISSING'], weight: -4 },
    ],
    bodyPatterns: [
      { patterns: ['DISAPPOINTED', 'FRUSTRATED'], weight: -8 },
      { patterns: ['NOT HAPPY', 'UNACCEPTABLE'], weight: -7 },
      { patterns: ['POOR SERVICE', 'BAD EXPERIENCE'], weight: -8 },
      { patterns: ['PLEASE EXPLAIN', 'WHY IS THIS'], weight: -4 },
    ],
    description: 'Negative sentiment/complaints',
  },
  {
    sentiment: 'positive',
    subjectPatterns: [
      { patterns: ['THANK YOU', 'THANKS'], weight: 5 },
      { patterns: ['APPRECIATE', 'GRATEFUL'], weight: 6 },
      { patterns: ['WELL DONE', 'GREAT JOB'], weight: 7 },
    ],
    bodyPatterns: [
      { patterns: ['THANK YOU', 'THANKS FOR'], weight: 5 },
      { patterns: ['APPRECIATE YOUR', 'GRATEFUL FOR'], weight: 6 },
      { patterns: ['EXCELLENT', 'GREAT SERVICE'], weight: 7 },
      { patterns: ['SMOOTH', 'SEAMLESS'], weight: 5 },
    ],
    description: 'Positive sentiment/appreciation',
  },
];

export type EmailCategory =
  | 'approval'      // Approval-related
  | 'status'        // Status updates
  | 'customs'       // Customs-related
  | 'delivery'      // Delivery-related
  | 'commercial'    // Commercial/financial
  | 'change'        // Changes/amendments
  | 'communication' // General communication
  | 'unknown';

// =============================================================================
// EMAIL TYPE CONFIGS
// =============================================================================

export interface EmailTypeConfig {
  type: EmailType;
  category: EmailCategory;
  subjectPatterns: Array<{
    required: string[];
    optional?: string[];
    exclude?: string[];
    confidence: number;
  }>;
  bodyPatterns?: Array<{
    required: string[];
    optional?: string[];
    confidence: number;
  }>;
  senderCategories?: SenderCategory[];  // If specified, only match for these senders
  description: string;
}

export const EMAIL_TYPE_CONFIGS: EmailTypeConfig[] = [
  // =========================================================================
  // APPROVAL FLOW
  // =========================================================================
  {
    type: 'approval_request',
    category: 'approval',
    subjectPatterns: [
      { required: ['APPROVAL'], optional: ['CHECKLIST', 'SI', 'BL', 'DRAFT'], confidence: 90 },
      { required: ['FOR YOUR', 'APPROVAL'], confidence: 92 },
      { required: ['APPROVE'], optional: ['PLEASE', 'KINDLY'], confidence: 88 },
      { required: ['CHECKLIST', 'APPROVAL'], confidence: 95 },
      { required: ['SI', 'APPROVAL'], confidence: 93 },
      { required: ['BL', 'APPROVAL'], confidence: 93 },
      { required: ['FOR', 'REVIEW'], optional: ['DRAFT'], confidence: 85 },
    ],
    bodyPatterns: [
      { required: ['PLEASE', 'APPROVE'], confidence: 85 },
      { required: ['KINDLY', 'APPROVE'], confidence: 85 },
      { required: ['AWAITING', 'APPROVAL'], confidence: 88 },
    ],
    description: 'Request for approval on checklist, SI, BL draft, etc.',
  },
  {
    type: 'approval_granted',
    category: 'approval',
    subjectPatterns: [
      { required: ['APPROVED'], exclude: ['NOT APPROVED', 'REJECTED'], confidence: 92 },
      { required: ['APPROVAL', 'GRANTED'], confidence: 95 },
    ],
    bodyPatterns: [
      { required: ['APPROVED'], optional: ['CHECKLIST', 'SI', 'BL'], confidence: 85 },
      { required: ['GO AHEAD'], confidence: 80 },
    ],
    description: 'Approval granted for request',
  },
  {
    type: 'approval_rejected',
    category: 'approval',
    subjectPatterns: [
      { required: ['REJECTED'], confidence: 90 },
      { required: ['NOT', 'APPROVED'], confidence: 90 },
      { required: ['REVISION', 'REQUIRED'], confidence: 85 },
    ],
    bodyPatterns: [
      { required: ['REJECTED'], confidence: 85 },
      { required: ['PLEASE', 'REVISE'], confidence: 82 },
      { required: ['CORRECTION', 'REQUIRED'], confidence: 82 },
    ],
    description: 'Approval rejected, revision needed',
  },

  // =========================================================================
  // STATUS UPDATES
  // =========================================================================
  {
    type: 'stuffing_update',
    category: 'status',
    subjectPatterns: [
      { required: ['STUFFING'], optional: ['COMPLETE', 'DONE', 'UPDATE', 'STATUS'], confidence: 92 },
      { required: ['FACTORY', 'STUFFING'], confidence: 95 },
      { required: ['CONTAINER', 'STUFFED'], confidence: 90 },
    ],
    senderCategories: ['cha_india', 'shipper', 'intoglo'],
    description: 'Factory stuffing status update',
  },
  {
    type: 'gate_in_update',
    category: 'status',
    subjectPatterns: [
      { required: ['GATE', 'IN'], optional: ['CONFIRM', 'DONE'], confidence: 92 },
      { required: ['GATED', 'IN'], confidence: 92 },
      { required: ['CONTAINER', 'REACHED'], confidence: 88 },
      { required: ['ARRIVED', 'AT', 'ICD'], confidence: 88 },
      { required: ['ARRIVED', 'AT', 'CFS'], confidence: 88 },
      { required: ['ARRIVED', 'AT', 'PORT'], confidence: 88 },
    ],
    description: 'Container gated in at port/ICD',
  },
  {
    type: 'handover_update',
    category: 'status',
    subjectPatterns: [
      { required: ['HANDOVER'], optional: ['DONE', 'COMPLETE'], confidence: 92 },
      { required: ['RAILOUT'], optional: ['DONE', 'COMPLETE'], confidence: 92 },
      { required: ['HAND', 'OVER'], confidence: 88 },
    ],
    senderCategories: ['cha_india'],
    description: 'CHA handover/railout status',
  },
  {
    type: 'departure_update',
    category: 'status',
    subjectPatterns: [
      { required: ['DEPARTED'], confidence: 92 },
      { required: ['VESSEL', 'SAILED'], confidence: 95 },
      { required: ['SHIPPED', 'ON', 'BOARD'], confidence: 90 },
      { required: ['SOB', 'CONFIRMATION'], confidence: 95 },
      { required: ['SOB'], confidence: 88 },  // SOB alone indicates sailed on board
      { required: ['ETD', 'CONFIRMED'], confidence: 88 },
      { required: ['SAILING', 'CONFIRMATION'], confidence: 92 },
      { required: ['ON', 'BOARD'], optional: ['CONFIRMATION'], confidence: 85 },
      { required: ['SAILED'], confidence: 85 },
    ],
    description: 'Vessel departure/sailing confirmation',
  },
  {
    type: 'transit_update',
    category: 'status',
    subjectPatterns: [
      { required: ['IN', 'TRANSIT'], confidence: 92 },
      { required: ['TRANSIT', 'UPDATE'], confidence: 90 },
      { required: ['TRANSSHIPMENT'], optional: ['UPDATE', 'NOTICE'], confidence: 88 },
      { required: ['VESSEL', 'UPDATE'], confidence: 85 },
      { required: ['ETA', 'UPDATE'], confidence: 88 },
      { required: ['SCHEDULE', 'CHANGE'], confidence: 85 },
    ],
    description: 'In-transit status update',
  },
  {
    type: 'arrival_update',
    category: 'status',
    subjectPatterns: [
      { required: ['ARRIVED'], confidence: 92 },
      { required: ['VESSEL', 'ARRIVAL'], confidence: 95 },
      { required: ['POD', 'ARRIVAL'], confidence: 90 },
      { required: ['DISCHARGED'], confidence: 88 },
      { required: ['ARRIVAL', 'NOTICE'], confidence: 95 },
      { required: ['ATA'], optional: ['CONFIRMED', 'UPDATE'], confidence: 85 },
    ],
    description: 'Vessel arrival notification',
  },

  // =========================================================================
  // CUSTOMS
  // =========================================================================
  {
    type: 'pre_alert',
    category: 'customs',
    subjectPatterns: [
      { required: ['PRE-ALERT'], confidence: 95 },
      { required: ['PRE', 'ALERT'], confidence: 95 },
      { required: ['PREALERT'], confidence: 95 },
      { required: ['PRE-ARRIVAL'], confidence: 92 },
      { required: ['PRE', 'ARRIVAL'], confidence: 92 },
      { required: ['CUSTOMS', 'BONDED'], confidence: 88 },
    ],
    senderCategories: ['intoglo', 'cha_india', 'partner'],
    description: 'Pre-arrival alert to customs broker',
  },
  {
    type: 'clearance_initiation',
    category: 'customs',
    subjectPatterns: [
      { required: ['CLEARANCE', 'INITIATION'], confidence: 95 },
      { required: ['CUSTOMS', 'CLEARANCE'], optional: ['REQUEST', 'INITIATE'], confidence: 88 },
      { required: ['CUSTOM', 'CLEARANCE', 'REQUEST'], confidence: 90 },
    ],
    description: 'Customs clearance initiated',
  },
  {
    type: 'clearance_complete',
    category: 'customs',
    subjectPatterns: [
      { required: ['CLEARED'], optional: ['CUSTOMS', 'CARGO'], confidence: 88 },
      { required: ['OUT', 'OF', 'CHARGE'], confidence: 95 },
      { required: ['OOC'], confidence: 90 },
      { required: ['CUSTOMS', 'RELEASED'], confidence: 92 },
      { required: ['CARGO', 'RELEASED'], confidence: 90 },
    ],
    description: 'Customs clearance completed',
  },

  // =========================================================================
  // DELIVERY
  // =========================================================================
  {
    type: 'delivery_scheduling',
    category: 'delivery',
    subjectPatterns: [
      { required: ['DELIVERY', 'APPOINTMENT'], confidence: 95 },
      { required: ['DELIVERY', 'SCHEDULE'], confidence: 92 },
      { required: ['DELIVERY', 'PLANNING'], confidence: 90 },
      { required: ['APPOINTMENT'], optional: ['CONFIRM', 'SCHEDULED'], confidence: 85 },
    ],
    description: 'Delivery appointment scheduling',
  },
  {
    type: 'pickup_scheduling',
    category: 'delivery',
    subjectPatterns: [
      { required: ['PICKUP'], optional: ['SCHEDULE', 'ARRANGE', 'READY'], confidence: 88 },
      { required: ['DRAYAGE'], confidence: 85 },
      { required: ['CONTAINER', 'OUT'], confidence: 88 },
    ],
    description: 'Pickup/drayage scheduling',
  },
  {
    type: 'delivery_complete',
    category: 'delivery',
    subjectPatterns: [
      { required: ['DELIVERED'], confidence: 90 },
      { required: ['DELIVERY', 'COMPLETE'], confidence: 92 },
      { required: ['POD', 'ATTACHED'], confidence: 90 },
      { required: ['SUCCESSFULLY', 'DELIVERED'], confidence: 95 },
    ],
    description: 'Delivery completed',
  },

  // =========================================================================
  // COMMERCIAL
  // =========================================================================
  {
    type: 'quote_request',
    category: 'commercial',
    subjectPatterns: [
      { required: ['QUOTE'], optional: ['REQUEST', 'FREIGHT', 'FCL'], exclude: ['QUOTE ATTACHED'], confidence: 90 },
      { required: ['QUOTATION'], optional: ['REQUEST'], exclude: ['QUOTATION ATTACHED'], confidence: 90 },
      { required: ['FREIGHT', 'QUOTE'], confidence: 92 },
      { required: ['RATE', 'QUOTE'], confidence: 92 },
      { required: ['REQUEST', 'FOR', 'QUOTE'], confidence: 95 },
      { required: ['RFQ'], confidence: 92 },
    ],
    description: 'Rate/freight quote request',
  },
  {
    type: 'quote_response',
    category: 'commercial',
    subjectPatterns: [
      { required: ['QUOTE', 'ATTACHED'], confidence: 92 },
      { required: ['QUOTATION', 'ATTACHED'], confidence: 92 },
      { required: ['RATE', 'OFFER'], confidence: 90 },
      { required: ['FREIGHT', 'RATES'], confidence: 88 },
      { required: ['PRICING'], optional: ['ATTACHED', 'ENCLOSED'], confidence: 85 },
      { required: ['OUR', 'QUOTE'], confidence: 88 },
      { required: ['RATES', 'FOR'], confidence: 85 },
    ],
    description: 'Rate/freight quote response',
  },
  {
    type: 'payment_request',
    category: 'commercial',
    subjectPatterns: [
      { required: ['PAYMENT', 'DUE'], confidence: 90 },
      { required: ['PAYMENT', 'REQUEST'], confidence: 90 },
      { required: ['STATEMENT'], optional: ['ACCOUNT', 'OUTSTANDING'], confidence: 85 },
      { required: ['INVOICE'], optional: ['ATTACHED', 'DUE'], exclude: ['PACKING'], confidence: 82 },
    ],
    description: 'Payment/invoice request',
  },
  {
    type: 'payment_confirmation',
    category: 'commercial',
    subjectPatterns: [
      { required: ['PAYMENT', 'RECEIVED'], confidence: 92 },
      { required: ['PAYMENT', 'CONFIRM'], confidence: 92 },
      { required: ['PAYMENT', 'SUCCESSFUL'], confidence: 95 },
    ],
    description: 'Payment confirmed',
  },

  // =========================================================================
  // CHANGES
  // =========================================================================
  {
    type: 'amendment_request',
    category: 'change',
    subjectPatterns: [
      { required: ['AMENDMENT'], optional: ['REQUEST', 'REQUIRED'], exclude: ['BOOKING AMENDMENT'], confidence: 88 },
      { required: ['AMEND'], optional: ['PLEASE', 'NEED'], confidence: 85 },
      { required: ['REVISION', 'REQUIRED'], confidence: 88 },
      { required: ['NEED', 'REVISED'], confidence: 85 },
      { required: ['UNABLE', 'TO'], optional: ['AMEND', 'SUBMIT', 'PROCESS'], confidence: 82 },
    ],
    description: 'Amendment/revision request',
  },
  {
    type: 'cancellation_notice',
    category: 'change',
    subjectPatterns: [
      { required: ['CANCEL'], optional: ['BOOKING', 'SHIPMENT'], exclude: ['BOOKING CANCELLATION'], confidence: 85 },
      { required: ['CANCELLED'], confidence: 88 },
    ],
    description: 'Cancellation notice',
  },

  // =========================================================================
  // COMMUNICATION
  // =========================================================================
  {
    type: 'query',
    category: 'communication',
    subjectPatterns: [
      { required: ['QUERY'], confidence: 85 },
      { required: ['CLARIFICATION'], confidence: 85 },
      { required: ['CLARIFY'], confidence: 82 },
    ],
    bodyPatterns: [
      { required: ['PLEASE', 'CLARIFY'], confidence: 80 },
      { required: ['KINDLY', 'ADVISE'], confidence: 80 },
    ],
    description: 'Question/inquiry',
  },
  {
    type: 'reminder',
    category: 'communication',
    subjectPatterns: [
      { required: ['REMINDER'], confidence: 90 },
      { required: ['FOLLOW', 'UP'], confidence: 82 },
      { required: ['GENTLE', 'REMINDER'], confidence: 95 },
    ],
    description: 'Reminder/follow-up',
  },
  {
    type: 'urgent_action',
    category: 'communication',
    subjectPatterns: [
      { required: ['URGENT'], confidence: 90 },
      { required: ['ASAP'], confidence: 88 },
      { required: ['IMMEDIATE'], optional: ['ACTION', 'ATTENTION'], confidence: 88 },
      { required: ['RUSH'], confidence: 85 },
    ],
    description: 'Urgent action required',
  },
  {
    type: 'delay_notice',
    category: 'communication',
    subjectPatterns: [
      { required: ['DELAY'], optional: ['NOTICE', 'UPDATE'], confidence: 88 },
      { required: ['HOLD'], exclude: ['HOUSEHOLD'], confidence: 82 },
      { required: ['ROLLOVER'], confidence: 85 },
    ],
    description: 'Delay notification',
  },
  {
    type: 'demurrage_action',
    category: 'communication',
    subjectPatterns: [
      { required: ['DEMURRAGE'], confidence: 92 },
      { required: ['DETENTION'], confidence: 92 },
      { required: ['AVOIDING', 'DEMURRAGE'], confidence: 95 },
      { required: ['LFD'], confidence: 85 },  // Last Free Day
    ],
    description: 'Demurrage/detention notice',
  },
  {
    type: 'document_share',
    category: 'communication',
    subjectPatterns: [
      { required: ['PFA'], confidence: 85 },
      { required: ['PLEASE', 'FIND', 'ATTACHED'], confidence: 88 },
      { required: ['ATTACHED', 'HEREWITH'], confidence: 85 },
      { required: ['SHARING'], optional: ['DOCUMENTS', 'FILES'], confidence: 82 },
      // Carrier confirmation emails are document shares
      { required: ['BOOKING', 'CONFIRMATION'], confidence: 88 },
      { required: ['FINAL', 'BL'], confidence: 90 },
      { required: ['EXPRESS', 'BL'], confidence: 88 },
      { required: ['DRAFT', 'BL'], confidence: 85 },
      { required: ['INSURANCE'], optional: ['POLICY', 'CERTIFICATE'], confidence: 82 },
    ],
    description: 'Document sharing',
  },
  {
    type: 'acknowledgement',
    category: 'communication',
    subjectPatterns: [
      { required: ['ACKNOWLEDGED'], confidence: 92 },
      { required: ['NOTED'], optional: ['THANKS', 'WITH'], confidence: 85 },
      { required: ['RECEIVED', 'THANKS'], confidence: 88 },
      { required: ['WILL', 'DO'], confidence: 80 },
      { required: ['WORKING', 'ON', 'IT'], confidence: 82 },
      { required: ['ON', 'IT'], confidence: 78 },
    ],
    bodyPatterns: [
      { required: ['NOTED', 'THANKS'], confidence: 85 },
      { required: ['RECEIVED', 'WILL', 'PROCESS'], confidence: 88 },
      { required: ['ACKNOWLEDGED'], confidence: 90 },
    ],
    description: 'Acknowledgement of receipt/action',
  },
  {
    type: 'escalation',
    category: 'communication',
    subjectPatterns: [
      { required: ['ESCALATION'], confidence: 95 },
      { required: ['ESCALATE'], confidence: 92 },
      { required: ['COMPLAINT'], confidence: 90 },
      { required: ['UNRESOLVED'], confidence: 88 },
      { required: ['PENDING', 'SINCE'], confidence: 85 },
      { required: ['NO', 'RESPONSE'], confidence: 82 },
      { required: ['FOLLOWING', 'UP', 'AGAIN'], confidence: 80 },
    ],
    bodyPatterns: [
      { required: ['ESCALATING', 'THIS'], confidence: 92 },
      { required: ['MULTIPLE', 'TIMES'], confidence: 85 },
      { required: ['STILL', 'WAITING'], confidence: 82 },
      { required: ['NO', 'UPDATE'], confidence: 80 },
    ],
    description: 'Escalated issues/complaints',
  },
];

// =============================================================================
// HELPER FUNCTIONS
// =============================================================================

/**
 * Get sender category from email address
 */
export function getSenderCategory(senderEmail: string): SenderCategory {
  const email = senderEmail.toLowerCase();

  for (const { category, patterns } of SENDER_CATEGORY_PATTERNS) {
    if (patterns.some(pattern => pattern.test(email))) {
      return category;
    }
  }

  return 'unknown';
}

/**
 * Check if email matches sender category
 */
export function matchesSenderCategory(
  senderEmail: string,
  categories: SenderCategory[]
): boolean {
  const category = getSenderCategory(senderEmail);
  return categories.includes(category);
}

/**
 * Detect email sentiment from subject and body content.
 * Returns sentiment type and score (-10 to +10).
 */
export function detectSentiment(
  subject: string,
  bodyText?: string
): { sentiment: EmailSentiment; score: number; matchedPatterns: string[] } {
  const subjectUpper = subject.toUpperCase();
  const bodyUpper = (bodyText || '').toUpperCase();
  const matchedPatterns: string[] = [];
  let totalScore = 0;

  for (const config of SENTIMENT_CONFIGS) {
    // Check subject patterns
    for (const patternGroup of config.subjectPatterns) {
      for (const pattern of patternGroup.patterns) {
        if (subjectUpper.includes(pattern.toUpperCase())) {
          totalScore += patternGroup.weight;
          matchedPatterns.push(`subject:${pattern}`);
        }
      }
    }

    // Check body patterns
    if (config.bodyPatterns) {
      for (const patternGroup of config.bodyPatterns) {
        for (const pattern of patternGroup.patterns) {
          if (bodyUpper.includes(pattern.toUpperCase())) {
            totalScore += patternGroup.weight;
            matchedPatterns.push(`body:${pattern}`);
          }
        }
      }
    }
  }

  // Determine sentiment from score
  let sentiment: EmailSentiment;
  if (totalScore >= 8) {
    sentiment = 'urgent';
  } else if (totalScore >= 5 && matchedPatterns.some(p => p.includes('ESCALAT'))) {
    sentiment = 'escalated';
  } else if (totalScore < -3) {
    sentiment = 'negative';
  } else if (totalScore > 3) {
    sentiment = 'positive';
  } else {
    sentiment = 'neutral';
  }

  return { sentiment, score: totalScore, matchedPatterns };
}
