# Security Notes

This file documents known secret-leak exposure in this repository's git
history and the remediation status for each. It is deliberately checked
into the repo so every maintainer has the same record.

## Status snapshot

- `.env` has **never** been committed to this repository — confirmed by
  `git log --all -- .env` returning zero results.
- `.env.example` contains placeholder values only (`sk_test_...`,
  `re_...`, etc.) — confirmed by grep of tracked files.
- `.env` and `.env.*.local` are listed in `.gitignore` (lines 11–15).

## Historical leaks to rotate

### AWS access key in one-shot tooling scripts

- **Commit:** `587acfc` — "fix: 2FA email redesign, product card hover shadow, stores Return to Edit, dist chown hook"
- **Files (at the time of that commit):**
  - `download-files.sh` — contained a hardcoded
    `AWS_ACCESS_KEY_ID=AKIARN4YYXRRUBBO6ZBB` and matching
    `AWS_SECRET_ACCESS_KEY`.
  - `upload-source.sh` — contained a pre-signed S3 URL using the same
    access-key ID.
- **Remediation:**
  1. **Rotate the affected IAM user's keys immediately** in the AWS
     console. The compromised access-key ID is
     `AKIARN4YYXRRUBBO6ZBB`; deactivate and delete it, and issue a
     replacement if the automation still needs one.
  2. Audit `CloudTrail` for unauthorised use of the old key since the
     commit was pushed.
  3. The scripts themselves have been removed from `HEAD` in a follow-up
     commit. The history rewrite that would remove them from older
     commits has been deliberately **not** performed — forcing-pushing
     rewritten history would invalidate every fork and every CI pointer
     to a deploy SHA. Key rotation is the correct containment.

### Resend API key / Stripe / database credentials

- `.env` is not tracked, but the current working tree on production
  hosts previously held live values. A separate untracked `.envy`
  observed in the working tree at audit time contained production
  values.
- **Remediation:**
  - Rotate `RESEND_API_KEY` via the Resend dashboard and update `.env`
    on every host that had it.
  - Rotate Stripe secret, webhook signing secret, and publishable keys.
  - Rotate OAuth client secrets (Google, Microsoft) and SAML / OIDC
    signing material for every SSO-enabled store.
  - Rotate MySQL and AWS credentials stored in server `.env` files.
  - Rotate `SESSION_SECRET` / `JWT_SECRET`. Rotating this will sign
    every existing session out; do it during a scheduled maintenance
    window and inform users.

## Policy

- Never commit secrets. Use `.env` (gitignored) for local values and
  your secret manager (AWS Secrets Manager, 1Password, etc.) for
  shared/production values.
- Never commit one-shot upload or download scripts that bake in
  credentials. Use a short-lived IAM role or a pre-signed URL generated
  on-demand and kept out of source control.
- `git log --all -- .env` must continue to return empty. If it ever
  does not, add a new section to this file and rotate.
- `server/utils/validateEnv.ts` is the canonical list of required env
  vars. Any new secret must be added there so boot fails loudly when it
  is missing, not silently with a degraded service.

## Verifying your local clone is clean

```
git log --all -- .env          # must be empty
git grep -I "AKIA[0-9A-Z]\{16\}"  # any hit is a leak — rotate & remove
git grep -I "sk_live_[A-Za-z0-9]\{10,\}"  # same
git grep -I "re_[A-Za-z0-9_]\{20,\}"      # same
```

If any of the above return real values, open an incident, rotate the
affected credential, and update this file.
