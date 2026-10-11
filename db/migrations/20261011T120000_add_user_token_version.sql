BEGIN;

ALTER TABLE users
    ADD COLUMN IF NOT EXISTS token_version INTEGER DEFAULT 1;

UPDATE users
   SET token_version = 1
 WHERE token_version IS NULL;

ALTER TABLE users
    ALTER COLUMN token_version SET DEFAULT 1,
    ALTER COLUMN token_version SET NOT NULL;

CREATE TABLE IF NOT EXISTS schema_migrations (
    filename   TEXT PRIMARY KEY,
    applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

INSERT INTO schema_migrations (filename)
VALUES ('20261011T120000_add_user_token_version.sql')
ON CONFLICT (filename) DO NOTHING;

COMMIT;
