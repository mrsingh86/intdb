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
 * Subject patterns that indicate carrier/inbound emails
 * These override the default Intoglo = outbound logic
 */
const CARRIER_SUBJECT_PATTERNS = [
  /^booking\s+(confirmation|amendment)\s*:/i,  // Maersk BC via ops@intoglo.com
  /booking\s*confirm/i,
  /booking\s*amendment/i,
  /shipment\s*notice/i,
];

/**
 * Booking number patterns in subject that indicate carrier emails
 */
const CARRIER_BOOKING_PATTERNS = [
  /\b26\d{7}\b/,           // Maersk 9-digit
  /\bCOSU\d{6,}/i,         // COSCO
  /\b(AMC|CEI|EID|CAD)\d{6,}/i,  // CMA CGM
  /\bHL(CU|CL)?\d{6,}/i,   // Hapag-Lloyd
  /\bODeX:/i,              // ODeX carrier platform
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

  // Check for Google Groups forwards: "Name via GroupName <group@intoglo.com>"
  // These are INBOUND - external parties sending to Intoglo groups
  if (sender.includes(' via ')) {
    return 'inbound';
  }

  // For Intoglo senders, check if subject reveals carrier origin
  if (sender.includes('@intoglo.com') || sender.includes('@intoglo.in')) {
    // Maersk BC forwarded via ops@intoglo.com (without "via" display name)
    // Subject format: "Booking Confirmation : 263825330"
    if (sender === 'ops@intoglo.com' && CARRIER_SUBJECT_PATTERNS[0].test(subject || '')) {
      return 'inbound';
    }

    // Check for carrier subject patterns
    if (CARRIER_SUBJECT_PATTERNS.some(p => p.test(subj))) {
      return 'inbound';
    }

    // Check for carrier booking number patterns in subject
    if (CARRIER_BOOKING_PATTERNS.some(p => p.test(subj))) {
      return 'inbound';
    }

    // COSCO IRIS system emails
    if (/iris/i.test(sender) && /booking\s*confirm/i.test(subj)) {
      return 'inbound';
    }

    // Default for Intoglo sender = OUTBOUND
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
    'maersk.com',
    'sealand.com',
    'hapag-lloyd.com',
    'hlag.com',
    'hlag.cloud',
    'cma-cgm.com',
    'apl.com',
    'coscon.com',
    'oocl.com',
    'msc.com',
    'evergreen-line.com',
    'one-line.com',
    'yangming.com',
    'zim.com',
  ];

  return carrierDomains.some(domain => sender.includes(domain));
}
