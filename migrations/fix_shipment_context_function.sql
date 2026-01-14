-- ============================================================================
-- FIX: get_shipment_context_for_ai - Use JSONB to avoid type mismatches
-- Run this in Supabase Dashboard > SQL Editor
-- ============================================================================

-- Drop and recreate with JSONB return type
DROP FUNCTION IF EXISTS get_shipment_context_for_ai(UUID);

CREATE OR REPLACE FUNCTION get_shipment_context_for_ai(p_shipment_id UUID)
RETURNS TABLE (
  shipment_data JSONB
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN QUERY
  SELECT to_jsonb(s) as shipment_data
  FROM shipments s
  WHERE s.id = p_shipment_id;
END;
$$;

-- Grant permissions
GRANT EXECUTE ON FUNCTION get_shipment_context_for_ai TO authenticated, anon, service_role;

-- Test query (should return JSONB with all shipment fields)
-- SELECT * FROM get_shipment_context_for_ai('42c3e690-2420-429b-94de-7340a2f63286');
