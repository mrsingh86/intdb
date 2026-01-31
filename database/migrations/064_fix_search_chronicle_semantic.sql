-- Migration: Fix search_chronicle_semantic to return booking_number, mbl_number, from_address
-- Applied: 2026-01-31
-- Issue: Semantic search in Pulse was returning 0 results because the RPC
--        didn't return booking_number, preventing aggregation into shipments

DROP FUNCTION IF EXISTS public.search_chronicle_semantic(vector, integer, double precision, text);

CREATE FUNCTION public.search_chronicle_semantic(
  query_embedding vector,
  match_count integer DEFAULT 10,
  similarity_threshold double precision DEFAULT 0.7,
  p_document_type text DEFAULT NULL::text
)
RETURNS TABLE(
  id uuid,
  gmail_message_id text,
  shipment_id uuid,
  document_type text,
  subject text,
  summary text,
  occurred_at timestamp with time zone,
  similarity double precision,
  booking_number text,
  mbl_number text,
  from_address text
)
LANGUAGE plpgsql
STABLE
AS $function$
BEGIN
  RETURN QUERY
  SELECT
    c.id,
    c.gmail_message_id,
    c.shipment_id,
    c.document_type,
    c.subject,
    c.summary,
    c.occurred_at,
    1 - (c.embedding <=> query_embedding) as similarity,
    c.booking_number,
    c.mbl_number,
    c.from_address
  FROM chronicle c
  WHERE c.embedding IS NOT NULL
    AND 1 - (c.embedding <=> query_embedding) >= similarity_threshold
    AND (p_document_type IS NULL OR c.document_type = p_document_type)
  ORDER BY c.embedding <=> query_embedding
  LIMIT match_count;
END;
$function$;
