# Static frontend edge security headers

## Current state

The static frontend is configured for GitHub Pages. GitHub Pages does not let this repository set arbitrary HTTP response headers with a file in the repository. HTML meta tags do not replace response headers, and a Cloudflare zone that is still pending nameserver delegation does not prove that Cloudflare currently serves the frontend.

This document is a deployment specification only. No headers are claimed active and no DNS/edge setting is changed.

## Desired response policy

After the owner chooses and activates a CDN/edge layer that actually serves the static frontend, configure and verify:

- `X-Content-Type-Options: nosniff`
- `X-Frame-Options: DENY`
- `Referrer-Policy: strict-origin-when-cross-origin`
- `Permissions-Policy: camera=(), microphone=(), geolocation=()`
- `Content-Security-Policy` tailored to the actual script/style/font/image/connect sources.
- `Strict-Transport-Security` only after HTTPS is stable for every included hostname and the owner approves its scope; do not add `includeSubDomains` or preload casually.

## CSP compatibility warning

The current single-page application includes inline JavaScript and inline CSS. A strict CSP that omits `unsafe-inline` will break those assets unless they are first moved to external files or protected with per-response nonces/hashes. Do not copy a generic CSP from an example into production. Inventory all script, style, image, font, connect and worker sources, then test in report-only mode before enforcement.

The `frame-ancestors` directive must be delivered as an HTTP CSP response header; it is not supported in a CSP meta element. Keep `X-Frame-Options: DENY` as a compatible fallback.

## Verification checklist

1. Confirm the selected edge provider is authoritative for the frontend hostname.
2. Configure headers in a preview/staging zone or non-production route first.
3. Fetch the actual HTML response and inspect response headers (not only the document source).
4. Test account registration/login, API calls, AI output, image preview/download, localization and static assets under the policy.
5. Review browser console CSP reports and remove accidental third-party dependencies.
6. Enforce only after the owner approves and staging passes.
7. Recheck apex and www separately and save sanitized response-header evidence.

Do not mark tracker step 28b complete until the real frontend responses show the approved headers over HTTPS.
