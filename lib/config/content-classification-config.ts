/**
 * Content-First Classification Configuration
 *
 * This file defines:
 * 1. Document types with content markers (for deterministic classification)
 * 2. Sender types with domain patterns
 * 3. Priority and confidence rules
 *
 * Philosophy: Classify documents by WHAT THEY ARE, not by email subject/body
 */

// =============================================================================
// SENDER TYPES - Who is sending the document?
// =============================================================================

export type SenderType =
  | 'shipping_line'      // Maersk, Hapag, CMA CGM, MSC, COSCO, etc.
  | 'customs_broker_us'  // US customs brokers (Portside, Seven Seas, Artemus)
  | 'customs_broker_in'  // India CHAs (ANS, Aarish, Tulsi)
  | 'freight_forwarder'  // NVOCCs, forwarders
  | 'trucker'            // US trucking/drayage (Transjet, Carmel, Triways)
  | 'shipper'            // Export customers / manufacturers
  | 'consignee'          // Import customers
  | 'intoglo'            // Intoglo team
  | 'unknown';

export interface SenderPattern {
  type: SenderType;
  domains: string[];
  namePatterns?: RegExp[];
  description: string;
}

export const SENDER_PATTERNS: SenderPattern[] = [
  // SHIPPING LINES
  {
    type: 'shipping_line',
    domains: [
      // Maersk
      'maersk.com', 'sealandmaersk.com',
      // Hapag-Lloyd
      'hlag.com', 'service.hlag.com', 'csd.hlag.com', 'ext.hlag.com', 'hlag.cloud',
      // CMA CGM
      'cma-cgm.com', 'usa.cma-cgm.com',
      // MSC
      'msc.com', 'medlog.com',
      // COSCO
      'cosco.com', 'coscon.com',
      // Evergreen
      'evergreen-marine.com', 'evergreen-shipping.us',
      // ONE (Ocean Network Express)
      'one-line.com',
      // Yang Ming
      'yangming.com',
      // HMM (Hyundai)
      'hmm21.com',
      // ZIM
      'zim.com',
      // PIL
      'pilship.com',
      // OOCL
      'oocl.com',
    ],
    description: 'Ocean carriers / shipping lines'
  },

  // US CUSTOMS BROKERS
  {
    type: 'customs_broker_us',
    domains: [
      'portsidecustoms.com',      // Portside Customs Service
      'sssusainc.com',            // Seven Seas Shipping USA
      'artemusnetwork.com',       // Artemus
      'jmdcustoms.com',           // JMD Customs
    ],
    description: 'US licensed customs brokers'
  },

  // INDIA CHA (Customs House Agents)
  {
    type: 'customs_broker_in',
    domains: [
      'anscargo.in',
      'aarishkalogistics.com',
      'tulsilogistics.com',
      'vccfa.in',
      'aboreglobal.com',
    ],
    namePatterns: [
      /customs?\s*house\s*agent/i,
      /\bCHA\b/,
    ],
    description: 'India customs house agents'
  },

  // FREIGHT FORWARDERS / NVOCCs
  {
    type: 'freight_forwarder',
    domains: [
      'odexservices.com',
      'flexport.com',
      'freightos.com',
    ],
    description: 'Freight forwarders and NVOCCs'
  },

  // TRUCKING COMPANIES (US Drayage)
  {
    type: 'trucker',
    domains: [
      'transjetcargo.com',       // Transjet - US trucker
      'carmeltransport.com',     // Carmel Transport
      'triwaystransport.com',    // Triways Transport
    ],
    namePatterns: [
      /trucking/i,
      /drayage/i,
    ],
    description: 'US trucking and drayage companies'
  },

  // SHIPPERS (Export Customers)
  {
    type: 'shipper',
    domains: [
      'tradepartners.us',        // Trade Partners - shipper
      'matangiindustries.com',
      'pearlglobal.com',
    ],
    namePatterns: [
      /industries/i,
      /manufacturing/i,
      /exports/i,
      /private limited/i,
      /pvt ltd/i,
    ],
    description: 'Shippers / exporters / manufacturers'
  },

  // CONSIGNEES (Import Customers)
  {
    type: 'consignee',
    domains: [
      // Large US logistics companies are often consignees, not truckers
      'xpologistics.com',
      'jbhunt.com',
      'schneider.com',
      'werner.com',
    ],
    description: 'Consignees / importers'
  },

  // INTOGLO TEAM
  {
    type: 'intoglo',
    domains: [
      'intoglo.com',
    ],
    description: 'Intoglo internal team'
  },

];


// =============================================================================
// DOCUMENT TYPES - What is the document?
// =============================================================================

export type DocumentCategory =
  | 'booking'              // Booking confirmation, amendment, cancellation
  | 'vgm'                  // VGM submission, reminder, confirmation
  | 'schedule'             // Vessel schedule, cutoff advisory, delay notice
  | 'export_docs'          // Commercial invoice, packing list (from shipper)
  | 'india_customs'        // Shipping bill, LEO, CHA checklist, annexure
  | 'documentation'        // SI, draft BL, final BL, sea waybill
  | 'sob'                  // Shipped on Board confirmation
  | 'us_customs'           // ISF, draft entry, 3461, 7501, customs bond
  | 'arrival_delivery'     // Arrival notice, delivery order, container release
  | 'trucking'             // Gate in, POD, empty return, rate confirmation, work order
  | 'financial'            // Freight/duty/service invoice, payment receipt
  | 'other';               // Certificate, general correspondence, not shipping

export interface ContentMarker {
  /** Text patterns to look for in document content (case-insensitive) */
  required: string[];
  /** Optional patterns that increase confidence */
  optional?: string[];
  /** Patterns that EXCLUDE this document type */
  exclude?: string[];
  /** Confidence score when matched (0-100) */
  confidence: number;
}

export interface DocumentTypeConfig {
  type: string;
  displayName: string;
  category: DocumentCategory;
  /** Content markers for deterministic classification */
  contentMarkers: ContentMarker[];
  /** Filename patterns (secondary signal) */
  filenamePatterns?: RegExp[];
  /** Which sender types typically send this document */
  expectedSenders?: SenderType[];
  /** Description for AI fallback */
  description: string;
}

export const DOCUMENT_TYPE_CONFIGS: DocumentTypeConfig[] = [
  // ===========================================================================
  // US CUSTOMS DOCUMENTS
  // ===========================================================================
  {
    type: 'entry_summary',
    displayName: 'Entry Summary (CBP 7501)',
    category: 'us_customs',
    contentMarkers: [
      {
        required: ['DEPARTMENT OF HOMELAND SECURITY', 'ENTRY SUMMARY'],
        optional: ['CBP Form 7501', 'OMB APPROVAL', 'Filer Code/Entry'],
        confidence: 98
      },
      {
        required: ['ENTRY SUMMARY', 'CBP'],
        optional: ['Duty', 'HTS', 'Importer'],
        confidence: 95
      }
    ],
    filenamePatterns: [/7501/i, /entry.?summary/i],
    expectedSenders: ['customs_broker_us'],
    description: 'US Customs Entry Summary form (CBP 7501) showing duties, tariffs, and import details'
  },

  {
    type: 'entry_immediate_delivery',
    displayName: 'Entry/Immediate Delivery (CBP 3461)',
    category: 'us_customs',
    contentMarkers: [
      {
        required: ['ENTRY/IMMEDIATE DELIVERY'],
        optional: ['CBP Form 3461', 'DEPARTMENT OF HOMELAND SECURITY'],
        confidence: 98
      },
      {
        required: ['IMMEDIATE DELIVERY', 'CBP'],
        confidence: 92
      }
    ],
    filenamePatterns: [/3461/i, /immediate.?delivery/i],
    expectedSenders: ['customs_broker_us'],
    description: 'US Customs Entry/Immediate Delivery form (CBP 3461) for cargo release'
  },

  {
    type: 'isf_filing',
    displayName: 'ISF Filing (10+2)',
    category: 'us_customs',
    contentMarkers: [
      {
        required: ['IMPORTER SECURITY FILING'],
        optional: ['ISF', '10+2', 'CBP'],
        confidence: 95
      },
      {
        required: ['ISF', 'SECURITY FILING'],
        confidence: 90
      }
    ],
    filenamePatterns: [/ISF/i, /10\+2/i],
    expectedSenders: ['customs_broker_us', 'freight_forwarder'],
    description: 'US Importer Security Filing (ISF/10+2) submission'
  },

  {
    type: 'draft_entry',
    displayName: 'Draft Entry',
    category: 'us_customs',
    contentMarkers: [
      {
        required: ['DRAFT', 'ENTRY'],
        optional: ['REVIEW', 'APPROVAL', 'CBP'],
        confidence: 88
      },
      {
        required: ['ENTRY', 'DRAFT'],
        optional: ['PRELIMINARY', '7501'],
        confidence: 85
      }
    ],
    filenamePatterns: [/draft.?entry/i],
    expectedSenders: ['customs_broker_us'],
    description: 'Draft US customs entry for review before filing'
  },

  {
    type: 'duty_invoice',
    displayName: 'Duty Invoice',
    category: 'financial',
    contentMarkers: [
      {
        required: ['INVOICE'],
        optional: ['DUTIES', 'CUSTOMS', 'ENTRY FEE', 'MPF', 'HMF'],
        confidence: 88
      }
    ],
    filenamePatterns: [/duty.?invoice/i, /customs.?invoice/i],
    expectedSenders: ['customs_broker_us'],
    description: 'Invoice for customs duties and broker fees'
  },

  // ===========================================================================
  // INDIA CUSTOMS DOCUMENTS
  // ===========================================================================
  {
    type: 'shipping_bill',
    displayName: 'Shipping Bill',
    category: 'india_customs',
    contentMarkers: [
      {
        required: ['SHIPPING BILL'],
        optional: ['SB NO', 'CUSTOMS', 'ICEGATE'],
        confidence: 95
      }
    ],
    filenamePatterns: [/shipping.?bill/i, /SB.?\d+/i],
    expectedSenders: ['customs_broker_in'],
    description: 'India export customs shipping bill'
  },

  {
    type: 'leo_copy',
    displayName: 'LEO Copy (Let Export Order)',
    category: 'india_customs',
    contentMarkers: [
      {
        required: ['LET EXPORT ORDER'],
        optional: ['LEO', 'CUSTOMS'],
        confidence: 95
      },
      {
        required: ['LEO'],
        optional: ['EXPORT', 'CUSTOMS'],
        confidence: 85
      }
    ],
    filenamePatterns: [/LEO/i, /let.?export/i],
    expectedSenders: ['customs_broker_in'],
    description: 'India customs Let Export Order (LEO) - export release'
  },

  {
    type: 'checklist',
    displayName: 'CHA Checklist',
    category: 'india_customs',
    contentMarkers: [
      {
        required: ['CHECKLIST'],
        optional: ['SHIPPING BILL', 'EXPORT', 'DOCUMENTS'],
        confidence: 85
      }
    ],
    filenamePatterns: [/checklist/i],
    expectedSenders: ['customs_broker_in'],
    description: 'Customs house agent document checklist'
  },

  // ===========================================================================
  // BOOKING DOCUMENTS
  // ===========================================================================
  {
    type: 'booking_confirmation',
    displayName: 'Booking Confirmation',
    category: 'booking',
    contentMarkers: [
      {
        required: ['BOOKING CONFIRMATION'],
        optional: ['BOOKING NUMBER', 'VESSEL', 'VOYAGE', 'ETD'],
        confidence: 95
      },
      {
        required: ['BOOKING', 'CONFIRMED'],
        optional: ['CONTAINER', 'VESSEL'],
        exclude: ['AMENDMENT', 'CANCEL'],
        confidence: 85
      }
    ],
    filenamePatterns: [/booking.?confirm/i, /BC_/i],
    expectedSenders: ['shipping_line', 'freight_forwarder'],
    description: 'Carrier booking confirmation with vessel and schedule details'
  },

  {
    type: 'booking_amendment',
    displayName: 'Booking Amendment',
    category: 'booking',
    contentMarkers: [
      {
        required: ['BOOKING', 'AMENDMENT'],
        optional: ['UPDATE', 'REVISED', 'CHANGE'],
        confidence: 92
      },
      {
        required: ['BOOKING', 'UPDATE'],
        optional: ['VESSEL', 'ETD', 'CHANGE'],
        confidence: 85
      }
    ],
    filenamePatterns: [/amendment/i, /update/i],
    expectedSenders: ['shipping_line', 'freight_forwarder'],
    description: 'Booking change notification with updated details'
  },

  {
    type: 'booking_cancellation',
    displayName: 'Booking Cancellation',
    category: 'booking',
    contentMarkers: [
      {
        required: ['BOOKING', 'CANCEL'],
        confidence: 95
      }
    ],
    filenamePatterns: [/cancel/i],
    expectedSenders: ['shipping_line'],
    description: 'Booking cancellation notice'
  },

  // ===========================================================================
  // SHIPPING INSTRUCTIONS
  // ===========================================================================
  {
    type: 'shipping_instruction',
    displayName: 'Shipping Instruction',
    category: 'documentation',
    contentMarkers: [
      {
        required: ['SHIPPING INSTRUCTION'],
        optional: ['SI SUB TYPE', 'TRANSPORT DOCUMENT', 'SHIPPER', 'CONSIGNEE'],
        confidence: 95
      }
    ],
    filenamePatterns: [/SI_/i, /shipping.?instruction/i],
    expectedSenders: ['shipping_line', 'intoglo'],
    description: 'Shipping instruction submission'
  },

  {
    type: 'si_draft',
    displayName: 'SI Draft',
    category: 'documentation',
    contentMarkers: [
      {
        required: ['DRAFT', 'SHIPPING INSTRUCTION'],
        confidence: 90
      },
      {
        required: ['SI', 'DRAFT'],
        optional: ['REVIEW', 'APPROVAL'],
        confidence: 85
      }
    ],
    filenamePatterns: [/SI.*draft/i, /draft.*SI/i],
    expectedSenders: ['shipping_line', 'freight_forwarder'],
    description: 'Draft shipping instruction for review'
  },

  {
    type: 'si_confirmation',
    displayName: 'SI Confirmation',
    category: 'documentation',
    contentMarkers: [
      {
        required: ['SI', 'CONFIRMED'],
        confidence: 90
      },
      {
        required: ['SHIPPING INSTRUCTION', 'ACCEPTED'],
        confidence: 88
      }
    ],
    expectedSenders: ['shipping_line'],
    description: 'Shipping instruction confirmation from carrier'
  },

  // ===========================================================================
  // BILL OF LADING DOCUMENTS
  // HBL = House BL, MBL = Master BL; each has final and draft versions
  // ===========================================================================
  {
    type: 'hbl',
    displayName: 'House Bill of Lading (Final)',
    category: 'documentation',
    contentMarkers: [
      {
        required: ['HOUSE BILL OF LADING'],
        optional: ['HBL', 'SHIPPER', 'CONSIGNEE', 'SHIPPED ON BOARD'],
        exclude: ['DRAFT'],
        confidence: 92
      },
      {
        required: ['HBL'],
        optional: ['SHIPPED ON BOARD', 'ORIGINAL'],
        exclude: ['DRAFT'],
        confidence: 88
      }
    ],
    filenamePatterns: [/\bHBL\b/i, /house.?bill/i],
    expectedSenders: ['freight_forwarder'],
    description: 'Final House Bill of Lading (issued by forwarder/NVOCC)'
  },

  {
    type: 'draft_hbl',
    displayName: 'Draft House BL',
    category: 'documentation',
    contentMarkers: [
      {
        required: ['DRAFT', 'HOUSE'],
        optional: ['BILL OF LADING', 'B/L', 'HBL'],
        confidence: 90
      },
      {
        required: ['HBL', 'DRAFT'],
        confidence: 90
      },
      {
        required: ['HOUSE BILL OF LADING', 'DRAFT'],
        confidence: 92
      }
    ],
    filenamePatterns: [/HBL.*draft/i, /draft.*HBL/i],
    expectedSenders: ['freight_forwarder'],
    description: 'Draft House Bill of Lading for approval'
  },

  {
    type: 'mbl',
    displayName: 'Master Bill of Lading (Final)',
    category: 'documentation',
    contentMarkers: [
      {
        required: ['MASTER BILL OF LADING'],
        optional: ['MBL', 'SHIPPER', 'CONSIGNEE', 'SHIPPED ON BOARD'],
        exclude: ['DRAFT'],
        confidence: 92
      },
      {
        required: ['MBL'],
        optional: ['SHIPPED ON BOARD', 'ORIGINAL'],
        exclude: ['DRAFT'],
        confidence: 88
      },
      {
        required: ['BILL OF LADING'],
        optional: ['B/L NO', 'SHIPPER', 'CONSIGNEE', 'SHIPPED ON BOARD'],
        exclude: ['DRAFT', 'HOUSE'],
        confidence: 85
      }
    ],
    filenamePatterns: [/\bMBL\b/i, /master.?bill/i, /\bBL\b/i],
    expectedSenders: ['shipping_line'],
    description: 'Final Master Bill of Lading (issued by shipping line)'
  },

  {
    type: 'draft_mbl',
    displayName: 'Draft Master BL',
    category: 'documentation',
    contentMarkers: [
      {
        required: ['DRAFT', 'MASTER'],
        optional: ['BILL OF LADING', 'B/L', 'MBL'],
        confidence: 90
      },
      {
        required: ['MBL', 'DRAFT'],
        confidence: 90
      },
      {
        required: ['MASTER BILL OF LADING', 'DRAFT'],
        confidence: 92
      },
      {
        required: ['DRAFT', 'BILL OF LADING'],
        exclude: ['HOUSE', 'HBL'],
        confidence: 85
      }
    ],
    filenamePatterns: [/MBL.*draft/i, /draft.*MBL/i, /draft.*BL/i],
    expectedSenders: ['shipping_line', 'freight_forwarder'],
    description: 'Draft Master Bill of Lading for approval'
  },

  {
    type: 'sob_confirmation',
    displayName: 'Shipped on Board Confirmation',
    category: 'sob',  // SOB is separate from BL
    contentMarkers: [
      {
        required: ['SHIPPED ON BOARD'],
        optional: ['CONFIRMATION', 'SOB', 'ON BOARD DATE'],
        exclude: ['DRAFT'],
        confidence: 92
      },
      {
        required: ['SOB', 'CONFIRMATION'],
        confidence: 90
      }
    ],
    filenamePatterns: [/SOB/i],
    expectedSenders: ['shipping_line', 'freight_forwarder'],
    description: 'Confirmation that cargo is shipped on board vessel'
  },

  // ===========================================================================
  // ARRIVAL & DELIVERY DOCUMENTS
  // ===========================================================================
  {
    type: 'arrival_notice',
    displayName: 'Arrival Notice',
    category: 'arrival_delivery',
    contentMarkers: [
      {
        required: ['ARRIVAL NOTICE'],
        optional: ['ETA', 'PORT OF DISCHARGE', 'CONSIGNEE'],
        exclude: ['EXCEPTION', 'PRE-ARRIVAL'],
        confidence: 95
      }
    ],
    filenamePatterns: [/arrival.?notice/i, /AN_/i, /AN\s?\d+/i],
    expectedSenders: ['shipping_line', 'freight_forwarder'],
    description: 'Cargo arrival notice at destination port'
  },

  {
    type: 'delivery_order',
    displayName: 'Delivery Order',
    category: 'arrival_delivery',
    contentMarkers: [
      {
        required: ['DELIVERY ORDER'],
        optional: ['DO NO', 'RELEASE', 'CONTAINER'],
        confidence: 92
      },
      {
        required: ['D/O'],
        optional: ['RELEASE', 'CONTAINER'],
        confidence: 85
      }
    ],
    filenamePatterns: [/\bDO\b.*\d+/i, /delivery.?order/i],
    expectedSenders: ['shipping_line', 'freight_forwarder'],
    description: 'Delivery order for cargo release'
  },

  {
    type: 'container_release',
    displayName: 'Container Release',
    category: 'arrival_delivery',
    contentMarkers: [
      {
        required: ['CONTAINER', 'RELEASE'],
        optional: ['AVAILABLE', 'PICKUP'],
        confidence: 88
      }
    ],
    filenamePatterns: [/release/i],
    expectedSenders: ['shipping_line', 'freight_forwarder'],
    description: 'Container release authorization'
  },

  // ===========================================================================
  // TRUCKING DOCUMENTS (Only POD, Rate Confirmation, Empty Return)
  // ===========================================================================
  {
    type: 'proof_of_delivery',
    displayName: 'Proof of Delivery',
    category: 'trucking',
    contentMarkers: [
      {
        required: ['PROOF OF DELIVERY'],
        confidence: 95
      },
      {
        required: ['POD'],
        optional: ['DELIVERED', 'SIGNATURE', 'RECEIVED'],
        confidence: 85
      }
    ],
    filenamePatterns: [/POD/i, /proof.?of.?delivery/i],
    expectedSenders: ['trucker'],
    description: 'Proof of delivery with signature/confirmation'
  },

  {
    type: 'rate_confirmation',
    displayName: 'Rate Confirmation',
    category: 'trucking',
    contentMarkers: [
      {
        required: ['RATE CONFIRMATION'],
        optional: ['CARRIER', 'RATE', 'PICKUP', 'DELIVERY'],
        confidence: 92
      },
      {
        required: ['RATE', 'CONFIRMED'],
        optional: ['TRUCKING', 'DRAYAGE'],
        confidence: 85
      }
    ],
    filenamePatterns: [/rate.?confirm/i],
    expectedSenders: ['trucker'],
    description: 'Trucking rate confirmation'
  },

  {
    type: 'empty_return',
    displayName: 'Empty Return',
    category: 'trucking',
    contentMarkers: [
      {
        required: ['EMPTY', 'RETURN'],
        optional: ['CONTAINER', 'DEPOT'],
        confidence: 90
      }
    ],
    filenamePatterns: [/empty.?return/i, /MTY/i],
    expectedSenders: ['trucker', 'shipping_line'],
    description: 'Empty container return confirmation'
  },

  // ===========================================================================
  // FINANCIAL DOCUMENTS
  // ===========================================================================
  {
    type: 'invoice',
    displayName: 'Invoice',
    category: 'financial',
    contentMarkers: [
      {
        required: ['INVOICE'],
        optional: ['INVOICE NO', 'INVOICE DATE', 'AMOUNT', 'DUE DATE', 'TOTAL'],
        exclude: ['DUTY', 'CUSTOMS', 'COMMERCIAL'],
        confidence: 85
      }
    ],
    filenamePatterns: [/invoice/i, /INV_/i],
    expectedSenders: ['freight_forwarder', 'trucker', 'customs_broker_us', 'customs_broker_in'],
    description: 'General invoice for services'
  },

  {
    type: 'freight_invoice',
    displayName: 'Freight Invoice',
    category: 'financial',
    contentMarkers: [
      {
        required: ['INVOICE'],
        optional: ['FREIGHT', 'OCEAN', 'SHIPPING', 'CONTAINER'],
        confidence: 85
      }
    ],
    filenamePatterns: [/freight.?invoice/i],
    expectedSenders: ['shipping_line', 'freight_forwarder'],
    description: 'Ocean freight invoice'
  },

  {
    type: 'commercial_invoice',
    displayName: 'Commercial Invoice',
    category: 'export_docs',  // Export docs from shipper - used for customs clearance
    contentMarkers: [
      {
        required: ['COMMERCIAL INVOICE'],
        optional: ['EXPORTER', 'IMPORTER', 'HS CODE', 'FOB', 'CIF'],
        confidence: 92
      }
    ],
    filenamePatterns: [/commercial.?invoice/i, /CI_/i],
    expectedSenders: ['shipper'],
    description: 'Commercial invoice for goods - used for customs clearance'
  },

  {
    type: 'payment_receipt',
    displayName: 'Payment Receipt',
    category: 'financial',
    contentMarkers: [
      {
        required: ['RECEIPT'],
        optional: ['PAYMENT', 'WIRE', 'ACH', 'PAID', 'TRANSACTION'],
        confidence: 90
      },
      {
        required: ['WIRE', 'PAYMENT'],
        optional: ['RECEIPT', 'TRANSACTION', 'AMOUNT'],
        confidence: 88
      },
      {
        required: ['ACH PAYMENT'],
        optional: ['RECEIPT', 'SENT'],
        confidence: 92
      }
    ],
    filenamePatterns: [/receipt/i, /payment/i, /wire/i],
    expectedSenders: ['intoglo'],
    description: 'Payment receipt / wire transfer confirmation'
  },

  // ===========================================================================
  // SCHEDULE, VGM, AND TRUCKING DOCUMENTS
  // ===========================================================================
  {
    type: 'vessel_schedule',
    displayName: 'Vessel Schedule',
    category: 'schedule',
    contentMarkers: [
      {
        required: ['VESSEL', 'SCHEDULE'],
        optional: ['ETD', 'ETA', 'PORT', 'ROTATION'],
        confidence: 88
      }
    ],
    filenamePatterns: [/schedule/i, /rotation/i],
    expectedSenders: ['shipping_line'],
    description: 'Vessel sailing schedule'
  },

  {
    type: 'cutoff_advisory',
    displayName: 'Cutoff Advisory',
    category: 'schedule',
    contentMarkers: [
      {
        required: ['CUTOFF'],
        optional: ['VGM', 'SI', 'DOCUMENTATION', 'CARGO'],
        confidence: 88
      }
    ],
    filenamePatterns: [/cutoff/i],
    expectedSenders: ['shipping_line', 'freight_forwarder'],
    description: 'Cutoff date/time advisory for various activities'
  },

  {
    type: 'vgm_confirmation',
    displayName: 'VGM Confirmation',
    category: 'vgm',
    contentMarkers: [
      {
        required: ['VGM'],
        optional: ['VERIFIED GROSS MASS', 'CONFIRMED', 'SUBMITTED'],
        confidence: 90
      }
    ],
    filenamePatterns: [/VGM/i],
    expectedSenders: ['shipping_line', 'freight_forwarder'],
    description: 'Verified Gross Mass confirmation'
  },

  {
    type: 'packing_list',
    displayName: 'Packing List',
    category: 'export_docs',  // Export docs from shipper - used for customs clearance
    contentMarkers: [
      {
        required: ['PACKING LIST'],
        optional: ['PACKAGES', 'WEIGHT', 'DIMENSIONS', 'QUANTITY'],
        confidence: 92
      }
    ],
    filenamePatterns: [/packing.?list/i, /PL_/i],
    expectedSenders: ['shipper'],
    description: 'Cargo packing list - used for customs clearance'
  },

  {
    type: 'cargo_manifest',
    displayName: 'Cargo Manifest',
    category: 'schedule',
    contentMarkers: [
      {
        required: ['MANIFEST'],
        optional: ['CARGO', 'CONTAINER', 'VESSEL'],
        confidence: 85
      }
    ],
    filenamePatterns: [/manifest/i],
    expectedSenders: ['shipping_line'],
    description: 'Cargo manifest'
  },

  {
    type: 'work_order',
    displayName: 'Work Order / Dispatch',
    category: 'trucking',
    contentMarkers: [
      {
        required: ['WORK ORDER'],
        optional: ['PICKUP', 'DELIVERY', 'DRIVER', 'TRUCK'],
        confidence: 90
      },
      {
        required: ['DISPATCH', 'ORDER'],
        optional: ['CONTAINER', 'PICKUP'],
        confidence: 85
      }
    ],
    filenamePatterns: [/work.?order/i, /WO_/i],
    expectedSenders: ['trucker', 'freight_forwarder'],
    description: 'Trucking work order / dispatch instructions'
  },

  {
    type: 'gate_in_confirmation',
    displayName: 'Gate In Confirmation',
    category: 'trucking',
    contentMarkers: [
      {
        required: ['GATE', 'IN'],
        optional: ['CONFIRMATION', 'CONTAINER', 'TERMINAL'],
        confidence: 88
      }
    ],
    filenamePatterns: [/gate.?in/i],
    expectedSenders: ['trucker', 'shipping_line'],
    description: 'Container gate-in at terminal confirmation'
  },

  {
    type: 'shipment_status',
    displayName: 'Shipment Status Update',
    category: 'schedule',
    contentMarkers: [
      {
        required: ['STATUS'],
        optional: ['UPDATE', 'SHIPMENT', 'TRACKING', 'MILESTONE'],
        confidence: 75
      }
    ],
    expectedSenders: ['shipping_line', 'freight_forwarder'],
    description: 'General shipment status update'
  },

  {
    type: 'delay_notice',
    displayName: 'Delay Notice',
    category: 'schedule',
    contentMarkers: [
      {
        required: ['DELAY'],
        optional: ['VESSEL', 'SCHEDULE', 'ETD', 'ETA', 'ROLLOVER'],
        confidence: 88
      },
      {
        required: ['ROLLOVER'],
        optional: ['VESSEL', 'BOOKING'],
        confidence: 85
      }
    ],
    expectedSenders: ['shipping_line', 'freight_forwarder'],
    description: 'Delay or rollover notification'
  },

  {
    type: 'general_correspondence',
    displayName: 'General Correspondence',
    category: 'other',
    contentMarkers: [
      {
        required: [],  // Fallback for unmatched
        confidence: 50
      }
    ],
    expectedSenders: ['unknown'],
    description: 'General email correspondence not matching specific document types'
  },
];


// =============================================================================
// HELPER FUNCTIONS
// =============================================================================

/**
 * Identify sender type from email address
 */
export function identifySenderType(email: string): SenderType {
  const emailLower = email.toLowerCase();

  for (const pattern of SENDER_PATTERNS) {
    for (const domain of pattern.domains) {
      if (emailLower.includes(domain.toLowerCase())) {
        return pattern.type;
      }
    }
  }

  return 'unknown';
}

/**
 * Get document type config by type name
 */
export function getDocumentConfig(type: string): DocumentTypeConfig | undefined {
  return DOCUMENT_TYPE_CONFIGS.find(c => c.type === type);
}

/**
 * Get all document types for a category
 */
export function getDocumentTypesByCategory(category: DocumentCategory): DocumentTypeConfig[] {
  return DOCUMENT_TYPE_CONFIGS.filter(c => c.category === category);
}

/**
 * Get expected document types for a sender type
 */
export function getExpectedDocumentTypes(senderType: SenderType): DocumentTypeConfig[] {
  return DOCUMENT_TYPE_CONFIGS.filter(c =>
    c.expectedSenders?.includes(senderType)
  );
}
