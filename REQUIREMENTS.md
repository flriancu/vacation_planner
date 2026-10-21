# Vacation planner: requirements

Status: draft 3, elicited 2026-10-21 (draft 2 added the employer's swap and floating days and the OAuth mode; draft 3 removes personal data, see NF-7). This file is the contract: change it first, then the code.
Source of truth for the current workflow: my old hand-made spreadsheet (private, not in this repo).

## 1. Goal

A web app that replaces the hand-made spreadsheet I use to plan time off. It shows the year as one continuous calendar with weekends, Romanian public holidays and the days the office is closed marked. It suggests bridges that turn a few leave days into long breaks, and it tracks the leave I've planned and taken against my budget. It syncs between desktop and phone through Google sign-in and Google Drive.

## 2. Scope and phases

| Phase | Scope |
|---|---|
| **v1** | One person (me), one calendar file. Everything in §4 except items tagged *v2*. |
| **v2** | Other people: a partner with their own Google account and their own file, kids as people with no account inside a parent's file, an overlay of several calendars, overlap finding, school holidays. |
| **Later, maybe** | Moving storage to AWS (Cognito + DynamoDB), reminders and notifications. Not built, but §6 must keep the move cheap. |

The data model is per person from v1, so v2 adds features but needs no migration.

## 3. Glossary

- **Working day**: Mon–Fri that is not a public holiday and not covered by a free office-closed day.
- **Day off (free)**: a weekend, a public holiday, or a day covered by a leave type that does not count against annual leave (office-closed day, swap day, floating day…).
- **Swap day**: when a legal holiday falls on a Saturday or Sunday, the employer requires me to take either the Friday before or the Monday after as a day off. Which one is my choice.
- **Floating day**: an employer bonus day that I place on any date I choose. HR sets the yearly number; it seems to depend on how many legal holidays fall on weekends, but that isn't predictable, so I enter it by hand.
- **Office-closed day**: a day the office is closed, e.g. between Christmas and New Year. Besides swap and floating days, it is the only extra day off the employer gives.
- **Leave block**: a date range of one leave type with a status. Its **leave cost** is the number of working days inside it, charged to the type's budget.
- **Days off gained**: the length of the whole run of consecutive non-working days that the block creates, including the free days around it.
- **Bridge (punte) candidate**: a range `[a, b]` where day `a-1` and day `b+1` are working days, every day in the range is free or covered by leave, and the range contains at least one public holiday or office-closed day.
- **Ratio**: days off gained ÷ leave cost.
- **Status**: `idea` → `planned` → `approved`. (§4.4)

## 4. Functional requirements

Priority: **M** = must (v1), **S** = should (v1 if cheap), **v2** = phase 2.

### 4.1 Calendar view (CAL)

| ID | Pri | Requirement |
|---|---|---|
| CAL-1 | M | Show the calendar as one continuous list of weeks, Monday to Sunday, with no break between months, like the spreadsheet. |
| CAL-2 | M | Default range: the selected year plus the weeks that overlap the previous December and the following January, so the Christmas–Epiphany break is visible in full. A year switcher moves between years. |
| CAL-3 | M | Separate months with a stepped line that follows the real first day of each month. Show the month name in a narrow vertical band along the weeks whose Monday is in that month, like the merged cells of the old sheet; short bands at the view's edges leave out the year. |
| CAL-4 | M | Two colours only: one tint for days off anyway (weekend, public holiday, office closed) and one accent for all my leave, whatever its type, swap days included (I choose and request them). The kind of leave is shown in the editor and tooltip, not by colour. Holidays also get a dot under the number. |
| CAL-5 | M | Holiday names are not drawn on the calendar (only the dot, CAL-4): they are in the day's tooltip and screen-reader label, and in the hint line when the day is picked ("Prima zi: marți 6 ianuarie (Boboteaza)"). This keeps the calendar narrow, leaving room for side panels. |
| CAL-6 | M | Status matters most and is drawn as a lightness ramp, with line style as a second cue: `idea` = a very faint tint + dashed outline; `planned` = light fill + solid outline; `approved` = the full accent + thick outline + bold number. Each leave block is one outline, even across weeks. Past and out-of-year days mute only the number, never the fill. Contrast meets WCAG 1.4.11 (≥ 3:1 for outlines and fills against neighbouring cells) and 1.4.3 (≥ 4.5:1 for numbers) in every scheme. |
| CAL-7 | M | Say in plain words what a block costs and what it gives, with full dates and no abbreviations, e.g. "Folosești 1 zi de concediu → ești liber 5 zile la rând: vineri 27 noiembrie – marți 1 decembrie". Shown in the editor and as the tooltip of the block's days; nothing is written on the calendar itself. |
| CAL-8 | M | Create a block by selecting a date range (drag on desktop, tap start and tap end on phone), then choose its type and status. |
| CAL-9 | M | Tapping or clicking a block opens it to edit dates, type, status and note, or to delete it. |
| CAL-10 | S | Show today's date. |
| CAL-12 | M | Page layout (from industry guidance, see DESIGN §7): one header row with title, year and **Azi** (scrolls to today; the page also opens there), then on the right the save status, a **Setări** menu (colours, appearance, language) and the account slot (sign-in button signed out, account menu signed in). The header hides while scrolling down. Wide screens get a supporting pane on the right (legend, closable hint; later balance and suggestions); narrower ones show the legend above the calendar (behind a "Legendă" toggle on phones). Signed out, a thin strip under the header explains the demo. |
| CAL-11 | M | Switchable colour schemes (Roz, Neutru, Contrast ridicat), each with light and dark variants, plus Automatic / Light / Dark. Remembered in the browser and applied before first paint. |

### 4.2 Day types and holiday data (DAY)

| ID | Pri | Requirement |
|---|---|---|
| DAY-1 | M | Calculate Romanian public holidays for any year (Labor Code art. 139, current list): 1–2 Jan, 6–7 Jan, 24 Jan, Orthodox Good Friday, Easter Sunday and Monday, 1 May, 1 Jun, Rusalii Sunday and Monday (Easter +49/+50), 15 Aug, 30 Nov, 1 Dec, 25–26 Dec. |
| DAY-2 | M | Holiday names in Romanian and English. |
| DAY-3 | M | Per-year overrides: add, remove or rename a public holiday for a specific date, because the law changes (6–7 Jan were added recently). Overrides are stored in my file. |
| DAY-4 | M | Legal holidays on a Saturday or Sunday, except Easter Sunday and Rusalii Sunday, which always fall on Sunday, are listed for the year as **swap reminders**: "Sun 24 Jan 2027: choose Fri 22 or Mon 25 Jan". The reminder stays open until a swap day is entered for it. I enter swap days by hand (one click on either suggested day). |
| DAY-5 | S | Each swap reminder shows which of the two days makes the better bridge given the rest of the plan (e.g. "Friday gives 4 days off with 1 leave day before it"). |
| DAY-6 | M | I enter the days the office is closed by hand each year, as blocks of the *office closed* leave type (§4.3), status `approved`. |

### 4.3 Leave types (LT)

| ID | Pri | Requirement |
|---|---|---|
| LT-1 | M | Built-in types: **annual leave** (concediu de odihnă), **floating day**, **excused leave** (învoire), **swap day**, **office closed** (birou închis), **special event** (wedding, birth, death in the family…), **sick**, **unpaid leave** (concediu fără plată). |
| LT-2 | M | Each type has a name (RO and EN), a colour, a "counts against annual leave" setting, and a "needs approval" setting. Defaults: annual counts against annual leave and needs approval; floating days have their own quota (LT-6) and don't need approval; excused leave has its own quota (LT-6) and needs approval; swap days need approval like leave (they cost nothing); office-closed days need no approval; the rest count against nothing. |
| LT-6 | M | Floating days and excused leave each have a per-year quota that I enter by hand (excused leave: at most 2 a year). Unused days of both expire on 31 Dec. Annual leave carries over to the next year as a BAL-2 adjustment. |
| LT-3 | M | The "counts against annual leave" setting for office-closed days can be changed per year, because some years the employer takes them out of annual leave. |
| LT-4 | S | I can add or rename types. Built-in types can be hidden but not deleted. |
| LT-5 | M | The app keeps a separate per-year total of days used for each type. |

### 4.4 Block lifecycle (BLK)

| ID | Pri | Requirement |
|---|---|---|
| BLK-1 | M | Status `idea`: under consideration. It takes nothing from the balance, but the app shows what accepting it would cost. |
| BLK-2 | M | Status `planned`: I intend to take it. Its cost is reserved from the balance. |
| BLK-3 | M | Status `approved`: signed off by HR or my manager. Its cost is reserved; once its dates have passed, it counts as **used**. |
| BLK-4 | M | Status moves forward or back in one step. Changing an `approved` block's dates asks me to confirm. For types that don't need approval (LT-2), `planned` is the final stage. |
| BLK-5 | M | Blocks of the same person must not overlap, except `idea` blocks, which may overlap each other and other blocks. |
| BLK-6 | M | Leave cost counts working days only. Weekends, public holidays and free office-closed day inside a block cost nothing. |

### 4.5 Balance (BAL)

| ID | Pri | Requirement |
|---|---|---|
| BAL-1 | M | The leave year is the calendar year. For each year I enter an opening balance of annual-leave days by hand. |
| BAL-2 | M | Manual adjustments, each with a date, a signed number of days and a note: carry-over from last year, extra days granted, corrections. |
| BAL-3 | M | Always show: opening balance + adjustments; used; reserved (planned + future approved); **available** = total − used − reserved; and "if all ideas are accepted". |
| BAL-4 | M | Warn when planned plus approved leave exceeds the total. Don't block it. |
| BAL-5 | S | Per-year totals for the non-annual types (LT-5) are shown next to the balance. |
| BAL-6 | M | Floating-day and excused-leave balances with the same breakdown as BAL-3 (quota, used, reserved, available). From October on, warn if any of them are still unplaced, because they expire on 31 Dec. |

### 4.6 Suggestions (SUG)

| ID | Pri | Requirement |
|---|---|---|
| SUG-1 | M | Generate every bridge candidate (§3) for the selected year, given the current holidays, office-closed days and existing planned or approved blocks. Configurable maximum leave cost per candidate (default 5). |
| SUG-2 | M | Ranked list: each entry shows the date range, "X leave → Y off" and the holiday or holidays it builds on. Rank by ratio (best first), break ties by longer gain. |
| SUG-3 | M | Each entry can be previewed on the calendar, accepted (it becomes an `idea` block), or dismissed (it is hidden for that year and the dismissal is saved). |
| SUG-4 | M | **Propose plan**: picks a set of non-overlapping candidates within the remaining available balance, balancing two goals: (a) a high total ratio, and (b) spreading breaks through the year, measured as the longest stretch with no break of ≥ 3 consecutive days off. Shorter is better. The weight between (a) and (b) is a slider. |
| SUG-5 | M | A proposed plan is shown as a preview; I accept all of it, part of it, or none. Accepted entries become `idea` blocks. |
| SUG-6 | S | Explain each suggestion in one line, e.g. "Mon 12 – Wed 14 Aug bridges the weekend to Sf. Maria (Thu–Fri)". |
| SUG-7 | M | Suggestions and proposed plans spend expiring days first (floating, then excused), then annual leave. The cost is shown split, e.g. "1 excused + 2 leave → 9". |
| SUG-8 | M | Swap reminders that are still open (DAY-4) are treated as undecided: suggestions show both options (Friday / Monday) as separate candidates. |

### 4.7 People and sharing (PPL)

| ID | Pri | Requirement |
|---|---|---|
| PPL-1 | M | The data model holds a list of people per file. In v1 it holds one person (me). |
| PPL-2 | v2 | Add people without an account (kids) to my file, each with their own blocks. |
| PPL-3 | v2 | Follow another account's calendar file that was shared with me in Drive: pick it once with the Google Picker. The list of files I follow is stored in my own file, so it syncs between my devices. |
| PPL-4 | v2 | Overlay view: toggle each followed person on or off; their blocks are drawn in that person's colour. Followed calendars are read-only to me. |
| PPL-5 | v2 | Overlap finder: date ranges when every selected person is off, and suggestions ranked by the combined cost for the selected people. |
| PPL-6 | v2 | School holidays (vacanțe școlare) entered per year as a calendar layer, attached to a child or shared. |

### 4.8 Import and export (IO)

| ID | Pri | Requirement |
|---|---|---|
| IO-1 | M | One-time import of my old spreadsheet format. The imported records go into my Drive file as history; nothing from the sheet ever goes into the repo (NF-7). Fill colours: light pink FFE5F0 = weekend; pink FFBDDA = holiday; dark pink FF96C4 = swap day if it is the Friday before or Monday after a weekend holiday, otherwise office-closed day. A pink FFBDDA weekday that isn't a calculated holiday is either a floating day or an office-closed day. The preview suggests floating day (status `planned`), and I can change it. Medium-border outlines map to `idea` blocks (they were "sugestie concediu"). White and no-fill cells mean the same thing. Show a preview and the list of every classification before saving. |
| IO-2 | M | Export `.ics` for a chosen year, filtered by status (default: planned + approved). One all-day event per block, with a stable UID so re-importing updates events instead of duplicating them. |
| IO-3 | M | Push to Google Calendar: create or update one event per approved (and, optionally, planned) block in a chosen calendar; deleting or changing the block updates the event. Ask for the Calendar permission only when I first use this (incremental consent). |

### 4.9 Language (I18N)

| ID | Pri | Requirement |
|---|---|---|
| I18N-1 | M | All interface text comes from translation files: Romanian and English, switchable at any time, with the choice remembered. One language switch, "Română \| English" with the current one highlighted, looks the same on every page (app, privacy, terms) and the choice is shared between them. |
| I18N-2 | M | Dates, month and day names follow the selected language; weeks always start on Monday. |

### 4.10 Sign-in (AUTH)

| ID | Pri | Requirement |
|---|---|---|
| AUTH-1 | M | Sign in with Google. The app needs no account of its own. |
| AUTH-2 | M | Scopes: `openid`/`email`/`profile` + `drive.file` at sign-in. The Calendar scope is requested only on first use of IO-3. No broad Drive scope, and no other sensitive or restricted scopes. |
| AUTH-4 | M | The Google OAuth app runs in **production mode, unverified**. Because sign-in uses only non-sensitive scopes, there's no warning screen and the permission doesn't expire. The one-time "unverified app" screen appears only when someone first enables Calendar push (limit: 100 such users ever, which is fine for family use). |
| AUTH-3 | M | Signed out, the app shows a demo year that can be edited but saves nothing, under one banner that says so and offers sign-in. A returning browser is offered "Continuă ca …" (and "Alt cont"). A reload in the same tab keeps the Google session (sessionStorage, about an hour); a new visit takes one click. |

## 5. Non-functional requirements

| ID | Requirement |
|---|---|
| NF-1 | Static single-page app, no server of its own. Hosted on **GitHub Pages** from a public repo, at its own subdomain `concediu.floriniancu.ro`, not under the shared `flriancu.github.io` address: a browser treats every site there as one, so any of them could read this app's session token and stored data (the OAuth client ID is not a secret; no secrets in the repo). |
| NF-2 | Works equally on desktop and phone: the continuous week list fits a phone width (7 day columns, notes below or folded). Desktop adds side panels for balance and suggestions. |
| NF-3 | My data is stored only in my Google Drive. The app sends nothing to any other service. |
| NF-4 | Saving happens automatically after each change (short debounce); a visible state shows saved / saving / error. |
| NF-5 | Holiday calculation and the suggestion engine are plain functions with no UI or storage dependencies, covered by unit tests, including the acceptance cases in §7. |
| NF-6 | Accessible: keyboard can select ranges, colour is not the only signal (CAL-6), contrast passes WCAG AA. |
| NF-7 | **No personal data in the repo.** No real leave dates, plans or sheet extracts in code, tests or docs. Public tests use the made-up demo plan (§7). Tests on my real data live in the git-ignored `private/` folder and run only on my machine. My history lives only in my Drive file. |
| NF-8 | Public pages `privacy.html` and `terms.html` (Romanian and English), linked from the app's footer and used on Google's sign-in setup (Branding: privacy policy and terms of service). |

## 6. Data and storage design (constraints)

### 6.1 File

- One JSON file per Google account, created by the app in that account's Drive (e.g. `vacation-planner.json`). Found again through `drive.file`, which can see files the app created.
- Top level: `schemaVersion`, `owner` (account id), and collections: `people`, `leaveTypes`, `blocks`, `holidayOverrides`, `yearSettings` (opening balance, per-year type settings), `adjustments`, `dismissedSuggestions`, `following` (v2), `settings`.

### 6.2 Records (built for a later AWS move)

- Every record in every collection has: `id` (UUID), `personId` where relevant, `createdAt`, `updatedAt`, and a `deleted` flag. A deleted record stays in the file as a marker instead of being removed.
- Collections are maps keyed by `id`, never positional arrays. Each record maps 1:1 to a future DynamoDB item (partition key = owner/person, sort key = collection#id).
- Dates are plain `YYYY-MM-DD` strings (no time zones). Timestamps are ISO-8601 UTC.

### 6.3 Storage interface

The UI talks only to a `Storage` interface; `DriveStorage` is the v1 implementation and `DynamoStorage` would be a later one:

```
listCalendars()          → [{calendarId, ownerName, writable}]
load(calendarId)         → {doc, version}
save(calendarId, doc, baseVersion) → {version} | Conflict
```

### 6.4 Saving and conflicts

- Each file is written only by its owner, but the owner may have the app open on phone and desktop at once.
- Before saving, compare Drive's file `version` with `baseVersion`. If they differ, reload the file and merge record by record (the newer `updatedAt` wins; deleted markers count as updates), then save.
- Any migration is a pure function `migrate(doc) → doc`, run step by step on load.

## 7. Acceptance cases (made-up demo plan)

The public cases use a fictional plan for 2027 (`tests/fixtures/demo2027.ts`); only its holidays are real (NF-7). The fictional person:
- took swap days on Mon 4 Jan (for Sat 2 Jan; Fri 1 Jan is itself a holiday), Mon 16 Aug (for Sun 15 Aug) and Fri 24 Dec (for Sat 25 Dec);
- dismissed the Sun 26 Dec reminder and left Sun 24 Jan open;
- has the office closed 28–31 Dec, a floating quota of 2, and one floating day on Mon 31 May.

Given that plan, the ranked list (SUG-2) must contain at least these, with exactly these leave days:

| Range | Leave days | Cost → gain |
|---|---|---|
| Fri 1 – Thu 7 Jan 2027 | 5 Jan | 1 → 7 |
| Fri 1 – Sun 10 Jan 2027 | 5, 8 Jan | 2 → 10 |
| Sat 24 Apr – Mon 3 May 2027 | 26–29 Apr | 4 → 10 |
| Fri 30 Apr – Sun 9 May 2027 | 4–7 May | 4 → 10 |
| Sat 29 May – Wed 2 Jun 2027 | 2 Jun | 1 → 5 |
| Sat 29 May – Sun 6 Jun 2027 | 2–4 Jun | 3 → 9 |
| Fri 13 – Mon 16 Aug 2027 | 13 Aug | 1 → 4 |
| Fri 24 Dec 2027 – Sun 2 Jan 2028 | 27 Dec | 1 → 10 (ranked first) |

Also:
- The unplaced floating day pays first: each case above costs 1 floating day plus the rest in annual leave (SUG-7).
- The full candidate list equals a brute-force search over every range that overlaps the year, for a cost limit of 3 and of 5 (SUG-1).
- DAY-1 must give Orthodox Easter on 20 Apr 2025, 12 Apr 2026, 2 May 2027 and 16 Apr 2028, Rusalii on 20–21 Jun 2027, and both names on 1 Jun 2026 (Children's Day and Rusalii Monday).
- DAY-4 for 2027 must list Sat 2 Jan (option: Mon 4 Jan only), Sun 24 Jan (Fri 22 or Mon 25), Sat 1 May (no option: Good Friday and Easter Monday surround it), Sun 15 Aug, Sat 25 Dec and Sun 26 Dec, and not Easter Sunday or Rusalii Sunday. For Sun 30 Nov 2031 the only option is Fri 28 Nov, because Mon 1 Dec is a holiday.
- SUG-8: the open 24 Jan reminder gives Thu 21 – Sun 24 Jan (assuming the Friday swap) and Sat 23 – Tue 26 Jan (assuming the Monday swap), each for 1 leave day.

Acceptance cases on my real data are in the private folder (NF-7).

## 8. Open questions

None.

### Assumptions to confirm

- Easter Sunday and Rusalii Sunday don't create a swap day. My old sheet has none for them.
- Unused floating days and excused leave expire on 31 Dec (LT-6).
- When both days of a weekend are holidays (e.g. 6–7 Jan), my old sheet shows only one swap day and the year got floating days instead. Because HR decides, the app only reminds me about the swaps; it doesn't enforce one swap per holiday.

### Resolved

- Weekdays the old sheet marks as holidays that aren't legal holidays are floating days or office-closed days; I classify them in the IO-1 preview.
- OAuth app: production mode, unverified (AUTH-4).
- Repo: public, with no personal data (NF-7).
- Tech stack: React + TypeScript + Vite, with Vitest and Playwright tests. See [DESIGN.md](DESIGN.md).
