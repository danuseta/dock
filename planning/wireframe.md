# UI/UX Specification & Wireframes
**Aesthetic Theme:** Editorial Brutalism / Luxury Minimal Dark Mode.

## 1. Design System Tokens

### 1.1 Typography
- **Primary (Headings/UI):** `Outfit` (Geometric, clean, modern). Used for ticket titles, navigation, and large metrics.
- **Secondary (Code/Technical):** `JetBrains Mono` (Monospaced, crisp). Used for ticket keys, branch names, commit hashes, and file paths.

### 1.2 Color Palette (Luxury Minimal Dark Mode)
- **Background (Base):** `#0A0A0A` (Deep void black)
- **Background (Surface):** `#141414` (Slightly elevated dark gray)
- **Border/Divider:** `#2A2A2A` (Subtle separation)
- **Primary Text:** `#F5F5F5` (Off-white, high contrast)
- **Secondary Text:** `#888888` (Muted gray)
- **Accent (Action/Link):** `#E5E5E5` (Bright white, brutalist hover states)
- **Status Colors:**
  - **Success (Merged/Done):** `#4ADE80` (Muted neon green)
  - **Warning (Draft/In Progress):** `#FBBF24` (Amber)
  - **Error (Conflict/Blocker):** `#F87171` (Soft red)
  - **Brand (Discord):** `#5865F2` (Blurple)

### 1.3 Design Principles (Editorial Brutalism)
- **High Contrast Borders:** Prominent 1px solid borders (`#2A2A2A`) around cards and sections. No soft drop shadows.
- **Sharp Edges:** 0px or 2px border radius. No pill-shaped buttons.
- **Typography as UI:** Large, bold `Outfit` headings. Negative space instead of lines where possible, but strict grids.
- **Micro-animations:** Instant snap states (0.1s ease-out) rather than long bouncy transitions.

## 2. Layout & Wireframes

### 2.1 Global Navigation & Layout

```text
+-------------------------------------------------------------+
|  JIDIS                           [Dashboard]  [Attention(2)]|
+-------------------------------------------------------------+
|                                                             |
|  +-------------------------+  +--------------------------+  |
|  |     IN PROGRESS (3)     |  |      IN REVIEW (1)       |  |
|  +-------------------------+  +--------------------------+  |
|  |                         |  |                          |  |
|  | JID-123                 |  | JID-105                  |  |
|  | User Authentication     |  | Setup CI/CD Pipeline     |  |
|  |                         |  |                          |  |
|  | PRs: [1 Open]           |  | PRs: [1 Merged]          |  |
|  +-------------------------+  +--------------------------+  |
|  |                         |  |                          |  |
|  | JID-124                 |  |                          |  |
|  | Reset Password Flow     |  |                          |  |
|  |                         |  |                          |  |
|  | PRs: [1 Draft]          |  |                          |  |
|  +-------------------------+  +--------------------------+  |
|                                                             |
|                                                  [⚙ Settings]|
+-------------------------------------------------------------+
```

### 2.2 Ticket Detail View

```text
+-------------------------------------------------------------+
|  ← Back    |   Ticket Details                               |
+-------------------------------------------------------------+
|                                                             |
|  [JID-123] User Authentication                              |
|  Status: IN PROGRESS                                        |
|  ---------------------------------------------------------  |
|                                                             |
|  PULL REQUESTS                                              |
|  +-------------------------------------------------------+  |
|  | ⚠ CONFLICT   | frontend-app | branch: JID-123-feat    |  |
|  | [View Files] | Title: Add login form                  |  |
|  +-------------------------------------------------------+  |
|  | ✓ MERGED     | backend-api  | branch: JID-123-auth    |  |
|  |              | Title: Auth endpoints                  |  |
|  +-------------------------------------------------------+  |
|                                                             |
|  DEMO VIDEO                                                 |
|  [ http://loom.com/share/....                          ]    |
|                                                             |
|  ---------------------------------------------------------  |
|  [ SEND SUMMARY TO DISCORD ]                                |
+-------------------------------------------------------------+
```

### 2.3 Needs Attention View
Focuses purely on blocked tasks. A brutalist list with stark red typography for conflicts.

```text
+-------------------------------------------------------------+
|  JIDIS                                     NEEDS ATTENTION  |
+-------------------------------------------------------------+
|                                                             |
|  [ CONFLICT ] JID-123 - User Authentication                 |
|  Repo: frontend-app                                         |
|  Files: src/App.tsx, package.json                           |
|  [Resolve in GitHub ->]                                     |
|  ---------------------------------------------------------  |
|                                                             |
|  [ STALE ] JID-099 - Update dependencies                    |
|  Repo: backend-api                                          |
|  Waiting for review: 4 days                                 |
|  [Ping Reviewers ->]                                        |
|                                                             |
+-------------------------------------------------------------+
```

## 3. Interaction & DFII Score
- **DFII (Design Friction Index Indicator):** Target < 1.0 (Extremely Low Friction).
- **Discord Summary:** 1 click from the Ticket Detail view. No copy-pasting required.
- **Refresh Data:** Automatic background polling every 5 mins, manual refresh via keyboard shortcut (`Ctrl+R`).

## 4. Accessibility Guidelines
- Contrast ratio must exceed 7:1 for text (using `#F5F5F5` on `#0A0A0A` achieves this easily).
- Focus states must use a sharp, highly visible 2px solid white outline.
- Full keyboard navigation (Tab through tickets, Enter to open).
