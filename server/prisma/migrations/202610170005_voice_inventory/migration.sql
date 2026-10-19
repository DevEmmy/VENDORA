CREATE TABLE vendora.voice_logs (
  id uuid PRIMARY KEY,
  business_id uuid NOT NULL REFERENCES vendora.businesses(id) ON DELETE RESTRICT,
  created_by_id uuid NOT NULL REFERENCES vendora.users(id) ON DELETE RESTRICT,
  transcript text NOT NULL DEFAULT '',
  parsed jsonb NOT NULL DEFAULT '{}',
  confidence double precision NOT NULL DEFAULT 0 CHECK (confidence BETWEEN 0 AND 1),
  status text NOT NULL DEFAULT 'processing' CHECK (status IN ('processing','pending','needs_clarification','confirmed','rejected','failed')),
  asr_job_id text, audio_seconds numeric, latency_ms integer, error_code text,
  candidates jsonb NOT NULL DEFAULT '[]', readback_text text,
  movement_id uuid, result jsonb,
  created_at timestamptz(3) NOT NULL DEFAULT now(),
  updated_at timestamptz(3) NOT NULL DEFAULT now()
);
CREATE INDEX voice_logs_business_cursor ON vendora.voice_logs(business_id, created_at DESC, id DESC);
-- First item references the command UUID; subsequent items use UUID:item-index.
-- The locked voice log is the command receipt; each ledger reference is independently unique.
CREATE UNIQUE INDEX stock_movements_voice_reference_key ON vendora.stock_movements(reference_id) WHERE source = 'voice';
