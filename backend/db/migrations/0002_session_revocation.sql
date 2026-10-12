-- Session revocation: every JWT carries the user's token_version; bumping it (logout,
-- password change, admin action) invalidates all tokens issued before.
ALTER TABLE users ADD COLUMN IF NOT EXISTS token_version INT NOT NULL DEFAULT 0;
