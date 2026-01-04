/**
 * Direction Detector
 *
 * Determines email direction based on sender domain and subject patterns.
 * - OUTBOUND: Sent by Intoglo team (@intoglo.com, @intoglo.in) to customers
 * - INBOUND: Received from external parties (carriers, clients, agents)
 *
 * Key insight: Some carrier emails arrive via ops@intoglo.com without "via" display name
 * but can be identified by subject patterns (e.g., "Booking Confirmation : 263825330")
 */

export type EmailDirection = 'inbound' | 'outbound';

/**
 * Carrier BC subject patterns - specific formats forwarded via Intoglo emails
 * IMPORTANT: Only exact patterns are used - do NOT add generic patterns
 * Generic patterns like /booking\s*confirm/ catch replies too
 */
const CARRIER_BC_PATTERNS = [
  /^booking\s+(confirmation|amendment)\s*:/i,  // Maersk: "Booking Confirmation : 263..."
  /^cosco\s+shipping\s+line\s+booking\s+confirmation/i,  // COSCO: "Cosco Shipping Line Booking Confirmation - COSU..."
  /^cma\s*cgm\s*-\s*booking\s+confirmation\s+available/i,  // CMA CGM: "CMA CGM - Booking confirmation available"
  // NOTE: "Price overview - booking confirmation" is NOT a BC, it's a rate_quote document
];

/**
 * Carrier Arrival Notice patterns - forwarded via nam@intoglo.com or ops@intoglo.com
 * These indicate shipping line origin even when sender is Intoglo
 */
const CARRIER_AN_PATTERNS = [
  /^arrival\s+notice\s+\d{9}/i,  // Maersk: "Arrival notice 262121778" (9-digit booking)
  /^cosco\s+arrival\s+notice/i,  // COSCO: "COSCO Arrival Notice at Port..."
  /^cma\s*cgm\s*-\s*arrival\s+notice\s+available/i,  // CMA CGM: "CMA CGM - Arrival notice available"
  /^oocl\s+arrival\s+notice/i,  // OOCL: "OOCL Arrival Notice..."
  /^smil\s+arrival\s+notice/i,  // SMIL partner: "SMIL Arrival Notice | ..."
  /^arrival\s+notice\s*\(bl#:/i,  // ONE Line: "Arrival Notice(BL#: MUMFA0549800)"
];

/**
 * Detect email direction based on sender email address and subject
 *
 * Rules:
 * 1. "Name via Group <group@intoglo.com>" = INBOUND (forwarded from external)
 * 2. ops@intoglo.com + carrier subject pattern = INBOUND (Maersk BC forwards)
 * 3. Intoglo sender + carrier booking pattern in subject = INBOUND
 * 4. Direct @intoglo.com or @intoglo.in sender = OUTBOUND (team member sent)
 * 5. All other senders = INBOUND (carrier, client, agent)
 *
 * Key insight: Google Groups forwards show as "Original Sender via Group <group@intoglo.com>"
 * These are INBOUND even though the email address is @intoglo.com
 */
export function detectDirection(
  senderEmail: string | null | undefined,
  subject?: string | null
): EmailDirection {
  if (!senderEmail) {
    return 'inbound'; // Default to inbound if no sender
  }

  const sender = senderEmail.toLowerCase();
  const subj = (subject || '').toLowerCase();

  // FIRST: Check if sender is from carrier domain - ALWAYS inbound
  // This catches true_sender_email from shipping lines (forwarded via Intoglo)
  if (isCarrierSender(senderEmail)) {
    return 'inbound';
  }

  // Check for Google Groups forwards: "Name via GroupName <group@intoglo.com>"
  // These are INBOUND - external parties sending to Intoglo groups
  if (sender.includes(' via ')) {
    return 'inbound';
  }

  // For Intoglo senders, check if subject reveals carrier origin
  if (sender.includes('@intoglo.com') || sender.includes('@intoglo.in')) {
    // IMPORTANT: Replies are OUTBOUND (Intoglo staff replying to customers)
    // Replies start with "Re:", "RE:", "Fwd:", etc.
    const isReply = /^(re|fw|fwd):/i.test((subject || '').trim());

    // Carrier BC/AN forwarded via ops@intoglo.com, pricing@intoglo.com, or nam@intoglo.com
    // Matches specific carrier subject patterns (not generic)
    // Only match if NOT a reply
    if (!isReply && (
      sender === 'ops@intoglo.com' ||
      sender === 'pricing@intoglo.com' ||
      sender === 'nam@intoglo.com'
    )) {
      // Check for Booking Confirmation patterns
      if (CARRIER_BC_PATTERNS.some(p => p.test(subject || ''))) {
        return 'inbound';
      }
      // Check for Arrival Notice patterns
      if (CARRIER_AN_PATTERNS.some(p => p.test(subject || ''))) {
        return 'inbound';
      }
    }

    // COSCO IRIS system emails (not replies)
    if (!isReply && /iris/i.test(sender) && /booking\s*confirm/i.test(subj)) {
      return 'inbound';
    }

    // ODeX carrier platform notifications (not replies)
    if (!isReply && /\bODeX:/i.test(subject || '')) {
      return 'inbound';
    }

    // Default for Intoglo sender = OUTBOUND
    // This includes all replies and non-carrier-pattern emails
    return 'outbound';
  }

  // Everyone else = INBOUND
  // This includes: carriers, clients, agents
  return 'inbound';
}

/**
 * Check if sender is from Intoglo
 */
export function isIntogloSender(senderEmail: string | null | undefined): boolean {
  return detectDirection(senderEmail) === 'outbound';
}

/**
 * Check if sender is from a known shipping carrier
 */
export function isCarrierSender(senderEmail: string | null | undefined): boolean {
  if (!senderEmail) return false;

  const sender = senderEmail.toLowerCase();

  const carrierDomains = [
    // Major shipping lines
    'maersk.com',
    'sealand.com',
    'hapag-lloyd.com',
    'hlag.com',
    'hlag.cloud',
    'service.hlag.com',
    'cma-cgm.com',
    'apl.com',
    'coscon.com',
    'oocl.com',
    'msc.com',
    'evergreen-line.com',
    'one-line.com',
    'yangming.com',
    'zim.com',
    // Partner/Agent domains that send arrival notices
    'smartmode.net',  // SMIL partner
  ];

  return carrierDomains.some(domain => sender.includes(domain));
}
