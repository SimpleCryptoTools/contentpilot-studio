# ContentPilot custom-domain setup

This project has two separate services:

- Public frontend: GitHub Pages at https://contentpilot.ir/
- AI/API backend: Cloudflare Worker at https://api.contentpilot.ir/

Do not attach the apex domain `contentpilot.ir` to the Worker. Doing so would route the public website to the API instead of GitHub Pages.

## GitHub Pages

1. The repository `CNAME` file sets the GitHub Pages custom domain to `contentpilot.ir`.
2. In GitHub, open the repository Settings → Pages and confirm the custom domain is `contentpilot.ir`.
3. Enable Enforce HTTPS only after GitHub reports the certificate is ready.

## Cloudflare

1. Add `contentpilot.ir` as a zone and use the Free plan.
2. Wait until the registrar (IRNIC) has approved/activated the domain before changing its nameservers.
3. At IRNIC, set the exact two nameservers assigned by Cloudflare to this zone. Do not copy nameservers from another zone.
4. Once the zone is Active, configure the apex and `www` DNS records for GitHub Pages using GitHub's current official instructions. Keep those website records DNS-only initially; verify the site and TLS before considering proxying.
5. In Workers & Pages → `contentpilot-ai` → Settings/Triggers → Domains & Routes, add the Worker custom domain `api.contentpilot.ir` (not `contentpilot.ir`).
6. Confirm the Worker domain is active and the API responds to an OPTIONS preflight and authenticated POST requests.

## Verification before launch

- Open `https://contentpilot.ir/` and confirm the frontend loads.
- Confirm the browser sends API requests to `https://api.contentpilot.ir/`.
- Test registration, login, text generation and image generation with a non-production test account.
- Confirm the D1 binding is still `DB` and Workers AI binding is still `AI`.
- Do not enable paid top-ups until a signed, idempotent payment callback has been implemented and tested.

## Important

The domain was still pending IRNIC approval at the time this guide was prepared. Until IRNIC approves it and Cloudflare provides active nameservers, do not change nameservers or assume DNS is live.
