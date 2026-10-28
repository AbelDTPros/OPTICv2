# WCAG 2.1 AA and Section 508

The platform target is **WCAG 2.1 Level AA** and **Section 508**. That bound includes officer screens (Workspace queues, Find a case, forms, labels) and configurator screens (definition/release Designer: form, workflow, catalog, try, lifecycle, simulate, and diff). Hiding a control in React is never sufficient authorization, and color is never the only status indicator.

Slice 6 adds `DynamicFormRenderer`. Slice 10 adds `QueueScreen`. Slice 13 adds a labeled bulk-action toolbar and row selection checkboxes. Slice 14 adds keyboard-operable form and workflow designers (click-to-add, move up/down, labeled property fields, and keyboard node nudge alongside optional pointer drag). Slice 15 adds a catalog designer (actions, queues with unique eligibility labels, SLAs, search, bulk, and scheduled), a **Lifecycle** tab (actor id, validate, submit/approve/publish), and labeled per-row **Reassign** buttons. Slices 16–18 add officer **Workspace**: **Workload Type** tiles, labeled **Tracking ID** and **Receipt number** Find a case fields, a stacked list of full-width result buttons (the row is the control; no Open column), a labeled **Clear** that empties the form and results, QR stickers with **status as text**, and a unique document title **OPTIC v2.0 — Workspace**. Shared bulk-input fields use JSON Schema `title` (not raw keys) and bind optional `description` with `aria-describedby`. Authoring still rejects inaccessible form drafts. The renderer binds labels, help, and errors using the same `field-{KEY}` ids. Queues use a captioned table, a **Row** number column, column headers, labeled filters, and assignment status as text rather than color alone. Find a case results show a visible row number and include it in the open-control name. Semantic diff uses a captioned table. The demo shell provides a skip link, a unique document title per screen, and a main landmark. Error summaries are focusable alerts that show the API envelope (`summary`, `details`, `referenceId`); Yes/No fields expose a visible legend on the radiogroup.

## What the platform enforces now

Form drafts are rejected (`OPTIC-CONFIG-40010`) unless:

- The form has a title (page/heading).
- Every section has a visible title.
- Every field has a programmatic `label`.
- Field keys are unique and become stable `inputId` values (`field-{FIELD_KEY}`).
- Components are limited to the approved accessible library.
- PII/SENSITIVE fields declare a Splunk masking policy.

API errors return a screen-reader-usable `summary` plus field `details.path` / `details.inputId`. Designer, Workspace, search, and live queues:

- Announce an error summary at the top of the region.
- List details and, when `inputId` is present, link to `#field-{KEY}`.
- Show `referenceId` as “Give this id to support.”
- Associate each inline form error with its input (`aria-describedby` and `aria-errormessage`).

## Runtime UI checklist (Slices 6+)

Every new React surface MUST satisfy all of the following before it is considered done:

- All interactive elements are keyboard reachable and operable.
- Focus is visible and has sufficient contrast.
- Semantic landmarks and headings are present.
- Every input has a programmatic label; help and errors are associated.
- Validation uses a page/form error summary and inline field errors.
- Tables have headers and accessible names.
- Status is not color-only (text or icon plus color).
- Dialogs trap focus and restore it on close.
- Designers cannot emit components that fail these rules.
- Automated accessibility checks run in CI for officer and definition/Designer surfaces; keyboard and screen-reader sampling is required for new flows.

Customer-approved branding tokens must still meet contrast requirements. Do not invent protected brand assets.

## Mapping from configuration to accessible UI

| Configuration field | Runtime accessibility use |
| --- | --- |
| `form.title` | Page / region heading |
| `section.title` | Section heading |
| `field.label` | `<label for>` / `aria-label` source |
| `field.helpText` | `aria-describedby` help id |
| `field.fieldKey` | Stable `id="field-{key}"` |
| API `error.summary` | Alert / live-region summary |
| API `error.details[].inputId` | Inline error binding |

## Non-goals

- Automated axe checks and authoring gates do not replace a complete 508 ATO package. That still requires operational UI, production branding tokens, and manual assistive-technology testing.
- Document/binary viewers are out of scope for the application and therefore out of the 508 boundary of this system.
