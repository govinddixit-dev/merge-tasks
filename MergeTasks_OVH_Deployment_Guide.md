# MergeTasks v8 — OVH Production Deployment Guide

This guide provides step-by-step instructions for deploying the MergeTasks application to a bare-metal OVH server (or any Ubuntu 22.04/24.04 VPS) using PM2 for process management and Nginx as a reverse proxy.

---

## 1. Initial Server Setup

Log into your OVH server via SSH as the `root` user or a user with `sudo` privileges.

### Update the System
Update the package lists and upgrade existing packages to ensure the system is secure and up to date.

```bash
sudo apt update && sudo apt upgrade -y
```

### Install Required Dependencies
Install Node.js (v20+ recommended), npm, pnpm, Nginx, and Git.

```bash
# Install Node.js v20
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt install -y nodejs nginx git build-essential

# Verify installation
node -v
npm -v

# Install pnpm (the package manager used by MergeTasks)
sudo npm install -g pnpm

# Install PM2 (process manager to keep the app running)
sudo npm install -g pm2
```

---

## 2. Application Setup

### Clone the Repository or Upload the ZIP
Upload the `MergeTasks_v8.zip` file to your server (e.g., using `scp` or `sftp`), or clone the repository if using Git.

```bash
# Assuming you uploaded the ZIP to the home directory
sudo apt install -y unzip
mkdir -p ~/mergetasks
cd ~/mergetasks
unzip ~/MergeTasks_v8.zip
```

### Install Dependencies
Install all required Node.js packages using pnpm.

```bash
cd ~/mergetasks
pnpm install
```

### Configure Environment Variables
Copy the example environment file and fill in the production credentials.

```bash
cp .env.example .env
nano .env
```

**Critical `.env` Variables for Production:**
- `NODE_ENV=production`
- `DATABASE_URL=mysql://user:pass@host:3306/mergetasks` (Point to your production database, e.g., PlanetScale, AWS RDS, or local MySQL)
- `STRIPE_SECRET_KEY=sk_live_...` (Use the LIVE key, not the test key)
- `SESSION_SECRET` and `CREDENTIAL_ENCRYPTION_KEY` (Generate secure random strings)
- `SMTP_*` variables (Required for user login and verification)
- `APP_URL=https://app.mergetasks.com` (Required for Stripe redirect validation)
- `TRUSTED_PROXY_COUNT=1` (Required if behind Nginx/Cloudflare to prevent IP spoofing)
- `OPENAI_API_KEY` (Required for AI Copilot features)

---

## 3. Database Migration and Build

### Run Database Migrations
Push the Drizzle ORM schema to your production database. This creates the necessary tables.

```bash
pnpm db:push
```

### Apply Database Migrations
Push the latest database schema changes to your production database.

```bash
pnpm db:push
mysql -u mergetasks -p mergetasks < drizzle/0038_stores_tax_rate.sql
mysql -u mergetasks -p mergetasks < drizzle/0039_proposals_paid_at.sql
```

### Build the Application
Compile the React frontend (Vite) and the Express backend (ESBuild).

```bash
pnpm build
```

This will create a `dist/` directory containing the compiled client and server code.

---

## 4. Starting the Application with PM2

PM2 ensures the application stays running and automatically restarts if it crashes.

### Start the Server
Start the compiled backend entrypoint using PM2.

```bash
# Start the app and name the process "mergetasks"
pm2 start dist/index.js --name "mergetasks"

# Save the PM2 process list so it restarts on server reboot
pm2 save

# Generate the startup script
pm2 startup
# Follow the instructions output by the command above (run the generated sudo command)
```

---

## 5. Nginx Reverse Proxy Setup

Configure Nginx to route traffic from port 80/443 to the Node.js application running on port 5000 (or whatever `PORT` is set to in your `.env`).

### Create Nginx Configuration
Create a new Nginx server block configuration file.

```bash
sudo nano /etc/nginx/sites-available/mergetasks
```

Paste the following configuration, replacing `yourdomain.com` with your actual domain:

```nginx
server {
    listen 80;
    server_name yourdomain.com www.yourdomain.com;

    location / {
        proxy_pass http://localhost:5000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_cache_bypass $http_upgrade;
        
        # Forward real IP to the application (important for rate limiting)
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
```

### Enable the Configuration
Enable the site and test the Nginx configuration.

```bash
# Create a symlink to enable the site
sudo ln -s /etc/nginx/sites-available/mergetasks /etc/nginx/sites-enabled/

# Remove the default Nginx site
sudo rm /etc/nginx/sites-enabled/default

# Test the configuration for syntax errors
sudo nginx -t

# Restart Nginx to apply the changes
sudo systemctl restart nginx
```

---

## 6. SSL/TLS Configuration (Let's Encrypt)

Secure the application with a free SSL certificate from Let's Encrypt using Certbot.

```bash
# Install Certbot and the Nginx plugin
sudo apt install -y certbot python3-certbot-nginx

# Obtain and install the certificate
sudo certbot --nginx -d yourdomain.com -d www.yourdomain.com
```

Follow the prompts to configure HTTPS. Certbot will automatically update your Nginx configuration to redirect HTTP traffic to HTTPS.

---

## 7. Verification and Maintenance

### Verify the Deployment
Navigate to `https://yourdomain.com` in your web browser. You should see the MergeTasks application running securely.

### Viewing Logs
To view the application logs, use PM2:

```bash
pm2 logs mergetasks
```

### Updating the Application
When deploying future updates:

1. Upload the new code to `~/mergetasks`
2. Run `pnpm install` (if dependencies changed)
3. Run `pnpm db:push` (if the schema changed)
4. Run `pnpm build`
5. Run `pm2 restart mergetasks`
