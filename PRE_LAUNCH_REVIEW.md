# ContentPilot pre-launch technical review

This review is based on static inspection of the repository. It is not a live penetration test and does not prove that production services are healthy.

## Confirmed in the repository

- The frontend is a static single-page app; the Cloudflare Worker is a separate API.
- The frontend stores its session bearer token in `sessionStorage`.
- Passwords are derived with PBKDF2-SHA-256 and per-user random salts.
- Session tokens are random values; only SHA-256 hashes are stored in D1.
- Registration and login have per-IP and per-account rate limits. Their hashed counters are provisioned by `migrations/0002_auth_rate_limits.sql`; expiry cleanup runs hourly through the Worker scheduled handler, not on the authentication request path.
- Text and image generation require an authenticated session.
- The Worker handles CORS preflight before its POST-only method guard.
- The Worker validates JSON request bodies before checking service bindings, requires POST, and enforces a 16 KiB limit while reading the actual request stream; it also rejects requests whose declared Content-Length exceeds the limit before reading.
- Generated image responses identify PNG/JPEG/WebP from the returned byte signature rather than assuming JPEG.
- Browser CORS is restricted to the intended apex and www frontend origins; CORS is not treated as authentication.
- Authentication rate-limit storage is managed by `migrations/0002_auth_rate_limits.sql`, including an index for hourly expiry cleanup. The Worker cron is configured for minute 17 of each hour; this migration has not been applied to production D1.
- Free and paid generation reservations now create durable `generation_reservations` rows in the same D1 batch as quota reservation or wallet debit; completion and refund use conditional state transitions so only a still-reserved operation can be finalized or refunded. A migration is committed, but it has not been applied to the production D1 database or verified with live D1 concurrency tests.
- Payment buttons are visibly inactive; the Worker has no payment/top-up endpoint.
- Drafts and the content calendar are stored in browser `localStorage`, not synced to an account.
- The empty-output placeholder is assembled with DOM APIs and `textContent` rather than an HTML string sink; a restrictive cross-origin referrer policy is declared in the document.
- Keyboard users now have a localized skip-to-main-content link, visible focus states and a focusable main landmark; account email/password inputs have programmatic labels. Static validation checks that every input, select and textarea has an accessible name.

## Required before public launch

### Domain and deployment
- Obtain IRNIC approval and confirm the domain is active.
- Use only the exact nameservers Cloudflare assigns to this zone.
- Keep the apex domain for the GitHub Pages frontend.
- Configure the Worker only on `api.contentpilot.ir`.
- Configure GitHub Pages DNS records and verify HTTPS.
- Confirm both custom domains resolve before switching the frontend to production use.
- Confirm GitHub Pages custom domain and HTTPS settings after the CNAME file is merged.

### Functional verification
- Test registration, login, logout and session expiry with a disposable test account.
- Test the `me` endpoint and account quota display.
- Test text generation in Persian and English, plus another supported language.
- Test image generation for PNG/JPEG/WebP response types and validate generated image downloads.
- Verify oversized and non-JSON API requests are rejected without consuming quota.
- Confirm failed AI calls refund quota/credits correctly.
- Test simultaneous requests at the free-quota boundary.
- Test on current desktop and mobile browsers.
- Verify allowed-origin preflight and rejection of an unapproved browser Origin after the Worker custom domain is configured.

### Account lifecycle and privacy
- Implement email verification before treating email ownership as confirmed.
- Implement a secure password-reset flow with expiring, single-use tokens.
- Review and complete `PRIVACY_NOTICE_DRAFT.md`; it is an evidence-based draft, not a published legal policy.
- Publish accurate privacy and retention terms, including the browser-local nature of drafts/calendar.
- Provide a support contact and account/data deletion process.
- Decide whether drafts and calendar should remain device-local or become account-synced.

### Payments
- Keep payments disabled.
- Choose a supported payment provider.
- Implement server-side signature verification, replay protection and idempotent credit fulfillment.
- Test success, failure, cancellation, duplicate callbacks and refund paths before enabling purchases.

### Operations
- Confirm D1 backup/restore procedures.
- Enable and review Worker logs/traces with appropriate privacy controls.
- Add production monitoring and an incident contact.
- Keep the Worker deployment workflow manual until a tested release process is agreed.
- Run the repository validation workflow and confirm a green result before merging.

## Additional security review notes

- Static inspection found the placeholder renderer was the only `innerHTML` write in the frontend. It has been replaced with DOM node creation and `textContent`, and repository validation now rejects reintroducing an `innerHTML` sink.
- The document now declares `strict-origin-when-cross-origin` as its referrer policy.
- GitHub Pages does not provide repository-controlled arbitrary HTTP response headers through a static HTML file. A meta tag cannot replace response headers such as Content-Security-Policy, frame-ancestors, X-Content-Type-Options, Permissions-Policy or HSTS. Configure and verify these at a suitable CDN/edge layer after the domain is approved; do not claim they are active yet.
- The bearer token remains accessible to same-origin JavaScript because it is held in `sessionStorage`. Moving it to an HttpOnly cookie requires a deliberate CSRF/CORS/session architecture change and should not be improvised in this readiness PR.
- Generation refunds now use a durable per-reservation ID and conditional `reserved` → `refunded` transition. Successful generation changes the state to `consumed`. The migrations are `migrations/0001_generation_reservations.sql` and `migrations/0002_auth_rate_limits.sql`; both must be applied to the correct D1 database before deploying this Worker. The new tests inspect the state-transition SQL and mocked D1 results only. Live D1 semantics, concurrent duplicate refunds, crash recovery and backup/restore remain unverified, so keep purchases disabled until those checks pass.
## Not verified by this review

- Live site availability, live DNS, nameserver activation or SSL issuance.
- Production D1 schema integrity or backup status.
- Actual AI model availability, latency, quotas or output quality.
- End-to-end account flows or payment-provider behavior.
- A penetration test or independent security audit.

### Automated Worker boundary tests
- Added 29 Node.js built-in tests for allowed apex/www CORS preflight, rejected unapproved origins, POST-only method enforcement, JSON content-type enforcement, declared and actual streamed-body size limits, malformed JSON rejection, fail-closed behavior without service bindings, transactional credit-debit/ledger SQL statements (including the no-credit case), registration with a mocked D1 binding but no Workers AI binding, free-quota reservation plus durable reservation insertion, paid-credit fallback after the daily limit, free/paid guarded generation refunds, one-time generation completion, duplicate-refund rejection, unknown-account login rejection, login rate limiting, successful login/session creation, logout token-hash deletion, authenticated `me`, and wrong-password rejection.
- The validation GitHub Actions workflow runs these tests after the static validator, which also checks keyboard skip navigation, localized account labels and accessible names for every form control.
- These tests use mocked D1 and no live Cloudflare services. Registration verifies the Worker request path and SQL call sequence against a mock, not durable persistence. Credit tests inspect D1 batch statements and mocked result metadata; they do not prove live D1 transaction behavior, login persistence, full quota/refund concurrency, AI calls or production behavior. Generation reservation and refund tests inspect mocked SQL statements and mocked result metadata; they do not prove concurrent behavior or idempotent refunds against live D1. Authentication tests now exercise mocked successful login/session creation, logout token-hash deletion, authenticated `me`, wrong-password and unknown-account rejection, and rate limiting. These remain mocked tests and do not establish live D1 persistence or integration behavior. Account actions (register/login/logout/me) no longer require the Workers AI binding; only generation actions require it.

## Release gate

Do not announce a public launch, enable payments, or treat the custom domain as operational until all required domain, functional, account-lifecycle and operational checks above have been completed.
