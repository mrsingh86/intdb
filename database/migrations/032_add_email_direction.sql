-- ============================================================================
-- Migration: Add email_direction to raw_emails
-- ============================================================================
-- Persists email direction (inbound/outbound) to avoid recalculating each time.
--
-- Direction Rules:
-- 1. "Name via Group <group@intoglo.com>" = INBOUND (forwarded from external)
-- 2. Direct @intoglo.com or @intoglo.in sender = OUTBOUND (team member sent)
-- 3. All other senders = INBOUND (carrier, client, agent)
-- ============================================================================

-- Add direction column to raw_emails
ALTER TABLE raw_emails
ADD COLUMN IF NOT EXISTS email_direction VARCHAR(20);

COMMENT ON COLUMN raw_emails.email_direction IS 'Email direction: inbound (from external) or outbound (from Intoglo team)';

-- Create index for filtering by direction
CREATE INDEX IF NOT EXISTS idx_raw_emails_direction ON raw_emails(email_direction);

-- ============================================================================
-- Backfill existing emails with direction
-- ============================================================================
-- Rule: If sender contains ' via ' → INBOUND (Google Groups forward)
--       If sender contains @intoglo.com/@intoglo.in (no via) → OUTBOUND
--       Otherwise → INBOUND
-- ============================================================================

UPDATE raw_emails
SET email_direction = CASE
  -- Google Groups forwards are INBOUND
  WHEN LOWER(sender_email) LIKE '% via %' THEN 'inbound'
  -- Direct Intoglo team members are OUTBOUND
  WHEN LOWER(sender_email) LIKE '%@intoglo.com%' THEN 'outbound'
  WHEN LOWER(sender_email) LIKE '%@intoglo.in%' THEN 'outbound'
  -- Everyone else is INBOUND
  ELSE 'inbound'
END
WHERE email_direction IS NULL;

-- ============================================================================
-- Verification query (run after migration)
-- ============================================================================
-- SELECT email_direction, COUNT(*) FROM raw_emails GROUP BY email_direction;
