/**
 * Direction Detector
 *
 * Determines email direction based on sender domain.
 * - OUTBOUND: Sent by Intoglo team (@intoglo.com, @intoglo.in)
 * - INBOUND: Received from external parties (carriers, clients, agents)
 */

export type EmailDirection = 'inbound' | 'outbound';

/**
 * Detect email direction based on sender email address
 *
 * Rules:
 * 1. "Name via Group <group@intoglo.com>" = INBOUND (forwarded from external)
 * 2. Direct @intoglo.com or @intoglo.in sender = OUTBOUND (team member sent)
 * 3. All other senders = INBOUND (carrier, client, agent)
 *
 * Key insight: Google Groups forwards show as "Original Sender via Group <group@intoglo.com>"
 * These are INBOUND even though the email address is @intoglo.com
 */
export function detectDirection(senderEmail: string | null | undefined): EmailDirection {
  if (!senderEmail) {
    return 'inbound'; // Default to inbound if no sender
  }

  const sender = senderEmail.toLowerCase();

  // Check for Google Groups forwards: "Name via GroupName <group@intoglo.com>"
  // These are INBOUND - external parties sending to Intoglo groups
  if (sender.includes(' via ')) {
    return 'inbound';
  }

  // Direct Intoglo team member = OUTBOUND
  // Must be direct sender, not a forward
  if (sender.includes('@intoglo.com') || sender.includes('@intoglo.in')) {
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
