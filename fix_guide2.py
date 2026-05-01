import re

with open("/home/ubuntu/mergetasks-work/mt-test/DEPLOYMENT_GUIDE.md", "r") as f:
    lines = f.readlines()

# Clean up the corrupted section
new_lines = []
skip = False
for line in lines:
    if line.startswith("| `CREDENTIAL_ENCRYPTION_KEY`"):
        new_lines.append("| `CREDENTIAL_ENCRYPTION_KEY` | (64 hex chars) | AES-256 encryption for stored credentials |\n")
        new_lines.append("| `APP_BASE_URL` | `https://app.mergetasks.com` | Used in email links and redirects |\n")
        new_lines.append("| `APP_URL` | `https://app.mergetasks.com` | Stripe redirect validation allowlist |\n")
        new_lines.append("| `TRUSTED_PROXY_COUNT` | `1` | Prevents IP spoofing in X-Forwarded-For |\n")
        skip = True
    elif skip and (line.startswith("| `APP_URL`") or line.startswith("| `TRUSTED_PROXY_COUNT`") or "llowlist" in line or "owlist" in line):
        continue
    elif skip and line.startswith("| `SMTP_HOST`"):
        skip = False
        new_lines.append(line)
    elif skip:
        continue
    else:
        new_lines.append(line)

with open("/home/ubuntu/mergetasks-work/mt-test/DEPLOYMENT_GUIDE.md", "w") as f:
    f.writelines(new_lines)
