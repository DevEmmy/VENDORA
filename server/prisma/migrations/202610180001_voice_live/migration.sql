ALTER TABLE vendora.voice_logs DROP CONSTRAINT voice_logs_status_check;
ALTER TABLE vendora.voice_logs ADD CONSTRAINT voice_logs_status_check
  CHECK (status IN ('processing','pending','needs_clarification','confirmed','rejected','failed','completed'));
CREATE INDEX products_voice_name_trgm ON vendora.products USING gin (lower(name) public.gin_trgm_ops) WHERE deleted_at IS NULL;
CREATE FUNCTION vendora.voice_alias_keys(input text[]) RETURNS text[]
LANGUAGE sql IMMUTABLE PARALLEL SAFE AS $$
  SELECT coalesce(array_agg(lower(btrim(value))), ARRAY[]::text[]) FROM unnest(input) AS value
$$;
CREATE INDEX products_voice_aliases ON vendora.products USING gin (vendora.voice_alias_keys(aliases)) WHERE deleted_at IS NULL;
