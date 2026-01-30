-- ============================================================================
-- Migration 063: AI Memory Layer for INTDB
-- ============================================================================
-- Purpose: Create ai_memories table for persistent memory across AI operations
-- Replaces: Mem0 Cloud ($249/mo) with self-hosted solution ($0/mo)
--
-- Uses existing infrastructure:
-- - pgvector extension (enabled in 061)
-- - gte-small embeddings (384 dimensions, configured in 062)
-- - EmbeddingService for vector generation
-- ============================================================================

-- Table: ai_memories
-- Stores learned context for AI personalization and intelligence
CREATE TABLE IF NOT EXISTS ai_memories (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Scoping (determines memory isolation)
  scope VARCHAR(50) NOT NULL,           -- global, project, agent, shipment, customer, sender, pattern, error, session
  scope_id VARCHAR(200) NOT NULL,       -- e.g., user-dinesh, shipment-ABC123, customer-xyz

  -- Content
  content TEXT NOT NULL,
  summary TEXT,                         -- Optional AI-generated summary for long content

  -- Vector embedding (reuse existing 384-dim gte-small model)
  embedding vector(384),

  -- Metadata (flexible JSON for scope-specific data)
  metadata JSONB DEFAULT '{}',          -- carrier, docType, confidence, source, etc.
  tags TEXT[] DEFAULT '{}',             -- For filtering (e.g., ['maersk', 'booking'])

  -- Lifecycle management
  version INTEGER DEFAULT 1,
  expires_at TIMESTAMPTZ,               -- TTL support (NULL = never expires)
  is_active BOOLEAN DEFAULT true,

  -- Audit trail
  source VARCHAR(50),                   -- chronicle, manual, api, cron
  source_reference VARCHAR(200),        -- gmail_message_id, cron_run_id, etc.
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  created_by VARCHAR(100),

  -- Prevent duplicate memories within same scope
  CONSTRAINT unique_memory_content UNIQUE(scope, scope_id, content)
);

-- ============================================================================
-- INDEXES
-- ============================================================================

-- Primary lookup: by scope and scope_id
CREATE INDEX idx_ai_memories_scope
  ON ai_memories(scope, scope_id)
  WHERE is_active = true;

-- Tag-based filtering (GIN for array containment)
CREATE INDEX idx_ai_memories_tags
  ON ai_memories USING gin(tags)
  WHERE is_active = true;

-- Metadata queries (GIN for JSONB)
CREATE INDEX idx_ai_memories_metadata
  ON ai_memories USING gin(metadata)
  WHERE is_active = true;

-- TTL cleanup queries
CREATE INDEX idx_ai_memories_expires
  ON ai_memories(expires_at)
  WHERE expires_at IS NOT NULL;

-- Vector similarity search (ivfflat for performance at scale)
-- Lists = 100 is good for up to ~1M records
CREATE INDEX idx_ai_memories_embedding
  ON ai_memories USING ivfflat (embedding vector_cosine_ops)
  WITH (lists = 100)
  WHERE is_active = true AND embedding IS NOT NULL;

-- ============================================================================
-- RPC FUNCTIONS
-- ============================================================================

-- Semantic search across memories
CREATE OR REPLACE FUNCTION search_memories_semantic(
  query_embedding vector(384),
  p_scope VARCHAR DEFAULT NULL,
  p_scope_id VARCHAR DEFAULT NULL,
  p_tags TEXT[] DEFAULT NULL,
  match_count INT DEFAULT 5,
  similarity_threshold FLOAT DEFAULT 0.5
)
RETURNS TABLE (
  id UUID,
  scope VARCHAR,
  scope_id VARCHAR,
  content TEXT,
  summary TEXT,
  metadata JSONB,
  tags TEXT[],
  similarity FLOAT,
  created_at TIMESTAMPTZ
)
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  RETURN QUERY
  SELECT
    m.id,
    m.scope::VARCHAR,
    m.scope_id::VARCHAR,
    m.content,
    m.summary,
    m.metadata,
    m.tags,
    (1 - (m.embedding <=> query_embedding))::FLOAT AS similarity,
    m.created_at
  FROM ai_memories m
  WHERE m.is_active = true
    AND m.embedding IS NOT NULL
    AND (m.expires_at IS NULL OR m.expires_at > NOW())
    AND (p_scope IS NULL OR m.scope = p_scope)
    AND (p_scope_id IS NULL OR m.scope_id = p_scope_id)
    AND (p_tags IS NULL OR m.tags && p_tags)
    AND (1 - (m.embedding <=> query_embedding)) > similarity_threshold
  ORDER BY m.embedding <=> query_embedding
  LIMIT match_count;
END;
$$;

-- Cleanup expired memories (for scheduled maintenance)
CREATE OR REPLACE FUNCTION cleanup_expired_memories()
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  deleted_count INTEGER;
BEGIN
  -- Soft delete expired memories
  UPDATE ai_memories
  SET is_active = false, updated_at = NOW()
  WHERE expires_at IS NOT NULL
    AND expires_at < NOW()
    AND is_active = true;

  GET DIAGNOSTICS deleted_count = ROW_COUNT;

  -- Log cleanup
  RAISE NOTICE 'Cleaned up % expired memories', deleted_count;

  RETURN deleted_count;
END;
$$;

-- Get memory statistics by scope
CREATE OR REPLACE FUNCTION get_memory_stats()
RETURNS TABLE (
  scope VARCHAR,
  total_count BIGINT,
  active_count BIGINT,
  avg_content_length NUMERIC,
  oldest_memory TIMESTAMPTZ,
  newest_memory TIMESTAMPTZ
)
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  RETURN QUERY
  SELECT
    m.scope::VARCHAR,
    COUNT(*)::BIGINT AS total_count,
    COUNT(*) FILTER (WHERE m.is_active)::BIGINT AS active_count,
    AVG(LENGTH(m.content))::NUMERIC AS avg_content_length,
    MIN(m.created_at) AS oldest_memory,
    MAX(m.created_at) AS newest_memory
  FROM ai_memories m
  GROUP BY m.scope
  ORDER BY active_count DESC;
END;
$$;

-- ============================================================================
-- COMMENTS
-- ============================================================================

COMMENT ON TABLE ai_memories IS 'AI memory layer - stores learned context for personalization and intelligence';

COMMENT ON COLUMN ai_memories.scope IS 'Memory scope: global (user prefs), project, agent, shipment, customer, sender, pattern, error, session';
COMMENT ON COLUMN ai_memories.scope_id IS 'Identifier within scope, e.g., shipment-ABC123, customer-xyz, sender-maersk.com';
COMMENT ON COLUMN ai_memories.content IS 'The actual memory content (max 10KB recommended)';
COMMENT ON COLUMN ai_memories.embedding IS 'Vector embedding for semantic search (384-dim gte-small)';
COMMENT ON COLUMN ai_memories.metadata IS 'Flexible JSON for scope-specific data (carrier, confidence, etc.)';
COMMENT ON COLUMN ai_memories.tags IS 'Array tags for filtering (e.g., carrier names, doc types)';
COMMENT ON COLUMN ai_memories.expires_at IS 'When this memory expires (NULL = never). TTL varies by scope.';
COMMENT ON COLUMN ai_memories.source IS 'Where this memory came from: chronicle, manual, api, cron';

COMMENT ON FUNCTION search_memories_semantic IS 'Semantic search across memories using vector similarity';
COMMENT ON FUNCTION cleanup_expired_memories IS 'Soft-delete memories past their TTL (run via cron)';
COMMENT ON FUNCTION get_memory_stats IS 'Get memory usage statistics by scope';

-- ============================================================================
-- GRANTS (for Supabase RLS)
-- ============================================================================

-- Service role has full access
GRANT ALL ON ai_memories TO service_role;

-- Authenticated users can read/write their own memories (if needed in future)
-- For now, all access is via service_role through API routes
GRANT SELECT, INSERT, UPDATE ON ai_memories TO authenticated;

-- ============================================================================
-- DONE
-- ============================================================================
