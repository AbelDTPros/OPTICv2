# OPTIC NextGen — High-Level Requirements

*For prospective customer / contractual scoping*

## Purpose

- Provide a configurable mail and workload case-processing platform that onboard new process types through versioned configuration, not custom application code.
- Support day-to-day case work in an officer **Workspace** and process authoring/governance in a **Designer**.

## Officer operations

- Allow officers to select a Workload Type and work mail-item and workload queues from activated (Live) releases.
- Support assign-to-self, release, save draft, and complete actions that advance cases per configured stage rules.
- Support supervisor reassignment where stage policy permits.
- Mint tracking identifiers for new mail/work; support QR label print (browser) and scan-to-open.
- Provide Find a case by tracking ID, receipt, and configured search fields.
- Support mail-complete spawning of linked child workloads and recovery of linked parent mail context.
- Support configured bulk actions on selected queue items.
- Enforce safe concurrent editing so two officers cannot claim/edit the same case unsafely.

## Configuration and lifecycle

- Enable authors to create, clone, and edit DRAFT definition releases (forms, workflow, queues, actions, search, bulk/scheduled actions, SLAs).
- Provide validate → submit → approve/reject → publish → activate/deactivate/retire lifecycle with separation of duties (submitter ≠ approver ≠ publisher where required).
- Keep published releases immutable; pin in-flight cases to the release they were created under.
- Provide Try/Simulate for rehearsal and Diff for release comparison.
- Support definition package export/import with integrity verification (import does not auto-activate).

## Governance, security, and compliance

- Authenticate actors and enforce role-based permissions for sensitive actions (e.g., reassignment, admin).
- Maintain an append-only audit trail of configuration and operational events with integrity metadata.
- Support field-level change capture with PII classification and masking for operational log projections.
- Target WCAG 2.1 AA / Section 508 for officer and designer UIs.
- Provide stable, supportable error references without exposing internal stack or SQL detail to end users.

## Administration and operations

- Provide an Admin capability to manage feature flags and inspect the audit trail (filter, page, view detail).
- Run background scheduled actions and durable event delivery with retry/dead-letter handling.
- Expose health/readiness checks suitable for hosted operation.
- Persist data in a managed MySQL-compatible database.

## Deployment / customer environment (assumptions)

- Customer provides (or funds) hosting for web UI, application API, and managed database, plus network/identity integration points agreed in the statement of work.
- Production identity federation (e.g., ICAM/PIV/SAML), live SIEM shipping, notification delivery, and dedicated label-printer SDK may be scoped as separate deliverables if required.

## Explicit exclusions (unless separately contracted)

- Full in-product RBAC administration UI.
- Migration of in-flight cases onto a newly activated definition version.
- Live Splunk HEC, end-user notification delivery, GitHub definition export, and dedicated printer SDK.
