# What's new

Changes are grouped under the semantic version of the production release that ships them. Each feature or fix remains its own card. Add a Changeset file for every user-visible change; the release workflow updates this file when it prepares the version PR. Preview deployments do not count as releases.

## v0.3.4 — 2026-10-29

<!-- change-id: issues-sidebar-review-ux -->
### Fixes — Add Issues to workspace navigation

- Add a dedicated Issues destination in the sidebar and improve the data-health review layout with summary counts, search, priority filtering, and expandable review controls.

<!-- change-id: neat-expenses-page -->
### Fixes — Expenses page cleanup

- The Expenses page now follows the supplied reference layout, removes duplicate expense and receipt panels, and keeps the entry form available from the page Record action.

## v0.3.3 — 2026-10-29

<!-- change-id: plain-text-expense-import -->
### Fixes — Import expenses from copied plain text

- Allow workspace managers to paste tab-separated expense rows, including multi-line descriptions and receipts, directly into the cashbook import flow.

## v0.3.2 — 2026-10-29

<!-- change-id: legacy-member-role-compat -->
### Fixes — Keep legacy Member access limited

- Keep existing Member accounts on their fixed limited permission set, even when older membership records point to a broader role template.

## v0.3.1 — 2026-10-29

<!-- change-id: calm-record-forms -->
### Fixes — Unify finance period and account filters across workspace pages

- The Dashboard and finance pages now share Daily, Weekly, Monthly, Yearly, Last year, and Custom ranges with account filtering in the page action bar. Record forms stay closed until requested from the Record button. Bill schedules support common categories plus a custom category, show an updating due countdown, and advance the next due date after a payment is recorded. Savings supports bulk recording contributions on a user-selected weekday across a selected date range, with one audited activity row per contribution.

## v0.3.0 — 2026-10-29

<!-- change-id: accurate-dashboard-totals -->
### Fixes — Improve dashboard calculation accuracy

- Build dashboard and analytics totals from posted ledger entries, show negative balances and net results explicitly, and calculate cash runway from the workspace's observed data window. Align the updated dashboard and reset controls with the existing design tokens.

<!-- change-id: fresh-ledger-reset -->
### New — Reset workspace finance data

- Workspace owners can clear saved finance records with exact-name confirmation while keeping membership, roles, preferences, integration settings, and the audit trail. The reset runs in safe batches and keeps integration duplicate protection.

<!-- change-id: plain-page-headings -->
### Fixes — Remove redundant page heading labels

- Remove section labels and board numbers above workspace page titles, including on sign-in, so page titles stay clear and uncluttered.

## v0.2.0 — 2026-10-29

<!-- change-id: accurate-dashboard-insights -->
### Fixes — Improve dashboard insight accuracy

- Keep dashboard totals, comparison charts, partner shares, targets, and cash runway aligned with complete recorded data, and show negative net results clearly.

<!-- change-id: accurate-whats-new-badge -->
### Fixes — Stable What's new notifications

- Count unread notifications by stable card identifiers, so wording edits to existing release notes do not create phantom updates.

<!-- change-id: bright-charts-filter -->
### New — Shared finance filters and interactive charts

- Filter dashboard and analytics reports by date range and account, and inspect recorded activity with accessible interactive charts.

<!-- change-id: clear-search-header -->
### Fixes — Keep the shared search bar clear

- Move appearance choices out of the shared top bar and into the account menu so search, attention, support, and account controls remain easy to see.

<!-- change-id: editorial-type-accent -->
### Fixes — Consistent workspace typography

- Apply shared heading fonts and serif accents to workspace titles, and give the dashboard quote a classic italic serif. Load the actual Instrument Serif italic face for italic-serif token use and move font variables to the document root so shared font tokens match their loaded families.

<!-- change-id: fresh-whats-new-badge -->
### Fixes — Fresh What's new notifications

- Refresh the changelog before marking updates as read so long-open tabs stay in sync with newly released notes.

<!-- change-id: protect-preview-and-search -->
### Fixes — Harden preview updates and workspace navigation

- Require sign-in for the What's new page, show unreleased notes on preview builds, and keep saved searches private to each account and workspace. Apply saved appearance preferences as the app loads, improve keyboard and mobile navigation behavior, and keep theme controls out of the shared search bar.

<!-- change-id: responsive-page-context -->
### Fixes — Keep page titles clear on narrow headers

- Long workspace page names now truncate cleanly instead of colliding with search and account controls.

<!-- change-id: search-keyboard-flow -->
### Fixes — Smoother workspace search

- Keep keyboard selection visible and valid as results update, and prevent Escape from closing dialogs underneath search.

<!-- change-id: tidy-titles-glow -->
### Fixes — Clearer workspace page titles

- Use the theme-aware accent color to highlight the final word in multiword workspace page titles.

<!-- change-id: versioned-changelog -->
### New — Versioned What's New timeline

- Associate every feature card with the semantic version of the production release that ships it.

<!-- change-id: workspace-list-compatibility -->
### Fixes — Protect workspace navigation during backend updates

- Keep the finance workspace usable if a local or preview Convex deployment temporarily returns an older access response without a workspace list.

## v0.1.0 — 2026-10-28

<!-- change-id: v0-1-0-whatsapp-support -->
### New — WhatsApp support

- Open a WhatsApp support conversation with MylesCorp at +254 743 993 715.

<!-- change-id: v0-1-0-simpler-shared-header -->
### Improvements — Simpler shared header

- Keep the shared header focused by removing the unavailable Ask AI action.

<!-- change-id: v0-1-0-workspace-access-audit-trail -->
### New — Workspace access and audit trail

- Set up a finance workspace and manage team access with role-based permissions and an audit trail.

<!-- change-id: v0-1-0-whats-new-sidebar -->
### New — What's new in the sidebar

- Browse product updates from the What's new link at the bottom of the workspace sidebar.

<!-- change-id: v0-1-0-unread-update-count -->
### New — Unread update count

- See a count of unread product changes that clears after opening What's new and returns with the next update.

<!-- change-id: v0-1-0-shared-cashbook -->
### New — Shared cashbook

- Record sales, expenses, money movements, savings, loans, and bills in one shared cashbook.

<!-- change-id: v0-1-0-finance-reports -->
### New — Finance reports

- Review dashboards, analytics, daily and monthly reports, and reconciliation based on saved workspace records.

<!-- change-id: v0-1-0-personalized-dashboard-greeting -->
### Improvements — Personalized dashboard greeting

- See a dashboard greeting personalized with your name and a daily quote.

<!-- change-id: v0-1-0-consistent-workspace-navigation -->
### Improvements — Consistent workspace navigation

- Use the same top navigation across workspace areas, with MylesCorp Technologies credited in the footer.

<!-- change-id: v0-1-0-centered-workspace-search -->
### Improvements — Centered workspace search

- Find workspace records from the centered search field, with attention and account actions grouped on the right.

<!-- change-id: v0-1-0-clearer-navigation-search-shortcut -->
### Improvements — Clearer navigation and search shortcut

- Scan a clean single-line page title, clearer active sidebar styling, and open search with Ctrl+K.

<!-- change-id: v0-1-0-refined-header-sidebar -->
### Improvements — Refined header and sidebar

- Use inset rounded header and sidebar panels with aligned search, support, and account actions.

<!-- change-id: v0-1-0-cleaner-sidebar -->
### Improvements — Cleaner sidebar

- Use the sidebar space for navigation by removing the redundant workspace-protection footer.

<!-- change-id: v0-1-0-regional-finance-settings -->
### New — Regional finance settings

- Set the workspace country, timezone, currency, finance rules, and reporting preferences in Settings.

<!-- change-id: v0-1-0-import-integration-settings -->
### New — Import and integration settings

- Review imports and connected finance integrations from the Data settings area.
