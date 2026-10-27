# OPTIC NextGen

Configurable workflow platform for Mail, Workload, and future entities. A new workload type is onboarded through an immutable Definition Release rather than React or Node.js code changes.

This repository is being built in the vertical slices defined by the technical design specification. The system stays runnable after each slice.

Architecture, logging, and accessibility notes are kept current as slices land:

- [Architecture overview](docs/architecture/overview.md)
- [Logging and exceptions](docs/architecture/logging-and-errors.md)
- [WCAG 2.1 AA / Section 508](docs/architecture/accessibility-508.md)
- [Officer Workspace user guide](docs/guides/officer-workspace-user-guide.md) — day-to-day officer use (plain language)
- [Designer user guide](docs/guides/designer-user-guide.md) — build and publish processes (plain language)
- [Onboard a new workload from scratch](docs/guides/onboard-a-new-workload.md) — deep authoring walkthrough
- [High-level requirements (PDF)](docs/optic-nextgen-high-level-requirements.pdf) — contractual scoping for prospective customers ([Markdown source](docs/optic-nextgen-high-level-requirements.md))

## Current slice

**Slice 18 — Officer Workspace, tracking mint, labels, and scan**

- Header is **Workspace** (officer product) and **Designer** (authoring). There is no Station product name.
- **Workspace** groups a **Workload Type** (mail + workload drafts or activated releases). **Try** walks saved drafts; **Live** uses activated queues. **Working as** is a name or email you type; assign, release, and Assigned to me use that value. **Reassign** asks who should receive the case. Queues show the stored assignee as entered.
- **Find a case** sits at the top of the main pane (Tracking ID, Receipt number, Entity type, Stage, Assignee). Workload Type and queue nav stay on the left. Results are a stacked list with row numbers; click the row to open. **Clear** empties the fields and removes the list. A full scan or exact tracking ID opens immediately.
- `GET /api/v1/search?q=` matches tracking ID only. `receiptNumber=` is a separate prefix on the projected receipt column.
- Live **New mail arrives** mints `POST /api/v1/tracking-ids` (`M-` / `W-` + 10 Crockford chars). QR payload `OPTIC:MAIL:{id}` / `OPTIC:WORKLOAD:{id}`. `GET /api/v1/workflows/scan?q=` opens by payload or bare tracking id. Status on the sticker is text. Browser Print only (no printer SDK).
- Mail Complete can spawn workload instances and copy matching repeating-row fields (for example workload status) onto the child.
- Designer **Try** is still the single-definition walk-through for the opened draft. Workspace **Try** is the officer path across the whole type.

Slices 1–17 remain in place. Later: dedicated printer SDK, GitHub export, live Splunk HEC, notifications, ICAM/RBAC admin.

## Previous slice

**Slices 16–17 — Officer Workspace and mail packets**

- Header is **Workspace** and **Designer**. Officers pick a **Workload Type**, then mail-item vs workload queues.
- Mail Complete can spawn workloads and copy matching repeating-row fields onto the child. Opening a workload recovers parent mail screens.
- **Find a case** lives on Workspace (Tracking ID, Receipt number, Entity type, Stage, Assignee). Designer **Try** stays the single-definition walk-through.

**Slice 15 — Catalog designers, global search, supervisor reassignment**

- Designer **Catalog** authors actions, queues (including eligibility), SLAs, search, bulk actions, and scheduled actions on a DRAFT.
- Designer **Lifecycle** validates, submits, approves, rejects, returns to draft, publishes, activates, deactivates, and retires the opened release (change **Actor id** for separation of duties).
- Form **Properties** edit SELECT options and behavior `required` / `readOnly` effects.
- `GET /api/v1/search` queries `workflow_queue_projection` using pinned-release search metadata.
- `POST .../reassign` moves assignment when `X-Actor-Roles` includes `SUPERVISOR` or `ADMIN`. Event: `WORKLOAD_REASSIGNED`. Stage `assignmentPolicy` controls assign, reassign, and release (`OPTIC-WF-40092` / `OPTIC-WF-40093`).

**Slice 14 — Workflow and form designers**

- `npm run dev:web` → **Designer** opens a three-pane form designer (palette, canvas, properties) and a positioned workflow graph.
- **Create draft** can clone an existing version. **Form** picks among release forms; **New form** starts a blank draft. Save writes `PUT .../forms/{formKey}`, then `PUT .../schema` when JSON Schema is present, or `PUT .../workflow`.
- Form **Schema** is a JSON Schema editor. Behaviors and transition rules use `all` / `any` / `not` groups. Fields reorder by drag or Up/Down.
- **Try** walks the saved draft as an officer (`POST /api/v1/workflows` with `version`, then assign / save / complete). **Simulate** posts saved `transitionSetKey` + JSON to `POST .../simulate`. **Diff** lists semantic changes from `GET .../diff/{from}/{to}`.
- Published and other non-DRAFT releases stay read-only.

**Slice 13 — Bulk actions**

- `POST /api/v1/bulk-actions/{bulkActionKey}/execute` runs a configured `ATOMIC` or `BEST_EFFORT` bulk action against selected items.
- Shared input is validated, `writeMappings` copy values onto each item, and an optional `transition.targetStage` moves them.
- Per-item results persist on `bulk_operation` / `bulk_operation_item`. `GET /api/v1/bulk-operations/{id}` returns the run.
- ATOMIC rolls back every item (and the operation row) if any item fails. BEST_EFFORT records success and failure per item.
- Queue pages include `bulkActions` the actor may execute. Shared-input fields use schema `title`s. Eligibility can require unassigned-or-mine plus `all` / `any` / `not` workflow predicates.
- `QueueScreen` has a selection toolbar. **Workspace → Live** calls assign, release, and bulk execute through the Vite `/api` proxy.

Slices 1–12 remain in place.

## Run locally

Prerequisites: Node.js 20+ and Docker (for MySQL).

```bash
cp .env.example .env
docker compose up -d mysql
npm install
# App and migrate read .env (127.0.0.1:3307 = Docker MySQL). Host MySQL on 3306 is unused.
npm run migrate
npm run seed:bulk
npm run dev
# In another terminal, Workspace + Designer:
npm run dev:web
```

Health checks:

- `GET /health/live` — process is up
- `GET /health/ready` — process and database are reachable

`npm run seed:bulk` publishes `I_131_BULK` (author / approver / publisher separation of duties) and creates `W-DEMO-SHIP-1` and `W-DEMO-SHIP-2`. It also seeds **I-407**: `I_407_MAILITEM` + `I_407_WORKLOAD` version `1.0.0` published and activated for **Workspace → Live**, plus version `1.1.0` drafts for Designer and **Workspace → Try**, and demo cases `M-DEMO-I407-1` / `W-DEMO-I407-1`. Open **Workspace → Live** in the web demo after both `npm run dev` and `npm run dev:web` are running. Vite proxies `/api` and `/health` to the API `PORT` (default `http://127.0.0.1:3000`). If that port is already taken, set `PORT` in `.env` and restart both processes. The seed is idempotent. `npm run seed:i407` runs only the I-407 part.

Dev authentication (Slice 1 placeholder; ICAM/PIV/SAML is the production source):

```text
Authorization: Bearer dev-token
X-Actor-Id: configurator@example.gov
```

## Draft configuration APIs

| Method | Path |
| --- | --- |
| POST | `/api/v1/config/definitions` |
| GET | `/api/v1/config/definitions` |
| POST | `/api/v1/config/definitions/{key}/releases` |
| GET | `/api/v1/config/definitions/{key}/releases/{version}` |
| DELETE | `/api/v1/config/definitions/{key}/releases/{version}` (DRAFT only) |
| PUT | `/api/v1/config/definitions/{key}/releases/{version}/workflow` |
| PUT | `/api/v1/config/definitions/{key}/releases/{version}/schema` |
| PUT | `/api/v1/config/definitions/{key}/releases/{version}/forms/{formKey}` |
| PUT | `/api/v1/config/definitions/{key}/releases/{version}/actions/{actionKey}` |
| PUT | `/api/v1/config/definitions/{key}/releases/{version}/queues/{queueKey}` |
| PUT | `/api/v1/config/definitions/{key}/releases/{version}/bulk-actions/{bulkActionKey}` |
| PUT | `/api/v1/config/definitions/{key}/releases/{version}/scheduled-actions/{scheduledActionKey}` |
| PUT | `/api/v1/config/definitions/{key}/releases/{version}/slas/{slaKey}` |
| PUT | `/api/v1/config/definitions/{key}/releases/{version}/search` |
| GET | `/api/v1/config/definitions/{key}/releases/{version}/compiled` |
| GET | `/api/v1/config/releases/{releaseId}/compiled` |
| POST | `/api/v1/config/definitions/{key}/releases/{version}/simulate` |
| POST | `/api/v1/config/definitions/{key}/releases/{version}/validate` |
| POST | `/api/v1/config/definitions/{key}/releases/{version}/submit` |
| POST | `/api/v1/config/definitions/{key}/releases/{version}/approve` |
| POST | `/api/v1/config/definitions/{key}/releases/{version}/reject` |
| POST | `/api/v1/config/definitions/{key}/releases/{version}/return-to-draft` |
| POST | `/api/v1/config/definitions/{key}/releases/{version}/publish` |
| POST | `/api/v1/config/definitions/{key}/releases/{version}/retire` |
| POST | `/api/v1/config/definitions/{key}/activate/{version}` |
| POST | `/api/v1/config/definitions/{key}/deactivate/{version}` |
| GET | `/api/v1/config/definitions/{key}/releases/{version}/export` |
| GET | `/api/v1/config/definitions/{key}/releases/{a}/diff/{b}` |
| POST | `/api/v1/workflows` |
| GET | `/api/v1/workflows/{entityType}/{trackingId}` |
| GET | `/api/v1/workflows/{entityType}/{trackingId}/history` |
| POST | `/api/v1/workflows/{entityType}/{trackingId}/assign` |
| POST | `/api/v1/workflows/{entityType}/{trackingId}/reassign` |
| POST | `/api/v1/workflows/{entityType}/{trackingId}/release` |
| POST | `/api/v1/workflows/{entityType}/{trackingId}/stage-visits` |
| PATCH | `/api/v1/workflows/{entityType}/{trackingId}/data` |
| POST | `/api/v1/workflows/{entityType}/{trackingId}/actions/{actionKey}` |
| GET | `/api/v1/workloads/{trackingId}` |
| GET | `/api/v1/workloads/{trackingId}/history` |
| POST | `/api/v1/workloads/{trackingId}/assign` |
| POST | `/api/v1/workloads/{trackingId}/reassign` |
| POST | `/api/v1/workloads/{trackingId}/release` |
| PATCH | `/api/v1/workloads/{trackingId}/data` |
| POST | `/api/v1/workloads/{trackingId}/actions/{actionKey}` |
| POST | `/api/v1/workflows/{trackingId}/assign` |
| GET | `/api/v1/queues` |
| GET | `/api/v1/queues/{queueKey}` |
| POST | `/api/v1/queues/{queueKey}/assign` |
| POST | `/api/v1/queues/{queueKey}/reassign` |
| POST | `/api/v1/queues/{queueKey}/release` |
| POST | `/api/v1/bulk-actions/{bulkActionKey}/execute` |
| GET | `/api/v1/bulk-operations/{id}` |
| GET | `/api/v1/search` |
| POST | `/api/v1/tracking-ids` |
| GET | `/api/v1/workflows/scan` |

WORKLOAD aliases omit `{entityType}`. Spec-style `/api/v1/workflows/{trackingId}/assign` (and the other one-segment variants) also assume `WORKLOAD`. Send `X-Idempotency-Key` on assign, reassign, release, draft save, and execute action. Queue query parameters: `page`, `pageSize` (10/25/50/100), `sort`, `direction`, and configured filters such as `assignedStatus`. Search query parameters: `q` (tracking ID or scan payload), `receiptNumber` (receipt prefix), `entityType`, `definitionKey`, `currentStageKey`, `assignedTo`, `page`, `pageSize`. Supervisor reassignment requires `X-Actor-Roles: SUPERVISOR` or `ADMIN`.

Create-release body may include `cloneFromVersion` (and optional `cloneFromDefinitionKey`) to copy children into a new DRAFT, including onto a different definition key. Only DRAFT releases can be edited. Lifecycle mutations take `{ expectedRowVersion }`.

## Tests

```bash
npm test
npm run lint
```

Unit and API tests use an in-memory repository and do not require MySQL. Repository tests run when `TEST_DATABASE_URL` is set:

```bash
npm run test:mysql
```

## Logging and errors

Structured JSON logs include `correlationId`, `service`, `environment`, and `errorCode`. Secrets, tokens, A-Numbers, and receipt numbers are redacted by field name and by value shape in every string (including `message`). API failures use a stable error envelope with `summary`, field `details`, and `referenceId`. Designer, Workspace, search, and live queues show that same envelope, including the support id.

## Accessibility

The platform target is WCAG 2.1 AA and Section 508. Form drafts are rejected if they omit labels, section titles, or approved components. `QueueScreen` uses a captioned table, a **Row** number column, labeled filters, assignment status in text, and labeled reassignment. **Find a case** uses labeled Tracking ID and Receipt number fields, a **Clear** control, and a list of full-width result buttons with row numbers (no Open column). Stickers print status as text. Catalog designer fields are labeled (search fields uniquely per row). Error summaries announce the API `summary`, list `details`, and show `referenceId`.

## Operational dependencies

- Managed MySQL-compatible database. Local development uses Docker **MySQL 9.7.2 LTS**. Production engine (RDS MySQL vs Aurora MySQL) remains TBD; RDS 9.7 was preview-only as of July 2026.
- Environment variables from `.env.example`. Secrets are not stored in definition packages.

## Slice status

**Slices 1–18 complete.** Officer **Workspace** (Workload Type, mail vs workload queues, Find a case, labels, scan). Catalog and Lifecycle designers, form/workflow designers, Designer Try, search, supervisor reassignment, bulk actions, scheduler, outbox → `audit_event` and masked `splunk_event`.

## Out of scope in this slice

Dedicated label printer SDK, live Splunk HEC, notification delivery, GitHub export, ICAM/PIV/SAML, and RBAC administration.
