/**
 * Email Party Classification Configuration
 *
 * Defines how to identify different parties in shipping communications:
 * - Carriers: Shipping lines (Hapag, Maersk, MSC, CMA-CGM, etc.)
 * - Internal: Your company (intoglo.com)
 * - Government: Customs agencies (CBSA, etc.)
 * - Partners: CHAs, truckers, freight agents
 * - Customers: Shippers, consignees
 */

export type PartyType =
  | 'carrier'      // Shipping lines
  | 'internal'     // Intoglo team
  | 'government'   // Customs/regulatory
  | 'cha'          // Customs House Agent
  | 'trucker'      // Trucking company
  | 'partner'      // Freight partners/agents
  | 'customer'     // Shipper/Consignee
  | 'unknown';

export type Direction = 'incoming' | 'outgoing';

export interface PartyInfo {
  type: PartyType;
  name: string;           // Display name
  shortName: string;      // 3-4 char abbreviation
  color: string;          // Tailwind color class
}

export interface EmailPartyResult {
  party: PartyInfo;
  direction: Direction;
}

// Carrier patterns - shipping lines
const CARRIER_PATTERNS: Record<string, PartyInfo> = {
  'hlag.com': { type: 'carrier', name: 'Hapag-Lloyd', shortName: 'HLCU', color: 'bg-orange-100 text-orange-800' },
  'hapag-lloyd': { type: 'carrier', name: 'Hapag-Lloyd', shortName: 'HLCU', color: 'bg-orange-100 text-orange-800' },
  'maersk.com': { type: 'carrier', name: 'Maersk', shortName: 'MAEU', color: 'bg-blue-100 text-blue-800' },
  'msc.com': { type: 'carrier', name: 'MSC', shortName: 'MSCU', color: 'bg-yellow-100 text-yellow-800' },
  'medlog': { type: 'carrier', name: 'MSC', shortName: 'MSCU', color: 'bg-yellow-100 text-yellow-800' },
  'cma-cgm.com': { type: 'carrier', name: 'CMA CGM', shortName: 'CMDU', color: 'bg-red-100 text-red-800' },
  'coscon.com': { type: 'carrier', name: 'COSCO', shortName: 'COSU', color: 'bg-green-100 text-green-800' },
  'oocl.com': { type: 'carrier', name: 'OOCL', shortName: 'OOLU', color: 'bg-teal-100 text-teal-800' },
  'evergreen': { type: 'carrier', name: 'Evergreen', shortName: 'EGLV', color: 'bg-emerald-100 text-emerald-800' },
  'one-line.com': { type: 'carrier', name: 'ONE', shortName: 'ONEY', color: 'bg-pink-100 text-pink-800' },
  'yangming.com': { type: 'carrier', name: 'Yang Ming', shortName: 'YMLU', color: 'bg-amber-100 text-amber-800' },
  'zim.com': { type: 'carrier', name: 'ZIM', shortName: 'ZIMU', color: 'bg-indigo-100 text-indigo-800' },
};

// Internal company patterns
const INTERNAL_PATTERNS: Record<string, PartyInfo> = {
  'intoglo.com': { type: 'internal', name: 'Intoglo', shortName: 'INT', color: 'bg-gray-100 text-gray-800' },
};

// Government/Customs patterns
const GOVERNMENT_PATTERNS: Record<string, PartyInfo> = {
  'cbsa-asfc.gc.ca': { type: 'government', name: 'CBSA Canada', shortName: 'CBSA', color: 'bg-purple-100 text-purple-800' },
  'customs': { type: 'government', name: 'Customs', shortName: 'CUST', color: 'bg-purple-100 text-purple-800' },
  'icegate': { type: 'government', name: 'Indian Customs', shortName: 'ICGT', color: 'bg-purple-100 text-purple-800' },
};

// Known freight partners/CHAs
const PARTNER_PATTERNS: Record<string, PartyInfo> = {
  'sunrisefreight.com': { type: 'partner', name: 'Sunrise Freight', shortName: 'SRF', color: 'bg-cyan-100 text-cyan-800' },
  'oakshipping.com': { type: 'partner', name: 'Oak Shipping', shortName: 'OAK', color: 'bg-cyan-100 text-cyan-800' },
};

// Known customers
const CUSTOMER_PATTERNS: Record<string, PartyInfo> = {
  'gokulgroup.com': { type: 'customer', name: 'Gokul Group', shortName: 'GKL', color: 'bg-lime-100 text-lime-800' },
  'resilient': { type: 'customer', name: 'Resilient Auto', shortName: 'RES', color: 'bg-lime-100 text-lime-800' },
  'uflexltd.com': { type: 'customer', name: 'Uflex', shortName: 'UFX', color: 'bg-lime-100 text-lime-800' },
};

const UNKNOWN_PARTY: PartyInfo = {
  type: 'unknown',
  name: 'Unknown',
  shortName: '???',
  color: 'bg-gray-100 text-gray-600'
};

/**
 * Identify party from email address
 */
export function identifyParty(email: string): PartyInfo {
  const normalizedEmail = email.toLowerCase();

  // Check each pattern category in order of specificity
  const allPatterns = [
    ...Object.entries(INTERNAL_PATTERNS),
    ...Object.entries(CARRIER_PATTERNS),
    ...Object.entries(GOVERNMENT_PATTERNS),
    ...Object.entries(PARTNER_PATTERNS),
    ...Object.entries(CUSTOMER_PATTERNS),
  ];

  for (const [pattern, info] of allPatterns) {
    if (normalizedEmail.includes(pattern)) {
      return info;
    }
  }

  return UNKNOWN_PARTY;
}

/**
 * Classify email direction and party
 */
export function classifyEmailParty(senderEmail: string): EmailPartyResult {
  const party = identifyParty(senderEmail);

  // Direction: if from internal, it's outgoing; otherwise incoming
  const direction: Direction = party.type === 'internal' ? 'outgoing' : 'incoming';

  return { party, direction };
}

/**
 * Get party info for display in UI
 */
export function getPartyDisplay(email: string): {
  name: string;
  shortName: string;
  type: PartyType;
  color: string;
  direction: Direction;
  icon: PartyType;
} {
  const { party, direction } = classifyEmailParty(email);

  return {
    name: party.name,
    shortName: party.shortName,
    type: party.type,
    color: party.color,
    direction,
    icon: party.type,
  };
}
