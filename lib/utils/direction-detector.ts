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
 * Rule:
 * - @intoglo.com or @intoglo.in sender = OUTBOUND (team member sent)
 * - All other senders = INBOUND (carrier, client, agent, group forward)
 */
export function detectDirection(senderEmail: string | null | undefined): EmailDirection {
  if (!senderEmail) {
    return 'inbound'; // Default to inbound if no sender
  }

  const sender = senderEmail.toLowerCase();

  // Intoglo team member = OUTBOUND
  if (sender.includes('@intoglo.com') || sender.includes('@intoglo.in')) {
    return 'outbound';
  }

  // Everyone else = INBOUND
  // This includes: carriers, clients, agents, group forwards
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
