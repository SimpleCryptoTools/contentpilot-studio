# ContentPilot pre-launch technical review

This review is based on static inspection of the repository. It is not a live penetration test and does not prove that production services are healthy.

## Confirmed in the repository

- The frontend is a static single-page app; the Cloudflare Worker is a separate API.
- The frontend stores its session bearer token in `sessionStorage`.
- Passwords are derived with PBKDF2-SHA-256 and per-user random salts.
- Session tokens are random values; only SHA-256 hashes are stored in D1.
- Registration and login have per-IP and per-account rate limits.
- Text and image generation require an authenticated session.
- The Worker handles CORS preflight before its POST-only method guard.
- The Worker validates JSON request bodies before checking service bindings, requires POST, and enforces a 16 KiB limit while reading the actual request stream; it also rejects requests whose declared Content-Length exceeds the limit before reading.
- Generated image responses identify PNG/JPEG/WebP from the returned byte signature rather than assuming JPEG.
- Browser CORS is restricted to the intended apex and www frontend origins; CORS is not treated as authentication.
- Free usage and paid-credit reservations are enforced server-side.
- Payment buttons are visibly inactive; the Worker has no payment/top-up endpoint.
- Drafts and the content calendar are stored in browser `localStorage`, not synced to an account.

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

## Not verified by this review

- Live site availability, live DNS, nameserver activation or SSL issuance.
- Production D1 schema integrity or backup status.
- Actual AI model availability, latency, quotas or output quality.
- End-to-end account flows or payment-provider behavior.
- A penetration test or independent security audit.

### Automated Worker boundary tests
- Added Node.js built-in test coverage for allowed apex/www CORS preflight, rejected unapproved origins, POST-only method enforcement, JSON content-type enforcement, the declared Content-Length guard, actual streamed-body size enforcement without a Content-Length header, malformed JSON rejection, and fail-closed behavior when D1/Workers AI bindings are missing.
- The validation GitHub Actions workflow now runs these tests after the static validator.
- These tests exercise the Worker request boundary with no live D1 or Workers AI bindings; they do not test registration/login persistence, quota accounting, refunds, AI calls or production behavior.

## Release gate

Do not announce a public launch, enable payments, or treat the custom domain as operational until all required domain, functional, account-lifecycle and operational checks above have been completed.
