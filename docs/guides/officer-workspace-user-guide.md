# Officer Workspace user guide

A plain-language, step-by-step guide for people who **process mail and workloads** in OPTIC v2.0.

You do **not** need to know programming, databases, or how the process was built. If you can fill in a web form and work from a list of tasks, you can use Workspace.

This guide assumes you are a **new officer** (or a supervisor helping officers). It explains what you see on the screen, why it is there, and exactly what to click for everyday work.

**Officers work in Live.** Practice against a draft belongs to process authors (**Designer → Try**, or Workspace **Try** when that toggle is enabled for authors). If someone asks you to rehearse a draft as part of authoring, that is not day-to-day officer work.

**Companion guide (for authors, not officers):** [Designer user guide](./designer-user-guide.md)

**In the product:** open Workspace and click **User guide** in the Officer workspace header to read this guide inside the app. You can also open **Jump to…** (⌘K / Ctrl+K) and search for help destinations when that command palette is enabled.

---

## How to use this guide

| If you want to… | Go to… |
| --- | --- |
| Understand the big picture in five minutes | [Section 1](#1-what-workspace-is) and [Section 2](#2-mail-vs-workload-simple-picture) |
| Learn every word on the screen | [Section 3](#3-words-you-will-see) and [Section 4](#4-the-workspace-screen) |
| Do your first real case end to end | [Section 15](#15-your-first-day-walkthrough) |
| Look up one task (assign, find, new mail, …) | Use the [table of contents](#table-of-contents) |
| Fix something that went wrong | [Section 13](#13-common-problems-and-what-to-do) |

Read sections 1–8 once when you start. Keep sections 9–14 as a reference.

---

## Table of contents

1. [What Workspace is](#1-what-workspace-is)
2. [Mail vs workload (simple picture)](#2-mail-vs-workload-simple-picture)
3. [Words you will see](#3-words-you-will-see)
4. [The Workspace screen](#4-the-workspace-screen)
5. [Signed in as (who am I?)](#5-signed-in-as-who-am-i)
6. [Pick a workload type](#6-pick-a-workload-type)
7. [Use the queues](#7-use-the-queues)
8. [Open and work a case](#8-open-and-work-a-case)
9. [New mail arrives / New work arrives](#9-new-mail-arrives--new-work-arrives)
10. [Find a case](#10-find-a-case)
11. [Labels and printing](#11-labels-and-printing)
12. [If two officers grab the same case](#12-if-two-officers-grab-the-same-case)
13. [Common problems and what to do](#13-common-problems-and-what-to-do)
14. [Quick checklists](#14-quick-checklists)
15. [Your first day walkthrough](#15-your-first-day-walkthrough)
16. [Keyboard shortcuts and tips](#16-keyboard-shortcuts-and-tips)

---

## 1. What Workspace is

**Workspace** is your electronic desk for **Live** work — the real activated queues your office uses every day.

Think of it like a physical mailroom plus file desk combined:

- The **queues** on the left are stacks of folders waiting at each step of the process.
- When you **open** a case, a **case drawer** opens with the form for the step that folder is currently on.
- When you **Complete** a case, you are saying “I finished this step,” and the system moves the folder to the next stack (or marks it finished).

### What you use Workspace for

| Task | Why you do it |
| --- | --- |
| See work waiting in **queues** | Know what needs attention at each stage |
| **Assign** a case to yourself | Claim the work so others do not edit it at the same time |
| Fill in the **form** for that stage | Capture the data your office needs at that step |
| **Save**, **Complete**, or **Release** | Keep a draft, finish the stage, or put the case back for someone else |
| **Find** a case by tracking ID or receipt | Help a customer who walks up with a sticker or receipt |
| Print a simple **label** | Put tracking number and status on a sticker |

### What you do *not* do in Workspace

- You do **not** design forms, stages, or queues. Process authors do that in **Designer**.
- You do **not** “activate” a process for Live. Publishers do that.
- You do **not** use draft **Try** as part of normal officer duties. Try is author rehearsal.

| Area | Who uses it | Purpose |
| --- | --- | --- |
| **Workspace (Live)** | Officers (and supervisors helping officers) | Daily Live work |
| **Workspace (Try)** / **Designer → Try** | Authors | Rehearse a draft before Activate |
| **Designer** | Authors / reviewers / publishers | Build, rehearse, and publish the process |
| **Dashboard** | Supervisors | Shift overview; can jump you into Workspace on a stage or case |

### What “Live” and “Try” mean

At the top of Workspace you may see **Try** and **Live** toggles (when Try mode is enabled).

- **Live** = real activated work that counts for the office. **Officers stay here.**
- **Try** = draft rehearsal for authors against saved drafts. Ignore it for officer duties.

If Live shows no workload types, nothing has been activated yet — ask a publisher or support, not another officer.

---

## 2. Mail vs workload (simple picture)

This is the most important idea for new officers. Getting it wrong usually means looking in the wrong queue.

### Physical office analogy

1. An **envelope** arrives in the mailroom → that is a **mail item**.
2. Inside it there may be one or more **files that need processing** (applications, packets of forms) → those are **workloads**.
3. Staff first register the envelope (Doc Prep / intake), then work each file through its own stages (data entry, shipping, shredding, and so on).

### In OPTIC

| Concept | Plain meaning | Example |
| --- | --- | --- |
| **Mail item** | The packet / envelope you receive first | Tracking ID that starts like a mail case |
| **Workload** | A case created from that mail (the file to process) | An I-407 file with its own tracking ID |
| **Workload Type** | The named process your office uses (groups mail + workload queues) | **I-407**, **I-90**, **I-131-BULK** |
| **Packet** | The mail item plus the workloads linked to it | One envelope → several workload cases |

A **Workload Type** (for example **I-407**) usually shows both:

- **Mail item queues** — work on envelopes/packets
- **Workload queues** — work on the files created from mail

### How mail creates workloads (typical path)

1. You (or intake) start with **New mail arrives**.
2. You fill Doc Prep / intake fields, including rows that describe each file in the packet.
3. When you **Complete** certain mail steps, the system can **create workload cases** automatically from those rows.
4. Those new workloads appear in workload queues for later stages (for example Ready for Data Entry).

You do not invent that link by hand. The process authors configured when and how workloads spawn. Your job is to complete the mail stage correctly so the system can create the right child cases.

### When you open a workload

On a workload case you may see a note like **Linked mail item** with a tracking ID. That means you can open mail screens below for intake data that was captured earlier. If you see **Not linked to a mail item**, the packet connection is missing — usually Doc Prep on the parent mail was not completed correctly. Ask a lead or report it; do not invent a new mail case unless your procedure says so.

---

## 3. Words you will see

Keep this table nearby for your first week.

| Word | Plain meaning | Everyday analogy |
| --- | --- | --- |
| **Tracking ID** | The unique number/code for that mail or workload | Barcode on a folder |
| **Receipt number** | A business receipt (often searchable by prefix) | Receipt on the form |
| **Queue** | A work list for one step or view | Stack of folders on a shelf |
| **Stage** | Where the case is in the process right now | “This folder is at Data Entry” |
| **Assign** | “I am taking this case.” | Writing your name on the folder |
| **Release** | “I am putting it back for someone else.” | Putting the folder back on the stack |
| **Reassign** | “Give this case to another named officer.” | Handing the folder to a coworker (often supervisors) |
| **Complete** | Finish this stage and move the case forward (or finish the process) | Stamping “done for this step” |
| **Save** / draft save | Keep what you typed without finishing the stage | Leaving sticky notes on the folder and putting it in your drawer |
| **Live** | Real activated work — what officers use | Production desk |
| **Signed in as** | The name or email that counts as “you” for assign and “Assigned to Me” | Your badge / sign-in name |
| **Unassigned** | Nobody currently owns the case | Folder still on the shared stack |
| **Past SLA** / **On track** | Timing status for the stage (when authors configured an SLA) | How late the folder is vs the desk clock |
| **ACTIVE** / **COMPLETED** | Rough case status you may see as a pill | Still in process vs finished |
| **Jump to…** | Quick search across Workspace, Dashboard, Designer, Admin | Shortcut desk directory |
| **User guide** | This document, also available as a button in the header | The laminated how-to sheet on the desk |

---

## 4. The Workspace screen

Open **Workspace** from the product header (or **Jump to…** → Workspace). You should see **Officer workspace**.

### Top header

| Control | What it does |
| --- | --- |
| Context line | Shows mode (Live / Try), workload type, queue, Signed in as, and open tracking ID when a case is open |
| **Signed in as** | Who you are for assign / Assigned to Me — see [section 5](#5-signed-in-as-who-am-i) |
| **Try** / **Live** | Mode switch — officers use **Live** |
| **User guide** | Opens this guide in a dialog |
| **Find a case** (when collapsed) | Expands Find so you can search without leaving the desk |

### Left side (sidebar)

Work top to bottom:

1. **Workload Type** — pick the kind of work (for example I-407). Type to search if the list is long. Use the clear control (×) if you need to unselect.
2. **New mail arrives** or **New work arrives** — start a brand-new intake (see [section 9](#9-new-mail-arrives--new-work-arrives)). The button label depends on whether this type starts with mail or with a workload-only path.
3. **Queues** — grouped lists:
   - **Mail item queues** (when this type has mail)
   - **Workload queues**
   - Each queue shows a **count** of cases.

Your last Workload Type is remembered for next time you open Workspace.

### Main area (center / right)

What you see depends on what you clicked:

| Situation | Main area shows |
| --- | --- |
| No case open, no queue selected | Guidance to open a queue, find a case, or start new work |
| A queue selected | The **queue table** (list of cases) |
| A case open | A **case drawer** over the desk (form, actions, labels, history) |
| After a Find search | Match list, then a case if you open one |

**Find a case** sits in the workspace (often above the desk): Tracking ID, Receipt number, Advanced search (when offered), Search, and Clear. You can collapse Find when you need more room for the queue.

### How the layout changes when a case is open

When you open a case:

- A **case drawer** opens on the side (on smaller screens it may cover more of the desk).
- Actions (**Complete**, **Print labels**, **Close case**) stay pinned at the bottom of the drawer while the form scrolls.
- Use **Back to queues**, **Close case**, or **Escape** to return to the list. You are not deleting the case — you are only closing the view.

---

## 5. Signed in as (who am I?)

In this product demo, **Signed in as** is who the desk treats as you for assign and **Assigned to Me** (for example `officer@example.gov`).

When Admin has **Signed in as override** on (the default for demos), you can type a name or email in that field. When the override is off, the field is read-only and uses the fixed demo officer identity until real sign-in (ICAM) replaces it.

That value is used when you:

- **Assign** a case to yourself
- See **Assigned to Me**
- Appear as the assignee on the case for others
- Pass the “must be assigned to you” check on **Complete** / **Save**

### Critical rule: Assigned to must match Signed in as

Complete and Save often require the case to be assigned to **exactly** the same id as **Signed in as** (same spelling, no extra spaces).

| What you see | What it means |
| --- | --- |
| Case shows **Assigned to** `alice@example.gov` and Signed in as is also `alice@example.gov` | You can Complete when the form is valid |
| Case shows Assigned to someone else, or a slightly different spelling | You get “Assign the item to yourself and try again” even though the case looks assigned |

If Signed in as was edited but not committed (click away from the field or press Enter), the box may still show a draft value while the system uses the previous id. Commit the field, then compare it to **Assigned to**.

### Tips for new officers

1. Use a **clear, consistent** value every day — ideally your work email, the same spelling every time.
2. If you change **Signed in as** mid-day, **Assigned to Me** follows the **new** value. Cases assigned to the old value will not appear under the new one until reassigned.
3. **Assign** is disabled when the case is already assigned to **anyone**. To take a case from another officer, use **Reassign** (when allowed) or ask them to **Release**.
4. **Reassign** asks for another person’s id — type the id that person uses in **Signed in as**, not a nickname they never use.
5. Do not share one Signed in as value across two people working at the same time.

### Supervisors

When you reassign, you are telling the system who should own the case next. Confirm their Signed in as spelling with them first.

---

## 6. Pick a workload type

Every process your office runs is a **Workload Type**. Until you pick one, queues and New mail do not know which recipe to use.

### Steps

1. Open **Workspace**.
2. Confirm you are on **Live**.
3. Under **Workload Type**, open the list (or type to filter).
4. Choose the type you are working today (for example **I-407**).

### What you should see

- The left rail fills with queues for that type.
- Counts appear next to queue names.
- **New mail arrives** or **New work arrives** becomes available when intake is allowed for that type.

### If the list is empty

Nothing is activated for Live yet. Officers cannot activate a process themselves. Ask a publisher to **Activate** the process in Designer → Lifecycle, then refresh Workspace.

### If you see the wrong queues

You may have the wrong Workload Type selected. Switch the type and confirm the queue names match the desk you are covering (mail vs data entry vs shipping). Clear the type (×) if you need to start the picker over.

### Arriving from Dashboard

Supervisors may open Workspace from the **Dashboard** (Needs attention, a stage tile, or a case). Workspace tries to land you on the matching Workload Type and queue. Confirm the type and queue before you Assign or Complete.

---

## 7. Use the queues

Queues are how you find work without knowing a tracking ID in advance.

### Mail item queues and Workload queues

| Group | What lives there | Typical stages |
| --- | --- | --- |
| **Mail item queues** | Envelope / packet cases | Doc Prep, intake, mail complete |
| **Workload queues** | File / case work created from mail (or workload-only types) | Data Entry, Shipping, Shredding, … |

Queues usually follow the **order of the process** (earlier stages nearer the top). After the stage queues you often see special lists:

| Queue | What it is | When to use it |
| --- | --- | --- |
| **Completed** | Finished cases (usually read-only) | Look up finished work; do not expect to edit |
| **Assigned to Me** | Cases assigned to your **Signed in as** value | Resume your in-progress work |
| **All Items** | Everything for that side (browse view) | Hunting when you are unsure which stage |

### Open a queue

1. Click the queue name on the left.
2. The main area shows the table for that queue.
3. Read the columns (tracking ID, assignment, SLA, names, dates — whatever authors configured).
4. Use **row numbers** to keep your place when talking with a coworker (“row 4”).

### Filters and chips

When a queue has filters:

1. Set the filter values you need.
2. Active filters appear as **chips** above the table.
3. Clear one chip, or **Clear all**, when you want the full list again.

### What you can usually do in the list

Exact buttons depend on the process, but typically:

| Action | Meaning |
| --- | --- |
| **Assign to me** | Claim the row for yourself |
| **Open** (or click the row) | Open the case drawer |
| **Release** | Return an assigned case to the pool (when allowed) |
| **Reassign** | Hand to another officer (when allowed) |
| **Pages** / next-previous | Move through long lists |
| **Filters** | Narrow by assignment status or other catalog filters |

Some queues show **SLA** badges (for example On track, Warning, Past SLA) when authors configured timing for that stage.

### Empty queue

Empty does **not** always mean “no work in the office.” It means “nothing currently matches this list.” Try:

1. **Assigned to Me** — maybe you already own the work.
2. **All Items** — browse.
3. **Find a case** — if you have a sticker or receipt.
4. Another stage queue — the case may have moved.
5. **New mail arrives** — only when you are intentionally starting intake.

### Counts

The number next to a queue is a count of matching cases. It updates as work moves. If a count looks wrong after a Complete, refresh or re-open the queue.

---

## 8. Open and work a case

This is the core of officer work: take a case, fill the form, finish the stage.

### Typical happy path (memorize this)

1. Pick **Workload Type**.
2. Open the queue for the stage you work (for example Ready for Data Entry).
3. Click **Assign to me** on a row (or open the case first, then **Assign**).
4. Confirm the header shows **Assigned to** you — the **same** spelling as **Signed in as**.
5. Fill in the form fields for that stage. Required fields must be filled before Complete will succeed.
6. Click **Save** (if available) if you need to pause without finishing.
7. Click **Complete** (or the named action shown — authors choose the label) when finished.
8. A short success toast may appear (for example “Moved to …” or “Draft saved”).
9. The case moves to the next stage — or finishes, if this was the last step.
10. Click **Close case** / **Back to queues** (or press Escape) and take the next item.

### What success looks like after Complete

- A short status toast may appear.
- The case leaves the current queue (count drops).
- It appears in the next stage’s queue, or in **Completed** if the process ended.
- If you still have the case open and it is terminal, you may see a note that earlier screens are read-only.

### When Complete fails (validation)

If required fields are missing or data is invalid:

1. An error summary appears on the form with a count of fields that need attention.
2. Invalid fields are highlighted.
3. The desk scrolls to the **first** problem field and moves focus there.
4. Click an error message in the summary to jump to that field (without collapsing the case drawer).
5. Fix the fields, then Complete again.

If the message says to assign the item to yourself, compare **Assigned to** with **Signed in as** — see [section 5](#5-signed-in-as-who-am-i).

### Case header: status and assignment

At the top of an open case you will see:

| Element | Meaning |
| --- | --- |
| **Unassigned** | Nobody owns it — Assign before editing if your process requires it |
| **Assigned to** *name* | That person owns it |
| Status pill (**ACTIVE**, **COMPLETED**, …) | High-level case status |

#### Assignment bar

| Button | When to use it |
| --- | --- |
| **Assign** | Take the case. Often required before Complete. Disabled if already assigned to anyone. |
| **Release** | Put it back on the queue. Use when you cannot finish and someone else should take it. |
| **Reassign** | Give it to a named colleague. Opens a dialog asking for their id. Escape cancels; focus returns to where you were. |

### Form area

The middle of the case is the **stage form**:

- Fields are grouped into **sections** (for example Applicant Information).
- Some fields are **required** — leave them blank and Complete will fail with highlighted errors.
- Some fields are **read-only** — earlier data or system values you should not change.
- On finished / terminal cases, forms stay visible but are read-only.

Fill carefully. Dates and numbers must match the format the field expects. Fix highlighted fields first rather than clicking Complete repeatedly.

### Earlier screens and linked mail

| Feature | What it means for you |
| --- | --- |
| **Earlier stage screens** | Read-only history of forms from previous stages — useful for context |
| **Linked mail item** | Parent packet; open mail screens below for intake data |
| **Stage history** | Expandable timeline of stages with who and when; click a completed step to open that earlier screen |

Use history when a customer asks “where has this been?” Do not try to edit history.

### Buttons on the case footer (sticky)

| Button | Meaning |
| --- | --- |
| **Complete** / named action | Finish this stage (primary action) |
| Other named actions | Extra actions authors configured (follow your desk procedures) |
| **Print labels** | Print stickers for this case (and related packet items when shown) |
| **Close case** | Close the case drawer and return to the list |

### Brand-new intake you have not saved yet

If you used **New mail arrives** / **New work arrives**, the first screen can be a **temporary draft**. It becomes a real saved case when you **Assign**, **Save**, or **Complete**. See [section 9](#9-new-mail-arrives--new-work-arrives).

---

## 9. New mail arrives / New work arrives

Use this when something **new** comes in and is not already in a queue — a physical envelope at the counter, or a new workload-only intake your procedures allow.

### Steps

1. Select the correct **Workload Type**.
2. Click **New mail arrives** (mail-based types) or **New work arrives** (workload-only types).
3. A case screen opens with a new **tracking ID**.
4. Review the form. Assign yourself if required.
5. Enter intake data.
6. **Assign**, **Save**, or **Complete** so the case is kept.
7. Continue through Doc Prep / intake as your process requires.
8. After mail Complete (when configured), check workload queues for any new child cases.

### Important: nothing is saved until you act

The first screen is a **draft**.

| What you do | Result |
| --- | --- |
| Only look around, then close the case / Escape | **No case is kept** — the draft is discarded |
| **Assign**, **Save**, or **Complete** | The case is **saved** and will appear in queues |

That design is intentional. Accidental clicks should not fill queues with empty orphan cases.

### After you save the first time

Treat it like any other case: assign if needed, fill required fields, Complete when ready. Do not create a second New mail for the same physical envelope unless your procedure explicitly says to.

### Naming tip for customers

Write or print the **tracking ID** on the physical packet when your office procedure requires it. That ID is how Find a case and labels reconnect the paper to the screen. Use the copy control on the tracking id when you need to paste it elsewhere.

---

## 10. Find a case

Use **Find a case** when you have a sticker, scan, receipt, or partial id and need the case quickly — for example a customer at the counter.

### Tracking ID search

1. Expand Find if it is collapsed, or press **/** when you are not typing in another field.
2. Click into **Tracking ID**.
3. Scan the label, paste a full payload, or type part of the id.
4. Press Search (or follow on-screen behavior).

| What you entered | What usually happens |
| --- | --- |
| Full exact tracking ID or QR payload (`OPTIC:MAIL:…` / `OPTIC:WORKLOAD:…`) | Often **opens the case immediately** |
| Partial text | A **list of matches** — click a row to open |

While search is running you may briefly see **Searching…**.

### Receipt number search

1. Type the start of the receipt number (prefix search).
2. Review the result list.
3. Click the correct row.

Receipt search is helpful when the sticker is missing but the form receipt is known.

### Clear

**Clear** empties the search fields and removes the result list so you can start over.

### Advanced search

If **Advanced** is available, it may add entity type, stage, assignee, or catalog extras. Use it when basic Tracking ID / Receipt is not enough. Keep filters as narrow as you can so the list stays usable.

### Tips

- Prefer **scanning** the label when you have one — fewer typos.
- Confirm you are on the right **Workload Type** before searching if results look empty.
- If nothing matches, try **All Items**, check spelling, or ask whether the case was created under a different type.

---

## 11. Labels and printing

Labels put the electronic tracking id back onto paper.

### Open labels on a case

1. Open the case.
2. Expand **Labels** (details section), or use **Print labels** in the footer.
3. Review the sticker preview(s).
4. Print with the **browser Print** dialog.

### What prints

| Situation | Stickers you may get |
| --- | --- |
| Standalone case | This case’s tracking ID and status as text |
| Packet (mail + workloads) | This case, the mail item, and each workload in the packet when linked |

Printing uses the browser — there is no special printer driver inside OPTIC in this version. Status on the sticker is shown as **text**.

### If print fails

1. Check that the browser is not blocking pop-ups.
2. Try Print labels again after allowing pop-ups for this site.
3. Confirm a printer is available to the browser.
4. If the preview is empty, reopen the case and expand Labels again.

---

## 12. If two officers grab the same case

Only **one** officer can successfully assign a given case at a time. That protects the work from being edited by two people at once.

### What you may see

- An error or conflict message when Assign fails
- The case already showing **Assigned to** someone else when you open it
- Your Assign button disabled because it is already assigned

### What to do

1. Do **not** keep clicking Assign hoping it will “win.”
2. Refresh the queue or reopen the case to see who has it.
3. Pick another case, or ask the assignee / a supervisor to **Release** or **Reassign**.
4. If you had typed data into a draft that never assigned, that typing may not have been saved — check before redoing work.

This is normal office behavior in electronic form. Treat it like two people reaching for the same physical folder.

---

## 13. Common problems and what to do

| What you see | What it usually means | What to try |
| --- | --- | --- |
| No workload types | Nothing activated for Live yet | Ask a publisher to activate the process in Designer |
| Empty queue | No cases at that stage right now | Check Assigned to Me, All Items, Find a case, or New mail arrives |
| Cannot Assign | Stage may not allow assign, already assigned, or conflict | Refresh; check status; ask supervisor |
| “Assign the item to yourself…” but it looks assigned | **Assigned to** ≠ **Signed in as** (exact spelling) | Match Signed in as to the assignee, or Reassign to your id; commit the Signed in as field (blur / Enter) |
| Cannot Complete / highlighted fields | Required fields missing, wrong formats | Use the error summary links; fix highlighted fields; Assign first if needed |
| Complete succeeded but you cannot find the case | It moved to the next stage | Open the next queue or All Items; use Find a case with the tracking ID |
| Name columns blank in a queue | Process may be projecting the wrong field names | Report to support / process authors (configuration issue — not something you fix in Workspace) |
| Signed in as changed and Assigned to Me is empty | You are looking under a different id | Set Signed in as back to the id that owns the cases, or reassign |
| New mail disappeared after close | Draft was never Assign/Save/Complete’d | Create again and take an action so it is kept |
| Case drawer looks “squished” after an error click | Rare layout glitch from jumping to a field | Close and reopen the case; report if it persists |
| Error with a **reference id** | System recorded the failure | Copy the reference id for support — do **not** paste personal data (A-Numbers, full receipts) into chat or tickets |
| Linked mail missing on a workload | Packet was not attached during mail Complete | Ask a lead; check Doc Prep on the parent mail |

### How to report a problem well

Send support:

1. Workload Type name  
2. Tracking ID (if any)  
3. Queue / stage you were in  
4. What you clicked  
5. Exact error text or **reference id**  
6. Approximate time  

Do **not** send full Social Security numbers, full A-Numbers, or secrets in chat.

---

## 14. Quick checklists

### Start of day

1. Open **Workspace**.
2. Confirm **Live**.
3. Set **Signed in as** to your id (commit with Enter or click away).
4. Pick the **Workload Type**.
5. Open your main queue (or **Assigned to Me**).
6. Work assign → fill → complete.

### Customer walks up with a label

1. Focus **Find a case** (or press **/**).
2. Scan or paste the tracking ID.
3. Open the case.
4. Confirm assignment (Assign or ask the current owner).
5. Continue the stage or answer the customer’s question from history / earlier screens.

### New physical mail

1. Pick the **Workload Type**.
2. Click **New mail arrives**.
3. Assign (or Save / Complete) so the case is kept.
4. Finish Doc Prep / intake as your process requires.
5. Print labels if your desk requires stickers on the packet.
6. Continue on any workload cases that were created.

### End of day

1. Complete or Save in-progress cases per your desk rules.
2. Release cases you should not hold overnight (if policy says so).
3. Note any reference ids from errors for the next shift.

---

## 15. Your first day walkthrough

Use this once with a trainer or on a quiet queue.

### Goal

Assign one real Live case, fill the form, Complete it, and find it again by tracking ID.

### Steps

1. **Sign in to the desk** — open Workspace, set Signed in as, choose Live.
2. **Pick the Workload Type** your trainer names.
3. **Open the queue** they name (for example Ready for Data Entry).
4. **Assign to me** on the first available row (or a row they designate).
5. Confirm **Assigned to** matches **Signed in as**.
6. **Read the form** — ask which fields are required for your desk.
7. **Enter practice-safe data** your trainer provides (never invent real person data in a shared demo without guidance).
8. **Complete** the stage. If errors appear, follow the highlighted fields.
9. **Copy the tracking ID** from the case or label.
10. Close the case, then use **Find a case** with that tracking ID.
11. Confirm you can open it again and see where it went (next queue or Completed).

If any step fails, use [section 13](#13-common-problems-and-what-to-do) before trying a second case — fix the first failure pattern first.

---

## 16. Keyboard shortcuts and tips

| Shortcut / tip | What it does |
| --- | --- |
| **/** (when not typing in a field) | Jump to Find a case |
| **⌘K** / **Ctrl+K** (when enabled) | Open **Jump to…** command palette |
| **Escape** | Close an open case and return toward the queues |
| Scan labels when possible | Avoids typos in tracking IDs |
| One Signed in as value per person | Keeps Assigned to Me trustworthy |
| Commit Signed in as (Enter / blur) before Complete | Avoids “assign to yourself” mismatches |
| Assign before long data entry | Reduces conflict with other officers |
| Save if you must step away | Protects typed work without Completing early |
| Read error summary once carefully | Usually names the missing field or conflict |
| Click an error in the summary | Jumps to that field in the case drawer |

---

## Need more detail?

- Building forms, queues, and go-live steps (authors): [Designer user guide](./designer-user-guide.md)
- Deep authoring / naming rules / worked example: [Onboard a new workload from scratch](./onboard-a-new-workload.md)
