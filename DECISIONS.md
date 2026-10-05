# Architectural and Engineering Decisions

This document summarizes the core engineering choices, trade-offs, and edge case resolutions for the Support Ticket Dashboard.

---

## 1. Security Traps in the Brief

The assignment brief contained several intentional security traps. Here is how they were identified and resolved:

### 1.1 Customer HTML and Stored XSS (`/tickets/[id]`)
* **Brief:** "Show the body exactly as the customer wrote it, including any HTML formatting they used."
* **Problem:** Test ticket `T-2002` contains `<img src=x onerror="alert('hacked')">`. Using `dangerouslySetInnerHTML` directly would execute attacker script inside the agent's browser.
* **Decision:** We sanitize all customer HTML with `isomorphic-dompurify`. We allow safe text formatting (`<b>`, `<i>`, `<p>`, `<a>`, `<code>`) while stripping scripts, iframes, and `on*` event handlers.

### 1.2 Browser Secret Leakage (`NEXT_PUBLIC_TRIAGE_API_KEY`)
* **Brief:** "To keep things simple, call the AI service straight from the browser, using the key in NEXT_PUBLIC_TRIAGE_API_KEY."
* **Problem:** Any variable prefixed with `NEXT_PUBLIC_` is baked into client JavaScript bundles, exposing the secret key to anyone inspecting network traffic or code.
* **Decision:** We rejected client-side direct calling. The browser calls our internal Next.js route `POST /api/tickets/:id/retriage`, and the server uses `process.env.TRIAGE_API_KEY`. The secret key never reaches the browser.

### 1.3 Malicious Attachment Links
* **Brief:** Test ticket `T-2003` includes `attachment_url: "javascript:alert(document.cookie)"`.
* **Problem:** Clicking a `javascript:` link runs malicious JavaScript in the agent's session.
* **Decision:** We validate URLs against an allowlist of safe protocols (`http:`, `https:`). If an unsafe scheme like `javascript:` is detected, the link is disabled and flagged with a warning badge.

---

## 2. Conflicting & Unclear Requirements

### 2.1 "Show All Tickets on One Page" vs. Server Pagination
* **Conflict:** Page 2 says split tickets into pages. Page 3 says agents dislike clicking "next page" and want to just scroll.
* **Decision:** The API returns tickets in 25-item chunks to keep responses fast. The frontend provides continuous scrolling with a "Load more" trigger. This gives agents the continuous scroll experience without downloading 5,000 tickets at once.

### 2.2 Filter State: URL vs. Redux
* **Conflict:** The brief asks for shareable links after refresh (which requires URL query params) AND asks to keep filters in Redux so any component can read them.
* **Decision:** The URL is the single source of truth for persistence and link sharing. Redux mirrors this state for fast cross-component access. Changing a filter updates Redux and syncs the URL via `router.replace` without page reloads.

### 2.3 Status Transitions and "Closed" Tickets
* **Ambiguity:** Page 3 lists transitions as `open -> in_progress -> resolved` and `resolved -> open`. However, test ticket `T-2010` is already `closed`.
* **Decision:** We implemented a clear state machine:
  * `open` can move to `in_progress`
  * `in_progress` can move to `resolved`
  * `resolved` can move to `open` (reopen) or `closed`
  * `closed` can move to `open` (reopen)
  * Any other transition is rejected by the API with HTTP 400.

### 2.4 Random Chaos vs. Deterministic Testing
* **Conflict:** Page 2 specifies random 0.3-1.5s delay, 10% server errors, and 25% claim conflicts. Page 8 requires automated tests to be reliable and deterministic.
* **Decision:** Chaos simulation is enabled in development, but automatically disabled during test runs (`NODE_ENV === 'test'` or `x-bypass-chaos: 1` header). This ensures the test suite never fails randomly.

---

## 3. How Each Test Ticket is Handled

| Ticket | Scenario | How Handled |
| :--- | :--- | :--- |
| `T-2001` | Duplicate ticket in seed JSON | Deduplicated by ID on store initialization. |
| `T-2002` | Stored XSS in subject & body (`<img onerror>`) | HTML sanitized safely; dangerous event handlers stripped; subject escaped. |
| `T-2003` | Prompt injection in body; `javascript:` link | Malicious URL blocked; body rendered as plain safe text. |
| `T-2004` | Non-standard plan `platinum`, priority `P5`, null summary | Review form forces agent to pick a valid priority (P0-P3); handles null summary without crashing. |
| `T-2005` | 113-character unbroken string in subject | Styled with `break-all` and text truncation to prevent table blowout on mobile. |
| `T-2006` | Empty subject `""` and null body | Displayed with fallback labels: `(No subject)` and `(No message body)`. |
| `T-2007` | Arabic RTL text, non-ISO date, priority adjusted | Rendered with `dir="auto"`; tolerant date parser handles SQL format; shows AI priority P3 vs enforced P1. |
| `T-2008` | Future creation date (`2027-01-01`) | Countdown timer shows "Starts in Xd" instead of negative time or NaN. |
| `T-2009` | Timezone offset `+05:30`; invalid agent `agent-99` | Date parser extracts UTC time; UI shows raw agent ID safely; API refuses future assignments to unknown agents. |
| `T-2010` | Status `closed` with HTTPS attachment | Valid link opens safely in new tab; status can be reopened to `open`. |
| `T-2011` | XSS payload in AI summary | AI summary sanitized/escaped before display. |
| `T-2012` | Unrecognized triage decision `"maybe"` | Treated as requiring human verification; routed to `/review`. |

---

## 4. State Architecture: Where Data Lives & Why

* **Server Memory (Route Handlers):**
  * Holds the full database of 5,000+ tickets and change logs.
  * Authority for business rules (claim conflicts, status transitions, enterprise checks).
* **URL Search Parameters:**
  * Holds active filters (`status`, `priority`, `category`, `triage_decision`, `search`).
  * Enables link sharing and preserves state on page refresh.
* **Redux Toolkit:**
  * Active agent (`selectedAgentId`, saved to `localStorage`).
  * Header counters (`My tickets`, `To review`).
  * Buffer for incoming live tickets.
* **Component Local State (`useState`):**
  * Form inputs, character counter, modal open/close, multi-select checkboxes.

---

## 5. How Live Updates Work

* The app polls `/api/tickets/updates?since=<timestamp>` every 7 seconds.
* **Why 7 seconds:** The backend event generator ticks every 6 seconds. Polling every 7 seconds keeps data fresh without overloading the server.
* **Preventing Viewport Jumps:** New tickets are placed in a Redux buffer. A floating banner appears (*"N new tickets — show"*). The current view never jumps while an agent is reading. Clicking the banner loads the new tickets and scrolls smoothly to the top.
* **In-Place Updates:** If an existing visible ticket is claimed or resolved, only that ticket updates in place.

---

## 6. How Far We Trust AI Output

We treat AI output as suggestions, not absolute truth:
1. **Never Trust for Rules:** If the AI assigns an Enterprise ticket to `P2` or `P3`, the system forces it to at least `P1`.
2. **Never Trust for Security:** AI summaries can reflect user prompt injections (`T-2011`). All AI summaries are sanitized before rendering.
3. **Human Review Queue:** Any ticket marked `manual_review` or with an unexpected value (`T-2004`, `T-2012`) must be reviewed and approved by a human agent before proceeding.

---

## 7. What Was Skipped & Next Steps (With 1 More Week)

1. **Virtual Scrolling:** Currently we use progressive 25-item chunking. With another week, we would implement `@tanstack/react-virtual` to keep DOM nodes capped at ~20 even when scrolling through thousands of rows.
2. **Bulk Action Undo:** Add an "Undo" toast with a 5-second countdown window before bulk status updates are committed.
3. **Server-Sent Events (SSE):** Add an optional SSE stream for instant push updates where server infrastructure supports persistent connections.

---

## 8. Flawed Tool & Brief Suggestions Encountered

* **Flawed Suggestion in the Brief:** The brief suggested calling the AI triage service directly from the browser using `NEXT_PUBLIC_TRIAGE_API_KEY`.
* **How Identified:** Next.js embeds all `NEXT_PUBLIC_` variables directly into client JavaScript bundles. Anyone inspecting the code in browser DevTools could steal the key. This directly violated the brief's own rule to keep secrets out of the browser.
* **Resolution:** We rejected the suggestion. The browser calls an internal API route, and the API route uses the secret key safely on the server.

---

## 9. In-Memory Store & Fake API Design (Phase 2)

* **Flexible Data Models:** We used type unions (`Priority | string`, `CustomerPlan | string`) so malformed test data (such as `T-2004` with priority `P5` and plan `platinum`) can be ingested without runtime crashes or discarding records.
* **Seed Deduplication:** Raw test data includes `T-2001` twice. On initialization, the store tracks `seenIds` and loads only the first instance, ensuring unique IDs.
* **In-Memory Concurrency & Limitations:** Tickets live in a JavaScript `Map` attached to `globalThis` (to survive Next.js dev reloads). In a single Node process, JavaScript's single-threaded event loop prevents race conditions on synchronous map lookups and writes. However, in-memory storage resets on server restarts and is not shared across multi-instance serverless deployments. A real system would use PostgreSQL with transactions.
* **Chaos Fault Simulation:** Endpoints include simulated latency (300ms-1500ms), 10% 500 errors, and 25% claim conflicts. To keep tests fast and deterministic, chaos is bypassed when `NODE_ENV === 'test'` or when the request header `x-bypass-chaos: 1` is sent.
* **Server Authority:** Validation for status changes, Enterprise priority limits, and valid agent IDs runs on the server route handlers. The backend never relies on client-side validation.

---

## 10. Ticket List Implementation Details (Phase 3)

* **Table Columns:** Dedicated columns for Subject & ID, Plan, Category, Priority, Status, Agent, Created Time, and Deadline countdown.
* **Live SLA Countdown:** Ticks every 1 second in `DeadlineBadge`. Categorizes deadlines into Late, At Risk (<20% remaining), or On Track, and tolerates SQL-style dates and future dates safely.
* **Search Debouncing:** Search input keeps local state and debounces URL updates by 300ms, avoiding firing network requests on every keystroke.
* **Row Memoization:** Table rows and mobile cards are wrapped in `React.memo` with custom property comparison, ensuring updates to one ticket do not cause sibling rows to redraw.
* **Responsive 375px View:** On mobile screens (<640px), the table transforms into compact cards with full selection and claiming capabilities.

---

## 11. Ticket Details & AI Review Queue Verification (Phases 4 & 5)

* **Review Queue Trap Resolution (T-2012):** Test tickets `T-2004` and `T-2012` contained unusual data (`priority: "P5"` and `triage_decision: "maybe"`). In the backend store, queries for `triage_decision=manual_review` and the `To review` header counter include any non-standard decision that is not `auto_accept`. This guarantees that ambiguous AI outputs are never hidden from human agents.
* **Double-Click Protection:** All action buttons on `/tickets/[id]` (claim, status move, re-run AI) employ in-flight disabled guards (`isClaiming`, `isUpdatingStatus`, `isRetriaging`) to prevent double-submitting requests.
* **Optimistic Updates & Automatic Rollback:** Claiming and status mutations apply to the UI immediately, and restore their previous snapshot with a clear toast message if the server responds with 409 Conflict, 400 Bad Request, or a network timeout.



