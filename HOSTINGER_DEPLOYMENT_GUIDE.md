# Hostinger Shared Hosting (Business Plan) Deployment Guide
## IT-Toolkit Enterprise (Node.js + MySQL)

This step-by-step guide walks you through deploying **IT-Toolkit Enterprise** on a **Hostinger Business Web Hosting** account using **Hostinger hPanel**, **MySQL/phpMyAdmin**, and the **Node.js application selector**.

---

### Step 1: Create the MySQL Database in Hostinger
1. Log in to your **Hostinger hPanel**.
2. Navigate to **Databases** -> **MySQL Databases**.
3. Create a new database:
   - **Database Name:** e.g., `u123456789_aaditech`
   - **MySQL Username:** e.g., `u123456789_admin`
   - **Password:** Generate a strong password (copy this for `.env`).
4. Click **Create**.

---

### Step 2: Import the Database Schema
1. Under **Databases** -> **MySQL Databases**, find your newly created database.
2. Click **Enter phpMyAdmin**.
3. In phpMyAdmin, click the **Import** tab at the top.
4. Select the file: `/database/mysql/schema.sql` from this repository.
5. Click **Go** at the bottom.
6. Verify the following tables are created:
   - `tenants`, `users`, `device_groups`, `policies`
   - `devices`, `device_processes`, `device_app_usage`, `telemetry_history`
   - `patch_inventory`, `command_queue`, `alerts`, `audit_logs`

---

### Step 3: Configure Environment Variables
In your project root (or via Hostinger's Environment Variables manager), create or update `.env`:

```env
PORT=3000
NODE_ENV=production

# Hostinger MySQL Database Credentials
DB_HOST=localhost
DB_PORT=3306
DB_NAME=u123456789_aaditech
DB_USER=u123456789_admin
DB_PASSWORD=YourStrongDatabasePasswordHere

# Security Secrets
BOOTSTRAP_SECRET=aaditech_master_bootstrap_secret_key_2026
COMMAND_SIGNING_KEY=aaditech_cmd_sig_key_ec_991823
```

*(Note: On Hostinger shared hosting, `DB_HOST` is almost always `localhost` or `127.0.0.1`).*

---

### Step 4: Configure Node.js Application in Hostinger hPanel
1. In hPanel, navigate to **Websites** -> **Manage** -> **Advanced** -> **Node.js**.
2. Click **Create Application**:
   - **Node.js version:** Choose **v18.x** or **v20.x** (LTS).
   - **Application Mode:** **Production**.
   - **Application Root:** `/domains/yourdomain.com/public_html` (or your subdirectory).
   - **Application Startup File:** `server.js`.
3. Upload your files via Git, FTP, or File Manager.
4. Click **Run NPM Install** (or install via Hostinger SSH terminal `npm install --omit=dev`).
5. Click **Restart Application**.

---

### Step 5: Test Portal & Verify Database Connection
1. Visit your domain in a browser: `https://yourdomain.com`
2. Check database connection status at:
   `https://yourdomain.com/api/v1/database/status`
   You should see:
   ```json
   {
     "status": "ok",
     "storage_engine": "MySQL (Hostinger Production)",
     "mysql_connected": true,
     "database": "u123456789_aaditech"
   }
   ```

---

### Step 6: Deploy Windows Endpoint Agents
Because Hostinger shared hosting does not allow building Windows MSI binaries with WiX toolset, agents are deployed using the streamlined PowerShell/CMD installer package:

1. On the web portal, click **Download Agent Bundle** or navigate to **Fleet Setup**.
2. Extract the downloaded ZIP package onto any target Windows PC.
3. Right-click `install-agent.cmd` -> **Run as Administrator**.
4. The agent will:
   - Copy scripts to `C:\ProgramData\AaditechAgent\`
   - Read server endpoint and token from `agent.json`
   - Register a resilient Windows Scheduled Task (`AaditechAgent`) running every 30 seconds
   - Ingest live hardware, CPU, RAM, disk, active processes, and antivirus posture into your Hostinger MySQL database immediately!
