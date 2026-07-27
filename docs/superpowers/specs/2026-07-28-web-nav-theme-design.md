# Web App Navigation & Theme Port

## Problem

`web/` (pilltalk-web, a framework-free TypeScript/Vite app deployed via Cloudflare Pages) has no persistent navigation — a single static page shows two stacked panels ("Channel" and "Direct line") plus two modal bottom sheets (Settings, Room picker). Its theme is iOS-blue (`--accent: #007aff`) with a code comment noting it was deliberately built to mirror the native app's *previous* look. The iOS app has since moved to a persistent nav shell (Chats/Nearby/Groups/Settings) with a green→red gradient theme; this spec ports the equivalent structure and look to web.

## Goals

- Replace the sheet-based Settings/Room-picker pattern with a persistent nav shell: **Chats**, **Contacts**, **Settings**.
- Give Contacts real content — a proper list view, not just the existing DM chip-switcher relocated.
- Apply the green→red gradient (`#2FBF71`→`#E14B4B`) to the brand mark, active nav item, and primary buttons, in both existing light/dark `@media` blocks.
- Keep the app framework-free (no React/Preact/etc. introduced) — extend the existing hand-rolled `createElement`/`.append()`/`.textContent` style already used throughout `main.ts`/`render.ts`.

## Non-goals

- No "Groups" section — the feature doesn't exist on web (confirmed: zero non-test matches for "group" in `src/**/*.ts`), and inventing an empty placeholder tab was explicitly rejected.
- No new proximity/discovery feature — "Nearby" doesn't map to anything real on web (browsers can't do BLE); Contacts is a manually-curated list, not a discovery surface, and is presented as such.
- No changes to `peerColor.ts`'s per-sender hash-based hues — that's a distinct concern (telling chat participants apart) from the single brand-accent gradient this spec introduces.
- No changes to the underlying chat/DM/geohash/crypto logic — this is presentation-layer only, same boundary the iOS redesign kept.

## Design

### Navigation shell

A new, framework-free nav controller replaces `index.html`'s current always-both-visible-panels layout:

- **Sidebar**: persistent (always visible) at viewport widths ≥ 768px; below that, collapses to a slide-in drawer toggled by a hamburger button — the same responsive shape as iOS's `NavigationSplitView`, hand-rolled via a CSS media query plus a `hidden`/class-toggle on the sidebar element (matching the existing `hidden`-attribute pattern `main.ts` already uses for the two modal sheets).
- **Sections**: `Chats`, `Contacts`, `Settings`, each a top-level content container; a `currentSection` piece of state (a simple module-level variable, consistent with `main.ts`'s existing flat state style — no state-management library) controls which container is visible, toggled by clicking a sidebar item.

### Chats section

Hosts today's "Channel" and "Direct line" panels exactly as they render today (no internal changes) — they move from being the whole page to being this section's content. The room-picker sheet (geohash tier list + teleport entry) stays a modal sheet, opened the same way it is today, unchanged.

### Contacts section (new)

A real list view built on `src/contacts/contacts.ts`'s existing `{pubkey, label}[]` data (localStorage-backed, unchanged storage/model). Each row shows the contact's label; tapping a row switches Chats' "Direct line" panel to that contact's DM (reusing whatever mechanism the existing chip-switcher already uses to set the active DM target) and navigates to the Chats section. This is new UI (a scrollable list replacing the small inline chip row for this purpose) but no new data model — `contacts.ts` is unchanged.

### Settings section

Today's modal Settings sheet content (nickname field, notifications toggle, danger-zone wipe button) moves into this section's content container instead of a `.sheet-backdrop`/`.sheet` popup. Behavior of each control is unchanged; only the container changes from modal to persistent section.

### Theming

In `index.html`'s `<style>` block, both the light (`:root`) and dark (`@media (prefers-color-scheme: dark)`) rule sets:
- Replace `--accent: #007aff` with a new gradient-capable token pair: `--accent-start: #2fbf71` (green) and `--accent-end: #e14b4b` (red), identical in both light and dark blocks (matching iOS's design: only background/surface/text tokens vary by scheme, not the brand gradient itself).
- Wherever `--accent` is currently consumed as a flat `background-color`/`color` (the brand mark, active nav item, primary buttons), switch to `background: linear-gradient(90deg, var(--accent-start), var(--accent-end))`, with `background-clip: text; color: transparent;` for text usages (mirroring the iOS `LinearGradient` treatment on the "pilltalk/" wordmark).
- `--self: #ff9500` (orange, "you" in chat) and `--destructive: #ff3b30` are unrelated to the brand accent and stay unchanged.

### Testing

New logic gets vitest+jsdom unit tests, following the existing `render.test.ts`/`peerColor.test.ts` pattern (render a DOM fragment, assert on its structure/text/classes):
- Contacts list rendering (given a set of stored contacts, produces the right number of rows with the right labels; tapping a row invokes the DM-switch callback with the right pubkey).
- Section-switching state (selecting a sidebar item shows that section's container and hides the others).
- No integration/e2e/visual test exists for this app today and none is introduced — consistent with the existing project's testing boundary (crypto/protocol logic is tested, UI is spot-tested via jsdom DOM-structure assertions only).
