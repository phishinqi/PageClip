-- Millisecond timestamps. Only OAuth/security metadata; never PageClip business data.
CREATE TABLE sessions (
  id TEXT PRIMARY KEY,
  challenge TEXT NOT NULL,
  expected_email TEXT,
  expected_subject TEXT,
  previous_credential_hash TEXT,
  state_hash TEXT NOT NULL UNIQUE,
  browser_hash TEXT,
  status TEXT NOT NULL CHECK (status IN ('created','authorizing','processing','ready','redeemed','failed')),
  pkce_cipher TEXT,
  token_cipher TEXT,
  subject TEXT,
  email TEXT,
  access_expires_at INTEGER,
  credential_hash TEXT,
  error_code TEXT,
  cancel_requested INTEGER NOT NULL DEFAULT 0 CHECK (cancel_requested IN (0,1)),
  cancel_lease_owner TEXT,
  cancel_lease_until INTEGER NOT NULL DEFAULT 0,
  expires_at INTEGER NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE INDEX sessions_expiry ON sessions(expires_at);

CREATE TABLE connections (
  credential_hash TEXT PRIMARY KEY,
  source_session TEXT NOT NULL UNIQUE,
  subject TEXT NOT NULL,
  email TEXT NOT NULL,
  token_cipher TEXT NOT NULL,
  access_expires_at INTEGER NOT NULL,
  version INTEGER NOT NULL DEFAULT 0,
  lease_owner TEXT,
  lease_until INTEGER NOT NULL DEFAULT 0,
  revoking INTEGER NOT NULL DEFAULT 0 CHECK (revoking IN (0,1)),
  blocked INTEGER NOT NULL DEFAULT 0 CHECK (blocked IN (0,1)),
  provider_revoked INTEGER NOT NULL DEFAULT 0 CHECK (provider_revoked IN (0,1)),
  created_at INTEGER NOT NULL
);
-- Deliberately no FK: redeemed connections outlive transient sessions.
CREATE INDEX connections_subject ON connections(subject);
CREATE TABLE grant_revocations (
  subject TEXT PRIMARY KEY,
  lease_owner TEXT NOT NULL,
  lease_until INTEGER NOT NULL
);

CREATE TABLE rate_limits (
  bucket TEXT PRIMARY KEY,
  count INTEGER NOT NULL,
  expires_at INTEGER NOT NULL
);
CREATE INDEX rate_limits_expiry ON rate_limits(expires_at);
