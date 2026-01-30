-- ============================================================================
-- Migration: Enable pgvector and add embedding column to chronicle
-- Version: 061
-- Date: 2026-01-29
--
-- SAFE MIGRATION:
-- - Enables extension (no data changes)
-- - Adds NULLABLE column (no existing data affected)
-- - Creates index CONCURRENTLY (no table locks)
-- - All operations are backward compatible
-- ============================================================================

-- Step 1: Enable pgvector extension
-- This is safe - just enables the extension, doesn't modify any tables
CREATE EXTENSION IF NOT EXISTS vector;

-- Step 2: Add embedding column to chronicle table
-- NULLABLE so existing 35,000+ records are unaffected
-- Using 1536 dimensions (OpenAI text-embedding-3-small standard)
ALTER TABLE chronicle
ADD COLUMN IF NOT EXISTS embedding vector(1536);

-- Step 3: Add a column to track when embedding was generated
-- Useful for backfill tracking and debugging
ALTER TABLE chronicle
ADD COLUMN IF NOT EXISTS embedding_generated_at TIMESTAMP WITH TIME ZONE;

-- Step 4: Create index for fast similarity search
-- Using ivfflat for good balance of speed and accuracy
-- lists=100 is good for tables with 10K-100K rows
-- CONCURRENTLY means no table locks during creation
CREATE INDEX CONCURRENTLY IF NOT EXISTS chronicle_embedding_idx
ON chronicle USING ivfflat (embedding vector_cosine_ops)
WITH (lists = 100);

-- Step 5: Create a function for semantic search within a shipment
-- This searches emails by meaning, not just keywords
CREATE OR REPLACE FUNCTION search_shipment_emails_semantic(
  query_embedding vector(1536),
  p_shipment_id uuid,
  match_count int DEFAULT 5,
  similarity_threshold float DEFAULT 0.7
)
RETURNS TABLE (
  id uuid,
  gmail_message_id text,
  document_type text,
  subject text,
  summary text,
  occurred_at timestamptz,
  similarity float
) AS $$
BEGIN
  RETURN QUERY
  SELECT
    c.id,
    c.gmail_message_id,
    c.document_type,
    c.subject,
    c.summary,
    c.occurred_at,
    1 - (c.embedding <=> query_embedding) as similarity
  FROM chronicle c
  WHERE c.shipment_id = p_shipment_id
    AND c.embedding IS NOT NULL
    AND 1 - (c.embedding <=> query_embedding) >= similarity_threshold
  ORDER BY c.embedding <=> query_embedding
  LIMIT match_count;
END;
$$ LANGUAGE plpgsql STABLE;

-- Step 6: Create a function for general semantic search (across all emails)
-- Useful for finding similar emails regardless of shipment
CREATE OR REPLACE FUNCTION search_chronicle_semantic(
  query_embedding vector(1536),
  match_count int DEFAULT 10,
  similarity_threshold float DEFAULT 0.7,
  p_document_type text DEFAULT NULL
)
RETURNS TABLE (
  id uuid,
  gmail_message_id text,
  shipment_id uuid,
  document_type text,
  subject text,
  summary text,
  occurred_at timestamptz,
  similarity float
) AS $$
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
    1 - (c.embedding <=> query_embedding) as similarity
  FROM chronicle c
  WHERE c.embedding IS NOT NULL
    AND 1 - (c.embedding <=> query_embedding) >= similarity_threshold
    AND (p_document_type IS NULL OR c.document_type = p_document_type)
  ORDER BY c.embedding <=> query_embedding
  LIMIT match_count;
END;
$$ LANGUAGE plpgsql STABLE;

-- Step 7: Add comment for documentation
COMMENT ON COLUMN chronicle.embedding IS 'Vector embedding (1536 dim) for semantic search. Generated from subject + summary + body_preview using OpenAI text-embedding-3-small.';
COMMENT ON COLUMN chronicle.embedding_generated_at IS 'Timestamp when embedding was generated. NULL means not yet embedded.';
COMMENT ON FUNCTION search_shipment_emails_semantic IS 'Semantic search for emails within a specific shipment. Returns emails ordered by similarity to query.';
COMMENT ON FUNCTION search_chronicle_semantic IS 'Global semantic search across all chronicle emails. Can filter by document_type.';

-- ============================================================================
-- VERIFICATION QUERIES (run manually to verify migration)
-- ============================================================================
--
-- Check extension enabled:
-- SELECT * FROM pg_extension WHERE extname = 'vector';
--
-- Check column added:
-- SELECT column_name, data_type FROM information_schema.columns
-- WHERE table_name = 'chronicle' AND column_name IN ('embedding', 'embedding_generated_at');
--
-- Check index created:
-- SELECT indexname FROM pg_indexes WHERE tablename = 'chronicle' AND indexname LIKE '%embedding%';
--
-- Check functions created:
-- SELECT proname FROM pg_proc WHERE proname LIKE '%semantic%';
-- ============================================================================
