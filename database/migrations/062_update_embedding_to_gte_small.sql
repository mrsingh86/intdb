-- ============================================================================
-- Migration: Update embeddings to use Supabase built-in gte-small model
-- Version: 062
-- Date: 2026-01-29
--
-- CHANGES:
-- - Updates embedding column from 1536 dimensions to 384 (gte-small model)
-- - gte-small is Supabase's built-in model - no external API key needed
-- - Recreates search functions for 384 dimensions
--
-- NOTE: Any existing embeddings will be dropped as they're incompatible
-- ============================================================================

-- Step 1: Drop existing index (required before altering column)
DROP INDEX IF EXISTS chronicle_embedding_idx;

-- Step 2: Clear existing embeddings (1536 dims incompatible with 384)
-- This is safe - we haven't generated any embeddings yet
UPDATE chronicle SET embedding = NULL, embedding_generated_at = NULL;

-- Step 3: Alter column to use 384 dimensions (gte-small)
ALTER TABLE chronicle ALTER COLUMN embedding TYPE vector(384);

-- Step 4: Recreate index for 384-dimension vectors
-- Using ivfflat with lists=100 for tables with 10K-100K rows
CREATE INDEX chronicle_embedding_idx
ON chronicle USING ivfflat (embedding vector_cosine_ops)
WITH (lists = 100);

-- Step 5: Update semantic search function for shipment emails
CREATE OR REPLACE FUNCTION search_shipment_emails_semantic(
  query_embedding vector(384),
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

-- Step 6: Update global semantic search function
CREATE OR REPLACE FUNCTION search_chronicle_semantic(
  query_embedding vector(384),
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

-- Step 7: Update comments
COMMENT ON COLUMN chronicle.embedding IS 'Vector embedding (384 dim) for semantic search. Generated using Supabase built-in gte-small model.';

-- ============================================================================
-- VERIFICATION QUERIES
-- ============================================================================
--
-- Check column type:
-- SELECT column_name, udt_name FROM information_schema.columns
-- WHERE table_name = 'chronicle' AND column_name = 'embedding';
--
-- Should show: embedding | vector
-- ============================================================================
