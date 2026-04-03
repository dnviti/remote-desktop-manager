ALTER TABLE public."DbAuditLog"
    ADD COLUMN IF NOT EXISTS "sessionId" text;

CREATE INDEX IF NOT EXISTS "DbAuditLog_sessionId_createdAt_idx"
    ON public."DbAuditLog" USING btree ("sessionId", "createdAt");

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conname = 'DbAuditLog_sessionId_fkey'
    ) THEN
        ALTER TABLE ONLY public."DbAuditLog"
            ADD CONSTRAINT "DbAuditLog_sessionId_fkey"
            FOREIGN KEY ("sessionId")
            REFERENCES public."ActiveSession"(id)
            ON UPDATE CASCADE
            ON DELETE SET NULL;
    END IF;
END
$$;
