# Deploying the ContentPilot Cloudflare Worker

The Worker is deployed separately from the GitHub Pages frontend.

## One-time setup

1. In Cloudflare, create an API token with the minimum account-level permissions needed to deploy Workers:
   - Workers Scripts: Edit
   - Account Settings: Read
   - D1: Read (if required by the account's deployment validation)
2. In the GitHub repository, open **Settings → Secrets and variables → Actions**.
3. Add one repository secret named `CLOUDFLARE_API_TOKEN` and paste the token there. Never commit it to the repository or share it in chat.
4. Open the **Actions** tab and choose **Deploy ContentPilot Worker**.
5. Select **Run workflow** on the main branch.

The account ID and existing D1/Workers AI bindings are defined in `wrangler.toml`. The deploy workflow is manual-only, so a normal commit does not publish the Worker unexpectedly.

## Post-deploy verification

- Confirm the workflow completes successfully.
- Open the public site and test text generation using a test account.
- Test one output in English and one in another supported language.
- Test image generation separately.
- Check free quota and ensure failed generation attempts do not consume credits.
- Do not enable payments until the payment provider's signed callback and idempotent crediting flow is implemented and verified.

The Worker uses the existing D1 database `contentpilot-db` and Workers AI binding `AI`. Do not change database IDs or bindings without checking the production environment first.
