# soyonagasaki.com OAuth deployment record

Deployment performed 2026-10-21 using publisher-authenticated Cloudflare and Google Cloud dashboards through Ego.

## Active resources

- Public service: https://oauth.soyonagasaki.com
- Exact Google callback: https://oauth.soyonagasaki.com/oauth/callback
- Cloudflare Worker: `pageclip-oauth`
- D1: `pageclip-oauth`, ID `b021f395-4387-46b0-85c7-a994431df8b9`; initial SQL applied; read replication disabled.
- Cron configured: `*/5 * * * *`. Execution of a scheduled cleanup tick has not yet been verified.
- workers.dev and preview subdomains verified disabled.
- Observability disabled in deployment metadata.
- Worker Secrets configured: `GOOGLE_CLIENT_SECRET`, independent random `TOKEN_ENCRYPTION_KEY`, independent random `RATE_LIMIT_SALT`. Values were not printed or written to repository files.
- Google project `pageclip-backup`, existing Web client `PageClip-Web`; public client ID recorded in `oauth-worker/wrangler.toml`.
- New callback added; pre-existing callback preserved. Added an additional client secret, preserving the existing secret to avoid breaking other consumers. Old secret cleanup requires identifying its consumers first.
- Google audience page currently shows External / Production. This is not evidence of Google verification approval.
- Allowed Origin: `chrome-extension://mnapcpmijebakicgdflohgnjmndhlneg` only. Other extension IDs and Firefox origins are not enabled.
- Extension configured using `node scripts/configure-worker-auth.mjs https://oauth.soyonagasaki.com` and reloaded in Ego.

## Actual checks

- Custom HTTPS domain serves deployed Worker. Root returns intentional JSON 404 (`not_found`); root is not an OAuth start page.
- Cloudflare API verified custom domain enabled, three secret binding names, cron schedule, and workers.dev/preview disabled.
- Live HTTP `/v1/start`: 200; expected CORS allow-origin. `/v1/cancel`: 204. Untrusted Origin: 403. This test used synthetic Origin from Node and is not browser authentication evidence.
- Real Ego extension backup-card Connect action successfully created a broker session and opened Google's account chooser with Web client, HTTPS callback, Authorization Code, offline access, state and S256 PKCE.
- Browser space handed to user at account chooser. No account selected by agent, no Google consent submitted, no actual callback exchange or refresh token obtained/validated yet. No synchronization enabled and no backup uploaded by this check.

## Runtime incident: token exchange

The first real Google callback passed state/cookie validation but failed with `provider_transport`, without storing tokens. Production used `fetch(..., {redirect:'error'})`; workerd does not support that redirect mode. Updated provider calls to `redirect:'manual'` and explicitly reject 3xx before parsing, preventing credential forwarding. Also added explicit form Content-Type on authorization-code exchange and safe error classifications, without recording raw provider errors. Deployed updated source while preserving existing Secret bindings.

Actual deployed verification after the fix: an independent synthetic session with a deliberately invalid test code reached Google's token endpoint and returned the mapped `reauthorization_required` response (Google invalid_grant), replacing the transport failure. The user's real callback code was never replayed. Worker tests now 17/17, including asserting workerd-compatible redirect mode and rejecting provider redirects. This does not yet prove successful exchange/refresh with a real authorization grant. Failed no-token handshake cleared and fresh authorization opened for the user.

## Still required

Select intended Google account and complete consent in the open Ego tab. Return to PageClip and verify broker redemption, account binding, D1 encrypted refresh-token presence (without printing plaintext), and force refresh through the extension. If session expires, reconnect from the backup card. Verify scheduled cleanup, Google Drive API access, WAF/global abuse controls and operational quota alerts. Do not claim Brave, Edge or Firefox authorization verification from Ego results. Review publisher privacy notice for server-side identity and encrypted credential retention before public launch.

Wrangler CLI acquisition timed out in this environment; deployment used authenticated dashboard API instead. `wrangler.toml` records public configuration for subsequent publisher CLI deployments. Preserve encryption keys already stored in Cloudflare; do not regenerate on redeploy or overwrite existing secret bindings.
