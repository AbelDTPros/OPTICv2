# Logging and Exception Handling

Production contract for API diagnostics. Configuration mutations write `outbox_event` rows in the same MySQL transaction (`CONFIG_DRAFT_CREATED`, `CONFIG_CHANGED`, `CONFIG_SUBMITTED`, `CONFIG_APPROVED`, `CONFIG_PUBLISHED`, `CONFIG_ACTIVATED`, `CONFIG_RETIRED`). Workflow create/re-entry/assign writes `MAIL_CREATED` / `WORKLOAD_CREATED` / `STAGE_TRANSITIONED` / `STAGE_ENTERED` / `WORKLOAD_ASSIGNED` / `WORKLOAD_RELEASED` / `WORKLOAD_REASSIGNED`. Search writes `search.executed` with hit counts only. Draft save writes `DRAFT_SAVED` and `FIELD_CHANGED` (including empty deltas). Action execution writes `STAGE_COMPLETED`, `STAGE_TRANSITIONED`, `STAGE_ENTERED`, and `FIELD_CHANGED` when data changed. Action `comment` is stored on the outbox payload. Field changes include spec `changes[]` plus `fieldDeltas` (with `splunkPolicy`). HTTP 403 writes `AUTHORIZATION_DENIED`; unexpected 5xx writes `SYSTEM_ERROR`. An outbox publisher then creates independent `AUDIT` and `SPLUNK` deliveries. The audit consumer writes full values to append-only `audit_event` with a per-entity hash chain. The Splunk consumer applies `splunkPolicy` and writes a masked local `splunk_event` (no HTTP Event Collector in this slice). The scheduler worker writes `SCHEDULED_ACTION_CREATED` when a row is inserted, `SCHEDULED_ACTION_EXECUTED` / `SCHEDULED_ACTION_SKIPPED` on success or no-op, and `SCHEDULED_ACTION_FAILED` when a row is dead-lettered. Bulk execute writes `BULK_ACTION_STARTED`, `BULK_ITEM_SUCCEEDED` / `BULK_ITEM_FAILED`, and `BULK_ACTION_COMPLETED`.

## Log event shape

Every log line is JSON. Production default level is `info`. Debug is not emitted in Production unless `LOG_LEVEL=debug` is explicitly set.

```json
{
  "timestamp": "2026-08-23T00:30:00.123Z",
  "level": "ERROR",
  "service": "api-server",
  "serviceVersion": "0.1.0",
  "environment": "production",
  "host": "ip-10-0-1-12",
  "message": "HTTP request failed",
  "correlationId": "c-...",
  "sessionId": "s-...",
  "actorId": "user@example.gov",
  "operation": "PUT /api/v1/config/definitions/I_407/releases/0.1.0/forms/I407_DATA_ENTRY",
  "errorCode": "OPTIC-SYS-50001",
  "referenceId": "OPTIC-8F71C239"
}
```

## Rules

- Correlation IDs propagate on `X-Correlation-Id` and are copied into every request-scoped log.
- Request bodies, tokens, SAML assertions, cookies, passwords, A-Numbers, and receipt numbers are never logged. Redaction is by field name and by value shape in every string, including `message` (USCIS receipt, A-Number, SSN, Bearer token, JWT).
- Query strings are stripped from logged paths.
- Stack traces go only to technical logs when `LOG_STACK_TRACES=true` (off in Production by default).
- User-facing responses never include stack traces, host names, or SQL.
- `unhandledRejection` and `uncaughtException` are captured. Production exits after an uncaught exception or unhandled rejection so a process manager can restart a tainted process.
- Graceful shutdown on SIGTERM/SIGINT stops the scheduler worker and outbox publisher (no new claims, abandon leases), closes the HTTP server, and closes the database pool, with a 10s timeout.

## Error envelope

All failures use the specification envelope, plus `summary` and field `details`. Designer, Workspace, search, and live queues announce that summary, list details (and bind `inputId` when present), and show `referenceId` as the support handle.

```json
{
  "error": {
    "errorCode": "OPTIC-VAL-40001",
    "message": "Request validation failed. Review the highlighted fields and try again.",
    "summary": "Request validation failed. Review the highlighted fields and try again.",
    "referenceId": "OPTIC-8F71C239",
    "details": [
      {
        "field": "displayName",
        "path": "displayName",
        "message": "Required",
        "inputId": "field-displayName"
      }
    ]
  },
  "meta": {
    "correlationId": "c-...",
    "timestamp": "2026-08-23T00:30:00Z"
  }
}
```

| Prefix | Use |
| --- | --- |
| OPTIC-AUTH | Authentication / session |
| OPTIC-AUTHZ | Authorization |
| OPTIC-VAL | Request or schema validation |
| OPTIC-CONFIG | Definition authoring |
| OPTIC-WF | Workflow / concurrency / rule evaluation |
| OPTIC-SYS | System, 404, unexpected faults |

Rule-engine codes used by Slice 3: `OPTIC-CONFIG-40022` (invalid MATCHES regex at load), `OPTIC-CONFIG-40023` (unknown transition set), `OPTIC-CONFIG-40024` (unknown operator or illegal JSONPath at load), `OPTIC-WF-40030` (unsafe/invalid JSONPath at evaluation), `OPTIC-WF-40031` (unknown operator at evaluation), `OPTIC-WF-40032`/`40033` (illegal comparison), `OPTIC-WF-40034`/`40035` (nesting/count caps), `OPTIC-WF-40037` (no match and no default). Simulate logs `definition.simulated` with keys only — never `businessData` or raw resolved values.

Configuration lifecycle codes: `OPTIC-CONFIG-40025` (not complete enough to submit/publish), `OPTIC-CONFIG-40903` (illegal lifecycle transition), `OPTIC-CONFIG-40904` (cannot retire the active release), `OPTIC-CONFIG-40905` (activate requires PUBLISHED), `OPTIC-CONFIG-40907` (deactivate of a non-active release), `OPTIC-CONFIG-40908` (only a non-active DRAFT can be deleted; leftover Try cases on that draft are removed first), `OPTIC-AUTHZ-40302` (separation of duties). Published snapshots store SHA-256 `checksum` and `canonical_package_json`. Reject comments are stored on the release manifest and outbox payload.

Validate and export list the projected columns a release needs (`projections` / `projections.yaml`). Queue assign and release accept `X-Idempotency-Key` (`OPTIC-WF-40906` on reuse with a different body). Row columns come from the pinned release.

Queue codes: `OPTIC-CONFIG-40026` (queue eligibility, columns, filters, or actions are not projected or not SQL-safe), `OPTIC-WF-40060` (disallowed page size, sort, or filter at query time — also used by search), `OPTIC-WF-40061` (item is not eligible for the queue), `OPTIC-WF-40420` (queue not found or not authorized). Queue list and row queries apply the same eligibility and auth rules. Application logs record `queueKey` and counts, not receipt numbers or other projected PII values. Search logs `search.executed` with `hitCount` / `page` / `entityType` only — never `q` or matched field values.

Outbox pipeline codes: `OPTIC-SYS-50010` (publisher failed), `OPTIC-SYS-50011` (audit consumer failed), `OPTIC-SYS-50012` (Splunk consumer failed). Exhausted consumer retries mark `outbox_delivery` `DEAD_LETTER` and can be redriven. Audit keeps full `changes[]`; Splunk projections mask `MASK` values with prefix 1 / suffix 3 before serialization. `AUTHORIZATION_DENIED` and `SYSTEM_ERROR` are written to the outbox from the HTTP error handler.

Bulk action codes: `OPTIC-WF-40080` (unknown bulk action on the pinned release), `OPTIC-WF-40081` (empty or duplicate selection), `OPTIC-WF-40082` (selection exceeds `maxSelection`), `OPTIC-WF-40083` (items pinned to different releases), `OPTIC-WF-40084` (item is not in the configured stage), `OPTIC-WF-40085` (item failed bulk eligibility — assigned to another user, or `all`/`any`/`not` workflow predicates did not match), `OPTIC-WF-40086` (shared input failed schema validation), `OPTIC-WF-40087` (write mapping JSONPath invalid), `OPTIC-WF-40430` (bulk operation not found). Execute requires `assertCanExecuteBulkAction`; operation GET requires `assertCanReadBulkOperation`. Queue pages omit actions when `canExecuteBulkAction` is false. Bulk outbox events: `BULK_ACTION_STARTED`, `BULK_ITEM_SUCCEEDED`, `BULK_ITEM_FAILED`, `BULK_ACTION_COMPLETED`. ATOMIC failures roll back every item; BEST_EFFORT persists per-item success/failure. Logs use `bulkOperationId` and counts, not selected tracking IDs.

Workflow instance codes: `OPTIC-WF-40040` (create without version requires PUBLISHED; explicit version may pin DRAFT/IN_REVIEW/APPROVED for Designer Try), `OPTIC-WF-40041` (no active release), `OPTIC-WF-40042` (unknown stage on pinned release), `OPTIC-WF-40043` (missing initial stage), `OPTIC-WF-40044` (entity type mismatch), `OPTIC-WF-40045` (save draft stage mismatch), `OPTIC-WF-40046` (stage has no form), `OPTIC-WF-40047` (write outside stage `dataPath`), `OPTIC-WF-40048` (unknown action), `OPTIC-WF-40049` (action not allowed in current stage), `OPTIC-WF-40050` (action schema validation failed), `OPTIC-WF-40051` (draft type/format validation failed; required fields are not enforced), `OPTIC-WF-40090` (reassign missing `assignedTo`), `OPTIC-WF-40091` (already assigned to that officer), `OPTIC-WF-40092` (assign or reassign forbidden by the current stage `assignmentPolicy`), `OPTIC-WF-40093` (release forbidden by the current stage `assignmentPolicy`), `OPTIC-WF-40410` (instance not found), `OPTIC-WF-40901` (stale `rowVersion`; details include `currentRowVersion`), `OPTIC-WF-40902` (duplicate entity tracking id), `OPTIC-WF-40903` (assignment conflict), `OPTIC-WF-40904` (release denied), `OPTIC-WF-40905` (assignment required for save/action), `OPTIC-WF-40906` (idempotency key reused with a different body), `OPTIC-WF-40908` (stale `rowVersion` on reassign). Supervisor reassignment requires `SUPERVISOR` or `ADMIN` (`OPTIC-AUTHZ-40303`). Reassignment writes `WORKLOAD_REASSIGNED` with `previousAssignedTo`. Scheduler codes: `OPTIC-WF-40070` (unknown scheduled action on the pinned release), `OPTIC-WF-40071` (TRANSITION missing `targetStage`), `OPTIC-WF-40072` (unsupported scheduled action type), `OPTIC-WF-40073` (FIELD delay path missing or invalid), `OPTIC-WF-40421` (scheduled row not found), `OPTIC-WF-40907` (lost lease). Scheduler outbox events: `SCHEDULED_ACTION_CREATED`, `SCHEDULED_ACTION_EXECUTED`, `SCHEDULED_ACTION_SKIPPED`, `SCHEDULED_ACTION_FAILED`. Exhausted retries are `DEAD_LETTER`. Worker execution uses the row `idempotency_key`. Instance logs use `workflowInstanceId` and `entityType`, not raw business payloads. Draft and action audit events carry field deltas plus `piiClassification` / `splunkPolicy`. The Splunk consumer masks those values before `splunk_event` serialization; application logs still redact A-Numbers and receipt numbers.

`referenceId` is the support handle. `correlationId` is the end-to-end trace key. Designer, Workspace, search, and live queues parse this same envelope (`errorCode`, `summary`, `details[]`, `referenceId`) and show the support id on the error summary.
