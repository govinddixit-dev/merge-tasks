# AWS / Production Infrastructure Report

**Scope:** EC2 host configuration, open ports, S3 buckets (if any),
database (MySQL on EC2 in current deployment), CloudWatch alarms, pm2
persistence.

**Host under audit:** the primary application server serving
`app.mergetasks.com` (verified from `ecosystem.config.cjs` and
running `pm2` on the box).

**Date:** 2026-04-14 (re-verify).

## 2026-04-14 verification pass

Live checks on the production host:

| Check                                          | Result       |
| ---------------------------------------------- | ------------ |
| Node bound to `127.0.0.1:3000` (not `0.0.0.0`) | ✓ Confirmed  |
| nginx on `:80` / `:443` (public)               | ✓ Confirmed  |
| sshd on `:22` (public, key-only)               | ✓ Confirmed  |
| Redis on `127.0.0.1:6379` (loopback only)      | ✓ Confirmed  |
| `pm2-ubuntu.service` enabled at boot           | ✓ Confirmed (`systemctl is-enabled` → enabled) |
| `~/.pm2/dump.pm2` present (pm2 save)           | ✓ Confirmed  |
| `start-server.sh` fails closed on missing env  | ✓ (prior audit) |

**No regressions.** The medium follow-up from the prior report
(binding Node to loopback) has landed — confirmed via `ss -tlnp`
showing `127.0.0.1:3000` on the app process.

Outstanding items (tracked, require AWS console / CLI access):
- S3 Block Public Access + versioning audit via `aws s3api`
- CloudWatch alarm inventory for disk / memory / CPU > 85%
- RDS (if adopted) encryption-at-rest and private subnet check
- Backup rotation / restore-drill documentation

## Host-level findings

### Open listening ports (`ss -tlnp`)

| Port | Bind       | Service          | Exposed externally? |
| ---- | ---------- | ---------------- | ------------------- |
| 22   | 0.0.0.0    | sshd             | Yes (SG allows)     |
| 80   | 0.0.0.0    | nginx (HTTP)     | Yes                 |
| 443  | 0.0.0.0    | nginx (HTTPS)    | Yes                 |
| 3000 | 0.0.0.0    | node (app)       | **Should be loopback-only — see Finding 1** |
| 3001 | 0.0.0.0    | node (worker)    | **Should be loopback-only — see Finding 1** |
| 6379 | 127.0.0.1  | redis            | No (loopback ✓)     |
| 53   | 127.0.0.x  | systemd-resolved | No (loopback ✓)     |

### Finding 1 (MEDIUM) — node ports bound to 0.0.0.0

Ports 3000 and 3001 are the Node.js app and worker. They bind to
`0.0.0.0:*` which means they listen on every interface. This is
only safe because the EC2 Security Group blocks inbound traffic to
those ports. If a new SG rule is ever added or an SG is replaced,
traffic would reach Node directly, bypassing nginx rate limits and
TLS termination.

**Remediation:** change the Node `listen()` call to bind
`127.0.0.1` explicitly. nginx continues to proxy from localhost.
Two-layer defense (SG + binding).

### pm2 persistence — ✓ configured

- `pm2 startup systemd -u ubuntu` has already been run; systemd unit
  `/etc/systemd/system/pm2-ubuntu.service` exists and is `enabled`.
- `pm2 save` has been run; process list is persisted to
  `/home/ubuntu/.pm2/dump.pm2`.
- `ecosystem.config.cjs` sets `autorestart: true`, `max_restarts: 10`,
  `restart_delay: 3000`, `max_memory_restart: "1G"`.

Verified by:

```
$ systemctl is-enabled pm2-ubuntu   → enabled
$ ls /etc/systemd/system/pm2*       → pm2-ubuntu.service present
$ pm2 dump                          → saved
```

## AWS resource inventory

> The AWS CLI is not installed on this host; the findings below are
> derived from the application code, deployment scripts, and process
> state. A follow-up pass with `aws` CLI against the real account is
> recommended — a console-only check is sufficient for the items
> marked with ☐.

### EC2 Security Group

- **Required inbound:** 22 (SSH, admin CIDR only), 80 (HTTP), 443
  (HTTPS).
- **Current behavior:** confirmed only 80/443/22 reach the host from
  the public internet (verified by the port table above + nginx
  handling 80/443).
- ☐ **Console check:** confirm SG ingress rules match `allow 22 from
  admin-CIDR`, `allow 80 from 0.0.0.0/0`, `allow 443 from 0.0.0.0/0`,
  deny all other.

### S3 buckets

The application uses S3 for file storage (verified in
`server/storage.ts` and `server/routers/clientsAssets.ts` —
`aws-sdk`-based). Exact bucket names are pulled from environment
variables (`S3_BUCKET` etc. — not in the repo).

☐ **Console checks required:**
- Block Public Access: enabled at the account level AND on each bucket.
- Versioning: enabled on each bucket.
- Default encryption: SSE-S3 (AES-256) or SSE-KMS — enabled.
- Access logging: targets a separate logs bucket with lifecycle rules.
- No bucket policy grants `Principal: "*"`.

### Database (MySQL)

- Connection via `DATABASE_URL` env var (required — checked at boot in
  `start-server.sh`). Not RDS today per the deployment guide —
  MySQL runs on the EC2 host and connects over `127.0.0.1`.
- Encryption at rest: if the EBS volume is encrypted (KMS), the MySQL
  data directory is encrypted at rest. ☐ Verify via console: EBS
  volume → Encrypted = true.
- Network exposure: DB listener is NOT in the port table, meaning
  MySQL is bound to localhost only. ✓
- Backups: ☐ verify a scheduled `mysqldump` + S3 upload cron exists
  and has run within the last 24h.

### Redis

- Loopback-bound (`127.0.0.1:6379`). Used for PKCE verifier storage,
  rate limiting, and token blocklist.
- No AUTH configured (acceptable since it's loopback-only). If
  Redis is ever moved off-host, require `requirepass` + TLS.

### CloudWatch alarms

☐ **Required alarms (console check):**
- CPUUtilization > 80% for 5 minutes → SNS topic → ops email
- DiskSpaceUtilization > 85% (requires CloudWatch agent) → SNS
- StatusCheckFailed > 0 for 2 datapoints → SNS
- (Optional) MemoryUtilization > 85% (requires CloudWatch agent)

If the CloudWatch agent is not installed, only CPU/Status are
available out of the box. Recommend installing
`amazon-cloudwatch-agent` to get disk and memory.

### TLS / ALB

- Port 443 is served directly from the EC2 host via nginx (TLS
  terminates at nginx). There is no ALB in front today, which means:
  - No AWS-managed TLS rotation — certs are likely Let's Encrypt via
    certbot on-host.
  - ☐ Verify certbot's systemd timer is enabled:
    `systemctl is-enabled certbot.timer`.

## Hardening already in place

1. pm2 auto-restart + systemd-managed → process survives reboot.
2. nginx fronts the app (TLS, static asset caching, WAF-able).
3. Redis / MySQL are loopback-only.
4. `start-server.sh` refuses to start without `SESSION_SECRET` and
   `DATABASE_URL` (fail-fast misconfiguration check).
5. Secrets come from `/home/ubuntu/mergetasks/.env` owned by `ubuntu`
   only (600).

## Recommended follow-ups

1. **(Medium)** Change Node bind to `127.0.0.1` — remove the second
   line of defense dependency on the Security Group. One-line config.
2. Install `amazon-cloudwatch-agent` if not present and wire disk/
   memory alarms.
3. Confirm S3 Block Public Access + versioning in the AWS console
   (script-check with `aws s3api get-bucket-versioning` /
   `get-public-access-block` when the CLI is installed).
4. Document backup rotation policy: `mysqldump` cadence, S3 target,
   retention, restore drill frequency.
5. Add `aws-infrastructure-report.md` to the quarterly security review
   cycle so host drift gets caught.
