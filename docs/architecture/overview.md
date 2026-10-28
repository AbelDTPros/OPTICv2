# OPTIC v2.0 Architecture

Living architecture notes. Update this file when a slice changes runtime boundaries, data ownership, or operational contracts.

**Current implemented slice:** Slice 18 — officer **Workspace** (Workload Type, Find a case, labels), tracking-id mint, QR stickers with status text, and scan-to-open.

**Normative sources:** Technical design specification sections 4–6, 10, 13–15, 20–23, 26, 38.

## Target logical architecture

```mermaid
flowchart TB
    USER[Desktop user / future tablet] --> ALB[AWS load balancer]
    SCANNER[QR scanner as keyboard] --> USER
    ALB --> WEB[Apache web tier]
    WEB --> UI[React UI]
    UI --> API[Application API server]

    API --> AUTH[Auth integration]
    API --> CONFIG[Configuration module]
    API --> QUEUE[Queue module]
    API --> SEARCH[Search module]
    API --> REPORT[Operational reporting]
    API --> WF[Workflow runtime]
    API --> TRACK[Tracking API]

    WF --> DB[(Managed MySQL-compatible DB)]
    CONFIG --> DB
    QUEUE --> DB
    SEARCH --> DB
    TRACK --> DB

    WF --> DCACHE[Definition cache]
    CONFIG --> DCACHE

    API --> OUTBOX[(Outbox)]
    WF --> OUTBOX
    OUTBOX --> PUB[Event publisher]
    PUB --> BUS[Durable event routing]

    BUS --> AUDIT[Audit consumer]
    BUS --> SPLUNKC[Splunk consumer]
    BUS --> NOTIFY[Notification engine later]

    AUDIT --> AUDITSTORE[(audit_event)]
    SPLUNKC --> SPLUNKSINK[Masked splunk_event / logs]
    NOTIFY --> INAPP[In-app]
    NOTIFY --> EMAIL[Email]

    SCHED[Scheduler workers] --> WF
    CONFIG --> EXPORT[Definition export]
    EXPORT --> GITHUB[GitHub]
```

Shaded/future modules are specified but not implemented until their slice. Slice 1 implements the configuration persistence path inside the API server.

## Slice 1 implemented boundaries

```mermaid
flowchart LR
    Client[API client] --> MW[Correlation / auth hook / request log]
    MW --> CFG[Configuration APIs]
    CFG --> SVC[DefinitionReleaseService]
    SVC --> A11Y[Form accessibility gate]
    SVC --> REPO[Definition repository]
    SVC --> OUTBOX[Transactional outbox]
    REPO --> MYSQL[(MySQL definition tables)]
    OUTBOX --> MYSQL
    MW --> ERR[Exception envelope]
    ERR --> LOG[Structured JSON logs]
```

| Process | Slice 1 responsibility | Not yet |
| --- | --- | --- |
| API server | Draft definition CRUD, health, logging, errors | Mail/Workload runtime APIs |
| MySQL 9.7.2 LTS (local Docker) | Definition tables, outbox_event, workflow_instance (including packet parent columns), workflow_stage_visit, workflow_queue_projection, tracking_id_issuance, audit_event, splunk_event | confirm RDS/Aurora GA before production pin |
| Auth | Dev bearer + actor header hook | ICAM/PIV/SAML, RBAC scopes |
| UI | DynamicFormRenderer, QueueScreen, SearchScreen, officer **Workspace** (Workload Type tiles, mail/workload queues, Find a case, prior-stage and parent-mail screens, QR labels, scan-to-open), form/workflow/catalog designers with simulate and semantic diff | Dedicated label printer SDK |
| Workflow runtime | Loader, rule engine, simulate, instance + visits, assign/reassign/release, save draft, execute action, definition lifecycle, queues, Find a case / search, tracking mint, scan, scheduler worker, outbox publisher, bulk actions | Notification delivery, live Splunk HEC |

## Slice 2 definition load path

```mermaid
flowchart TD
    REQ[Load by release id or key/version] --> CACHE{Immutable cache?}
    CACHE -->|hit| COMPILED[CompiledDefinition]
    CACHE -->|miss| DB[(MySQL definition tables)]
    DB --> ASSEMBLE[Assemble DefinitionRelease]
    ASSEMBLE --> VAL[Validate stable keys and references]
    VAL -->|fail| ERR[OPTIC-CONFIG-40020]
    VAL -->|pass| SCHEMA[Compile JSON Schema 2020-12]
    SCHEMA --> STORE{PUBLISHED / RETIRED / APPROVED / IN_REVIEW?}
    STORE -->|yes| MEM[Cache by definition-release:KEY:VERSION]
    STORE -->|DRAFT| ONCE[Return without long-lived cache]
    MEM --> COMPILED
    ONCE --> COMPILED
```

DRAFT releases are compiled on each load because they are mutable. Retired published releases remain loadable for in-flight instances. Load also validates rule operators and JSONPath syntax (`OPTIC-CONFIG-40024`) and compiles MATCHES regexes (`OPTIC-CONFIG-40022` on invalid patterns).

## Slice 3 rule evaluation path

```mermaid
flowchart TD
    SIM[POST simulate / future execute action] --> LOAD[DefinitionLoader]
    LOAD --> SET[Resolve transitionSetKey]
    SET --> RULES[FIRST_MATCH by priority]
    RULES --> PATH[JSONPath $ or $workflow]
    PATH --> OP[Operator registry / EQUALS first]
    OP -->|match| KEY[targetStageKey]
    OP -->|no match| DEF{defaultTargetStageKey?}
    DEF -->|yes| KEY
    DEF -->|no| FAIL[OPTIC-WF-40037 fail closed]
    PATH --> TRACE[Redacted evaluation trace]
    KEY --> TRACE
```

Rules accept `equals` and `EQUALS`. MISSING is distinct from null. Comparisons do not coerce strings to numbers. Evaluation traces omit raw PII and string/object values. Simulation writes no production records.

## Slice 4 instance and stage-visit path

```mermaid
flowchart TD
    CREATE[POST /api/v1/workflows] --> PUB{PUBLISHED release?}
    PUB -->|no| REJECT[OPTIC-WF-40040]
    PUB -->|yes| PIN[Pin definition_release_id]
    PIN --> INST[Insert workflow_instance]
    INST --> V1[Open stage visit visit_number=1]
    V1 --> OUT[Outbox MAIL_CREATED / WORKLOAD_CREATED]
    REENTER[POST .../stage-visits reentry true] --> PINNED[Load pinned release not active]
    PINNED --> CLOSE[Complete open visit]
    CLOSE --> NEXT[visit_number = max+1 for stage_key]
    NEXT --> HIST[workload_transition STAGE_REENTRY]
    HIST --> OUT2[STAGE_TRANSITIONED / STAGE_ENTERED]
    OUT2 --> SUM[GET summary / history]
```

New instances without `version` require `PUBLISHED` (and usually an active pointer). An explicit `version` may pin DRAFT / IN_REVIEW / APPROVED for Designer Try; those rehearsal cases skip queue projection and scheduled actions. Existing instances keep their pinned release after a newer release becomes active. Re-entering a stage increments `visit_number`. `POST .../stage-visits` requires `reentry: true` and writes `workload_transition`; it is a re-entry hook, not a substitute for execute action.

## Slice 5 assignment compare-and-set

```mermaid
flowchart TD
    ASSIGN[POST .../assign] --> CAS["UPDATE assigned_to WHERE assigned_to IS NULL AND row_version = expected"]
    CAS -->|1 row| WIN[Assignee set / row_version++ / WORKLOAD_ASSIGNED]
    CAS -->|0 rows| LOSE[409 OPTIC-WF-40903 or OPTIC-WF-40901]
    REL[POST .../release] --> OWN["UPDATE assigned_to = NULL WHERE assigned_to = actor AND row_version = expected"]
    OWN -->|1 row| CLEAR[Unassigned / WORKLOAD_RELEASED]
    OWN -->|0 rows| DENY[409 OPTIC-WF-40904 or OPTIC-WF-40901]
```

Two overlapping assign-to-self calls on the same unassigned instance produce exactly one success. The open stage visit stores `assigned_to` / `assigned_at`. Supervisor reassignment is Slice 15 (`POST .../reassign`, `WORKLOAD_REASSIGNED`).

## Slice 6 dynamic form runtime

```mermaid
flowchart TD
    SUM[GET workflow summary] --> SF[stageForm: schema + UI]
    SF --> R[DynamicFormRenderer]
    R --> SEC[Accessible sections and labeled fields]
    R --> BEH[Form behaviors via rule engine]
    BEH -->|visible / required / readOnly| FLD[Field state]
    ERR[API error envelope] --> SUMM[Form error summary]
    ERR --> INLINE[aria-describedby / aria-errormessage inline errors]
```

The renderer is a React package in `web/`. GET summary includes `stageForm` and `businessData` from the pinned release.

## Slice 7 save draft

```mermaid
flowchart TD
    PATCH[PATCH .../data] --> STAGE[Current stage + form dataPath]
    PATCH --> ASGN{Assignment required?}
    ASGN -->|yes and not owner| DENY[409 OPTIC-WF-40905]
    STAGE --> PATH[Reject keys outside dataPath]
    PATH --> MERGE[JSON Merge Patch]
    MERGE --> DELTA[Before/after field deltas + PII metadata]
    DELTA --> TX[Update business_data and row_version]
    TX --> OUT[DRAFT_SAVED / FIELD_CHANGED always]
```

`business_data` lives on `workflow_instance` until Mail/Workload domain tables are the authoritative store. Draft save checks types and formats (`OPTIC-WF-40051`) but does not require complete required fields. `FIELD_CHANGED` is written even when the delta list is empty. Two writers with the same `rowVersion` produce one success and one `OPTIC-WF-40901`.

## Slice 8 execute action

```mermaid
flowchart TD
    POST[POST .../actions/actionKey] --> ALLOW{Action on current stage?}
    ALLOW -->|no| DENY1[400 OPTIC-WF-40048/40049]
    ALLOW --> ASGN{Assignment required?}
    ASGN -->|not owner| DENY2[409 OPTIC-WF-40905]
    ASGN --> MERGE[Optional path-restricted dataPatch]
    MERGE --> SCHEMA[Form schema merged with canvas fields]
    SCHEMA -->|fail| DENY3[400 OPTIC-WF-40050]
    SCHEMA -->|fail| DENY3[400 OPTIC-WF-40050]
    SCHEMA --> RULES[FIRST_MATCH transition set]
    RULES --> TX[One transaction]
    TX --> VISIT[Close visit / open next visit]
    TX --> HIST[workload_transition]
    TX --> SCH[Cancel/create scheduled_workflow_action]
    TX --> OUT[STAGE_COMPLETED / STAGE_TRANSITIONED / STAGE_ENTERED / FIELD_CHANGED]
```

`SAVE` actions reuse draft save. `RELEASE_ASSIGNMENT` reuses release. Complete (`validateStageForm`) compiles a schema from the current canvas fields (dropping removed palette properties) and validates only those properties, so leftover keys from an older schema do not block Complete. Action `comment` is copied onto the outbox payload. Assign, release, draft save, and execute action accept `X-Idempotency-Key` (`OPTIC-WF-40906` on reuse with a different body). WORKLOAD aliases live under `/api/v1/workloads/{trackingId}` and spec-style `/api/v1/workflows/{trackingId}/...`. The scheduler worker leases `scheduled_workflow_action` and executes configured hold expiration.

## Slice 9 configuration lifecycle

```mermaid
flowchart TD
    DRAFT[DRAFT edit + simulate] --> VAL[Publish validation]
    VAL -->|fail| ERR[OPTIC-CONFIG-40020/40025]
    VAL -->|pass| SUB[Submit IN_REVIEW]
    SUB --> SOD1{Same actor?}
    SOD1 -->|yes| DENY[403 OPTIC-AUTHZ-40302]
    SOD1 -->|no| APPR[Approve APPROVED]
    APPR --> PUB[Publish lock + canonical SHA-256]
    PUB --> SNAP[Immutable snapshot + local export]
    SNAP --> ACT[Activate for new instances]
    SUB --> REJ[Reject]
    REJ --> BACK[Return to DRAFT]
    ACT --> DEACT[Deactivate clears active pointer]
    ACT --> RET{Active?}
    RET -->|yes| KEEP[Cannot retire OPTIC-CONFIG-40904]
    DEACT --> DONE[RETIRED]
    RET -->|no| DONE
```

Submit, approve, and publish are separate duties. Publish does not change existing pinned instances. Activate/deactivate only move `definition.active_release_id`. A DRAFT can be deleted (`DELETE .../releases/{version}`); if it is the last release, the definition row is removed so the key can be reused. Local export writes `manifest.yaml`, `workflow.yaml`, `ui/*.yaml`, and `schemas/*.json`. `GET .../export` returns the package + checksum; `POST .../releases/import` installs that package as DRAFT (default) or PUBLISHED (`mode: "PUBLISHED"`) after checksum verify (no auto-activate). GitHub export is not written in this slice. Lifecycle mutations accept `X-Idempotency-Key`.

## Slice 10 configurable queues

```mermaid
flowchart TD
    MUT[Create / assign / save / transition] --> PROJ[Upsert workflow_queue_projection]
    GET[GET /api/v1/queues/queueKey] --> CAT[Active published queue catalog]
    CAT --> ELIG[SQL-translated eligibility]
    ELIG --> FILT[Whitelisted filters and sort]
    FILT --> PAGE[Server page 10/25/50/100]
    PAGE --> ROWS[Rows + count + rowVersion]
    UI[QueueScreen] --> GET
    UI --> ASN[POST /api/v1/queues/queueKey/assign or release]
    ASN --> CAS[Existing assign/release CAS + X-Idempotency-Key]
    START[API startup] --> BACK[Backfill missing projection rows]
```

A queue is a view, not a stage. Eligibility is a declarative predicate over projected workflow/system/business columns. Catalog queues may also declare `projectedFields` (fieldKey, label, JSONPath) so form values are copied into `projected_json` for display. Those authored columns are not SQL filters or sorts. Publish rejects unknown columns, unprojected eligibility, and operators that cannot become parameterized SQL (`OPTIC-CONFIG-40026`). Query-time violations use `OPTIC-WF-40060`; unknown queues use `OPTIC-WF-40420`; assign of a non-eligible item uses `OPTIC-WF-40061`. Authorization is applied before rows and counts are returned.

## Slice 11 scheduler worker

```mermaid
flowchart TD
    ENTER[Stage entered] --> INS[Insert PENDING + SCHEDULED_ACTION_CREATED]
    DUE[Due PENDING and lease expired or empty] --> CLAIM[Claim batch FOR UPDATE SKIP LOCKED]
    CLAIM --> RT[Workflow runtime + idempotency_key]
    RT -->|still in trigger stage/visit| EXEC{Action type}
    EXEC -->|TRANSITION| TX[Close visit / open dest / outbox / projection]
    EXEC -->|NOTIFICATION| NOTE[Outbox only]
    RT -->|stage or visit no longer applies| SKIP[COMPLETED no-op + SKIPPED]
    TX --> DONE[Mark COMPLETED + SCHEDULED_ACTION_EXECUTED]
    NOTE --> DONE
    SKIP --> DONE
    RT -->|transient error| BACK[Increment attempt_count and backoff due_at]
    BACK -->|under maxAttempts| DUE
    BACK -->|maxAttempts| FAIL[DEAD_LETTER + SCHEDULED_ACTION_FAILED]
    STOP[SIGTERM / SIGINT] --> ABANDON[Stop claiming and abandon leases]
```

The worker does not scan definition files. Hold period is `scheduledActions` on the pinned Definition Release (`ON_HOLD_EXPIRATION` TRANSITION). `due_at` comes from `delay.source: CONFIG` duration or `FIELD` JSONPath over business data. Runtime verifies the instance is still in the trigger stage and visit; a late duplicate is a safe no-op, not a second transition. Worker calls go through the idempotency store using the row `idempotency_key`. Leases use `lease_owner` / `lease_expires_at`. Retry uses configured `retry.maxAttempts` and EXPONENTIAL backoff; exhausted retries are `DEAD_LETTER`. Shutdown stops new claims, waits for in-flight work, then abandons this worker's leases.

Scheduler codes: `OPTIC-WF-40070` (unknown scheduled action key on the pinned release), `OPTIC-WF-40071` (TRANSITION missing `targetStage`), `OPTIC-WF-40072` (unsupported action type), `OPTIC-WF-40073` (FIELD delay path missing or invalid), `OPTIC-WF-40421` (scheduled row not found), `OPTIC-WF-40907` (lost lease; treated as a skip).

## Slice 12 audit and Splunk pipeline

```mermaid
flowchart TD
    TXN[Business transaction] --> OUT[(outbox_event PENDING)]
    OUT --> PUB[Publisher FOR UPDATE SKIP LOCKED]
    PUB --> DEL[(outbox_delivery AUDIT and SPLUNK)]
    PUB --> MARK[Mark outbox PUBLISHED]
    DEL --> AUDIT[Audit consumer]
    DEL --> SPLUNK[Splunk consumer]
    AUDIT --> FULL[(audit_event full values + hash chain)]
    SPLUNK --> MASK[Apply splunkPolicy before serialize]
    MASK --> SINK[(splunk_event masked JSON)]
    AUDIT -->|transient error| ARETRY[Backoff delivery next_attempt_at]
    SPLUNK -->|transient error| SRETRY[Backoff delivery next_attempt_at]
    ARETRY -->|maxAttempts| ADL[DEAD_LETTER]
    SRETRY -->|maxAttempts| SDL[DEAD_LETTER]
    STOP[SIGTERM / SIGINT] --> ABANDON[Stop claiming and abandon delivery leases]
```

The API does not call Splunk in the request path. The publisher hands each committed outbox row to independent `AUDIT` and `SPLUNK` deliveries. Authoritative `audit_event` stores full `fieldDeltas` plus spec `changes[]` (`fieldKey`, `path`, `classification`, `before`, `after`) and a SHA-256 hash chain per entity partition. Workflow events use `sourceService: workflow-runtime` and include `workflow.stageVisitId`. The Splunk path applies `splunkPolicy` (`MASK` / `KEEP_PREFIX_SUFFIX`, prefix 1 / suffix 3) before serialization. HTTP 403 writes `AUTHORIZATION_DENIED`; unexpected 5xx writes `SYSTEM_ERROR`. Dead-lettered deliveries can be redriven. `npm run migrate` with `DATABASE_ADMIN_USER`/`DATABASE_ADMIN_PASSWORD` strips schema-level `UPDATE`/`DELETE` from `DATABASE_USER` and re-grants them on every table except append-only `audit_event` (MySQL 9 partial revokes are schema-level only). There is no HTTP Event Collector in this slice.

Pipeline codes: `OPTIC-SYS-50010` (outbox publisher failed), `OPTIC-SYS-50011` (audit consumer failed), `OPTIC-SYS-50012` (Splunk consumer failed). Exhausted consumer retries are `DEAD_LETTER` on `outbox_delivery`.

## Slice 13 bulk actions

```mermaid
flowchart TD
    SEL[Selected queue rows + shared input] --> EXEC[POST bulk-actions/key/execute]
    EXEC --> VAL[maxSelection / stage / eligibility / schema]
    VAL --> MODE{transactionMode}
    MODE -->|ATOMIC| TXN[One transaction]
    MODE -->|BEST_EFFORT| EACH[Per-item transaction]
    TXN --> MAP[writeMappings + optional transition]
    EACH --> MAP
    MAP --> ROWS[(bulk_operation / bulk_operation_item)]
    MAP --> OUT[Outbox BULK_* plus stage events]
    TXN -->|any item fails| RB[Rollback all items and the operation]
    EACH --> PART[COMPLETED / PARTIAL / FAILED]
```

`ATOMIC` applies every selected item in one database transaction. Any item failure rolls back workflow mutations, outbox rows, and the `bulk_operation` record. `BEST_EFFORT` persists the operation first, then commits or fails each item independently. Queue GET includes `bulkActions` from stages that use that queue, omitting actions the actor cannot execute (`canExecuteBulkAction`). Execute and operation GET use `assertCanExecuteBulkAction` / `assertCanReadBulkOperation`. Shared-input labels come from JSON Schema `title`. Eligibility supports `requireUnassignedOrAssignedToCurrentUser` plus `all` / `any` / `not` predicates on `currentStageKey`, `assignedTo`, `entityType`, and `status` (`$currentUser` resolves to the actor). `QueueScreen` shows a selection toolbar only when bulk actions are configured. **Workspace → Live** calls the APIs through the Vite proxy after `npm run seed:bulk` (I-131 shipping plus I-407 live + draft).

Bulk codes: `OPTIC-WF-40080` (unknown bulk action), `OPTIC-WF-40081` (empty or duplicate selection), `OPTIC-WF-40082` (over `maxSelection`), `OPTIC-WF-40083` (mixed pinned releases), `OPTIC-WF-40084` (wrong stage), `OPTIC-WF-40085` (eligibility failed — assigned to someone else or expression mismatch), `OPTIC-WF-40086` (shared input invalid), `OPTIC-WF-40087` (write mapping path invalid), `OPTIC-WF-40430` (operation not found). Events: `BULK_ACTION_STARTED`, `BULK_ITEM_SUCCEEDED`, `BULK_ITEM_FAILED`, `BULK_ACTION_COMPLETED`.

## Slice 14 designers

```mermaid
flowchart LR
    PAL[Form palette] --> CAN[Form canvas]
    CAN --> PROP[Field / section properties]
    PROP --> PUTF[PUT forms/formKey]
    NODE[Workflow nodes] --> SPROP[Stage properties]
    SPROP --> PUTW[PUT workflow]
    PUTF --> DRAFT[(DRAFT definition_release)]
    PUTW --> DRAFT
```

The React designers sit on the existing configuration APIs. Save is offered only while `lifecycleStatus` is `DRAFT`. The form designer is a three-pane palette / canvas / properties layout with preview, form UI JSON, and a JSON Schema editor. SELECT/MULTI_SELECT/RADIO options and behavior `visible` / `required` / `readOnly` effects are edited in Properties. Behaviors and transition `when` clauses use nested `all` / `any` / `not` groups. The workflow designer stores presentation `layout` on nodes (drag or keyboard nudge) without changing execution `order`, and validates unreachable stages plus transition actions that have no destination. Clone-from-version, a form picker, Designer **Try** (`GET /api/v1/workflows?definitionKey=&version=` plus `POST` with an explicit version, including DRAFT), `POST .../simulate`, and `GET .../diff/{from}/{to}` are available on the same workspace. Client-side checks reuse the same accessibility and reference rules the server enforces (`OPTIC-CONFIG-40010` still rejects inaccessible forms).

## Slice 15 catalog designers, search, and reassignment

```mermaid
flowchart LR
    CAT[Catalog designer] --> PUTA[PUT actions / queues / SLAs / search / bulk / scheduled]
    PUTA --> DRAFT[(DRAFT definition_release)]
    LIFE[Lifecycle tab] --> POSTL[POST validate / submit / approve / publish / activate]
    POSTL --> DRAFT
    SEARCH[GET /api/v1/search] --> PROJ[(workflow_queue_projection)]
    SEARCH --> PIN[Pinned release search fields]
    REA[POST .../reassign] --> ROLE{SUPERVISOR or ADMIN}
    ROLE -->|yes| CAS["UPDATE assigned_to WHERE row_version = expected"]
    ROLE -->|no| DENY[403 OPTIC-AUTHZ-40303]
    CAS --> EVT[WORKLOAD_REASSIGNED]
```

The Designer **Catalog** tab authors actions, queues (including SQL-safe eligibility), SLAs, search metadata, bulk actions, and scheduled actions through the existing DRAFT `PUT` APIs. The **Lifecycle** tab runs validate and the submit → approve → publish → activate path; actor id is entered on that tab so separation of duties is a different `X-Actor-Id`, not an RBAC admin UI. Search fields belong here because `GET /api/v1/search` is driven by the pinned release `search_definition` plus always-on tracking ID and receipt number. `q` matches tracking ID only (scan payload or contains). `receiptNumber` is a separate prefix on the projected receipt column. The MySQL provider queries `workflow_queue_projection` with `LIKE` (no JSON CAST); matching is refined in the search service. Application logs emit `search.executed` with hit counts only — never `q` or matched values.

`POST /api/v1/workflows/{entityType}/{trackingId}/reassign`, WORKLOAD aliases, and `POST /api/v1/queues/{queueKey}/reassign` move assignment to another officer. Officers still assign-to-self only. Reassignment is optimistic on `row_version` (`OPTIC-WF-40908` on stale version) and does not require the row to be unassigned. Empty `assignedTo` is `OPTIC-WF-40090`; assigning to the current assignee is `OPTIC-WF-40091`. Each stage’s `assignmentPolicy` controls **Allow assign**, **Allow reassign**, and **Allow release**. Omitted flags infer assign/reassign off on a terminal stage and on otherwise; release defaults on. A forbidden assign or reassign is `OPTIC-WF-40092`; a forbidden release is `OPTIC-WF-40093`. Queue row actions and the case **Release** button follow the same flags. The outbox event is `WORKLOAD_REASSIGNED` with `previousAssignedTo`. Queue **Reassign** is on Workspace queue screens when the stage allows it; the button opens a dialog to type the officer who should receive the case. **Find a case** sits at the top of the Workspace main pane (not a separate header tab). Workspace **Working as** is a typed name or email that sets `X-Actor-Id` for assign and release. Reassignment sends `X-Actor-Roles: SUPERVISOR`. The bulk seed assigns `W-DEMO-SHIP-1` to `officer@example.gov` and `W-DEMO-SHIP-2` to `jordan.officer@example.gov`.

## Slice 16–17 officer Workspace

The navy header is **Workspace** and **Designer**. Workspace is the officer product: pick a **Workload Type** (mail + workload members of the same kind, e.g. I-407), then mail-item vs workload queues. **Try** lists saved drafts and pins an explicit `version` so DRAFT instances can be walked (they skip Live projection and the scheduler). **Live** uses activated queues. **Find a case** sits at the top of the main pane (always visible) with **Tracking ID** (scan payload or contains) and **Receipt number** (prefix on the projected receipt). Workload Type and queue nav stay on the left. Results are a stacked list of buttons — the whole row opens the case; there is no Open column and no horizontal table scroll. Each queue row and search result has a row number. **Clear** empties the fields and removes the list. A full QR or exact tracking ID opens immediately. Find a case can open a Try draft by tracking ID / scan even when it is not in Live projections.

Mail Complete can spawn workload instances (`spawnDefinitionKey`) and copy matching repeating-row fields onto the child’s first form by normalized leaf path (for example mail-row `workloadStatus` → workload **Workload Status**), mapping choice values onto the target options. Opening a workload recovers parent mail screens when that tracking number is listed on the mail Doc Prep form.

Designer **Try** remains the single-definition walk-through for the opened draft. Use Workspace **Try** to rehearse the officer path across the whole workload type.

## Slice 18 labels, tracking mint, and scan

```mermaid
flowchart LR
    MINT[POST /tracking-ids] --> CREATE[POST /workflows]
    CREATE --> STICKER[QR + tracking # + status text]
    STICKER --> PRINT[Browser print]
    SCAN[GET /workflows/scan?q=] --> CASE[Officer case pane]
    STICKER --> SCAN
```

Live **New mail arrives** mints a short Crockford id (`M-` / `W-` + 10 chars) from `POST /api/v1/tracking-ids` (`MAIL` or `WORKLOAD`) and stores it on `tracking_id_issuance` (`012_tracking_id.sql`). Packet parent columns are `parent_entity_type` / `parent_tracking_id` on `workflow_instance` (`011_workflow_packet_parent.sql`). Try still mints a local id of the same shape. The case pane shows stickers for this case plus packet parent/children. QR payload is `OPTIC:MAIL:{id}` or `OPTIC:WORKLOAD:{id}`. `GET /api/v1/workflows/scan?q=` accepts that payload or a bare tracking id. Status is printed as text (not color-only). Dedicated printer SDKs are not in this slice. Application logs redact receipts and A-Numbers by field name and by value shape. The UI error summary shows the same API envelope (`summary`, `details`, `referenceId`) as the JSON response.

## Definition persistence model

```mermaid
erDiagram
    DEFINITION ||--o{ DEFINITION_RELEASE : versions
    DEFINITION_RELEASE ||--o{ STAGE_DEFINITION : contains
    DEFINITION_RELEASE ||--o{ TRANSITION_DEFINITION : contains
    DEFINITION_RELEASE ||--o{ FORM_DEFINITION : contains
    DEFINITION_RELEASE ||--o{ ACTION_DEFINITION : contains
    DEFINITION_RELEASE ||--o{ QUEUE_DEFINITION : contains
    DEFINITION_RELEASE ||--o{ BULK_ACTION_DEFINITION : contains
    DEFINITION_RELEASE ||--o{ SCHEDULED_ACTION_DEFINITION : contains
    DEFINITION_RELEASE ||--o{ SLA_DEFINITION : contains
    DEFINITION_RELEASE ||--o{ SEARCH_DEFINITION : contains
    DEFINITION {
      string definition_key
      string entity_type
    }
    DEFINITION_RELEASE {
      string version
      string lifecycle_status
      json manifest_json
      bigint row_version
    }
```

Published releases are immutable. Slice 1 only writes `DRAFT`.

## Request, exception, and log flow

```mermaid
sequenceDiagram
    participant C as Client
    participant API as API server
    participant S as Service
    participant DB as MySQL
    participant L as Logs / Splunk projection

    C->>API: Request + optional X-Correlation-Id
    API->>API: Create correlationId and request context
    API->>API: Authenticate actor hook
    alt Validation or business error
        API-->>C: Error envelope with summary, details, referenceId
        API->>L: warn/error JSON log without PII or stack in the body
    else Success
        API->>S: Authorized command
        S->>DB: Parameterized SQL in one transaction
        DB-->>S: Persisted draft
        API-->>C: Success envelope + correlationId
        API->>L: info request completed
    end
```

See [logging-and-errors.md](./logging-and-errors.md) and [accessibility-508.md](./accessibility-508.md).

## Accessibility enforcement path

```mermaid
flowchart TD
    FormSave[PUT form draft] --> Gate[assertFormAccessibility]
    Gate -->|missing label/title or disallowed component| Reject[OPTIC-CONFIG-40010]
    Reject --> Envelope[Accessible error summary + field details]
    Gate -->|pass| Persist[Persist DRAFT form]
    Persist --> RuntimeUI[DynamicFormRenderer / Workspace / Designer]
    RuntimeUI --> RuntimeA11y[WCAG 2.1 AA / Section 508 runtime]
```

Configuration that cannot produce an accessible UI is rejected before it is stored. Officer and Designer surfaces follow the WCAG 2.1 AA / Section 508 checklist in [accessibility-508.md](./accessibility-508.md).
