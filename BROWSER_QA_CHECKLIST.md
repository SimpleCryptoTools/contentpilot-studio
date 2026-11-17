# Desktop and mobile browser QA checklist

## Test boundaries

Manual QA must use a staging frontend, staging Worker and isolated staging D1 with disposable accounts. Do not run destructive, quota-consuming or account-lifecycle tests against production users. Record browser version, OS, viewport, staging commit and date.

## Browser/viewport matrix

- Chromium desktop: current stable, 1280×800 and 1920×1080.
- Firefox desktop: current stable, 1280×800.
- Safari macOS: current supported version, 1280×800.
- iOS Safari: current supported iPhone viewport.
- Android Chrome: current supported Android viewport.
- Narrow layout: 320–375 CSS px; tablet: 768 CSS px.

Record unavailable platforms explicitly rather than implying they were tested.

## Functional scenarios

- [ ] First visit, language selection and persistence.
- [ ] Register with valid, invalid and duplicate email; validate useful error messages.
- [ ] Login, refresh, authenticated account snapshot and logout.
- [ ] Expired/invalid session handling and cleared browser session storage.
- [ ] Persian RTL and English LTR across navigation, forms, outputs and error messages.
- [ ] Generate text in Persian and English; inspect empty/error/success states.
- [ ] Generate each supported image aspect/type; verify preview, MIME and download.
- [ ] Free quota boundary, paid-credit fallback only in a non-payment test fixture, failed-generation refund.
- [ ] Oversized, malformed JSON, wrong content type, unsupported method and rejected Origin.
- [ ] Browser-local draft/calendar save, reload, edit, delete and clear-site-data warning.
- [ ] Payment UI remains inactive and no checkout/top-up endpoint is exposed.

## Accessibility and layout

- [ ] Complete all account and generation flows using keyboard only.
- [ ] Visible focus, skip link, logical tab order and no keyboard traps.
- [ ] Screen-reader labels, status/error announcements and meaningful button names.
- [ ] Text zoom at 200% without lost controls or horizontal page overflow.
- [ ] Reduced-motion preference respected.
- [ ] Contrast and focus indicators remain visible in all themes/states.
- [ ] Touch targets and virtual keyboard do not obscure form actions.

## Evidence and sign-off

For every failure, record reproducible steps, expected/actual result, browser/version, viewport and a screenshot with personal data removed. Track severity and owner. A checklist is not evidence of completion: mark a scenario passed only after it has been executed on the named browser/device. Step 30 also requires an independent security review; this manual checklist does not replace it.
