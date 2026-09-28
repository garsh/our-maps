# Labels & Map Organization Plan

## Overview
Currently, the landing page displays a single flat list of all maps sorted by last access. This plan outlines an intuitive, flexible organization system based on **Labels** (inspired by Gmail labels), replacing mutually exclusive folders and separate collections with a unified label model.

Under this architecture:
- **System Labels**: System-managed labels (`Favorites`, `Owned by Me`, `Shared with Me`, `Downloaded / Offline`, `Recent`) automatically apply to maps based on metadata and user actions.
- **User-Defined Labels**: Users create custom labels (e.g., `Road Trips`, `Europe 2026`, `Wishlist`, `Work`) to categorize maps. A map can hold multiple labels simultaneously.
- **Per-Label Ordering & Sorting**: Within each label (system or user-defined), users can switch between sort modes at any time (e.g., **Last Accessed**, **Custom Drag-and-Drop Order**, **Alphabetical**, **Date Modified**). Each label defaults to **Last Accessed** sort mode until the user changes sorting, and automatically remembers and defaults to its last-used sort mode thereafter.
- **Touch & Desktop Drag Reordering**: Drag-and-drop reordering within custom-ordered labels works seamlessly across mobile/touch and desktop.

---

## 1. Core Principles

- **Gmail-Style Multi-Labeling**: A map is never confined to a single folder. A map can simultaneously have labels like `★ Starred`, `Road Trips`, `Summer 2026`, and `Shared with Me`.
- **System Labels vs. User Labels**:
  - **System Labels (Automatic)**: Computed/applied dynamically based on map properties (`Favorites/Starred`, `Owned`, `Shared`, `Offline/Downloaded`, `All Maps`).
  - **User Labels (Manual)**: Created, colored, edited, and deleted by users, with manual assignment to maps.
- **Independent Per-Label Sorting & Last-Used State**:
  - Users can switch between sort modes (e.g., `Last Accessed`, `Custom Order`, `Alphabetical`, `Date Modified`) for any label at any time.
  - Each label defaults to `Last Accessed` sort mode until the user changes sorting; thereafter, it remembers and defaults to its last-used sort mode across sessions and devices.
  - **Explicit Custom Ordering Required**: Users must explicitly switch a label's sort mode to `Custom Order` before they can move or reorder maps around within that label. While a label is sorted by automatic modes (`Last Accessed`, `Alphabetical`, `Date Modified`), within-label card reordering is locked.
  - **Initial Custom Order Seeding**: When a user explicitly switches the sort order to `Custom Order` without having previously defined a custom sort order for that label, the initial custom sort order is seeded directly from the sort order from which the user switched (e.g. `Last Accessed`, `Alphabetical`). Cards remain in their familiar positions rather than reshuffling, providing a seamless baseline for manual adjustments.
  - When in `Custom Order`, dragging a map within Label A updates its position specifically in Label A without altering its order in Label B.
- **Per-User Organization**: All labels, assignments, and custom ordering are personal to each user account. Labeling or reordering a shared map does not affect any collaborators.
- **Offline-First Resilience**: Labels, color tags, assignments, and custom sort orders are cached in IndexedDB for instantaneous offline hydration and synchronized with the backend via background REST/socket operations.

---

## 2. Dashboard Layout & Visual Structure

### A. Navigation & Views

Users can view maps in two primary layout modes:

1. **Label Sections View (Dashboard / Grouped View)**:
   - Displays user-selected "pinned" label sections vertically (e.g., `★ Favorites`, `Road Trips`, `Europe 2026`, followed by unlabelled maps).
   - Each section shows a preview carousel/grid of cards with a count badge, quick sort selector, and reorder handle.

2. **Single Label View (Filtered Feed)**:
   - Clicking a label in the sidebar / navigation pill bar filters the view to that specific label.
   - Shows the full grid of maps with the label's active sort controls (Custom drag order, Last Accessed, Alphabetical, Date Modified).

```text
┌─────────────────────────────────────────────────────────────────────────────┐
│ [🔍 Search maps...           ]   [Active View: Road Trips ▾]  [+ New Map]  │
│ [ All (12) ] [ ★ Favorites (3) ] [ 🏷️ Road Trips (4) ] [ 🏷️ Europe (2) ] [+] │
└─────────────────────────────────────────────────────────────────────────────┘

 🏷️ ROAD TRIPS (4 maps)    [Sort: Custom ▾]  [Edit Label]
 ┌──────────────────────┐  ┌──────────────────────┐  ┌──────────────────────┐
 │ Day 1 - Seattle      │  │ Day 2 - Portland     │  │ Day 3 - Redwoods     │
 │ You • Aug 14, 2026   │  │ You • Aug 14, 2026   │  │ You • Aug 15, 2026   │
 │ [★] [💾 Offline]     │  │ [★] [💾 Offline]     │  │ [💾 Offline]         │
 │ [👁][🏷️][🗑]          │  │ [👁][🏷️][🗑]          │  │ [👁][🏷️][🗑]          │
 └──────────────────────┘  └──────────────────────┘  └──────────────────────┘
```

### B. Map Card Label Management & Dialog
- **Consistent Card Dimensions**: To prevent cards from overflowing or vertically stretching as labels accumulate, map cards do not render variable lists of user label chips.
- **Label Action Icon (`[🏷️]`)**: Each card contains a dedicated label icon button.
- **Label Management Dialog**: Clicking the `[🏷️]` icon opens a modal dialog for that map which:
  - Displays all currently assigned labels for the map with quick remove (`✕`) chips.
  - Lists all available labels with checkboxes/toggles to easily add or remove labels.
  - Provides a quick search/filter input to find existing labels or create a new label inline.
  - Applies changes optimistically, updating assignments both locally in IndexedDB and syncing to the backend.

---

## 3. Label Types & Behavior

### A. Automatic System Labels
| System Label | Auto-Assignment Rule | Initial Default Sort* | Allows Custom Reordering? |
| :--- | :--- | :--- | :--- |
| **All Maps** | Includes every map the user owns or has access to. | Last Accessed | No (or optional manual override) |
| **★ Favorites / Starred** | Explicitly starred by the user. | Last Accessed | Yes |
| **Owned by Me** | Maps where `map.owner_id == user.id`. | Last Accessed | Yes |
| **Shared with Me** | Maps where user is collaborator, not owner. | Last Accessed | Yes |
| **💾 Downloaded / Offline**| Maps downloaded into browser IndexedDB cache. | Last Accessed | Yes |

*\* Every label (system or user-defined) defaults to "Last Accessed" sort mode initially. Once a user switches sort modes, the view remembers and defaults to that label's last-used sort mode thereafter.*

### B. User-Defined Labels
- Users can create any number of custom labels (e.g., `Vacation`, `Client Sites`, `Hiking`).
- Custom color picker (dots or pill background accents) for rapid visual scanning.
- Per-label sort switcher:
  - Each custom label defaults to **Last Accessed** sort mode until the user changes sorting.
  - Users can switch between sort modes at any time; each label remembers and defaults to its last-used sort mode thereafter:
    - **Last Accessed** (Initial Default): Most recently opened maps appear first.
    - **Custom Order (Drag-and-Drop)**: Preserves explicit manual arrangement. If a user explicitly switches to Custom Order before having defined a custom order, the initial custom sort order is seeded directly from the sort order from which the user switched.
    - **Date Created / Modified**: Chronological order.
    - **Alphabetical (A → Z / Z → A)**.

---

## 4. Drag-and-Drop Mechanics

Reordering and drag interactions work seamlessly across desktop and touch:

### A. Manual Reordering Within a Label
- **Explicit Mode Requirement**: Moving/reordering cards within a label is only allowed when that label's sort mode is explicitly set to **Custom Order**. When viewing a label sorted by automatic criteria (`Last Accessed`, `Alphabetical`, `Date Modified`), within-label reordering is locked and reorder handles/gestures within the section are disabled.
- **Initial Custom Order Seeding**: If the user explicitly switches a label into **Custom Order** without having previously defined a custom order, the layout preserves the exact sequence of the sort mode from which they switched as the new custom starting baseline.
- Grabbing a card in **Custom Order** moves it horizontally or vertically among neighboring cards, with shift animations indicating the drop insertion point.
- Releasing commits the card's updated `position` for that specific label.

### B. Touch Conflict Resolution (Custom Order Only)
- **Only Active in Custom Order**: Drag gesture listeners and drag handling only apply when the label's sort mode is explicitly set to **Custom Order**.
- **Preserve Long-Press Tooltips for Non-Custom Ordering**: When sorted by automatic modes (`Last Accessed`, `Alphabetical`, `Date Modified`), reordering is disabled and existing long-press tooltip timers (`handleTouchStart`, `LongPressLabel`) remain active on map cards.
- **Scroll vs. Drag Disambiguation**: In Custom Order mode, tooltip timers are suppressed in favor of drag gesture detection with standard pointer movement thresholds (e.g., 5–8px) to prevent accidental card movements while scrolling.

---

## 5. Data Model & Storage

### SQLite Schema (Server)

```sql
-- User-defined labels
CREATE TABLE user_labels (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  name TEXT NOT NULL,
  color TEXT,                            -- Hex color code or theme token
  sort_mode TEXT NOT NULL DEFAULT 'last_accessed', -- Defaults to 'last_accessed' until changed: 'last_accessed', 'custom', 'name', 'created_at'
  position INTEGER NOT NULL DEFAULT 0,  -- Ordering of the label in user's label list
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  UNIQUE(user_id, name)
);

-- Map-to-Label association with per-label custom ordering
CREATE TABLE user_map_labels (
  user_id TEXT NOT NULL,
  label_id TEXT NOT NULL,
  map_id TEXT NOT NULL,
  position INTEGER NOT NULL DEFAULT 0,   -- Position specific to this label
  added_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (user_id, label_id, map_id),
  FOREIGN KEY (label_id) REFERENCES user_labels(id) ON DELETE CASCADE,
  FOREIGN KEY (map_id) REFERENCES maps(id) ON DELETE CASCADE
);

-- System label preferences & custom order overrides
-- (For system labels like 'favorites', 'owned', 'shared', 'offline')
CREATE TABLE user_system_label_settings (
  user_id TEXT NOT NULL,
  system_label_id TEXT NOT NULL,         -- 'favorites', 'owned', 'shared', 'offline', 'all'
  sort_mode TEXT NOT NULL DEFAULT 'last_accessed', -- Defaults to 'last_accessed' until changed
  PRIMARY KEY (user_id, system_label_id),
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE TABLE user_system_label_map_order (
  user_id TEXT NOT NULL,
  system_label_id TEXT NOT NULL,
  map_id TEXT NOT NULL,
  position INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (user_id, system_label_id, map_id),
  FOREIGN KEY (map_id) REFERENCES maps(id) ON DELETE CASCADE
);
```

### Client / Offline Caching
- Labels, assignments, and custom ordering tables are mirrored to IndexedDB:
  - `cached_labels`
  - `cached_map_labels`
  - `cached_system_label_settings`
  - `cached_system_label_map_order`
- State mutations (label toggles, reordering) apply optimistically to UI and IndexedDB immediately, queuing sync requests (`POST/PUT/DELETE /api/labels/*`) to the backend.
- **Initial Custom Order Materialization**: When the user explicitly switches a label into Custom Order without an existing custom order, the client computes sequential `position` integers (`0, 1, 2, ...`) directly based on the sequence of the sort order from which the user switched, persisting them locally to IndexedDB and syncing to the backend.
