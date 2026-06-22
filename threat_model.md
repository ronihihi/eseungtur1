# Threat Model

## Project Overview

WorkflowSign is a publicly deployed full-stack e-signature application for uploading documents, assigning recipients, collecting reviews/signatures through unique links, and producing audit-ready signed PDFs. The production stack is a React/Vite frontend and an Express/PostgreSQL backend using cookie-based sessions for account users and URL tokens for recipient review/sign flows. Files are stored in Replit Object Storage via the Google Cloud Storage client, and the backend also integrates with SMTP and optional Azure OAuth.

This threat model assumes `NODE_ENV=production`, TLS is handled by the platform, and only production-reachable surfaces are in scope. Mockup sandbox behavior is out of scope.

## Assets

- **User accounts and sessions** — account email addresses, password hashes, session cookies, role assignments, and Azure-linked identities. Compromise allows impersonation of document owners or administrators.
- **Recipient signing links** — unique review/sign tokens embedded in URLs. Possession of a token grants access to private document content and allows workflow actions without a normal account.
- **Uploaded documents and sealed PDFs** — unsigned source PDFs/DOCX conversions, signed outputs, field placements, and audit attachments. These contain business-sensitive and often legally sensitive data.
- **Audit trail data** — signer names, reviewer notes, timestamps, IP addresses, and document event history. Tampering or unauthorized disclosure undermines legal defensibility and privacy.
- **Application secrets and service credentials** — session secret, database connection string, SMTP credentials, Azure OAuth secrets, and object-storage credentials available through the Replit sidecar.

## Trust Boundaries

- **Browser to API** — all client input is untrusted. The API must authenticate and authorize every account-bound action and treat recipient token routes as externally reachable public endpoints.
- **Public token holder to private document data** — `/sign/:token*` routes intentionally bypass session auth, so token issuance, storage, expiry, and action checks become the primary access-control boundary.
- **API to PostgreSQL** — the backend persists users, documents, recipients, sessions, and audit events in Postgres. Query scoping errors can expose or corrupt cross-tenant data.
- **API to object storage** — the backend reads and writes PDFs via GCS/object storage URIs. Authorization must be enforced before any file read/stream path is reached.
- **API to external identity and email providers** — Azure OAuth callbacks and SMTP delivery cross out of the application trust domain and must not weaken identity binding.

## Scan Anchors

- Production backend entrypoints: `artifacts/api-server/src/app.ts` and `artifacts/api-server/src/routes/*.ts`.
- Highest-risk code areas: `routes/auth.ts`, `routes/signing.ts`, `routes/recipients.ts`, `routes/documents.ts`, `routes/admin.ts`, `routes/pdfSigner.ts`.
- Public surfaces: `/api/sign/:token`, `/api/sign/:token/review`, `/api/sign/:token/file`, `/api/sign/:token/download`, frontend `/sign/:token`, `/review/:token`.
- Authenticated surfaces: `/api/auth/*`, `/api/documents/*`, `/api/recipients/*`, `/api/signing/my-requests`, `/api/admin/*`, `/api/documents/:id/activity`.
- Usually ignore as dev-only unless reachability is proven: `attached_assets/`, local scripts, and non-runtime workspace metadata.

## Threat Categories

### Spoofing

This application has two identity systems: session-authenticated users and public recipients identified only by URL token. Account registration and login must ensure that users cannot claim privileges or recipient workflows they do not legitimately control. Recipient-access features that derive authority from an email string or other mutable identifier MUST be backed by verified ownership, not merely by a self-asserted profile field. Azure callback state MUST be validated and session cookies MUST remain unpredictable and server-validated.

### Tampering

Document metadata, recipient lists, field placements, review decisions, and submitted signatures all cross from untrusted clients into sensitive workflow state. The server MUST enforce ownership on every document mutation, validate token-based actions at the point of use, and prevent stale or replayed links from modifying document state after expiry or completion. Signed PDF generation MUST only use server-authorized field values and document sources.

### Information Disclosure

Private documents, recipient email addresses, audit logs, and signer IPs are highly sensitive. API responses and file-serving endpoints MUST be scoped either to the authenticated document owner or to a currently valid recipient token. Token-only routes MUST not leak more document data than required, and logs/errors MUST avoid exposing secrets, signing URLs, or raw document content.

### Denial of Service

The application accepts large uploads, large JSON bodies, PDF generation work, DOCX conversion through LibreOffice, and on-demand signed-PDF creation. Public and authenticated endpoints MUST bound input sizes, apply rate limits where anonymous work is expensive, and avoid allowing expired or unauthorized callers to trigger costly file or PDF operations. External calls to SMTP/OAuth/storage should fail safely without wedging request handling.

### Elevation of Privilege

Administrative capabilities, audit exports, document-owner functions, and recipient-token actions represent separate privilege levels. The backend MUST enforce those boundaries server-side on every route. Public recipient tokens MUST not become a substitute for broader account access, and unverified user registration MUST not let attackers step into another person’s signing or review authority. Database queries and file-access paths MUST remain parameterized/scoped so that one user cannot reach another user’s records or files.