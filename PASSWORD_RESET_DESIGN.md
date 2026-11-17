# Password reset — implementation design

## Status and scope

Design only. Password reset is not implemented in the current application. No reset endpoint, email provider, token table or delivery credential is added by this document.

## Proposed flow

1. Accept a reset request for an email address and always return the same generic response, whether or not the account exists.
2. Apply rate limits by IP and a SHA-256 digest of the normalized email; use a cooldown and a per-account daily cap.
3. For an eligible active account, create a cryptographically random, high-entropy, single-use reset token. Store only its SHA-256 digest, user ID, purpose, expiry and consumed timestamp.
4. Deliver a short-lived HTTPS reset link through a configured provider. Recommended initial expiry is 20 minutes, pending owner approval.
5. On submission, validate password policy, verify the token digest and atomically consume the still-valid token while updating the password hash and unique salt.
6. Revoke all existing sessions for that user in the same transaction/batch as the password change. Require a fresh login.
7. Return a generic success response. Expired, invalid, replayed and unknown-account requests must not disclose account existence.

## Security requirements

- Use the existing PBKDF2-SHA-256 password derivation pattern with a fresh per-password salt; do not invent a weaker parallel password storage scheme.
- Generate reset tokens with Web Crypto; store only a cryptographic digest.
- Bind tokens to a single purpose and account; enforce expiry and one-time use with a conditional atomic update.
- Do not put raw tokens in logs, analytics, support tickets or database plaintext columns.
- Build links from a fixed configured HTTPS origin, not request Host/Origin.
- Prevent token leakage through referrer headers and third-party scripts on reset pages.
- Rate-limit requests and token attempts; apply generic responses and monitoring for abuse.
- Revoke existing sessions after a successful reset; test races between reset and authenticated requests.
- Do not email passwords or session bearer tokens.

## Schema and rollout prerequisites

Inspect the actual production D1 schema and migration history before creating token tables or altering users/sessions. The repository has no complete baseline schema migration for those tables. Add a versioned migration only after schema compatibility is established. Test with an isolated D1 database, not production.

## Required tests and acceptance evidence

- Unknown and known email produce indistinguishable public responses.
- Expired, consumed, malformed and wrong-purpose tokens are rejected.
- Two simultaneous attempts cannot consume the same token twice.
- Password hash and salt change, and all prior sessions become invalid after success.
- Rate limits and cooldowns work across multiple Worker instances using durable storage.
- Delivery failure does not reveal account existence or create a usable token leak.
- Staging end-to-end test succeeds before production rollout.

Do not advertise password recovery until the full provider-backed flow is implemented and independently tested.
