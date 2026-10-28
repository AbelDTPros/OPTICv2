# Designer user guide

A plain-language, step-by-step guide for people who **build and publish** mail and workload processes in OPTIC v2.0.

You configure screens, stages, queues, and rules. Officers then use those recipes in **Workspace (Live)**. You do **not** need to write application code, run terminals, or understand the database.

This guide is written for a **newbie author** — someone who has never published a process before. It explains the ideas first, then walks through each Designer area with enough detail that you can build, rehearse, and activate a process with confidence.

**Try / rehearsal is for authors** (inside Designer → Try, or Workspace **Try** when enabled). **Officers do not use Try for daily work** — they only process activated Live work after you Activate.

**Companion guide (for officers):** [Officer Workspace user guide](./officer-workspace-user-guide.md)  
**Deep technical walkthrough (keys, JSONPath, worked example):** [Onboard a new workload from scratch](./onboard-a-new-workload.md)

**In the product:** open Designer and click **User guide** (far right of the Designer nav) to read this guide inside the app. **Jump to…** (⌘K / Ctrl+K) can also take you to Designer areas when the command palette is enabled.

---

## How to use this guide

| If you want to… | Go to… |
| --- | --- |
| Understand what you are publishing | [Sections 1–3](#1-what-designer-is) |
| Learn the screen layout | [Section 4](#4-tour-of-designer) |
| Build your first process in the right order | [Section 5](#5-recommended-order-of-work) then [Sections 6–11](#6-create-or-open-a-draft) |
| Rehearse before officers see it | [Section 10](#10-try-simulate-and-diff) |
| Go Live safely | [Section 11](#11-lifecycle-from-draft-to-live) |
| Fix errors and blank queue columns | [Section 15](#15-common-problems) |
| Follow a first-project narrative | [Section 17](#17-your-first-process-walkthrough) |

Keep a notepad for every **key** you invent (`I_407_WORKLOAD`, `READY_FOR_DATA_ENTRY`, `COMPLETE`). OPTIC is strict about spelling. Friendly display names can have spaces; keys cannot.

---

## Table of contents

1. [What Designer is](#1-what-designer-is)
2. [Big picture: definition, release, instance](#2-big-picture-definition-release-instance)
3. [Who does what (roles)](#3-who-does-what-roles)
4. [Tour of Designer](#4-tour-of-designer)
5. [Recommended order of work](#5-recommended-order-of-work)
6. [Create or open a draft](#6-create-or-open-a-draft)
7. [Catalog (building blocks)](#7-catalog-building-blocks)
8. [Forms (screens officers fill)](#8-forms-screens-officers-fill)
9. [Workflow (stages and movement)](#9-workflow-stages-and-movement)
10. [Try, Simulate, and Diff](#10-try-simulate-and-diff)
11. [Lifecycle: from draft to Live](#11-lifecycle-from-draft-to-live)
12. [Mail + workload packets](#12-mail--workload-packets)
13. [Versioning and changes after go-live](#13-versioning-and-changes-after-go-live)
14. [Naming rules (please follow these)](#14-naming-rules-please-follow-these)
15. [Common problems](#15-common-problems)
16. [Checklists](#16-checklists)
17. [Your first process walkthrough](#17-your-first-process-walkthrough)
18. [What officers will experience after you Activate](#18-what-officers-will-experience-after-you-activate)

---

## 1. What Designer is

**Designer** is the authoring workshop. You are not building a new website for each form type. You are publishing a **versioned recipe** that tells Workspace:

- which screens to show
- which queues to list
- which buttons officers can press
- where a case goes after Complete

### What you use Designer for

| Task | Outcome |
| --- | --- |
| Create a **workload type** (definition) | A named kind of work (for example I-407 or I-90) |
| Design **forms** | The fields officers fill at each step |
| Draw the **workflow** | Stages, order, assignment rules, and transitions |
| Define **catalog** pieces | Actions, queues, search fields, bulk tools, SLAs, timers |
| **Try** the draft yourself | Rehearse before officers ever see it |
| Run **Lifecycle** | Validate → submit → approve → publish → **activate** for Live |

### What you do *not* do in Designer

- You do not process the office’s daily Live queue as an officer duty (use Workspace Live for that smoke test only).
- You do not expect unsaved canvas edits to appear in Try — **save first** (or wait for autosave — see [section 4](#4-tour-of-designer)).
- You do not rewrite history for old tracking IDs by publishing a new version — old cases keep the version they were created with.

| Area | Purpose |
| --- | --- |
| **Designer** | Author, rehearse (Try), review, publish, activate |
| **Workspace (Live)** | Officer day-to-day work on activated processes |
| **Workspace (Try)** | Optional author rehearsal for a Workload Type (not for officers) |
| **Dashboard** | Supervisor view of Live pressure; drill-down into Workspace |

---

## 2. Big picture: definition, release, instance

Three words appear everywhere. Mixing them up causes most beginner mistakes.

| Concept | Everyday analogy | Example |
| --- | --- | --- |
| **Definition** | The recipe book title (the *kind* of work) | “I-407 Workload” / key `I_407_WORKLOAD` |
| **Release (version)** | One printed edition of the recipe | Version `1.0.0`, then later `1.0.1` |
| **Instance (case)** | One meal cooked from that edition | Tracking ID `W-9001` |

### Rules to remember

1. You edit a **DRAFT** release until it is ready.
2. Once **published**, that version is **frozen** (like a printed book — you do not erase the ink).
3. Cases stay on the version they were created with. Fixing a mistake means a **new version**, not rewriting old cases.
4. **Activate** chooses which published version **new** Live work should use. It does not migrate old tracking IDs onto new required fields.

### Mail + workload under one Workload Type

A workload type officers pick in Workspace often has **two** definitions that travel together:

| Definition | Entity type | Role |
| --- | --- | --- |
| Mail item | **MAIL** | Envelope / packet intake (Doc Prep, repeating rows, spawn) |
| Workload | **WORKLOAD** | The file to process (data entry, shipping, …) |

In Workspace they appear under one **Workload Type** display name (for example I-407), with **Mail item queues** and **Workload queues** on the left.

### What is inside a release?

| Piece | Everyday words | Purpose |
| --- | --- | --- |
| **Schema** | Data contract | What fields exist and what types they have |
| **Forms** | Screens | Labels, sections, inputs officers see |
| **Workflow** | Process map | Stages, assignment, transition rules |
| **Actions** | Buttons | Complete, Save draft, Release, … |
| **Queues** | Work lists | Filtered lists officers open |
| **SLAs** | Clocks | Optional timing targets (calendar or business-day clocks) |
| **Search** | Find extras | Extra Find-a-case fields beyond tracking ID / receipt |
| **Bulk actions** | Do-this-to-many | Multi-select queue operations |
| **Scheduled actions** | Timers | Holds, nudges, delayed events |

**Queue versus stage (easy to mix up):**

- A **stage** is where the case *is* (“Ready for Data Entry”).
- A **queue** is a *list* of cases that match a filter (usually “current stage equals Ready for Data Entry”).

Most stage queues map one-to-one with a stage, but they are still separate objects you create in Catalog and link in Workflow.

---

## 3. Who does what (roles)

Separation of duties is intentional. In the demo, you switch **Actor id** on the Lifecycle panel for review steps.

| Role | Typical actions | Notes for newbies |
| --- | --- | --- |
| **Author** | Create draft, edit Form / Workflow / Catalog, save, submit for review | This is you day to day |
| **Approver** | Review, approve or reject | Must be a **different** Actor id from the author who submitted |
| **Publisher** | Publish, activate / deactivate, retire | Different again from approver when the product requires it |
| **Officer** | Works in Workspace **Live** only | No Try for daily duty, no Designer editing |
| **Supervisor** | Dashboard; may reassign cases in Workspace when allowed | Operational, not authoring |

### Why the product blocks same-person approve

Do not use the same Actor id for author → approve → publish. The product blocks that on purpose so one person cannot silently approve their own unfinished draft in a regulated workflow. In the demo, change the Lifecycle **Actor id** field between steps.

### Comment field

Lifecycle actions often accept a **Comment**. Use short, useful notes (“Ready for pilot desk”, “Rejected: missing shipping queue columns”) so the next person knows why the status changed.

---

## 4. Tour of Designer

Open **Designer** from the product header (or **Jump to…**).

### Top of Designer: open / create a release

Before the nav tabs matter, you need an open draft.

| Control | What it does |
| --- | --- |
| **Open definition** | Browse and open an existing release |
| **Create draft** | Start a new DRAFT (optionally clone from another release) |
| **Delete draft** | Remove an opened DRAFT you do not need (not for published releases) |
| Definition key / Display name / Entity type / Version | Identity of what you are editing |
| **Clone from** | Copy forms, workflow, and catalog from another release into a new draft |
| Forms picker / New form / Duplicate / Delete form | Manage multiple forms on one draft |
| Save status | Shows **Unsaved changes** or **Saved · just now** while you edit |

Help text under these fields explains entity type and clone behavior. Read it the first time — it catches common mistakes (for example Try using the newest DRAFT).

### Dirty leave guard and autosave

Designer protects your draft:

| Behavior | What it means for you |
| --- | --- |
| **Autosave** | Form and Workflow drafts quietly save after a short pause (~2.5 seconds) while you work |
| **Unsaved changes** status | Something is still dirty — wait for autosave or save explicitly before Try / Lifecycle |
| **Leave warning** | Leaving Designer, switching release, or using Jump to… while dirty asks you to confirm |
| **Browser close warning** | Closing the tab with unsaved work prompts the browser leave dialog |

Do not rely on autosave alone before **Try** or **Submit** — glance at the status line and save if anything still says unsaved.

### Designer nav (middle bar)

| Area | What you do there |
| --- | --- |
| **Build → Form** | Build the screens officers fill |
| **Build → Workflow** | Stages, order, transitions, assignment settings |
| **Build → Catalog** | Actions, queues, SLAs, search, bulk actions, scheduled actions |
| **Build → Schema** | Inspect / reconcile the data contract behind forms |
| **Rehearse → Try** | Author rehearsal of **this one** saved draft |
| **Rehearse → Simulate** | Test “if data looks like this, where does Complete go?” without creating cases |
| **Release → Lifecycle** | Validate, submit, approve, publish, activate, deactivate, retire, export/import |
| **Release → Diff** | Compare two versions |
| **User guide** (far right) | Opens this guide |

### Critical habit: save before Try

Designer **Try** uses what you have **saved**. Unsaved canvas edits are not what Try runs. After Form, Workflow, or Catalog changes:

1. Confirm status is saved (or click Save).
2. Then open Try.
3. If Try looks “old,” you almost always forgot to save.

---

## 5. Recommended order of work

Build in this order the first time. Later pieces point at earlier ones. Skipping ahead is the #1 newbie failure mode.

1. **Create** the definition + DRAFT version (MAIL and/or WORKLOAD).  
2. **Catalog** — actions and queues first (then search / bulk / SLAs if needed).  
3. **Form** — screens and fields; save.  
4. **Workflow** — stages that use those forms, queues, and actions; set transition defaults.  
5. **Save** everything again.  
6. **Try** the happy path; use **Simulate** for branching rules.  
7. **Lifecycle** — Validate → Submit → Approve → Publish → **Activate**.  
8. Smoke-test in **Workspace → Live**.

### Why this order?

| If you do this too early… | What breaks |
| --- | --- |
| Wire a stage to a queue that does not exist | Validation / save errors |
| Add Complete action before Catalog action exists | Stage cannot offer the button |
| Try before saving Form | Officers-in-rehearsal see stale fields |
| Activate before Validate | Preventable Live defects |

Skipping ahead causes validation errors. That is normal — create the missing piece, then link it.

---

## 6. Create or open a draft

### Create a new type (first time)

1. In Designer, fill **Definition key** (stable internal name, for example `I_407_WORKLOAD`).
2. Fill **Display name** (friendly, for example `I-407 Workload`).
3. Choose **Entity type**: **MAIL** or **WORKLOAD**.
4. Set **Version** to `1.0.0` (or your team’s first SemVer).
5. Optionally set **Clone from** to an existing release so you do not start blank.
6. Click **Create draft**.

**What you should see:** status shows DRAFT; Form / Workflow / Catalog become editable for this release.

#### Choosing MAIL vs WORKLOAD

| Choose MAIL when… | Choose WORKLOAD when… |
| --- | --- |
| You are modeling the envelope / packet | You are modeling the file officers process after intake |
| You need repeating rows that spawn child cases | You need stage forms like Data Entry / Shipping |
| Doc Prep is the first officer desk | Work continues after mail Complete |

Many real processes need **both** definitions. See [section 12](#12-mail--workload-packets).

### Open an existing draft

1. Click **Open definition**.
2. Find the definition and version.
3. Open it.

Only **DRAFT** releases are freely editable. Published releases are read-only in Designer — clone to a new version to change them.

### Delete a leftover draft

You can delete an opened **DRAFT** if it is not needed. Published / in-review snapshots are not deleted that way — use Lifecycle retire/deactivate paths instead.

### Multiple forms on one draft

A release can have several forms (one per stage, or shared). Use:

- the form picker to select which form you are editing
- **New form** to add another
- **Duplicate form** to copy structure
- **Delete form** carefully (workflow stages may still point at it)

Form order in the picker often follows workflow stage order once stages link forms.

---

## 7. Catalog (building blocks)

Open **Catalog**. Catalog holds shared pieces the workflow will use. Create them **before** you expect Workflow to link to them.

### 7.1 Actions

Actions are the named buttons officers press.

#### Common action types

| Type | Officer experience | Typical use |
| --- | --- | --- |
| **Transition** | Moves to another stage (uses transition rules) | Complete, Approve, Send to shipping |
| **Save draft** | Keeps form data without finishing the stage | Save, Save progress |
| **Release assignment** | Puts the case back on the queue | Release |

#### What to set on each action

1. A clear **label** (what the officer sees) — for example `Complete`.
2. A stable **key** (internal) — for example `COMPLETE`.
3. The correct **type**.
4. For transition actions, connection to the right **transition set** / rules (wired fully in Workflow).
5. Optional **require assignment to current user** — when set, Complete fails unless the case is assigned to the officer who clicks it.

**Newbie tip:** Name labels the way officers speak (“Complete”, not `TRANSITION_OK`). Keep keys SCREAMING_SNAKE_CASE.

### 7.2 Queues

Queues are the work lists officers open in Workspace.

For each queue, you typically set:

| Setting | Why it matters |
| --- | --- |
| **Display name** | What officers see (“Ready for Data Entry”) |
| **Key** | Stable id Workflow references |
| **Eligibility** | Which cases belong here (usually “current stage equals …”) |
| **Columns** | Table columns in the list (including SLA when configured) |
| **Filters** | Optional narrowing (for example assignment status) — officers see these as filter chips |
| **Projected form fields** | Map form data onto extra columns (names, receipts, …) |

#### Projected fields (blank column trap)

The path must match where the form **actually stores** the value.

| Form saves… | Project… | Result |
| --- | --- | --- |
| `applicantFirstName` | `applicantFirstName` | Column shows the name |
| `applicantFirstName` | `firstName` | Column stays **blank** |

If officers report blank name columns, fix Catalog projections — do not tell officers to “refresh harder.”

#### System lists you do not invent

**Completed**, **Assigned to Me**, and **All Items** are provided for officers. You design the **stage queues**.

### 7.3 Search

Search catalog fields feed Workspace **Find a case** beyond tracking ID and receipt. Keep paths aligned with real form fields. Prefer a short list of high-value fields so Find stays simple.

### 7.4 Bulk actions and scheduled actions

| Feature | Meaning | Newbie guidance |
| --- | --- | --- |
| **Bulk actions** | Act on many selected queue rows | Add only when a desk truly needs multi-select |
| **Scheduled actions** | Time-based events after a stage is entered | Optional; delivery of notifications may still be limited in this product slice |

### 7.5 SLAs

Optional timing / service-level clocks on stages. Officers and Dashboard may show **On track**, **Warning**, **Past SLA**, or **Paused**.

| Setting | Newbie guidance |
| --- | --- |
| **Calendar** clock | Counts wall-clock time |
| **Business** clock | Counts Mon–Fri (UTC) business hours in the current product |
| Thresholds | When Warning vs Breached appear |
| Pause when | Optional stages where the clock should pause |

Safe to skip on your first process. When you add SLAs, Try a case long enough to see the badge language officers will see.

### Catalog save habit

After editing Catalog, save before switching to Workflow or Try. Unsaved catalog keys cannot be linked reliably.

---

## 8. Forms (screens officers fill)

Open **Form**. A form is one screen (or page of fields) for a stage: labels, inputs, sections, required rules, and read-only displays.

### 8.1 Typical editing flow

1. Open **Form**.
2. Pick which form you are editing.
3. Confirm **Form title**, **formKey**, and **dataPath** (where data lives on the case) under **Identity** (collapsed by default — expand it when you need those fields).
4. Add fields from the **palette** (Text, Date, Dropdown, A-Number, …).
5. Group fields into **sections**.
6. Select a field to edit **Properties** (label, required, help text, validation).
7. Open **Advanced** on a field only when you need width, classification, Fill from, Display from, or extra validation — Advanced starts **collapsed**.
8. Add **behaviors** if fields should show/hide or become required based on other values.
9. Confirm save status (or click Save).

### 8.2 Palette and canvas

| Area | Purpose |
| --- | --- |
| **Palette** | Field types you can add |
| **Canvas** | Sections and fields as officers will roughly experience them |
| **Properties** | Details for the selected section or field |
| **Behaviors** | Conditional logic for the form |

Multi-select shortcuts (when documented on screen) help you copy, remove, or rearrange fields quickly. Prefer clear labels over clever short names.

### 8.3 Sections

Sections group related fields (for example Applicant Information).

Typical section settings:

- Title officers see
- Section key
- Layout (one column / two column)
- Whether the section is repeatable (**Mail** only in many cases)

### 8.4 Field properties newbies must get right

| Property | Guidance |
| --- | --- |
| **Label** | Plain language officers understand |
| **Key / path** | Stable; do not rename casually after queues project it |
| **Required** | Only if the business truly needs it at this stage |
| **Read-only** | For values officers should see but not change |
| **Help text** | Short hint under the field (often under Advanced) |
| **Validation** | Match the data type (dates, numbers, A-Number patterns) |
| **Classification + Splunk policy** | Required for PII / SENSITIVE fields |

### 8.5 Accessibility (do not skip)

Forms must stay usable with assistive technology. Missing titles, labels, or duplicate field keys will fail validation. Treat those messages as **blockers**, not suggestions. If Validate complains about accessibility, fix the form before you fight Workflow.

### 8.6 Schema relationship

Behind the form is a **data contract** (JSON Schema) describing allowed fields and types. Saving the form usually keeps this in sync. Lifecycle Validate will complain if the contract and the canvas disagree in harmful ways. Use the **Schema** tab when you need to inspect the contract after larger edits.

### 8.7 Mail-only features

| Feature | Where | Purpose |
| --- | --- | --- |
| **Repeatable sections** | Mail forms | Officers click Add to append rows (for example multiple workloads in one packet) |
| **Spawn workloads** | Mail Complete configuration | Creates child WORKLOAD cases from those rows |

Workload forms do not use “create child cases” the same way. Put spawn logic on the mail side.

### 8.8 Preview and JSON views

Form designer often offers **Edit**, **Preview**, **UI JSON**, and **Form schema** modes. Use Preview to sanity-check labels. Use JSON views only when you need precision — prefer the visual canvas as a newbie.

### 8.9 What officers experience on validation errors

When officers (or you in Try) Complete with missing required fields:

- The case form shows an error summary with links to each field
- Invalid fields are highlighted
- Focus moves to the first problem field inside the case pane

Design required flags carefully — every required field becomes a Complete blocker for the desk.

---

## 9. Workflow (stages and movement)

Open **Workflow**. This is the process map.

### 9.1 Stages

Each stage is a step in the process, for example:

- Ready for Data Entry  
- Ready for Shipping  
- Ready for Shredding  
- Completed  

For each stage you typically set:

| Setting | Meaning |
| --- | --- |
| Display name and order | What officers see and the sequence on the canvas |
| **Form** | Which screen to show |
| **Queue** | Which list shows cases in this stage |
| **Actions** | Which buttons are allowed (Complete, Save, …) |
| Assignment rules | Must assign before complete? Allow release? Allow reassign? |
| Terminal flag | Mark final stages as **terminal** (Completed) |
| SLA (optional) | Link a Catalog SLA clock for timing badges |

#### Assignment rules (think about the officer desk)

| Rule idea | Officer impact |
| --- | --- |
| Must assign before complete | Prevents anonymous Completes; officer’s **Signed in as** must match **Assigned to** exactly |
| Allow release | Officers can return work to the pool |
| Allow reassign | Supervisors can hand work to someone else |

Match these to real desk policy. Too loose → collisions and unclear ownership. Too tight → officers get stuck. Train officers that Assign is disabled once *anyone* owns the case — they must Reassign or Release, not re-click Assign.

### 9.2 Transitions

When an officer Completes, **rules** decide the next stage.

Good practice:

1. Write the happy-path default first (always have a **default** next stage).
2. Add conditional branches (for example if status is Rejected → holding stage).
3. Use **Simulate** to prove each branch.
4. Never leave a Complete action with “no matching transition” — cases get stuck.

### 9.3 Canvas tips

- Add stages, then arrange them so the map is readable.
- Wire forms/queues/actions **only** to keys that already exist.
- Save often — large maps are painful to redo after a browser refresh (autosave helps, but confirm status before Try).

### 9.4 Transition sets and Catalog actions

Remember: Catalog defines the **button**; Workflow defines **when it appears** and **where it goes**. Both must agree on keys.

---

## 10. Try, Simulate, and Diff

### 10.1 Designer Try (authors only)

**Try** lets **you** rehearse **this one open draft** before officers ever see it.

Officers will not use Try for daily work. After you **Activate**, they work only in **Workspace Live**.

#### Steps

1. Save Form, Workflow, and Catalog (confirm save status).
2. Open **Try**.
3. Set **Signed in as** to a stable test officer id (same idea as Workspace).
4. Use **New work arrives** (or the queue list in the Try panel).
5. Assign, fill, Complete — same kinds of buttons officers will use in Live.
6. Confirm the case lands in the next queue / Completed as expected.
7. If Complete fails validation, use the highlighted fields and error links (same UX as Live Workspace).
8. Fix issues in Form/Workflow/Catalog, save, and Try again.

#### Notes

- New intake in Try opens a temporary case; it is saved when you Assign / Complete (not when you only open and leave) — same draft behavior officers see for New mail.
- Designer Try is single-definition practice for the open release.
- If Workspace still has a Try toggle in your environment, that is also for authors rehearsing a Workload Type — **not for officers**.
- Assignment must match **Signed in as** exactly when the stage requires assignment — the same trap officers hit in Live.

### 10.2 Simulate

Use **Simulate** to answer: “With this sample data, which stage does this transition choose?”

| Simulate does | Simulate does not |
| --- | --- |
| Evaluate transition rules against sample data | Create real cases |
| Help debug branching | Replace a full Try walkthrough |

Use Simulate when Complete should branch. Use Try when you need the full officer-feel path.

### 10.3 Diff

Use **Diff** to compare two versions before you publish a change. Review what officers will experience differently (fields added, stages renamed, queues changed). Make Diff part of every post-go-live change, not only the first publish.

---

## 11. Lifecycle: from draft to Live

Open **Lifecycle** on the draft. This is how a recipe becomes what officers use.

### 11.1 Typical happy path

1. **Validate** — fix every error listed.  
2. **Submit** — author sends for review (status becomes in review).  
3. **Approve** — different Actor id.  
4. **Publish** — version is frozen.  
5. **Activate** — this version becomes what **Workspace Live** uses for new work.

### 11.2 What each step means (newbie detail)

| Step | What changes | Common mistake |
| --- | --- | --- |
| **Validate** | Runs checks; lists problems | Ignoring warnings that are actually blockers for your desk |
| **Submit** | DRAFT → in review | Submitting with unsaved Form/Workflow |
| **Approve** | Review accepted | Same Actor id as submitter |
| **Reject / Return to draft** | Back to editable draft | Forgetting to tell the author *why* |
| **Publish** | Version frozen | Thinking Publish alone makes Live (it does **not**) |
| **Activate** | Live pointer moves here | Activating without a Workspace smoke test |
| **Deactivate** | Stop using this as Live | Deactivating with no replacement activated |
| **Retire** | Archive after deactivate | Retiring something still needed for history |

API errors in Lifecycle and other Designer panes keep structured detail when the server sends field references — read the banner carefully before retrying.

### 11.3 Actor id discipline

On Lifecycle:

1. Set Actor id to the **author** → Validate / Submit.  
2. Change Actor id to the **approver** → Approve.  
3. Change Actor id to the **publisher** → Publish / Activate.

Write the three ids down before you start so you do not lock yourself out of the next button.

### 11.4 Packages (export / import)

| Action | Use when |
| --- | --- |
| **Download package** | Move configuration to another environment |
| **Import package** | Bring a package in (may land as DRAFT or PUBLISHED depending on options) |

Import does **not** skip Activate. A published import still needs Activate when that environment should go Live.

### 11.5 What Activate means for officers

- Workspace **Live** shows this process — that is all officers use for daily work.
- Your Try / rehearsal cases stay out of Live.
- On activate/publish paths, Live for that release is prepared so officers are not flooded with old rehearsal items.

After Activate, open Workspace → Live yourself and walk one test case before you tell the desk it is ready. Share the [Officer Workspace user guide](./officer-workspace-user-guide.md) so the desk knows Find, Assign, and Complete behavior.

---

## 12. Mail + workload packets

For types like I-407 you usually author **two** definitions.

### Recommended packet build

1. Author a **MAIL** definition (intake / Doc Prep screens, repeating rows if needed).  
2. Author a **WORKLOAD** definition (data entry, shipping, shredding, …).  
3. On mail Complete, configure spawning of workload cases from the repeating section.  
4. Save, Try each side as far as you can.  
5. Lifecycle and **Activate both sides** when ready so Workspace shows one **Workload Type** with mail queues and workload queues.

### What officers should see afterward

- Left rail: Mail item queues + Workload queues  
- Completing Doc Prep creates child workloads  
- Opening a workload can show **Linked mail item** and mail screens for intake data  

### Newbie failure modes

| Symptom | Likely cause |
| --- | --- |
| Workloads never appear after mail Complete | Spawn not configured, or repeating rows empty |
| Workload says not linked to mail | Packet link missing from mail Complete path |
| Only one side visible in Workspace | Other definition not activated / not grouped into the Workload Type |

---

## 13. Versioning and changes after go-live

| Goal | What to do |
| --- | --- |
| Fix a published mistake | New version (for example `1.0.1`), clone from the published release, edit DRAFT, Lifecycle again, Activate when ready |
| Start a similar new form type | New definition key; clone from a cousin process |
| Keep old cases on old rules | Do nothing — cases stay pinned to their version |
| Stop new intakes on a version | Deactivate (then activate another) |
| Compare editions | Designer **Diff** |

### Mental model after go-live

- **Old tracking IDs** keep old required fields and old stages.  
- **New intakes** after Activate use the new recipe.  
- Never expect Activate of `1.0.1` to rewrite `1.0.0` cases onto new fields.

Plan desk communication: “Cases already in flight stay on the old screens; new mail uses the updated screens.”

---

## 14. Naming rules (please follow these)

OPTIC is strict about keys. Write them down as you invent them.

| Item | Good | Bad |
| --- | --- | --- |
| Definition / stage / queue / action keys | `I_407_WORKLOAD`, `READY_FOR_DATA_ENTRY`, `COMPLETE` | `I-407`, `Ready for data entry`, `complete!` |
| Versions | `1.0.0`, `1.0.1` | `1.0`, `v1`, `latest` |
| Display names | “Ready for Data Entry” | (display names *can* be friendly; keys cannot) |

### Consistency checklist

Wherever you reference a key, spelling must match exactly:

- Workflow stage → form key  
- Stage → queue key  
- Stage → action keys  
- Action → transition set  
- Queue projected fields → form field paths  

One typo = blank columns, missing buttons, or Validate failures.

---

## 15. Common problems

| Problem | Likely cause | What to try |
| --- | --- | --- |
| Try does not show my latest edits | Not saved | Wait for autosave / Save Form / Workflow / Catalog, then Try again |
| Leave / Jump to… blocked | Dirty draft | Save or confirm discard when prompted |
| Validate fails: missing form/queue/action | Built workflow before Catalog/Form pieces | Create the missing key, then re-link |
| Cannot approve / publish | Same Actor id as previous step | Change Lifecycle Actor id |
| Officers see nothing in Live | Not activated, or wrong workload type | Activate; confirm Workspace → Live |
| Queue column empty (for example names) | Projected path ≠ form field path | Fix Catalog projected fields to match the form |
| Complete fails “required” | Required fields empty or wrong types | Fill them in Try; use field error links; reconsider required flags |
| Complete fails “assign to yourself” | Signed in as ≠ Assigned to | Match ids exactly; Reassign if needed |
| Complete leaves case stuck | No matching transition / no default | Fix Workflow transitions; Simulate |
| Someone else changed the draft | Concurrent edit conflict | Reload the draft and re-apply carefully |
| Delete draft disabled | Not a disposable DRAFT | Use Lifecycle paths for published releases |
| Import succeeded but officers see nothing | Not Activated | Activate in that environment |
| Accessibility Validate errors | Missing labels/titles/duplicate keys | Fix Form properties before arguing with Workflow |

When an error shows a **reference id**, give that to support. Do not paste A-Numbers, full receipts, or tokens into tickets.

---

## 16. Checklists

### First-time author checklist

1. [ ] Definition + DRAFT `1.0.0` created (MAIL and/or WORKLOAD)  
2. [ ] Catalog: actions + queues (+ projected fields if needed)  
3. [ ] Forms saved with clear labels and required fields intentional  
4. [ ] Workflow stages linked to forms, queues, actions  
5. [ ] Default transition targets set; branches Simulated  
6. [ ] Designer Try: assign → fill → complete works (validation errors jump to fields)  
7. [ ] Validate clean (including accessibility)  
8. [ ] Submit → Approve (other actor) → Publish → **Activate**  
9. [ ] Workspace **Live**: queues visible; New mail / Find a case smoke-tested  
10. [ ] Officer guide shared with the desk for day-one training  

### Before every publish

1. [ ] Diff reviewed against the previous version  
2. [ ] Validate clean  
3. [ ] Try path walked once more after final save  
4. [ ] Correct Actor ids for approve / publish  
5. [ ] Activate plan agreed (when Live should switch)  
6. [ ] Desk communication drafted for in-flight vs new cases  

### After activate

1. [ ] Workspace → Live → correct Workload Type  
2. [ ] Stage queues in process order with sensible counts  
3. [ ] One test case: New mail / assign / complete  
4. [ ] Find a case by tracking ID  
5. [ ] Confirm author Try rehearsal is not polluting Live counts  
6. [ ] Spot-check projected columns (names, receipts) and SLA badges if configured  

---

## 17. Your first process walkthrough

Use this as a training script for your first solo publish (clone a simple cousin process if one exists).

### Goal

Publish and Activate a minimal linear process: one queue stage → Complete → Completed, then prove it in Workspace Live.

### Steps

1. **Clone or create** a WORKLOAD draft `1.0.0` with a clear definition key.  
2. **Catalog:** create `SAVE_DRAFT` (save) and `COMPLETE` (transition) actions; create `READY_FOR_DATA_ENTRY` queue with eligibility on that stage; add basic columns.  
3. **Form:** one section, a few fields (for example receipt number + a text field). Save (confirm status).  
4. **Workflow:** stages Ready for Data Entry (form + queue + actions; require assign if your desk needs it) and Completed (terminal). Default transition from Complete → Completed. Save.  
5. **Validate** until clean.  
6. **Try:** New work arrives → set Signed in as → Assign → fill → Complete → confirm Completed.  
7. **Lifecycle:** Submit / Approve / Publish / Activate with proper Actor ids.  
8. **Workspace Live:** pick the Workload Type → open the queue → run one case → Find by tracking ID.  
9. Write down every key you used in your notepad for the next process.

If anything fails, fix that layer (Catalog vs Form vs Workflow vs Lifecycle) before adding mail spawn complexity.

---

## 18. What officers will experience after you Activate

Authors often forget to “put on the officer hat.” After Activate, an officer should be able to:

1. Open **Workspace** → **Live**.  
2. Pick your **Workload Type** (remembered from last visit when they return).  
3. See mail and/or workload **queues** with clear names and counts.  
4. Open a queue, use filter chips if you configured filters, **Assign**, fill **your** labels (not internal keys), **Complete**.  
5. See validation errors jump to the first bad field when something is missing.  
6. Use **Find a case** with the tracking ID on a label.  
7. Open **User guide** if they are new — that guide assumes your queues and buttons make sense in plain language.

If officers need tribal knowledge to understand a button named `TRANSITION_2`, rename the **label** in Catalog before you call the process done.

---

## Where to go next

- Officer day-to-day use: [Officer Workspace user guide](./officer-workspace-user-guide.md)
- Field-by-field authoring, operators, and a full worked example: [Onboard a new workload from scratch](./onboard-a-new-workload.md)
- Architecture (for technical staff): [Architecture overview](../architecture/overview.md)
