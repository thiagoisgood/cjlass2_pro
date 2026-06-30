-- Migration 0005: formal RAG vector operations
-- Adds upload/source metadata, policy validity controls, and pgvector embeddings.

CREATE EXTENSION IF NOT EXISTS vector;

ALTER TABLE knowledge_docs ADD COLUMN IF NOT EXISTS source_uri TEXT NOT NULL DEFAULT '';
ALTER TABLE knowledge_docs ADD COLUMN IF NOT EXISTS mime_type TEXT NOT NULL DEFAULT 'text/plain';
ALTER TABLE knowledge_docs ADD COLUMN IF NOT EXISTS checksum TEXT NOT NULL DEFAULT '';
ALTER TABLE knowledge_docs ADD COLUMN IF NOT EXISTS parser TEXT NOT NULL DEFAULT '';
ALTER TABLE knowledge_docs ADD COLUMN IF NOT EXISTS effective_from TEXT NOT NULL DEFAULT '';
ALTER TABLE knowledge_docs ADD COLUMN IF NOT EXISTS expires_at TEXT NOT NULL DEFAULT '';
ALTER TABLE knowledge_docs ADD COLUMN IF NOT EXISTS invalidated_at TIMESTAMPTZ;
ALTER TABLE knowledge_docs ADD COLUMN IF NOT EXISTS invalidated_by TEXT;
ALTER TABLE knowledge_docs ADD COLUMN IF NOT EXISTS metadata JSONB NOT NULL DEFAULT '{}'::jsonb;

ALTER TABLE knowledge_chunks ADD COLUMN IF NOT EXISTS content_hash TEXT NOT NULL DEFAULT '';
ALTER TABLE knowledge_chunks ADD COLUMN IF NOT EXISTS embedding vector(1536);
ALTER TABLE knowledge_chunks ADD COLUMN IF NOT EXISTS embedding_provider TEXT;
ALTER TABLE knowledge_chunks ADD COLUMN IF NOT EXISTS embedding_model TEXT;
ALTER TABLE knowledge_chunks ADD COLUMN IF NOT EXISTS embedding_dimension INTEGER;
ALTER TABLE knowledge_chunks ADD COLUMN IF NOT EXISTS embedded_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS knowledge_docs_validity_idx
  ON knowledge_docs(tenant_id, status, scope, effective_from, expires_at)
  WHERE invalidated_at IS NULL;

CREATE INDEX IF NOT EXISTS knowledge_chunks_content_hash_idx
  ON knowledge_chunks(tenant_id, doc_id, content_hash);

CREATE INDEX IF NOT EXISTS knowledge_chunks_embedding_ivfflat_idx
  ON knowledge_chunks
  USING ivfflat (embedding vector_cosine_ops)
  WITH (lists = 100)
  WHERE embedding IS NOT NULL;
