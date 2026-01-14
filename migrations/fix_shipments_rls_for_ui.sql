-- ============================================================================
-- FIX: RPC Function to fetch shipments for UI (bypasses RLS)
-- Run this in Supabase Dashboard > SQL Editor
-- ============================================================================

-- Function to get shipments list for Chronicle V2 UI
CREATE OR REPLACE FUNCTION get_shipments_for_ui(
  p_limit INTEGER DEFAULT 500
)
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
  WHERE s.status IS NULL OR s.status != 'cancelled'
  ORDER BY s.etd DESC NULLS LAST
  LIMIT p_limit;
END;
$$;

-- Grant permissions
GRANT EXECUTE ON FUNCTION get_shipments_for_ui TO authenticated, anon, service_role;

-- Test query
-- SELECT * FROM get_shipments_for_ui(5);
