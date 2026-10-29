# ProcureFlow — Approval & Workflow Management System

<p align="center">
  <img src="public/favicon.png" alt="ProcureFlow Logo" width="120" height="120" />
</p>

<p align="center">
  <strong>An enterprise-grade procurement lifecycle, expenditure governance, and institutional workflow automation platform.</strong><br>
  Built specifically for Sir Parashurambhau College (S.P. College), Pune / Shikshana Prasaraka Mandali.
</p>

<p align="center">
  <img src="https://img.shields.io/badge/Node.js-%3E%3D22.0.0-339933?logo=node.js&logoColor=white" alt="Node Version" />
  <img src="https://img.shields.io/badge/PostgreSQL-16%20%7C%20Neon-4169E1?logo=postgresql&logoColor=white" alt="PostgreSQL" />
  <img src="https://img.shields.io/badge/React-18.3-61DAFB?logo=react&logoColor=black" alt="React 18" />
  <img src="https://img.shields.io/badge/Vite-5.4-646CFF?logo=vite&logoColor=white" alt="Vite" />
  <img src="https://img.shields.io/badge/TailwindCSS-3.4-38B2AC?logo=tailwind-css&logoColor=white" alt="Tailwind CSS" />
  <img src="https://img.shields.io/badge/Security-PostgreSQL%20RLS%20%2B%20TOTP%20MFA-darkgreen" alt="Security" />
  <img src="https://img.shields.io/badge/License-Proprietary%20%7C%20All%20Rights%20Reserved-red" alt="License" />
</p>

---

## 📜 Copyright Notice & Intellectual Property

```text
Copyright © 2026 Anish Mogam, Madhura Lakade and Isha Joshi. All Rights Reserved.
```

**ProcureFlow** and this repository, including all source code, software architecture, documentation, user interfaces, design assets, database schemas, workflows, and configurations, are proprietary works developed by **Anish Mogam**, **Madhura Lakade**, and **Isha Joshi**.

These works are protected under the **Copyright Act, 1957**, as amended, including protections applicable to computer software as literary works under Section 2(o). Unauthorized copying, reverse engineering, redistribution, mirroring, or exploitation of any part of this system is strictly prohibited.

---

## 📋 Table of Contents

1. [System Overview & Architecture](#-system-overview--architecture)
2. [Core Capabilities](#-core-capabilities)
3. [Visual Workflows & Architectural Diagrams](#-visual-workflows--architectural-diagrams)
   - [High-Level System Architecture](#1-high-level-system-architecture)
   - [Procurement Approval & Escalation Hierarchy](#2-procurement-approval--escalation-hierarchy)
   - [Request State Machine](#3-request-state-machine)
   - [Subdomain & Reverse Proxy Traffic Routing](#4-subdomain--reverse-proxy-traffic-routing)
4. [Project Structure](#-project-structure)
5. [Local Development Setup](#-local-development-setup)
6. [Subdomain & Production Deployment Guide](#-subdomain--production-deployment-guide)
   - [Architecture Pattern A: Single Subdomain via Reverse Proxy (Recommended)](#pattern-a-single-subdomain-via-reverse-proxy-recommended)
   - [Architecture Pattern B: Decoupled Dual Subdomains (Cloud / PaaS)](#pattern-b-decoupled-dual-subdomains-cloud--paas)
   - [Nginx Production Configuration](#nginx-production-configuration)
   - [cPanel / Apache / LiteSpeed Setup](#cpanel--apache--litespeed-setup)
   - [DNS Records & Domain Setup](#dns-records--domain-setup)
   - [SSL/TLS Certification with Let's Encrypt](#ssltls-certification-with-lets-encrypt)
7. [Environment Variables Reference](#-environment-variables-reference)
8. [Database Migrations & Neon Deployment](#-database-migrations--neon-deployment)
9. [Enterprise Security & Row-Level Security (RLS)](#-enterprise-security--row-level-security-rls)
10. [Automated Test Suite](#-automated-test-suite)
11. [Troubleshooting & FAQ](#-troubleshooting--faq)

---

## 🏛 System Overview & Architecture

**ProcureFlow** replaces manual paper requisition slips, physical signatures, and fragmented registers with an audited, multi-tiered digital procurement and governance ecosystem.

### Key Tenets:
- **Zero Ambiguity in Authority**: Every rupee of institutional expenditure passes through an automated decision matrix based on pre-configured statutory thresholds.
- **Append-Only Immutability**: No approver can overwrite or tamper with an applicant's original requisition. Approved, partial, rejected, and revised figures are recorded as separate revision entities with digital seals.
- **Strict Tenant & Role Scoping**: Built on PostgreSQL **Row-Level Security (RLS)**. The application connects exclusively through an unprivileged role (`app_user`). Database policies enforce visibility limits natively at the SQL engine level.
- **Air-Gapped Audit Trail**: Cryptographic sealing (`SIGNING_SECRET`) ensures past approvals cannot be modified without flagging immediate signature verification mismatches.

---

## 🚀 Core Capabilities

### 1. Multi-Tier Procurement Engine
- **Tier 1 (≤ ₹50,000)**: Scrutinized and decided by the **Purchase Committee**.
- **Tier 2 (₹50,001 to ₹5,00,000)**: Escalated to and decided by the **Principal**.
- **Tier 3 (₹5,00,001 to ₹15,00,000)**: Decided jointly by the **College Development Committee (CDC)** (Grant & Non-Grant members).
- **Tier 4 (> ₹15,00,000 or Special Capital)**: Escalated to the **Chairman & Vice Chairman** (Governing Body / Management).
- **Split & Line-Item Approvals**: Approvers can sanction partial line items, reduce quantities, and request revisions while maintaining the original audit trail.

### 2. Faculty Issue & Maintenance Ticketing
- Non-financial departmental issues (e.g., laboratory equipment repair, plumbing, campus networking) are tracked through dedicated non-financial workflows with resolution SLAs, assignees, and status logs.

### 3. Native PDF Reporting & Watermarking Suite
- Server-side (`pdfkit`) and client-side (`jspdf` + `jspdf-autotable`) generation of:
  - Official Requisition Sanction Sheets.
  - Departmental Budget Utilization & Balance Ledgers.
  - Institutional Purchase Summaries.
  - Campus Maintenance & Faculty Issue Reports.
- Every generated document includes automated statutory watermarks and copyright notices.

### 4. Enterprise Identity & Two-Factor Authentication
- Passwordless onboarding via time-limited, cryptographically signed email invitations.
- Two-Step Verification (**TOTP MFA**) using Google Authenticator, Microsoft Authenticator, or 1Password.
- Authenticator secrets are protected using AES-256 encryption (`MFA_ENCRYPTION_KEY`).
- Brute-force lockout prevention, secure HTTP-only cookies, and IP tracking behind reverse proxies.

### 5. Multi-Transport Resilient Mailer
- Automated failover delivery supporting:
  - **Brevo HTTPS API** (No custom domain required to start).
  - **Resend HTTPS API** (High-deliverability transactional engine).
  - **Gmail OAuth2 API** (Enterprise Google Workspace routing).
  - **Direct SMTP** (Custom college mail servers / cPanel Exim).

---

## 📊 Visual Workflows & Architectural Diagrams

### 1. High-Level System Architecture

```mermaid
graph TB
    subgraph Clients["Clients & Devices"]
        Browser["Desktop & Mobile Browsers<br/>(React 18 + Tailwind SPA)"]
    end

    subgraph Edge["Reverse Proxy & Subdomain Edge"]
        DNS["DNS Server<br/>(A / CNAME: procureflow.spcollege.edu.in)"]
        Nginx["Nginx / Apache / cPanel<br/>(SSL Termination & Rate Limiting)"]
    end

    subgraph AppLayer["Application Layer"]
        StaticServer["Frontend Static Server<br/>(Vite Production Build)"]
        NodeAPI["REST API Backend<br/>(Node.js 22 + Express 5)"]
        Worker["Outbox Worker & Background Queue"]
    end

    subgraph StorageLayer["Data & Persistence Layer"]
        NeonDB[("PostgreSQL 16 / Neon DB<br/>Row-Level Security (RLS)")]
        GDrive["Google Drive API<br/>(Quotation & Bill Storage)"]
        LocalDisk["Local Disk /uploads<br/>(Fallback Storage)"]
    end

    subgraph ExternalServices["External Notification Gateways"]
        Brevo["Brevo API"]
        Resend["Resend API"]
        SMTP["College SMTP Server"]
    end

    Browser -->|HTTPS Request| DNS
    DNS --> Nginx
    Nginx -->|/ route| StaticServer
    Nginx -->|/api and /health| NodeAPI

    NodeAPI -->|withUser RLS Session| NeonDB
    NodeAPI --> GDrive
    NodeAPI --> LocalDisk
    NodeAPI --> Worker
    Worker --> Brevo
    Worker --> Resend
    Worker --> SMTP
```

---

### 2. Procurement Approval & Escalation Hierarchy

```mermaid
flowchart TD
    START([Requester creates Requisition<br/>Head / Coordinator / Faculty]) --> ITEMS[Add budget line items<br/>quantity, specs, unit price]
    ITEMS --> COMPUTE{{Compute Total Amount}}
    
    COMPUTE --> ROUTE{Route by Amount}

    ROUTE -->|<= ₹50,000| PC[Purchase Committee Review<br/>UNDER_PURCHASE_COMMITTEE_REVIEW]
    ROUTE -->|₹50,001 to ₹5,00,000| PRIN[Principal Review<br/>UNDER_PRINCIPAL_REVIEW]
    ROUTE -->|> ₹5,00,000| CDC[CDC Review<br/>Grant + Non-Grant Members]

    PC -->|Verify & Approve| APPROVED[APPROVED]
    PC -->|Approve with cuts| PARTIAL[PARTIALLY_APPROVED]
    PC -->|Disallow| REJECTED[REJECTED]
    PC -->|Exceeds remit| PRIN
    PC -->|Clarification needed| REVISE[SEND_BACK_TO_REQUESTER]

    PRIN -->|Approve| APPROVED
    PRIN -->|Partial Approval| PARTIAL
    PRIN -->|Reject| REJECTED
    PRIN -->|High Value Escalation| CDC
    PRIN -->|Send for correction| REVISE

    CDC -->|Dual Committee Signoff| APPROVED
    CDC -->|Partial Approval| PARTIAL
    CDC -->|Reject| REJECTED
    CDC -->|> ₹15,00,000 or Special| FA[Chairman & Vice Chairman<br/>Final Governing Authority]

    FA -->|Final Sanction| APPROVED
    FA -->|Partial Sanction| PARTIAL
    FA -->|Final Rejection| REJECTED

    REVISE -->|Requester edits & resubmits| ITEMS

    APPROVED --> FULFIL[FULFILMENT_PENDING]
    PARTIAL --> FULFIL

    FULFIL --> BILL[Record Purchase Bill & Vendor Invoices]
    BILL --> INV[Update Departmental Inventory]
    INV --> CLOSED([CLOSED])

    subgraph AUDIT[Security & Compliance at Each Decision]
        direction TB
        A1[Digital Signature Hash Generated]
        A2[approval_actions Log Recorded]
        A3[Departmental Budget Balance Deducted]
        A4[Email Notification Dispatched]
        A5[audit_logs Entry Appended]
    end

    PC -.-> AUDIT
    PRIN -.-> AUDIT
    CDC -.-> AUDIT
    FA -.-> AUDIT
```

---

### 3. Request State Machine

```mermaid
stateDiagram-v2
    [*] --> DRAFT : Requester starts draft
    DRAFT --> SUBMITTED : submit()
    DRAFT --> [*] : discard()

    state "UNDER_PURCHASE_COMMITTEE_REVIEW" as PC
    state "UNDER_PRINCIPAL_REVIEW" as PR
    state "UNDER_CDC_REVIEW" as CDC
    state "UNDER_FINAL_AUTHORITY_REVIEW" as FA

    SUBMITTED --> PC : <= 50,000
    SUBMITTED --> PR : 50,001 to 5,00,000
    SUBMITTED --> CDC : > 5,00,000

    PC --> PR : escalate
    PC --> REVISED : request clarification
    PC --> APPROVED : approve
    PC --> PARTIALLY_APPROVED : partial approve
    PC --> REJECTED : reject

    PR --> CDC : escalate
    PR --> REVISED : request clarification
    PR --> APPROVED : approve
    PR --> PARTIALLY_APPROVED : partial approve
    PR --> REJECTED : reject

    CDC --> FA : escalate
    CDC --> APPROVED : approve
    CDC --> PARTIALLY_APPROVED : partial approve
    CDC --> REJECTED : reject

    FA --> APPROVED : approve
    FA --> PARTIALLY_APPROVED : partial approve
    FA --> REJECTED : reject

    REVISED --> SUBMITTED : resubmit with updates

    APPROVED --> FULFILMENT_PENDING : purchase orders released
    PARTIALLY_APPROVED --> FULFILMENT_PENDING : sanctioned lines released

    FULFILMENT_PENDING --> FULFILLED : goods received & bills uploaded
    FULFILLED --> CLOSED : assets verified & logged to inventory

    PC --> CARRIED_FORWARD : Financial Year ends
    PR --> CARRIED_FORWARD : Financial Year ends
    CDC --> CARRIED_FORWARD : Financial Year ends
    FA --> CARRIED_FORWARD : Financial Year ends

    REJECTED --> [*]
    CLOSED --> [*]
    CARRIED_FORWARD --> [*] : Linked to next FY budget ledger
```

---

### 4. Subdomain & Reverse Proxy Traffic Routing

```mermaid
flowchart LR
    User([User Request<br/>https://procureflow.spcollege.edu.in]) --> Nginx[Nginx Reverse Proxy<br/>Port 80 / 443]

    subgraph ReverseProxy["Subdomain Router & SSL Terminator"]
        Nginx -->|/api/*| API[Node.js Backend<br/>http://127.0.0.1:4000]
        Nginx -->|/health| API
        Nginx -->|/* static assets| WebRoot[Vite SPA Build<br/>/var/www/procureflow/dist]
    end

    subgraph CloudSubdomainAlternative["Alternative: Decoupled Subdomains"]
        DNS1[procureflow.spcollege.edu.in] --> Vercel[Vercel Frontend CDN]
        DNS2[api.procureflow.spcollege.edu.in] --> Render[Render / VPS Node Backend]
    end
```

---

## 📁 Project Structure

```text
SP_Project/
├── db/                                # PostgreSQL Database Layer
│   ├── schema/                        # Modular SQL DDL definitions (01_init to 08_audit)
│   ├── migrations/                    # Sequential, immutable migration scripts
│   ├── seed/                          # Development mock users, approvers, and roles
│   ├── tests/                         # SQL-level RLS policy verification scripts
│   └── docker-compose.yml             # Local PostgreSQL container specification
│
├── server/                            # Node.js REST API Backend
│   ├── src/
│   │   ├── routes/                    # Express route controllers (requests, auth, budget, etc.)
│   │   ├── auth.js                    # JWT verification, password checks, TOTP MFA validation
│   │   ├── db.js                      # Connection pool & RLS context wrapper (withUser)
│   │   ├── mailer.js                  # Multi-transport email dispatcher (Brevo, Resend, SMTP)
│   │   ├── gdrive.js                  # Google Drive API integration for file attachments
│   │   ├── config.js                  # Centralized, validated environment configuration
│   │   └── app.js                     # Express app setup, Helmet, Rate Limiter, CORS
│   ├── test/                          # Automated backend integration tests
│   └── package.json                   # Backend dependencies
│
├── src/                               # Frontend Single Page Application (SPA)
│   ├── api/                           # Typed API clients and authentication state handlers
│   ├── components/                    # Modular UI components (modals, auth frames, layouts)
│   ├── context/                       # App-wide authentication & active portal state
│   ├── hooks/                         # Custom React data hooks (useApi, useDashboard)
│   ├── pages/                         # Core views (Login, Dashboards, Requests, Reports)
│   ├── utils/                         # Client PDF generators, watermark engines, formatters
│   └── main.jsx                       # Application bootstrap
│
├── public/                            # Static Web Assets & Favicons
│   ├── favicon.ico                    # Multi-resolution tab icon (16x16, 32x32, 48x48)
│   ├── favicon-32x32.png              # High-DPI browser tab icon
│   ├── favicon.png                    # High-resolution 512x512 emblem
│   ├── apple-touch-icon.png           # iOS / Safari home screen icon
│   ├── site.webmanifest               # Modern web application manifest
│   └── ProcureFlow-logo-horizontal.png# Full institutional horizontal branding
│
├── docs/                              # In-depth architectural & deployment references
│   ├── diagrams/                      # Raw Mermaid diagram specifications (.mmd)
│   ├── DEPLOY_DB_NEON.md              # Production Neon database migration runbook
│   ├── DEPLOY_EMAIL_PASSWORD_RESET.md # Email provider setup and troubleshooting
│   ├── GOOGLE_DRIVE_SETUP.md          # Google Cloud Service Account & Drive setup
│   └── ADMIN_RECOVERY.md              # Disaster recovery script for resetting 2FA / admins
│
├── index.html                         # SPA HTML entry point & favicon links
├── package.json                       # Frontend dependencies and scripts
└── vite.config.js                     # Vite build configuration and local API proxy
```

---

## 💻 Local Development Setup

### Prerequisites
- **Node.js**: `v22.0.0` or higher
- **PostgreSQL**: `16+` or **Docker Desktop**
- **Git**

### Step 1: Start the Database

Run PostgreSQL via Docker:
```bash
cd db
docker compose up -d
```
*Note: Docker maps PostgreSQL to port `5433` to prevent conflicts with any locally installed PostgreSQL instance on port `5432`.*

Connect to PostgreSQL and create the `app_user` password:
```sql
-- Connect via psql
psql -U postgres -h localhost -p 5433 -d spc_approval

-- Set a password for the non-superuser application role
ALTER ROLE app_user LOGIN PASSWORD 'your_secure_dev_password';
```

### Step 2: Configure & Launch the API Server

```bash
cd ../server
cp .env.example .env
```

Edit `server/.env` with your development values:
```env
PORT=4000
DATABASE_URL=postgresql://app_user:your_secure_dev_password@localhost:5433/spc_approval
JWT_SECRET=super_secret_jwt_random_key_minimum_32_characters_long
SIGNING_SECRET=stable_random_sealing_secret_minimum_32_chars
MFA_ENCRYPTION_KEY=0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef
APP_URL=http://localhost:3000
CORS_ORIGIN=http://localhost:3000
MAIL_TRANSPORT=outbox
```

Install dependencies and start the backend:
```bash
npm install
npm run dev
```
The API will start at `http://localhost:4000`.

### Step 3: Launch the Frontend Interface

From the repository root:
```bash
npm install
npm run dev
```
Open **http://localhost:3000** in your browser.

> [!TIP]
> In local development, Vite automatically proxies `/api` and `/health` requests to `http://localhost:4000`, matching production reverse proxy behavior.

---

## 🌐 Subdomain & Production Deployment Guide

When deploying ProcureFlow for institutional use, you can choose between two architecture patterns:

### Pattern A: Single Subdomain via Reverse Proxy (Recommended)
**Domain**: `https://procureflow.spcollege.edu.in`
- **Frontend**: Built into static files (`dist/`) and served directly by Nginx / Apache.
- **Backend**: Node.js API running locally on port `4000` (managed by PM2 or systemd).
- **Traffic Routing**: Nginx serves static HTML/JS/CSS on `/` and proxies `/api/*` and `/health` to `http://127.0.0.1:4000`.
- **Advantages**:
  - No cross-origin (CORS) overhead.
  - Unified SSL certificate.
  - HttpOnly cookies and credentials pass seamlessly without third-party cookie restrictions.

---

### Pattern B: Decoupled Dual Subdomains (Cloud / PaaS)
- **Frontend Subdomain**: `https://procureflow.spcollege.edu.in` (Hosted on Vercel, Netlify, or S3/CloudFront)
- **Backend Subdomain**: `https://api.procureflow.spcollege.edu.in` (Hosted on Render, Railway, or AWS EC2)
- **Database**: Serverless PostgreSQL on **Neon**
- **Configuration**:
  - Frontend requires `VITE_API_BASE=https://api.procureflow.spcollege.edu.in` during build time.
  - Backend requires `CORS_ORIGIN=https://procureflow.spcollege.edu.in` and `APP_URL=https://procureflow.spcollege.edu.in`.

---

### Nginx Production Configuration

Save the following configuration block to `/etc/nginx/sites-available/procureflow.conf`:

```nginx
# Upstream Node.js API Server
upstream procureflow_api {
    server 127.0.0.1:4000;
    keepalive 64;
}

# Redirect HTTP to HTTPS
server {
    listen 80;
    listen [::]:80;
    server_name procureflow.spcollege.edu.in;
    return 301 https://$host$request_uri;
}

# HTTPS Server Block
server {
    listen 443 ssl http2;
    listen [::]:443 ssl http2;
    server_name procureflow.spcollege.edu.in;

    # SSL Certificate Paths (Let's Encrypt / Certbot)
    ssl_certificate /etc/letsencrypt/live/procureflow.spcollege.edu.in/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/procureflow.spcollege.edu.in/privkey.pem;

    # Modern SSL Protocols and Ciphers
    ssl_protocols TLSv1.2 TLSv1.3;
    ssl_ciphers HIGH:!aNULL:!MD5;
    ssl_prefer_server_ciphers on;
    ssl_session_cache shared:SSL:10m;
    ssl_session_timeout 1d;

    # Security Headers
    add_header X-Frame-Options "DENY" always;
    add_header X-Content-Type-Options "nosniff" always;
    add_header Referrer-Policy "strict-origin-when-cross-origin" always;
    add_header Strict-Transport-Security "max-age=63072000; includeSubDomains; preload" always;

    # Static Frontend SPA Root (Output of npm run build)
    root /var/www/procureflow/dist;
    index index.html;

    # Max upload size for quotations, invoices, and purchase bills
    client_max_body_size 25M;

    # Static Asset Caching (JS, CSS, Images, Favicons, Webmanifest)
    location ~* \.(?:ico|png|jpg|jpeg|gif|svg|woff2?|ttf|css|js|webmanifest)$ {
        expires 30d;
        add_header Cache-Control "public, no-transform";
        access_log off;
    }

    # API Backend Reverse Proxy
    location /api/ {
        proxy_pass http://procureflow_api;
        proxy_http_version 1.1;
        
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        
        proxy_cache_bypass $http_upgrade;
        proxy_read_timeout 60s;
        proxy_connect_timeout 60s;
    }

    # Health Check Endpoint
    location = /health {
        proxy_pass http://procureflow_api/health;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
    }

    # Frontend Single Page Application Fallback (React Router)
    location / {
        try_files $uri $uri/ /index.html;
    }
}
```

Enable the configuration and reload Nginx:
```bash
sudo ln -s /etc/nginx/sites-available/procureflow.conf /etc/nginx/sites-enabled/
sudo nginx -t
sudo systemctl reload nginx
```

---

### cPanel / Apache / LiteSpeed Setup

For colleges hosting on **cPanel** or **Apache** with a registered subdomain (e.g. `procureflow.spcollege.edu.in`):

1. **Deploy Frontend**:
   - Build the React SPA locally or in CI: `npm run build`.
   - Upload the contents of the `dist/` directory into the subdomain's document root (e.g. `/home/spcollege/public_html/procureflow/`).

2. **Configure `.htaccess` for SPA Routing & Proxy**:
   Create a `.htaccess` file inside the document root:
   ```apache
   RewriteEngine On
   RewriteBase /

   # Proxy API requests to local Node.js application port
   RewriteRule ^api/(.*)$ http://127.0.0.1:4000/api/$1 [P,L]
   RewriteRule ^health$ http://127.0.0.1:4000/health [P,L]

   # Fallback all other routes to React index.html
   RewriteCond %{REQUEST_FILENAME} !-f
   RewriteCond %{REQUEST_FILENAME} !-d
   RewriteRule ^ index.html [L]
   ```

3. **Manage the Node.js API on cPanel**:
   - Use **cPanel → Setup Node.js App**.
   - **Application root**: `server`
   - **Application startup file**: `src/index.js`
   - **Node.js version**: `22.x`
   - Define environment variables under the cPanel interface.

---

### DNS Records & Domain Setup

Configure the following DNS records at your domain registrar or institutional DNS server (e.g., Cloudflare, Route53, or college nameservers):

| Type | Host / Name | Target / Value | Purpose |
|---|---|---|---|
| **A** | `procureflow` | `SERVER_PUBLIC_IP` | Points subdomain to institutional VPS / Nginx |
| **CNAME** | `procureflow` | `your-app.vercel.app` | (Pattern B only) Points frontend to Vercel |
| **A** or **CNAME** | `api.procureflow` | `your-backend.onrender.com` | (Pattern B only) Points backend to cloud API |
| **TXT** | `@` / `spcollege.edu.in` | `v=spf1 include:resend.com ~all` | Authorizes email sending servers (SPF) |
| **CNAME** | `resend._domainkey` | `resend._domainkey.spcollege...` | Authenticates outgoing notification mail (DKIM) |

---

### SSL/TLS Certification with Let's Encrypt

Issue a free, auto-renewing SSL certificate via Certbot:
```bash
sudo apt update && sudo apt install -y certbot python3-certbot-nginx
sudo certbot --nginx -d procureflow.spcollege.edu.in
```
Certbot will automatically install the certificate and verify renewals via a systemd timer.

---

## 🔐 Environment Variables Reference

All sensitive credentials and institutional URLs must be configured in `server/.env`. **Never commit `.env` to Git.**

| Variable | Category | Required | Default / Example | Purpose |
|---|---|---|---|---|
| `PORT` | Server | Optional | `4000` | Port the backend process listens on. |
| `NODE_ENV` | Server | **Production** | `production` | Enforces production security checks, mandatory HTTPS URLs, and suppresses dev stack traces. |
| `APP_URL` | Server | **Production** | `https://procureflow.spcollege.edu.in` | Base public URL for user invitation tokens and password reset emails. Must be HTTPS in production. |
| `CORS_ORIGIN` | Security | Required | `https://procureflow.spcollege.edu.in` | Comma-separated allowed browser origins for cross-domain API calls. |
| `DATABASE_URL` | Database | **Yes** | `postgresql://app_user:pwd@host/db?sslmode=require` | PostgreSQL connection string. Must connect as the non-superuser `app_user`. |
| `JWT_SECRET` | Security | **Yes** | 64+ char random hex string | Signs user authentication tokens. |
| `JWT_EXPIRES_IN` | Security | Optional | `8h` | Session lifetime before re-authentication is required. |
| `SIGNING_SECRET` | Security | **Yes** | 64+ char random hex string | Cryptographically seals approved requisitions. Must remain stable across deploys. |
| `MFA_ENCRYPTION_KEY` | Security | **Production** | 64 hex characters (32 bytes) | Encrypts TOTP authenticator secrets in the database using AES-256-GCM. |
| `BCRYPT_ROUNDS` | Security | Optional | `12` | Password hashing workload factor (10–14). |
| `MAIL_TRANSPORT` | Email | Optional | `auto` | Delivery engine (`auto` chooses Brevo -> Resend -> SMTP; `outbox` is for local testing). |
| `MAIL_FROM_NAME` | Email | Optional | `SP College Approval Hub` | Friendly sender name visible in email clients. |
| `BREVO_API_KEY` | Email | Optional | `xkeysib-...` | Brevo HTTPS API key (works on cloud hosts with blocked SMTP). |
| `BREVO_SENDER_EMAIL`| Email | Optional | `noreply@spcollege.edu.in` | Sender email verified inside Brevo console. |
| `RESEND_API_KEY` | Email | Optional | `re_...` | Resend API key for transactional email. |
| `RESEND_FROM` | Email | Optional | `ProcureFlow <noreply@domain.edu.in>` | Domain-verified sender address on Resend. |
| `SMTP_HOST` | Email | Optional | `mail.spcollege.edu.in` | Outgoing SMTP host for college mail servers. |
| `SMTP_PORT` | Email | Optional | `465` (SSL) or `587` (TLS) | Outgoing SMTP port. |
| `SMTP_SECURE` | Email | Optional | `true` | `true` for port 465; `false` for port 587. |
| `SMTP_USER` | Email | Optional | `procureflow@spcollege.edu.in` | SMTP authentication username. |
| `SMTP_PASS` | Email | Optional | *Password or App Password* | SMTP authentication credential. |
| `GDRIVE_CREDENTIALS`| Storage | Optional | Base64-encoded Service JSON | Google Cloud Service Account key for off-site quotation storage. |
| `GDRIVE_FOLDER_ID` | Storage | Optional | `1aB2cD3eF4...` | Google Drive target directory ID. |

---

## 🗄 Database Migrations & Neon Deployment

The production database is hosted on **Neon Serverless PostgreSQL**.

### Migration Protocol:
1. **Create a Neon Safety Branch**:
   In the Neon console, create a point-in-time branch before applying migrations:
   ```bash
   backup-before-migration-YYYY-MM-DD
   ```
2. **Execute Migrations via Direct (Unpooled) Connection**:
   Neon provides two endpoints: pooled (port 5432) and direct (unpooled).
   > [!IMPORTANT]
   > Multi-statement database migrations must always run against the **direct unpooled connection string**, not the pooled endpoint.
3. **Run Verification Script**:
   ```bash
   cd server
   npm run test:branch02-migrations
   ```

---

## 🛡 Enterprise Security & Row-Level Security (RLS)

### Row-Level Security Enforcement
Every data query executed by the backend runs inside an isolated database transaction with the active user's context:
```sql
BEGIN;
SET LOCAL ROLE app_user;
SET LOCAL "request.jwt.claim.sub" = '<USER_UUID>';
SET LOCAL "request.jwt.claim.role" = '<USER_ROLE>';
SET LOCAL "request.jwt.claim.dept" = '<DEPARTMENT_ID>';

-- Query executes; PostgreSQL RLS policies evaluate row visibility automatically
SELECT * FROM procurement_requests WHERE ...;

COMMIT;
```
If a connection is accidentally initiated as the `postgres` superuser, `assertRlsEnforced()` triggers an immediate emergency shutdown on server boot, preventing data leaks.

### Two-Step Verification Recovery
If an administrator loses their TOTP device, run the recovery utility from the server console:
```bash
node server/scripts/admin-recovery.js --reset-mfa admin@spcollege.edu.in
```

---

## 🧪 Automated Test Suite

ProcureFlow features comprehensive end-to-end and unit test coverage across the database, API, and PDF reporting engines:

```bash
# 1. Run Backend REST API Integration Tests (133 tests)
cd server
npm test

# 2. Run PDF Generation & Watermarking Tests
cd ..
node --test src/utils/officialPdfGenerator.test.js src/utils/reportsSummaryPdf.test.js server/test/pdf_generation.test.js

# 3. Run Database Row-Level Security Policy Checks
psql -U app_user -h localhost -p 5433 -d spc_approval -f db/tests/rls_app_user.sql
```

---

## ❓ Troubleshooting & FAQ

#### 1. Why is the favicon not appearing on the browser tab?
Browsers aggressively cache favicons. If you recently updated the branding, perform a hard refresh using `Ctrl + F5` (Windows/Linux) or `Cmd + Shift + R` (macOS), or clear site cache.

#### 2. Password reset / invitation emails are not being delivered on Render.
Render's free tier blocks outgoing SMTP ports (`25`, `465`, `587`). Set `BREVO_API_KEY` and `BREVO_SENDER_EMAIL` or `RESEND_API_KEY` in Render's environment dashboard to send over HTTPS instead of raw SMTP.

#### 3. Why are uploads failing behind Nginx?
By default, Nginx limits request body size to 1MB. Ensure `client_max_body_size 25M;` is declared inside your `server` or `location /api/` block.

#### 4. The server logs error: `API refuses to connect as superuser`.
PostgreSQL superusers bypass Row-Level Security. You must connect as `app_user`. Ensure your `DATABASE_URL` contains `app_user`, not `postgres`.

---

## 👥 Authors & Maintainers

- **Anish Mogam** — Architecture, Full-Stack Engineering, Database Design & PDF Engine
- **Madhura Lakade** — Workflow Business Logic, UI/UX Engineering & Security Verification
- **Isha Joshi** — API Development, Workflow Policy Automation & Documentation

*Sir Parashurambhau College (Autonomous), Tilak Road, Pune, Maharashtra 411030.*
