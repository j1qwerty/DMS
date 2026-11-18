# DMS — Deployment and Operations Runbook

**Applies to:** Zila Panchayat DMS on the isolated zila_codex release line.  
**Audience:** Department IT administrator and approved application support personnel.  
**Status:** operational template — complete the environment-specific fields and rehearse every procedure before production takeover.

This runbook is part of the software handover pack. It is not a substitute for the approved production infrastructure design, security review or backup policy.

---

## 1. System components

| Component | Technology | Operational responsibility |
|---|---|---|
| Web client | React 19, TypeScript, Vite, Tailwind v4 | Static production build served by the approved web server/reverse proxy |
| API | ASP.NET Core 10 | Application service, authentication, authorization, file/scan operations and API health |
| Database | Microsoft SQL Server + EF Core 10 | Registry, users, locations, issue/return, scan metadata, audit and application transactions |
| Private document storage | Filesystem storage behind IPrivateDocumentStore | Original PDF/image uploads and generated PDF derivatives; must persist across application releases |
| Background jobs | Hangfire | Scheduled jobs; verify the configured storage provider and scheduler in the target environment |
| Cache/realtime | In-memory or configured Redis; SignalR | Cache invalidation and live UI updates; Redis is optional in the current API configuration |

## 2. Environment record

Complete this section for each environment. Do not put secret values here.

| Item | Development | Test/UAT | Production |
|---|---|---|---|
| Web URL / domain | | | |
| API URL / health URL | | | |
| Web host / owner | | | |
| API host / owner | | | |
| SQL Server instance / database | | | |
| Document storage root / volume | | | |
| TLS certificate / renewal owner | | | |
| Secrets vault / access owner | | | |
| Monitoring / alert route | | | |
| Release tag / commit SHA | | | |

## 3. Required configuration inventory

API configuration is supplied through appsettings and environment variables. The environment variable form uses double underscores for nested keys.

| Configuration key | Purpose / production handling |
|---|---|
| ConnectionStrings__Default | SQL Server connection; use a dedicated least-privilege application login. Secret must not be committed. |
| Jwt__SigningKey | Strong random signing key, unique per environment and stored in the secrets vault. Replace the development placeholder before production. |
| Jwt__Issuer / Jwt__Audience / Jwt__ExpiryMinutes | Token validation settings; record approved values. |
| Database__MigrateOnStartup | Controls EF migration on startup. Production migration policy must be explicitly approved and migration outcome monitored. |
| Database__SeedOnStartup | Demo seed behavior. Production must not retain shared demonstration credentials; approve initial administrator provisioning and disable/remove demo accounts. |
| FileStorage__RootPath | Persistent private document directory, outside the replaceable API publish directory. |
| FileStorage__MaxUploadBytes | Current API default is 48 MiB; reverse-proxy request limits must be compatible. |
| Redis__ConnectionString | Optional cache. Confirm whether Redis is used or API memory fallback is accepted. |
| Hangfire__Storage / Hangfire__EnableScheduling | Background-job storage and scheduler; confirm the provider is durable and appropriate for production. |
| Swagger__Enabled | Keep API documentation endpoint disabled in production unless explicitly approved and protected. |
| Cors__AllowedOrigins | Exact HTTPS frontend origin(s); do not use wildcard origins for authenticated production traffic. |
| Features__BarcodeEnabled | Retained non-scope module; default false unless separately approved. |
| Features__MovementEnabled | Retained standalone movement module; default false unless separately approved. |
| Features__SupportEnabled | Retained support/inquiry/media module; default false unless separately approved. |
| Features__BulkImportEnabled | Retained bulk-import module; default false unless separately approved. |
| Scope__ExpectedFileCount | Department-approved registry denominator; do not guess. Positive value only after signed inventory confirmation. |
| Scope__ExpectedPageCount | Department-approved digitization denominator; do not guess. Positive value only after signed page-volume confirmation. |

The deployment script preserves previously approved positive file/page baselines when zero is passed. Only supply a new positive count after formal Department sign-off.

## 4. Build and verification from a clean checkout

Record the release tag and commit SHA before building. Use a clean checkout and the lockfile committed with the source.

### Frontend

From record-room-frontend:

    corepack enable
    corepack prepare pnpm@10.15.0 --activate
    pnpm install --frozen-lockfile
    pnpm format:check
    pnpm lint
    pnpm typecheck
    pnpm test
    pnpm build

Archive the generated production output and the command logs. Do not deploy a developer-mode Vite server.

### API

From dotnet-api:

    dotnet restore
    dotnet build --configuration Release
    dotnet test --configuration Release
    dotnet publish src/RecordRoom.Api/RecordRoom.Api.csproj --configuration Release --output ./artifacts/api

The HTTP smoke harness uses a real running API and a dedicated test SQL Server database. Run it only against the dedicated test database:

    .scripts	est-api.ps1 -BaseUrl http://localhost:5199

Do not run destructive smoke scenarios against production. A clean frontend build or .NET build does not prove that SQL migrations, document storage, role boundaries or the complete HTTP workflows pass.

## 5. Deployment

The repository deployment script is deploy-recordroom.ps1. Its supported target values are api, web and both. The host alias, server IP, ports and provisioning behavior must be reviewed and changed to match the Department-approved environment before use.

Typical invocation after the host configuration is approved:

    .deploy-recordroom.ps1 -Target both

A deployment runbook entry must capture:

- Release tag and commit SHA.
- Operator and approval reference.
- Target host/environment.
- Frontend/API artefact hashes.
- Database migration state before and after deploy.
- Configuration revision identifier (not secret contents).
- Deployment start/end time.
- Smoke-check outcome and exceptions.

### Deployment gates

- Use HTTPS for all production browser/API traffic. Do not accept production credentials over plain HTTP.
- Keep SQL Server and private document storage inaccessible directly from the public internet.
- Use a dedicated service identity and least-privilege database account.
- Keep API secrets out of source files and shell history; use protected environment injection or the Department vault.
- Keep production Swagger disabled unless the security owner has approved a protected access method.
- Verify whether startup seeding is enabled. Demo accounts/passwords must not remain enabled for normal production use.
- Apply schema migrations only after a tested backup and approved deployment window.
- Keep private document storage on durable storage outside any folder replaced by deployment.
- Verify the reverse-proxy upload request limit against the API's maximum upload size.
- Confirm CORS contains only approved HTTPS frontend origins.

## 6. Health and routine checks

API health is exposed at /api/health. Confirm the response reports a healthy database connection and no pending migration unexpectedly remains. A successful web page response alone is not enough.

At the beginning of each support shift, verify:

- Web page loads over HTTPS.
- API health endpoint is healthy.
- SQL Server is reachable and storage is writable.
- Available disk space for database, transaction logs and document storage.
- Latest database and document-store backups completed.
- Background-job scheduler is active and no persistent failed jobs require action.
- No unexpected rise in API errors, failed logins or denied authorization events.
- Document upload, open and generated PDF retrieval work from a controlled test record.

Record results and escalate any failed health or backup check.

## 7. Database and document backup/restore

The application database and private document directory are one logical recovery set.

### Backup

1. Use the approved SQL Server backup procedure and record backup type, timestamp and destination.
2. Back up the private document root, preserving file names/keys, permissions and directory structure.
3. Capture the application release tag and EF migration history alongside the backup.
4. Store a protected off-host copy according to Department retention policy.
5. Encrypt backup media and restrict access to named custodians.

### Restore drill

1. Select a recent approved backup set and restore to an isolated recovery environment.
2. Restore SQL Server first using the documented database procedure.
3. Restore the corresponding private document directory to the configured storage root.
4. Deploy the matching application release or a tested compatible release.
5. Check /api/health, login, role-based access, registry search, document open/download and final PDF retrieval.
6. Compare stored document hashes and verify representative database-to-document links.
7. Record recovery time, missing/corrupt assets, recovery point and remediation.
8. Obtain the Department IT owner's approval before declaring the restore drill successful.

RPO, RTO, schedule and retention are Department decisions and must be written into the environment record before go-live.

## 8. Incident response

For a production incident:

1. Record time detected, affected URL/service, reporter, user impact and first observed error.
2. Preserve application, reverse-proxy, SQL Server and background-job logs. Preserve relevant audit records.
3. Identify whether the fault is web, API, database, storage, authentication, network or external dependency.
4. Do not manually edit production database rows or delete stored documents to clear an error.
5. Escalate data loss, suspected unauthorized access, exposed credentials or integrity failures immediately to the Department security/IT owner.
6. Apply a rollback or hotfix only under the approved change process.
7. Record root cause, affected records, recovery action, validation and closure approval.

## 9. Release and change management

- Every release must have a tag, commit SHA, release notes, test evidence and approval.
- Changes to production environment variables and secrets must be logged in the Department's configuration register.
- Database migrations must be reviewed and rehearsed against a copy of the production schema/data.
- Changes to roles, permissions, optional feature flags, retention, backup, network and storage must receive the appropriate owner approval.
- Keep a known-issues register and a clear distinction between defects, approved limitations and future change requests.
- Do not merge newer v2 changes into the zila_codex release line without a separate approved integration/review.

## 10. Contacts and acceptance record

| Responsibility | Name / team | Contact / approved channel |
|---|---|---|
| Department application owner | | |
| Department IT/infrastructure owner | | |
| Database administrator | | |
| Application support / delivery team | | |
| Security/incident contact | | |
| Backup and recovery owner | | |

| Operational transfer | Evidence | Date / result |
|---|---|---|
| Deployment rehearsal | Release log and health checks | PENDING |
| Database migration rehearsal | Migration output and schema review | PENDING |
| Backup/restore drill | Restore report and integrity checks | PENDING |
| Security review | Signed findings/exception register | PENDING |
| Monitoring/escalation | Alert test and contact list | PENDING |
| Admin/operator training | Attendance and practical check | PENDING |
| Department operational takeover | Signed application handover register | PENDING |
