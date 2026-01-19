-- ============================================================================
-- RPC Functions for AI Summary Generation (Bypass RLS)
-- Run this in Supabase Dashboard > SQL Editor
-- ============================================================================

-- Function 1: Get shipments for AI summary regeneration
-- Returns shipments with their chronicle counts, ordered by most data
CREATE OR REPLACE FUNCTION get_shipments_for_ai_summary(limit_count INTEGER DEFAULT 50)
RETURNS TABLE (
  shipment_id UUID,
  booking_number TEXT,
  mbl_number TEXT,
  carrier_name TEXT,
  shipper_name TEXT,
  stage TEXT,
  chronicle_count BIGINT,
  last_chronicle_at TIMESTAMPTZ
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN QUERY
  SELECT
    s.id as shipment_id,
    s.booking_number::TEXT,
    s.mbl_number::TEXT,
    s.carrier_name::TEXT,
    s.shipper_name::TEXT,
    s.stage::TEXT,
    COUNT(c.id) as chronicle_count,
    MAX(c.occurred_at) as last_chronicle_at
  FROM shipments s
  INNER JOIN chronicle c ON c.shipment_id = s.id
  WHERE (s.status IS NULL OR s.status != 'cancelled')
  GROUP BY s.id, s.booking_number, s.mbl_number, s.carrier_name, s.shipper_name, s.stage
  HAVING COUNT(c.id) > 0
  ORDER BY COUNT(c.id) DESC, MAX(c.occurred_at) DESC
  LIMIT limit_count;
END;
$$;

-- Function 2: Get full shipment context for AI (single shipment)
CREATE OR REPLACE FUNCTION get_shipment_context_for_ai(p_shipment_id UUID)
RETURNS TABLE (
  id UUID,
  booking_number TEXT,
  mbl_number TEXT,
  hbl_number TEXT,
  port_of_loading TEXT,
  port_of_loading_code TEXT,
  port_of_discharge TEXT,
  port_of_discharge_code TEXT,
  vessel_name TEXT,
  voyage_number TEXT,
  carrier_name TEXT,
  etd TIMESTAMPTZ,
  eta TIMESTAMPTZ,
  atd TIMESTAMPTZ,
  ata TIMESTAMPTZ,
  si_cutoff TIMESTAMPTZ,
  vgm_cutoff TIMESTAMPTZ,
  cargo_cutoff TIMESTAMPTZ,
  stage TEXT,
  status TEXT,
  shipper_name TEXT,
  consignee_name TEXT,
  created_at TIMESTAMPTZ
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN QUERY
  SELECT
    s.id,
    s.booking_number::TEXT,
    s.mbl_number::TEXT,
    s.hbl_number::TEXT,
    s.port_of_loading::TEXT,
    s.port_of_loading_code::TEXT,
    s.port_of_discharge::TEXT,
    s.port_of_discharge_code::TEXT,
    s.vessel_name::TEXT,
    s.voyage_number::TEXT,
    s.carrier_name::TEXT,
    s.etd,
    s.eta,
    s.atd,
    s.ata,
    s.si_cutoff,
    s.vgm_cutoff,
    s.cargo_cutoff,
    s.stage::TEXT,
    s.status::TEXT,
    s.shipper_name::TEXT,
    s.consignee_name::TEXT,
    s.created_at
  FROM shipments s
  WHERE s.id = p_shipment_id;
END;
$$;

-- Function 3: Get shipment containers
CREATE OR REPLACE FUNCTION get_shipment_containers_for_ai(p_shipment_id UUID)
RETURNS TABLE (
  container_number TEXT
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN QUERY
  SELECT sc.container_number::TEXT
  FROM shipment_containers sc
  WHERE sc.shipment_id = p_shipment_id
    AND sc.container_number IS NOT NULL;
END;
$$;

-- Grant permissions
GRANT EXECUTE ON FUNCTION get_shipments_for_ai_summary TO authenticated, anon, service_role;
GRANT EXECUTE ON FUNCTION get_shipment_context_for_ai TO authenticated, anon, service_role;
GRANT EXECUTE ON FUNCTION get_shipment_containers_for_ai TO authenticated, anon, service_role;

-- ============================================================================
-- Verification Query (run after creating functions)
-- ============================================================================
-- SELECT * FROM get_shipments_for_ai_summary(5);
-- SELECT * FROM get_shipment_context_for_ai('your-shipment-id-here');
