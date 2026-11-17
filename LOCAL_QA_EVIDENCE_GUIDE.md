# Local validation and QA evidence guide

## Automated checks

Run from the repository root with Node.js installed:

```sh
node scripts/validate.mjs
node --test tests/worker.test.mjs
python -m unittest discover -s tests -p '*migration*.py'
```

The first command checks JavaScript syntax, frontend structure/accessibility invariants, domain/API configuration, source-level security guardrails, migrations and release documentation. The second runs the Worker request-boundary and mocked-D1 tests. The Python suite exercises migration SQL with SQLite. None of these commands connects to Cloudflare or proves remote D1 behavior.

## Before reporting a passing result

Record the exact commit SHA, Node/Python versions, operating system, command exit codes and test counts. Preserve CI run links for the same commit. A local pass does not replace the required GitHub Actions run.

## Manual browser QA

Use `BROWSER_QA_CHECKLIST.md` only with an isolated staging frontend, staging Worker and staging D1. Record browser/device/version, OS, viewport, commit, date and result for each scenario. Do not mark tests passed from source inspection alone.

## Evidence boundaries

- Worker unit tests use mocked D1.
- Migration tests use SQLite, not Cloudflare D1.
- Static validation is not a penetration test.
- Manual browser QA is not an independent security review.
- No production D1 migration, backup, DNS change or deployment is implied by these commands.
