# ContentPilot Studio — 30-step completion tracker

This is the working release tracker reconstructed from the current application code, migrations, deployment notes and pre-launch review. It is not a claim that every step is complete. Status is intentionally conservative.

Legend:
- [x] Implemented in the repository or verified by the recorded CI run.
- [ ] Not complete, not verified, or blocked by an external owner/provider action.

## A. Repository and application readiness

- [x] 1. Separate the static frontend from the Worker API.
- [x] 2. Configure the intended public hostnames in application configuration: `contentpilot.ir` and `api.contentpilot.ir`.
- [x] 3. Add the GitHub Pages `CNAME` file.
- [x] 4. Add canonical, Open Graph, sitemap and robots metadata for the intended domain.
- [x] 5. Restrict browser CORS to the apex and www frontend origins.
- [x] 6. Enforce POST/JSON API boundaries and reject malformed or oversized request bodies.
- [x] 7. Validate generated image signatures before returning image data.
- [x] 8. Hash passwords with PBKDF2-SHA-256 and unique salts; store only hashed session tokens.
- [x] 9. Add per-IP and per-account authentication rate limits.
- [x] 10. Add durable generation reservations and guarded completion/refund state transitions.
- [x] 11. Keep paid top-ups disabled until a verified payment flow exists.
- [x] 12. Add keyboard navigation, accessible form names, visible focus and safer DOM rendering.

## B. Verification and database

- [x] 13. Add automated frontend/Worker syntax and static validation.
- [x] 14. Add Worker request-boundary and mocked account/quota tests.
- [x] 15. Add SQLite migration-schema tests.
- [ ] 16. Verify the actual production D1 database identity, schema and existing data.
- [ ] 17. Take a recoverable D1 backup and prove the restore procedure in a safe environment.
- [ ] 18. Review and apply migrations 0001 and 0002 to the intended D1 environment.
- [ ] 19. Run integration tests against real D1, including concurrent quota reservations, duplicate refunds and failure recovery.
- [ ] 20. Test registration, login, logout, session expiry, text generation and image generation end-to-end with a disposable account.

## C. Account lifecycle, privacy and operations

- [ ] 21. Implement email ownership verification with expiring, single-use verification tokens and a configured delivery provider.
- [ ] 22. Implement secure password reset with expiring, single-use tokens and abuse controls.
- [ ] 23. Verify the complete account/data inventory and define retention rules for financial, security, session and backup records.
- [ ] 24. Implement account deletion and user data export/correction only after the schema and retention rules are approved.
- [ ] 25. Complete the privacy notice with the operator identity, contact, providers, retention and jurisdiction-specific review.
- [ ] 26. Decide whether drafts and calendar remain browser-local or become account-synced; document the chosen behavior.
- [ ] 27. Configure production logs, monitoring, alerting, incident contact and an operational runbook.
- [x] 28a. Add and test baseline security headers on Worker API responses (`nosniff`, frame denial, strict referrer policy and restrictive device permissions).
- [ ] 28b. Configure and verify appropriate response security headers for the static frontend at the CDN/edge; a static HTML meta tag is not a substitute for HTTP headers.

## D. Domain and launch

- [ ] 29. Activate the Cloudflare zone using the exact nameservers assigned to this domain, then configure GitHub Pages DNS and the Worker custom domain on `api.contentpilot.ir`; verify HTTPS and both hosts.
- [ ] 30. Complete mobile/desktop/browser checks and an independent security review. Keep payments disabled unless a provider integration with signature verification, replay protection, idempotent fulfillment and refund tests has separately passed.

## Current evidence and blockers

- The recorded GitHub Actions run validates JavaScript, runs 31 Node.js tests with mocked D1 and five SQLite migration tests. It does not prove live Cloudflare D1 behavior or production availability.
- The current PR is still open and unmerged. Review and merge are release-owner decisions, not assumed completed by this tracker.
- Production D1 migrations, Worker deployment, DNS/nameserver changes and public launch are intentionally not performed by this tracker.
- Email verification/password reset require a delivery provider and secrets. Do not add credentials to source control or chat.
- Account deletion remains blocked until the actual D1 schema and legal/financial retention requirements are confirmed.
- Payment integration requires the owner's choice of a provider and merchant credentials; checkout remains inactive.
- Domain activation requires the domain owner to approve the exact Cloudflare nameserver delegation at the registrar.

## Safe execution order

1. Finish repository-only code, tests and documentation.
2. Review the PR and merge only after the owner approves.
3. Verify D1 identity and backups, then apply migrations and run live integration tests.
4. Deploy the Worker only after its database prerequisites pass.
5. Activate nameservers and DNS, then verify HTTPS and API routing.
6. Complete account lifecycle, privacy and operational controls.
7. Run the final browser/security review. Announce launch only when every applicable release gate is verified.
