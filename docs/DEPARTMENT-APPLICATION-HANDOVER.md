# Zila Panchayat DMS — Department Application Handover

**Purpose:** controlled transfer of the completed software solution and its operational responsibility to the Zila Panchayat Department.

**This is a project delivery document, not an application feature.** Physical custody of records remains covered separately by the DMS custody register.

**Working branch:** zila_codex  
**Release tag:** PENDING — create only after the release candidate passes the gates below.  
**Production environment:** PENDING — confirm the Department-approved host, domain, database and storage owners.  
**Handover state:** **NOT READY FOR SIGN-OFF** until the mandatory evidence and approvals in this document are complete.

---

## 1. Handover principles

1. Hand over a reproducible, tested release—not merely the current source branch or a developer workstation copy.
2. Give the Department the source repository, build/publish artefacts, database schema and migrations, deployment/rollback instructions, configuration inventory, operating instructions and test evidence.
3. Transfer credentials and secrets only through a Department-approved secure channel or vault. Never commit passwords, private keys, connection strings or production tokens to Git or place them in this document.
4. The Department must receive the knowledge and access needed to build, deploy, operate, back up, restore and support the application without depending on an individual developer's machine or personal account.
5. Record every asset, owner, recipient, date, version and acceptance result. Any item not supplied must be explicitly listed as an exception with an owner and target date.

## 2. Software deliverables

| Deliverable | Expected content | Evidence / status |
|---|---|---|
| Source repository | React frontend, .NET API, SQL Server EF migrations, deployment scripts, tests and supporting documentation | Repository ownership/admin access transfer: **PENDING** |
| Frozen release | Release tag and commit SHA, release notes, dependency lockfiles and change summary | Create after all release tests pass: **PENDING** |
| Frontend build | Reproducible production build output from the tagged source | Build from a clean checkout and archive output: **PENDING** |
| API publish | Release-published .NET API output for the approved target runtime | Publish from the tagged source and archive output: **PENDING** |
| Database package | Schema, EF migrations, data dictionary, indexes, SQL Server prerequisites and upgrade notes | Migration validation on a clean DB and an upgrade DB: **PENDING** |
| Configuration inventory | Required environment keys, non-secret values, secret owners, feature flags, baseline settings and environment-specific differences | Completed configuration register: **PENDING** |
| Technical documentation | Architecture, component/dependency list, API surface, data model, deployment, rollback, backup/restore and troubleshooting | Final reviewed documentation set: **PARTIAL** |
| User/admin documentation | Role-specific procedures, screenshots from the final release, scanning and issue/return workflows, user provisioning and support escalation | Prepare and validate against release candidate: **PENDING** |
| Test evidence | Frontend, API, database migration, authorization, security, performance and UAT results | Attach command output/reports and target environment: **PENDING** |
| Third-party inventory | Runtime/package dependencies, versions and licence notices | Generate and review for release: **PENDING** |

The release must be traceable to one commit. Do not use a moving branch name as the sole release identifier.

## 3. Repository and intellectual-property transfer

- [ ] Confirm the Department's preferred Git hosting organisation and repository ownership.
- [ ] Transfer or grant the agreed owner/admin/maintainer/read access to named Department accounts.
- [ ] Remove personal-account dependencies for CI, deployment, package registries, domain/DNS and monitoring.
- [ ] Confirm the release tag and commit SHA match the deployed build.
- [ ] Provide a source archive only as a secondary copy; the live Git repository remains the primary maintained source.
- [ ] Supply third-party dependency and licence inventory; identify separately licensed fonts, icons, libraries, services and hosted components.
- [ ] Record ownership/licence terms for custom source code, documentation, design assets and any supplied data.
- [ ] Confirm that secrets, production data and personal information are not present in the source archive or Git history.

Repository transfer must not merge this branch with newer v2 changes unless that integration is explicitly reviewed and approved as a separate change.

## 4. Production environment and deployment

The final environment must be confirmed by the Department/IT owner. An existing development or vendor-hosted instance is not automatically the Department's accepted production environment.

### Infrastructure inventory

| Component | Required handover information | Status |
|---|---|---|
| Web host | Provider, host/VM name, OS/version, CPU/RAM/disk, owner and access method | **PENDING** |
| API host | Runtime version, service name, service account, working directory, health endpoint and restart procedure | **PENDING** |
| SQL Server | Version/edition, instance, database name, collation, Full-Text Search availability, owner and backup location | **PENDING** |
| Document storage | Private storage root, persistent volume, capacity, permissions, backup policy and restore path | **PENDING** |
| Domain/TLS | Department domain, DNS owner, certificate issuer/renewal process and HTTPS verification | **PENDING** |
| Network | Inbound/outbound ports, firewall rules, reverse proxy, trusted proxy configuration and approved IP restrictions | **PENDING** |
| Email/SMS/other integrations | Provider, sender identities, credentials owner, callback URLs and test evidence, if applicable | **PENDING / N/A by approval** |
| Monitoring | Health checks, log location, alert routing, disk/database thresholds and responsible team | **PENDING** |

Production credentials and connection strings are handed over separately. This document must contain only secret names/owners and the approved storage location—not secret values.

### Deployment procedure

- [ ] Confirm a production-like staging environment and a separate test database.
- [ ] Verify supported .NET SDK/runtime and Node/pnpm versions from the release documentation.
- [ ] Build the frontend from a clean checkout with the frozen lockfile.
- [ ] Restore, build and publish the .NET API from the same release commit.
- [ ] Review all required API environment variables and frontend build-time settings.
- [ ] Configure the SQL Server connection using a least-privilege application login.
- [ ] Confirm SQL Server Full-Text Search installation/availability; document the metadata-search fallback where it is unavailable.
- [ ] Apply migrations to a clean test database and to a copy of the existing database. Review the generated schema changes before production.
- [ ] Configure private document storage on persistent storage outside replaceable release directories.
- [ ] Verify read/write permissions for the API service account and deny public/static web access to private documents.
- [ ] Deploy the API and web build; configure reverse proxy, HTTPS, request limits and health checks.
- [ ] Verify login, role-based access, registry search, file upload/view, digitization review/PDF composition, issue/return, custody, reports and audit.
- [ ] Verify restart/reboot recovery, persistent uploaded documents and background jobs.
- [ ] Record deployment commit SHA, migration version, configuration revision, operator and timestamp.
- [ ] Obtain IT approval before switching production traffic.

### Rollback plan

The release owner must document the previous known-good release, API/web rollback procedure, database compatibility constraints, migration rollback or forward-fix policy, storage rollback considerations and decision authority. Do not roll back a database migration or delete uploaded documents without a tested recovery plan.

## 5. Database, records and document-storage handover

- [ ] Supply the final data dictionary, relationship diagram, key/index inventory and migration history.
- [ ] Identify source data, imported records, rejected rows, duplicates, missing fields and reconciliation exceptions.
- [ ] Reconcile the source inventory against imported record counts and a Department-approved sample.
- [ ] Confirm file/page/page-side volume baselines with the Department before setting Scope:ExpectedFileCount and Scope:ExpectedPageCount.
- [ ] Explain how file records, scanned page versions, generated PDFs, audit records and physical custody events relate.
- [ ] Identify the SQL Server database backup owner, schedule, retention and off-host copy location.
- [ ] Back up the SQL Server database and private document store as one coordinated recovery set.
- [ ] Demonstrate restore to an isolated environment and verify document hashes/openability and record-to-document links.
- [ ] Confirm encryption at rest and in transit, retention, archival, legal hold and secure deletion requirements.
- [ ] Document capacity thresholds and expansion procedure for database, transaction log and private document storage.

The private document directory is part of the application data. A database-only backup is not a complete DMS backup.

## 6. Security and access handover

- [ ] Confirm the Department's identity/account provisioning owner and account approval process.
- [ ] Provide the Admin, Supervisor, Operator and Employee capability matrix, including which screens and server operations each role can access.
- [ ] Create named individual accounts; do not operate production through shared demo accounts.
- [ ] Change/remove all demonstration and deployment credentials before go-live.
- [ ] Transfer production secrets via the approved vault/channel and record the receiving owner.
- [ ] Confirm password policy, account deactivation, recovery process and any Department-required MFA/SSO policy.
- [ ] Review HTTPS/TLS, proxy headers, CORS, cookie/token handling, file validation, upload limits and private-storage access.
- [ ] Confirm audit-log access, retention, backup and protection from unauthorized alteration.
- [ ] Complete vulnerability/dependency review and document any accepted security exceptions.
- [ ] Record security contact, incident escalation route and credential-rotation schedule.

No account, password, token or private key should be embedded in the repository, screenshots, test reports or this handover file.

## 7. Operations and maintenance transfer

The receiving IT team must be able to perform the following without developer intervention:

- Start, stop, restart and inspect the web/API services.
- Check application health, SQL Server connectivity and document-storage availability.
- Review application, reverse-proxy, database and background-job logs.
- Diagnose login, permission, upload, PDF composition and search failures.
- Monitor database size, transaction log, document-storage capacity and backup completion.
- Restore the database and document files to an isolated environment.
- Rotate secrets/certificates and deactivate staff accounts.
- Apply an approved release, verify migrations and revert the application where safe.
- Escalate a production incident and preserve relevant logs/audit evidence.

Use OPERATIONS-RUNBOOK.md as the working operations procedure. It must be verified against the actual Department production environment before acceptance.

## 8. User training and knowledge transfer

Training is required for the roles that will operate the application. Record date, trainer, attendees, role, topics, practical exercise results, questions and outstanding actions.

| Audience | Minimum topics | Completion |
|---|---|---|
| Department Admin | User provisioning/deactivation, role access, configuration, audit, reports and escalation | **PENDING** |
| Supervisor / reviewer | Registry corrections, scan review, rejection/rescan, PDF output, custody reconciliation and exception handling | **PENDING** |
| Operator / data-entry staff | Search, create/update file metadata, room/shelf placement, upload, scanning intake and issue/return | **PENDING** |
| Employee / read-only user | Search, view permissions, request/issue-return procedures and support route | **PENDING** |
| Department IT | Deployment, monitoring, backup/restore, security, certificate/secret rotation and incident response | **PENDING** |

Training is not complete when a presentation is delivered; each group must complete the agreed practical workflow and receive the relevant quick-reference guide.

## 9. UAT, pilot and production acceptance

The Department and delivery team must agree the test dataset and acceptance thresholds before executing sign-off. At minimum, retain evidence for:

- [ ] Authentication and inactive-user denial.
- [ ] Admin/Supervisor/Operator/Employee permission matrix, including direct API calls.
- [ ] File creation, search, metadata validation, duplicate handling and pagination.
- [ ] Room/section/almirah/shelf hierarchy and physical location accuracy.
- [ ] PDF/image upload, retrieval, version retention and unauthorized-access denial.
- [ ] Scan page/side identity, review, rejection reason and rescan behavior.
- [ ] Final PDF generation, page count, readability, orientation, crop and output sample acceptance.
- [ ] Issue, partial return, overdue and audit behavior.
- [ ] Custody intake, count reconciliation, exceptions and department return sign-off.
- [ ] Dashboard counts against the approved physical/source register.
- [ ] SQL Server migration/upgrade, backup/restore, service restart and data persistence.
- [ ] Performance/load test using Department-agreed concurrency and data volumes.
- [ ] Security review and closure/acceptance of high-severity findings.
- [ ] User and IT training completion.

**Known scope dependencies that must not be represented as complete without evidence:** external e-office transfer needs its approved interface and credentials; Hindi/English OCR needs a representative-scan POC and an approved engine/accuracy threshold; automated image-quality gates need measurable DPI/legibility/crop criteria; full Scan Studio and PDF/A certification need implementation and acceptance evidence. These items must either be completed or explicitly recorded as approved exclusions/phase items before the Department signs the release.

## 10. Support, warranty and change control

Agree and record before operational takeover:

- Warranty/support start and end dates.
- Support hours, severity definitions, response and resolution targets.
- Named first-line, application, database and infrastructure contacts.
- Escalation path and out-of-hours contact method.
- Defect triage and hotfix approval process.
- Security patch and dependency update responsibility.
- Backup monitoring and periodic restore-drill owner.
- Change request approval, versioning and release-window process.
- Source-code maintenance and repository ownership after handover.

Do not invent a support SLA or warranty duration. Obtain written Department approval and attach it to the signed handover pack.

## 11. Handover register

| # | Asset / evidence | Version / location | Delivered by | Received by | Date | Accepted / exception |
|---:|---|---|---|---|---|---|
| 1 | Source repository and release tag | PENDING | | | | |
| 2 | Frontend build artefact | PENDING | | | | |
| 3 | API publish artefact | PENDING | | | | |
| 4 | SQL schema, migration and data dictionary | PENDING | | | | |
| 5 | Configuration and secure secret-transfer register | PENDING | | | | |
| 6 | Deployment and rollback runbook | PENDING | | | | |
| 7 | Backup/restore evidence and recovery set | PENDING | | | | |
| 8 | Security and role/access matrix | PENDING | | | | |
| 9 | User and administrator guides | PENDING | | | | |
| 10 | Test/UAT and performance evidence | PENDING | | | | |
| 11 | Training materials and attendance | PENDING | | | | |
| 12 | Support contacts, warranty and SLA | PENDING | | | | |
| 13 | Known issues, exclusions and approved future phases | PENDING | | | | |

## 12. Final sign-off

Completion of this document requires the attachments and evidence above. Signing acknowledges receipt and the agreed responsibility transfer; it does not silently waive listed defects, exclusions or unresolved dependencies.

| Role | Name / designation | Signature | Date |
|---|---|---|---|
| Delivery / implementation lead | | | |
| Department nodal officer | | | |
| Department application owner | | | |
| Department IT / infrastructure representative | | | |
| Department authorized accepting officer | | | |

**Outstanding exceptions / conditions of acceptance:**  
______________________________________________________________________________  
______________________________________________________________________________  
______________________________________________________________________________
