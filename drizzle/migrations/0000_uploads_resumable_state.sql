ALTER TABLE public.uploads
  ADD COLUMN IF NOT EXISTS upload_session_url text,
  ADD COLUMN IF NOT EXISTS upload_total_bytes bigint,
  ADD COLUMN IF NOT EXISTS upload_offset bigint NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS upload_tags text[],
  ADD COLUMN IF NOT EXISTS upload_attempts integer NOT NULL DEFAULT 0;