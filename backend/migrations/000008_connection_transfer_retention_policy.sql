ALTER TABLE public."Connection"
ADD COLUMN IF NOT EXISTS "transferRetentionPolicy" jsonb;
