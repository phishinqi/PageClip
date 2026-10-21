# PageClip publisher OAuth broker (Cloudflare Worker + D1)

This folder is independent of the extension. It contains executable JavaScript, SQL migrations, an intentionally **unconfigured** Wrangler example, and offline Node tests. It is not a deployed service and does not establish Google verification, browser release support, or live-account acceptance. No files outside this folder are needed to run the tests.

## Purpose and trust boundary

A publisher-owned **Google Web application OAuth client** uses a publisher HTTPS callback. The client secret is a Worker Secret, never shipped to the extension. The extension holds a random broker credential, not a Google refresh token. Google access tokens are returned only in JSON response bodies over HTTPS, never URLs, fragments, redirects, completion HTML, cookies, or logs. This is not an introspection/proxy API and stores no bookmark, document, or other PageClip business data.

The extension generates **two independent cryptographically random 32-byte values**, using `crypto.getRandomValues`: a redemption verifier and an extension-pre-generated device credential (both unpadded base64url). The S256 challenge is the verifier's SHA-256 digest, not another independent random value. Persist the pending verifier/id/credential before polling, and persist the credential before issuing redeem so a lost response is recoverable. Never reuse a credential for another session/device. The Worker independently generates Google OAuth state and a separate Google PKCE verifier. These are not the extension verifier.

Exact Origin checks are a browser cross-site defense, **not client authentication**: non-browser clients can spoof Origin. The initial `/v1/start` has no bearer requirement because no credential exists yet. Limits, short TTLs, proof-of-possession on redemption, Google consent, state and browser-cookie checks are still necessary. No API permits a caller to look up a token by Google email/subject.

## Deployment (publisher only)

1. Use Node **22.13+** (or Node 24). Run `npm test` in this directory. `node:sqlite` may print an experimental warning on Node 22. No dependencies, Google credentials or network are needed for tests.
2. Install the deploy CLI: `npm install`. Copy `wrangler.example.toml` to `wrangler.toml` and fill your D1 database ID, dedicated publisher domain, Google public Web client ID, and extension Origins. Create D1 with `npx wrangler d1 create pageclip-oauth`. Keep workers.dev/preview URLs disabled. Protect the Cloudflare account, D1 access and secret-management permissions.
3. Configure `PUBLIC_ORIGIN` as an **exact HTTPS origin with no trailing slash/path/query/credentials**, for example `https://oauth.publisher-domain.tld`. Configure a Cloudflare custom domain/route for that same origin. Blank/invalid config fails closed with 503. Do not launch the extension broker until a real domain is configured; placeholder URLs are not operational endpoints.
4. Create a Google OAuth client of type **Web application** in a publisher-owned Google project. Register exactly `PUBLIC_ORIGIN + /oauth/callback` as the authorized redirect URI; no wildcard, loopback or extension callback. Set up consent branding/privacy policy and Google's required publication/verification for your actual audience/scopes. Enable Google Drive API. Requested scopes are exactly `openid email https://www.googleapis.com/auth/drive.appdata`. No claim that Google has approved this project is implied. Google projects in **Testing** commonly issue refresh tokens expiring after **7 days** for these scopes; production status and Google policy/reauthorization limits still apply.
5. Set secrets using `npx wrangler secret put NAME`:
   - `GOOGLE_CLIENT_SECRET`: the Web client secret.
   - `TOKEN_ENCRYPTION_KEY`: base64 encoding of **32 random bytes**, independent of all other secrets (`node -e "console.log(require('node:crypto').randomBytes(32).toString('base64'))"`). Never derive it from client secret, bearer credential or password.
   - `RATE_LIMIT_SALT`: independent high-entropy random secret, at least 32 characters. Used for HMAC hashing temporary IP rate buckets, not token encryption.
   - Optional `TOKEN_ENCRYPTION_PREVIOUS_KEYS`: a JSON object mapping old key IDs to base64 keys; secret, not `[vars]`.
   Set public `TOKEN_ENCRYPTION_KEY_ID`, initially `k1`.
6. `ALLOWED_EXTENSION_ORIGINS` is a JSON array of exact publisher-controlled installed origins, for example `["chrome-extension://aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"]`. Replace the example ID. A Chromium extension origin has a 32-character `a`–`p` ID. Firefox `moz-extension://<uuid>` origins can vary by installation/profile; do not solve this by wildcarding the allowlist. Firefox release integration must provision a trustworthy exact origin or use a separately reviewed transport before claiming support.
7. Apply schema: `npx wrangler d1 migrations apply pageclip-oauth --remote`, then `npx wrangler deploy`. Enable the five-minute scheduled trigger and confirm it actually runs. No automatic external deployment is performed by this repository. D1 SQL uses prepared binds exclusively. Do not enable stale replica reads for this security service: use primary reads, or review/adapt with D1 Sessions consistency before enabling replication.
8. Configure Cloudflare WAF/edge limits on `/v1/*`, `/authorize`, and `/oauth/callback`, budget/traffic alerts, and operational monitoring that **does not record request bodies, Authorization, cookies, query strings or provider payloads**. This code has no application logging and example observability is disabled. Disable/redact URL query logging at every proxy/APM/Logpush layer: Google's callback necessarily has `code` and `state` in its query. Worker code cannot promise Cloudflare/Google/browser infrastructure never records those URLs. D1 backups/Time Travel can retain historical encrypted and identity rows: set access/retention policies accordingly and describe them in the publisher privacy notice.

### Origin policy and abuse controls

All API `POST`, `DELETE`, and preflight requests require an exact allowlisted **Origin**. Missing Origin, literal `null`, arbitrary HTTPS origins, prefixes/suffixes and wildcards are denied. No-Origin native clients are deliberately **not supported**. If your real extension browser/transport omits Origin, do not remove this check or forge it from untrusted input: test/review a new transport first. OAuth `/authorize` and `/oauth/callback` are browser top-level GET navigations, so they do not require extension Origin. CORS does not use credentials/cookies; the extension must not send Google/callback cookies to API routes. Only `Authorization` and `Content-Type` request headers are allowed in preflights.

D1 provides durable, atomic per-minute, per-route, per-IP limits: **10 starts**, **120 requests per other API route**, **30 authorize navigations**, **30 callbacks**. Cloudflare-provided `CF-Connecting-IP` is HMACed with the time window and salt; raw IP is not persisted. Outside Cloudflare missing IP shares a single `local-unknown` bucket. Buckets are deleted by cron. An optional `RATE_LIMITER` Cloudflare binding adds another control before D1. Fixed-window boundaries permit bursts; distributed IP abuse, cost exhaustion, NAT fairness, excessive invalid Origin traffic, and unbounded overall connections are not solved by these limits. Configure edge/WAF global limits/quotas before public deployment. No application-wide user signup/payment/business-data identity system is provided.

## HTTP contract

Every response has no-store, no-referrer, nosniff, restrictive CSP and HSTS headers. Errors are allowlisted JSON, never raw provider diagnostics:

```json
{"error":"refresh_busy","kind":"retry","retryAfter":2000}
```

`kind` is `auth`, `permission`, or `retry`. `retryAfter`, when supplied, is **milliseconds**; the HTTP `Retry-After` is rounded-up **seconds**. Respect it and back off with jitter. 401 includes `WWW-Authenticate: Bearer`. 401 auth errors mean stop using access and reauthorize/revoke as appropriate; do not discard the stored credential before retrying pending disconnection. 403 permission/account failures require user action. 409 `pending`, 429 and 503 are not permission to loop quickly. Unexpected internal/provider errors map to generic retry errors. APIs reject unknown fields, queries, non-JSON bodies and bodies over **2048 bytes**. Provider requests and body reads have an **8-second timeout**, 64 KiB response cap and no redirects. Access-token expiry is a millisecond Unix epoch.

### `POST /v1/start`

```json
{"challenge":"<S256 base64url digest of 32-byte verifier>","account":"optional-expected@example.com"}
```

Returns 200:

```json
{"id":"<opaque session id>","authorizeUrl":"https://publisher/authorize?id=...","expiresAt":1730000000000}
```

Session TTL is **10 minutes**. `account` is an expected **email**, not a Google subject. It is only a login hint at Google, but a mandatory verified-email equality check (case-normalized) before the session is ready. The Worker cannot verify how much entropy a supplied challenge originally had; the extension must generate the verifier correctly.

For explicit reauthorization of an existing connection, send its current `Authorization: Bearer <credential>` on `/v1/start`. The Worker binds the flow to that connection's actual stored subject and verified email, including when the old connection is auth-blocked; a supplied conflicting `account` is rejected. Redeem with a **new** independent credential. Only after successful verified redemption does the same D1 transaction remove the previous connection and its old redemption session, **without** revoking the shared Google grant. Failed/new pending flows leave the prior connection intact. An unrecognized supplied bearer fails 401; do not silently retry as an unauthenticated account replacement.

Open `authorizeUrl` as a trusted, direct user-initiated top-level navigation. Never render arbitrary provider markup or share this URL. `/authorize` atomically transitions the session once, sets a session-specific `__Host-` Secure/HttpOnly/SameSite=Lax cookie containing a random browser proof, then redirects to Google with state and S256 PKCE. The callback must present both matching state and browser proof. The Worker atomically claims state **before exchange**, exchanges once with the Web secret plus its PKCE verifier, checks granted scopes, and calls Google's authenticated OpenID userinfo endpoint. It requires actual nonempty `sub`, `email_verified === true`, verified email and any expected-email match. It does not trust a submitted email, decode an unverified ID token, or expose a token introspection endpoint. The initial token response must supply sufficient scopes; refresh scope omission retains the previous verified grant scopes. Google `email` and `userinfo.email` scope aliases are accepted.

Cookie binding prevents accepting a callback in an unrelated browser cookie context. It is **not** proof that the browser user owns the extension verifier, and does not prevent someone deliberately opening/sharing a whole attacker-created authorize URL. Keep the user-initiated flow and trusted extension UI; do not claim universal login-CSRF/link-sharing prevention. Browser cookie/storage restrictions can break the flow; a failed callback means start a fresh session, not reuse a state/code. A crash after claiming state also requires a new flow; at-most-once exchange is preferred over unsafe code replay.

Callback completion is static HTML saying **return to PageClip**, no scripts, links, tokens or automatic redirect. The extension polls with its redemption proof; no redirect interception is needed.

### `POST /v1/redeem`

```json
{"id":"<id>","verifier":"<original random 32 bytes as base64url>","credential":"<independent random 32-byte device credential as base64url>"}
```

While pending: 409 `{ "error":"pending", "kind":"retry", "retryAfter":2000 }`. Missing/wrong/expired proof: 401 `invalid_redemption`, without consuming or disclosing session status. Successful result is 200:

```json
{"accessToken":"<Google access token>","expiresAt":1730000000000,"email":"verified@example.com","subject":"Google sub"}
```

**No credential field is returned**: the extension already generated and stored it. A transaction inserts one connection and consumes the ready session, with unique credential hash and unique source session. A different credential cannot redeem an already-redeemed session. Retrying the **same id + verifier + credential** is idempotent until the original session expiry and recovers a lost response, returning the same connection's current usable access token (possibly refreshed), not creating a duplicate connection. This is one logical consume, not a promise that identical response bytes remain available after refresh/revocation. Session encryption blobs are removed on redemption. If the receipt expires after a lost response, retain the candidate credential and recover through `/v1/token`; never discard it solely because the receipt expired. Credentials are SHA-256 hashed in D1; no plaintext broker bearer is stored. High entropy is required: hashing is not a substitute for it.

### `POST /v1/token`

`Authorization: Bearer <credential>`; JSON `{}` or `{"force":true}`. Returns the same four token/identity fields as redeem. `force` requests a Google access-token refresh; it does **not** invalidate or discard the refresh token. Cached access is returned only if more than 60 seconds remain and the connection is not leased/revoking. All token refreshes use a D1 compare-and-swap lease (60 seconds) with owner fencing and version checks; concurrent holders get 503 `refresh_busy` and must retry later. There is no cross-isolate in-memory lock.

Every refreshed token's authenticated userinfo must still match the stored subject **and** email; identity changes require a new explicit connection. Google refresh-token rotation is encrypted and saved before identity lookup; omitted refresh tokens retain the prior token. Access is withheld until verification succeeds. Permanent auth/identity errors mark the connection **blocked**, deny further access and preserve token material for explicit deletion or authenticated replacement; they do **not** automatically revoke a grant or schedule grant-wide revocation (which could otherwise destroy a newer grant). Transient failure allows retry. Account email changes deliberately fail closed.

Leases outlast bounded upstream operations; crash/lease expiry permits retry. No system can guarantee exactly-once external refresh across process death after Google rotates a token but before D1 receives the result. Such a crash can require reauthorization. Secrets/SQL durability do not create a distributed transaction with Google.

### `DELETE /v1/connection`

`Authorization: Bearer <credential>`; no body or `{}`. Because Google revocation is grant-wide, it first marks **all stored device connections for that Google subject revoking** so further token/redeem requests cannot get access. An account-level D1 compare-and-swap lock waits for every existing per-device refresh lease, then posts the Google refresh token to Google's revocation endpoint **before** deleting all known same-subject connection and associated personal/session rows. Successful provider revocation is durably marked before deletion so a failed D1 delete can retry without losing that outcome. 204 means done. A network/provider failure or active refresh returns retryable 503 and **retains encrypted token material and the credential hash** with access denied. Retry using the same credential; cron also retries up to ten revoking connections per tick. Only a successful revocation or Google's exact 400 `invalid_token` response is treated as terminal; arbitrary 400/401 errors are not deletion permission. After successful deletion a repeat returns 401, not 204; callers may treat that as already absent.

This API therefore deletes **every known broker device connection for the same Google subject** after revocation, and intentionally rejects `{all:true}` because it already has account-grant semantics. The extension should warn users that disconnect affects all linked devices for that Google account. Unknown/anonymous OAuth flows still in flight and other independently configured publisher clients cannot be enumerated; grant revocation is not a transaction with Google. Those clients subsequently receive auth errors if Google invalidates their grant. It does not sign the user out of Google or delete their Google account/Drive files. No business data is held here. An already-issued Google access token held by another process cannot be clawed back by local row deletion alone; Google's revocation behavior determines its remaining usefulness. Pending in-flight operations may already have returned access before revoking was marked.

### `POST /v1/cancel`

JSON `{"id":"<pending session id>","verifier":"<original redemption verifier>"}` cancels an **unredeemed** flow. Requires the same Origin/proof policy as redeem, checks proof before mutation, and never accepts credential-only/email-based session lookup. Before code exchange it prevents claim and deletes the session; if a callback is processing, 503 `cancellation_pending` marks durable cancellation and retry waits for that callback. If encrypted provider tokens already exist, it revokes them before deleting the session. Retain pending proof until 204 or 401 absent; 409 `already_redeemed` means use DELETE with the credential. Explicit cancellations with revocation failure are retained with access denied and retried by cron; they are not silently expired. Cancellation/revocation can affect other devices through Google's grant-wide behavior.

## Storage, encryption and retention

- `sessions`: challenge, hashed state, hashed temporary browser cookie proof, encrypted PKCE verifier/state and encrypted transient provider tokens, expected/verified identity and timestamps. Ready/failed/unredeemed flows and their encrypted secrets expire after 10 minutes and cron deletes them (actual physical deletion can lag until the next successful cron). Redeemed session proof/credential hash remains only until that expiry to recover a lost response. Explicit cancellation material stays until revocation succeeds. Ordinary abandoned transient grants are **not** automatically revoked: revoking a Google grant could disconnect an existing device. Their encrypted material is deleted, not retained indefinitely.
- `connections`: one row per random **device credential**, never global uniqueness by email. Verified subject/email in plaintext for routing/identity checks, AES-GCM encrypted access + refresh + granted scopes + access expiry, hash of credential and lease/revocation/blocked metadata. `grant_revocations` stores subject and an account-level revocation lease until deletion succeeds. Connections persist until explicit revocation/deletion; no business content is stored. D1 access exposes identity metadata; encryption does not hide all personal data.
- `rate_limits`: HMACed IP/window/route bucket and count only, expired/cleaned by cron. No raw IP or Google provider errors are stored.

Encryption envelope is JSON `{v:1,kid,iv,data}` using AES-256-GCM, independent random 96-bit IV on every write, and authenticated additional data `pageclip:v1:<record-context>`. Context includes session ID/purpose or hashed connection credential, preventing ciphertext swap across rows/purposes. All encrypted writes use the current key ID; reads accept current plus explicitly provisioned old keys. PKCE secrets, access tokens and refresh tokens are encrypted, including transient session material. Client secret itself is never stored in D1.

**Key rotation:** generate a new independent 32-byte key; retain the old key under its original ID in `TOKEN_ENCRYPTION_PREVIOUS_KEYS`; deploy the new `TOKEN_ENCRYPTION_KEY` and a new unique ID together. Every normal refresh rewrites the connection with the new key; new sessions also use it. There is no built-in full-table re-encryption job. Before removing an old key, run an audited administrative migration using the same `open`/`seal` record context (primary D1 access), and verify **every live encrypted session and connection envelope** no longer names it. Keep keys needed for explicitly pending revocations and for required backups/restore policy. Changing the current key without retaining the old key causes fail-closed 503 and prevents revocation of those records. Rotating a Google client secret is separate from the AES key; do not lose the Web client identity that owns refresh tokens.

## Tests and acceptance limits

```sh
cd oauth-worker
npm test
# equivalent: node --test test/*.test.js
```

The tests execute production Worker handlers, Web Crypto AES-GCM, and the actual migration/prepared SQL against real `node:sqlite`, including transactional batches. Google fetch is intercepted; they do not contact Google or deploy Cloudflare resources. Coverage includes callback state/cookie replay and worker PKCE, redemption proof and atomic/idempotent consumption/collisions, encryption tampering/AAD/key rotation, verified-email/account/scope enforcement, refresh caching/rotation/leases/identity consistency, revocation failure/race/retry, strict Origin/CORS, rate limits/401, body limits, fail-closed config, expiry/cron and cancellation.

Before release, perform a separate deployed HTTPS custom-domain smoke test against real D1/Worker isolates and Google test accounts: correct redirect URI, cookie handling in each supported browser, secret configuration, consent scope response, refresh rotation/expiry, account mismatch, dropped redeem response, concurrent refresh, offline revocation/retry, scheduled cleanup, log redaction, and Google consent publication. Passing offline tests does **not** prove deployed/browser/Google compatibility or compliance. No external live-account test has been performed by this implementation.
