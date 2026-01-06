/**
 * Domain Classifier
 *
 * Classifies email domains as Intoglo, Carrier, or External
 */

export type DomainType = 'intoglo' | 'carrier' | 'external';

const INTOGLO_DOMAINS = [
  'intoglo.com',
  'intoglo.in',
];

const CARRIER_DOMAINS = [
  // Maersk
  'maersk.com',
  'sealand.com',
  // Hapag-Lloyd
  'hapag-lloyd.com',
  'hlag.com',
  'hlag.cloud',
  'service.hlag.com',
  // CMA CGM
  'cma-cgm.com',
  'cmacgm-group.com',
  'cma-cgm.net',
  // APL
  'apl.com',
  // COSCO
  'coscon.com',
  'cosco.com',
  // OOCL
  'oocl.com',
  // MSC
  'msc.com',
  // Evergreen
  'evergreen-line.com',
  'evergreen-marine.com',
  // ONE Line
  'one-line.com',
  // Yang Ming
  'yangming.com',
  // ZIM
  'zim.com',
  // Partner/Agent domains
  'smartmode.net', // SMIL partner
];

/**
 * Extract domain from email address
 */
export function extractDomain(email: string): string {
  if (!email) return '';

  // Handle "Name <email@domain.com>" format
  const match = email.match(/<([^>]+)>/);
  const cleanEmail = match ? match[1] : email;

  // Extract domain part
  const parts = cleanEmail.toLowerCase().split('@');
  return parts.length > 1 ? parts[1].trim() : '';
}

/**
 * Check if domain belongs to Intoglo
 */
export function isIntogloDomain(emailOrDomain: string): boolean {
  const domain = emailOrDomain.includes('@')
    ? extractDomain(emailOrDomain)
    : emailOrDomain.toLowerCase();

  return INTOGLO_DOMAINS.some(d => domain === d || domain.endsWith('.' + d));
}

/**
 * Check if domain belongs to a known carrier
 */
export function isCarrierDomain(emailOrDomain: string): boolean {
  const domain = emailOrDomain.includes('@')
    ? extractDomain(emailOrDomain)
    : emailOrDomain.toLowerCase();

  return CARRIER_DOMAINS.some(d => domain === d || domain.endsWith('.' + d));
}

/**
 * Classify a domain
 */
export function classifyDomain(emailOrDomain: string): DomainType {
  if (isIntogloDomain(emailOrDomain)) return 'intoglo';
  if (isCarrierDomain(emailOrDomain)) return 'carrier';
  return 'external';
}

/**
 * Get carrier name from domain (if known)
 */
export function getCarrierFromDomain(emailOrDomain: string): string | null {
  const domain = emailOrDomain.includes('@')
    ? extractDomain(emailOrDomain)
    : emailOrDomain.toLowerCase();

  const carrierMap: Record<string, string> = {
    'maersk.com': 'Maersk',
    'sealand.com': 'Maersk',
    'hapag-lloyd.com': 'Hapag-Lloyd',
    'hlag.com': 'Hapag-Lloyd',
    'hlag.cloud': 'Hapag-Lloyd',
    'service.hlag.com': 'Hapag-Lloyd',
    'cma-cgm.com': 'CMA CGM',
    'cmacgm-group.com': 'CMA CGM',
    'cma-cgm.net': 'CMA CGM',
    'apl.com': 'APL',
    'coscon.com': 'COSCO',
    'cosco.com': 'COSCO',
    'oocl.com': 'OOCL',
    'msc.com': 'MSC',
    'evergreen-line.com': 'Evergreen',
    'evergreen-marine.com': 'Evergreen',
    'one-line.com': 'ONE',
    'yangming.com': 'Yang Ming',
    'zim.com': 'ZIM',
    'smartmode.net': 'SMIL',
  };

  for (const [d, carrier] of Object.entries(carrierMap)) {
    if (domain === d || domain.endsWith('.' + d)) {
      return carrier;
    }
  }

  return null;
}
