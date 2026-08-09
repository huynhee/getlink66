# 3DiPL plugin staging

1. Point `staging.3dipl.org` to the VPS and install Docker Compose plus Caddy.
2. Copy `backend/.env.staging.example` to `/etc/3dipl/staging/backend.env`, replace every placeholder, and restrict the file to the deploy account.
3. Keep staging MongoDB, storage, JWT, Turnstile and release keys separate from Production. Do not enable production payments.
4. Start the isolated stack with `docker compose -f compose.staging.yml up -d --build` and install `deploy/Caddyfile.staging` in the host Caddy configuration.
5. Initialize the staging replica set once, then run `NODE_ENV=production npm run env:check` inside the backend container.
6. Publish the signed staging MZP under `/var/lib/3dipl-staging/plugin-releases`, copy SHA/signature/timestamp from the generated release manifest into the staging env, and recreate the backend container.
7. Run DevHost Live and the Max 2026 E2E checklist before changing Production.

The `x-3dipl-qa-risk-secret` header only marks a device authorization as risky when `PLUGIN_DEPLOYMENT_ENV=staging`. Production readiness rejects `PLUGIN_QA_RISK_SECRET` when deployment environment is Production.
