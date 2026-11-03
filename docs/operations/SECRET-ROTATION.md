# Zero-Downtime Secret & Certificate Rotation Procedure

---

## 1. Root CA & Code-Signing Certificate Rotation

When replacing `certs/ca.crt` and `certs/ca.key`:

1. **Generate New Keypair:**
   ```bash
   openssl req -x509 -newkey rsa:4096 -nodes -keyout /secure/storage/ca_new.key \
     -out /secure/storage/ca_new.crt -days 3650 \
     -subj "/CN=IT-Toolkit Enterprise Root CA (2026)/O=Aaditech IT-Toolkit/OU=Security"
   ```
2. **Dual-Trust Window:**
   Deploy `ca_new.crt` to target endpoints via GPO alongside existing root certificate before replacing active signing key.
3. **Re-sign Code Artifacts:**
   Issue newly signed MSI packages using `ca_new.crt`.
4. **Retire Old Certificate:**
   Remove deprecated root certificate from target machines once all agents run new version.

---

## 2. API Token & JWT Secret Rotation

1. **Bootstrap Secret Rotation:**
   New bootstrap tokens are signed with the updated key. Existing valid device tokens continue to authenticate via `device_token_hash`.
2. **JWT Secret Rotation:**
   Deploy server with dual verification support: verify against `JWT_SECRET_NEW`, falling back to `JWT_SECRET_OLD` for remaining token lifespan (typically 24 hours).
3. **Command Signing Key Rotation:**
   Coordinate rollout of new signing key in `agent-config.json` before enforcing on server.
