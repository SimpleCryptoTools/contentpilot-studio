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
2. IRNIC currently shows `contentpilot.ir` as **registered** (expiry 2027-11-15). Its DNS column still shows **unavailable**, so the domain is registered but no nameservers are assigned at IRNIC yet. Add the zone in Cloudflare and wait for Cloudflare to assign the two nameservers; do not guess or reuse nameservers from another zone.
3. At IRNIC, set the exact two nameservers assigned by Cloudflare to this zone. Do not copy nameservers from another zone.
4. After the zone is Active, add the GitHub Pages records below. Keep all website records DNS-only (grey cloud) during initial verification.

   | Type | Name | Target |
   | --- | --- | --- |
   | A | @ | 185.199.108.153 |
   | A | @ | 185.199.109.153 |
   | A | @ | 185.199.110.153 |
   | A | @ | 185.199.111.153 |
   | CNAME | www | simplecryptotools.github.io |

   Do not add wildcard records. Do not create an `api` record pointing to GitHub Pages; the API hostname belongs to the Worker. GitHub's official Pages guidance lists these apex addresses and recommends a `www` CNAME pointing to the account's .github.io host.
5. In Workers & Pages → `contentpilot-ai` → Settings/Triggers → Domains & Routes, add the Worker custom domain `api.contentpilot.ir` (not `contentpilot.ir`).
6. Confirm the Worker domain is active and the API responds to an OPTIONS preflight and authenticated POST requests.

## Verification before launch

- Open `https://contentpilot.ir/` and confirm the frontend loads.
- Confirm the browser sends API requests to `https://api.contentpilot.ir/`.
- Test registration, login, text generation and image generation with a non-production test account.
- Confirm the D1 binding is still `DB` and Workers AI binding is still `AI`.
- Do not enable paid top-ups until a signed, idempotent payment callback has been implemented and tested.

## Important

The domain is now registered at IRNIC, but the IRNIC DNS column is still unavailable. Nameserver assignment and DNS activation are not confirmed. Do not change nameservers until the exact pair shown in this domain's Cloudflare zone is available, and do not assume DNS or HTTPS is live.


## Official references

- GitHub Pages custom-domain DNS records: https://docs.github.com/en/pages/configuring-a-custom-domain-for-your-github-pages-site/managing-a-custom-domain-for-your-github-pages-site
- GitHub Pages HTTPS: https://docs.github.com/en/pages/getting-started-with-github-pages/securing-your-github-pages-site-with-https
- Cloudflare DNS zone apex records: https://developers.cloudflare.com/dns/manage-dns-records/how-to/create-zone-apex/
