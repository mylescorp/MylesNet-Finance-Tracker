# AGENT BRIEF: Rebuild the MylesNet Finance Tracker (Google Sheets) to match the approved redesign

You are implementing an approved visual and functional redesign inside the existing Google Sheet **"MylesNet Finance Tracker v3"** (UGX, Africa/Kampala). Design is finished and signed off as 18 mock boards. Your job is to build it in the sheet with live formulas, not static copies.

Read this whole brief first. Then open `previews/` (PNG of every board) next to `boards/` (standalone HTML of each board, the exact spec for text, order and spacing), and `design-tokens/` (the colour, type and spacing source of truth).

## 0. Ground rules

1. **Work on a copy** first (File > Make a copy, name "MylesNet Finance Tracker v4 DRAFT"). Never break existing formulas, named ranges (for example `NR_ACCOUNTS`), protections or the entry Google Form link. Swap in v4 only after the acceptance checks in section 9.
2. **Keep the data layer.** Existing data tabs (`Sales_Entries`, `Expense_Entries`, `Movements`, `Savings_Investments`, `Loans`, `Monthly_PnL`, `Daily_Report`, `Partner_Statement`, `Recurring_Bills`, `Analytics`, `Dashboard`) stay as the source of truth. Add the new look as **view sheets** or restyle in place where the sheet already is a view (Dashboard, Analytics, Partner_Statement, Settings).
3. **Everything numeric is a formula** reading the data tabs or Settings. The mocks contain figures from the real sheet (listed so you can verify), plus a few clearly labelled **samples** (section 8). Never hard-code a mock number into a cell.
4. **Do not hide data problems.** The mocks deliberately surface them (section 7). Build the checks that raise them.
5. Mark **NEW** features exactly as listed. Features marked EXISTING or UPGRADED must keep their current formulas and only change look and layout.
6. Ask for nothing. Where a detail is not specified, follow the tokens and the pattern of the nearest similar component.

## 1. Package map

| Preview / board | Sheet tab to build or restyle | Status |
|---|---|---|
| 01-Dashboard | `Dashboard` | UPGRADED (+ NEW cards) |
| 02-Analytics | `Analytics` | UPGRADED (+ NEW) |
| 03-Sales | new view sheet `Sales` over `Sales_Entries` | NEW view |
| 04-Expenses | new view sheet `Expenses` over `Expense_Entries` | NEW view |
| 05-Movements | new view sheet `Movements_View` over `Movements` | NEW view |
| 06-Savings | new view sheet `Savings` over `Savings_Investments` | NEW view |
| 07-Loans | new view sheet `Loans_View` over `Loans` | NEW view |
| 08-Daily-Report | new view sheet `Daily_Report_View` over `Daily_Report` | NEW view |
| 09-Monthly-PnL | new view sheet `Monthly_PnL_View` over `Monthly_PnL` | NEW view |
| 10-Partners | `Partner_Statement` (nav label "Partners") | UPGRADED (+ NEW) |
| 11-Bills | new view sheet `Bills` over `Recurring_Bills` | NEW view |
| 12-Reconcile | new sheet `Reconcile` | NEW |
| 13..18-Settings-* | six sheets: `Settings`, `Settings_Finance`, `Settings_Rules`, `Settings_Data`, `Settings_Access`, `Settings_Releases` | UPGRADED (split into subtabs) |

Hide the old raw tabs only if they are not edited by hand; otherwise leave them visible but move them to the right of the new tabs and add an "Open data ›" link on each view.

## 2. Design system (from `design-tokens/`)

**Colour (light):** page background `#F3F3F1`; card `#FFFFFF`; inset (table headers, chips, tracks) `#EFEFEC`; ink `#1B1B1B`; muted `#6B6B68`; line (borders) `#E8E8E5`; line-strong `#D2D2CE` (hover, emphasis). Accent `#B3622B` is for links, highlights, the "+ Add entry" button and chart series 1 only. Accent-bg `#FBEEE3` is for **input cells** (anything the user may edit). Status always pairs a tinted background with its own text colour: ok `#DDF3EA` / `#2E7D5B`, warn `#FBF0D9` / `#8A5A00`, danger `#FBE4E1` / `#B3362B`, info `#E4EEFA` / `#3B6AA0`. Chart series in order: accent `#B3622B`, `#4B6584`, `#2E7D6B`, `#7A4B96`, `#A8801F`. Brand orange and navy appear only in the logo and banner, never in sheet UI.

**Type:** Geist everywhere (already used in the sheet). Instrument Serif only for the page title (cell A2 area). Body 10pt (13px). Eyebrow label 10px, caps, wide letter-spacing, muted (in Sheets: 8pt, uppercase via formula `UPPER()` or typed caps, muted colour). KPI value 34px (about 26pt), weight regular/medium. Card titles are the eyebrow style, or 13px medium for sub-titles.

**Grid:** data rows 44px, table header 40px, KPI card about 64px of value area plus rows; content width about 1136px (columns B to N). Use a 12-column feel: cards occupy merged column blocks with one narrow gutter column (width 12px) between them. Hide gridlines on every view sheet. Freeze rows 1 to 2 (nav and title).

**Sheets translation rules (important):**
- Sheets has no corner radius or shadow. Fake a card with a white fill block on the `#F3F3F1` page, a 1px `#E8E8E5` border, and one blank gutter row/column around it. Rounded corners apply only to charts and drawn buttons (10px).
- **Buttons / pills** (nav, "+ Add entry", Print, Export): drawn shapes (Insert > Drawing) or a cell with fill and `=HYPERLINK("#gid=…","Label")`. Active nav = ink fill, white text. Others = no fill, ink text.
- **Progress bars / tracks:** `=SPARKLINE(value,{"charttype","bar";"max",1;"color1","#B3622B"})` on an inset-coloured cell, or a stacked bar chart. Mix bars in tables use the same.
- **Mini charts** (14-day trend, heatmap sparkline, area): `SPARKLINE` (column or line) for small ones, native charts for larger ones with no gridlines, series colours above, and muted axis text.
- **Status chips:** a cell with the tint fill, centred text, the status colour for text, driven by **conditional formatting** on the status text (for example "Review", "OK", "Fix first").
- **Toggles:** use a dropdown `On / Off` or a checkbox, with conditional formatting (On = accent fill white text; Off = line-strong fill). Say so in the cell note.
- **Inputs:** every editable cell gets accent-bg fill, data validation, and a protected range that excludes only those cells. Dropdowns use data validation lists backed by a `Lists` sheet.
- **Heatmap:** conditional formatting colour scale (low `#F6E4D6` to high `#B3622B`) on the value cells; missing = danger tint with "–".
- **Phone previews** in the mocks (Mobile view cards) are not cells. Implement them as a **Mobile** sheet or a narrow responsive layout (see 3.5) and keep the mock card only as a labelled screenshot.

## 3. Global components (every tab)

**3.1 Nav bar (row 1, all sheets):** one white bar with 13 links in this order: Dashboard, Analytics, Sales, Expenses, Movements, Savings, Loans, | REPORTS (eyebrow label) |, Daily Report, Monthly P&L, Partners, Bills, Reconcile, Settings; and a right-aligned accent "+ Add entry" that opens the entry form link from `Settings!Business profile`. The active tab's link is ink fill, white text. Links use `HYPERLINK("#gid=…")` with a name-to-gid lookup in a hidden `Nav` sheet so renames never break links. Row height 56px. This replaces the current nav and must fit on one line.

**3.2 Page header (rows 2 to 3):** title in Instrument Serif (about 32pt) at left, subtitle muted underneath; the **logo** (`assets/logo.png`) sits in a white bordered box at top right (about 104 x 72px) using `=IMAGE()` from Drive-hosted PNG or an image over cells. The **banner** (`assets/banner.png`) appears only on the Dashboard, full width, uncropped, directly under the header (about 405 to 490px tall; insert image over cells inside merged rows).

**3.3 Global bar (new, row under nav on every tab):** four blocks: **Search** (a cell where typing runs a `QUERY`/`FILTER` across `Sales_Entries`, `Expense_Entries`, `Partner_Statement`, `Recurring_Bills` into a results area on a hidden `Search` sheet, shown in a sidebar), **Notifications (N)** (count from `Issues`, see 3.4), **Mobile layout** (link to `Mobile`), **Audit trail ›** (link to `Audit_Log`).

**3.4 `Issues` sheet (new, the "Needs attention" source):** one row per open issue with columns `severity` (Fix / Action / Warn / Review), `title`, `detail`, `source_tab`, `link`, `opened_at`, `status`. Populate with formulas or Apps Script rules: (a) Dashboard vs entries difference ≠ tolerance; (b) Partners net profit ≠ Dashboard net; (c) cash on hand below the low-cash threshold; (d) Centipid balance above 0 with zero withdrawals; (e) recurring bill due or not booked; (f) missing-day count > 0; (g) estimated Centipid split in use; (h) unexplained funding ≠ 0; (i) any day below the weak-day threshold. Notification count = `COUNTIF(status,"Open")`.

**3.5 Mobile layout:** the Dashboard, Sales and Daily Report each need a phone view (about 360px wide: one column of stacked cards). Build a `Mobile` sheet with: Today's sales, Cash, Centipid, quick-add buttons, last 5 entries. It is the only place with a single-column layout.

**3.6 Footer (every sheet):** left "MylesNet Finance Tracker v3 · <Tab>"; right "Data from <source tabs> · Updated <date>" using `TEXT(NOW(),"d mmm yyyy")` or the last-edit stamp.

**3.7 Period / compare controls** appear in a row above KPIs on Dashboard, Analytics, Sales, Expenses, Movements, Savings, Loans, Partners, Monthly P&L, Bills. A period dropdown cell (Today, Week, Month, Year, Custom) writes to a named range `NR_PERIOD`; start/end dates are derived (`NR_FROM`, `NR_TO`). Compare mode (Analytics only, default on) writes `NR_COMPARE_FROM/TO` as the previous period of equal length. All KPI and table formulas for those tabs must read these named ranges (default behaviour: current month if blank).

**3.8 LIVE tag, Updated just now, Print, Export PDF, Share report:** LIVE is a pill label; Updated uses `NOW()` formatted as "Updated 14:05" (recalculated on edit); Print/Export PDF are links using the sheet's PDF export URL with the correct `gid` and print range (portrait, fit to width, hide gridlines); Share report runs an Apps Script that creates a PDF and emails or returns a link.

## 4. Per-tab specification

Notation: **[E]** existing, **[U]** upgraded (keep formula, new look), **[N]** new. "Data" lists the source ranges. Verify values against the figures in brackets (from the live sheet on 25 Oct 2026).

### 4.1 Dashboard (`Dashboard`)
Layout, top to bottom:
1. Header + logo + **full banner** [N banner]. Nav [U]. Global bar [N].
2. **All clear bar** [U]: green ok tint; check mark; text "All clear: no overdue bills and no missing days." Right side: three white chips "0 overdue", "0 missing days", "0 due soon" (live counts). When any count > 0 the bar turns warn or danger tint with the first issue's text.
3. **Period row** [N]: label PERIOD + segmented control (Today / Week / Month / Year / Custom) at left; LIVE, Updated just now, Print, Export PDF, Share report at right.
4. **Quick add** strip [N]: four buttons (+ Add sale, + Add expense, Record withdrawal, Record payout) that deep-link to the entry form with the type prefilled (`?entry.xxx=…`), plus a muted note.
5. **Today's sales hero** [N]: one wide card, three columns. Left: eyebrow "TODAY'S SALES · date", currency label, the number at 68px (about 50pt) [21,500], chip "2.1× the daily average" (= today ÷ month average; green if ≥1), muted line "Daily average this month is 10,292". Middle: last 14 days bar chart (today solid accent, others 35% accent). Right: two progress bars: This week [80,603] "Today is 27% of the week so far", This month [257,303] "Today is 8% of the month so far".
6. **KPI grid** (two rows, 6 columns) [U]: each card = eyebrow, value (34px), hairline, then two key/value rows (muted key, ink value), optionally a progress bar. Row 1: Sales this month 257,303 (Today 21,500; This week 80,603) · Expenses this month 57,000 (Share of sales 22% + bar) · Net this month 200,303 (Margin 77.8% green + bar) · Total balance 119,100, accent value (Cash on hand 46,100 • blue dot; Centipid mobile 73,000 • accent dot) · Active loans – (Monthly payments 0; Status None active) · Savings & investments – (Gain/loss 0; Status No holdings). Row 2: Revenue YTD 1,023,914 (Period 1 Jan – 25 Oct) · Expenses YTD 2,952,964 (Includes Equipment purchases) · Net YTD (1,929,050) danger colour (Basis Sales – expenses) · Net margin YTD -188.4% danger (Basis Net ÷ sales) · 14-day sales trend (spans 2 columns, SPARKLINE columns, last bar accent).
7. **Insight row, 4 cards** [N]: Cash flow this month (three horizontal bars: Sales 257,303 green, Expenses 57,000 accent, Net 200,303 blue) · Balance composition (119,100, stacked bar Cash 39% / Centipid 61%) · Profit split donut (30/30/30/10, chart colours 1 to 4) · Data health (Overdue bills 0 OK, Missing days 0 OK, Bills due soon 0 OK, Top expense "Other 39%" warn).
8. **Attention row, 3 cards** [N]: **Cash runway** (≈ days = cash on hand ÷ average daily expenses, 46,100 ÷ 2,280 ≈ 20 days; bar vs the low-cash alert 100,000 with a marker; shortfall 53,900; chip "Below alert"), **Centipid withdrawal** (73,000 collected, none withdrawn; withdrawals recorded 0; "Record withdrawal" button), **Reconciliation** (Dashboard sales vs entries total, difference 500, "Review entries" button).
9. **Second row of 3 cards** [N]: **Monthly target** (target from Settings 350,000; month-to-date %, pace marker = day-of-month ÷ days-in-month; projected finish; needed per day = (target – MTD) ÷ days left), **Equipment payback** mini (recovered % bar, invested, recovered, projected break-even month), **Payout readiness** (partner, balance, chip "Not ready" until balance > minimum payout).
10. **Upcoming 30 days + Recent activity** [N]: upcoming = daily report time, bills due (from `Recurring_Bills`, flag "not booked"), next backup, monthly export, payout run; recent activity = last 5 rows of `Audit_Log`.
11. **Needs attention inbox** [N]: ranked list from `Issues` (severity chip, title, detail, right-aligned link). **What changed since yesterday** [N]: sales today vs yesterday (+126% in the mock), net this month change, cash change, Centipid change, new flags. **Saved views** [N]: Owner / Partner / Cashier view selector (hides blocks by role using named ranges and a role lookup on the signed-in email) plus a "Save current view" button. **Mobile view** card [N]: screenshot or link to `Mobile`. **Audit trail** card [N].
12. **Tables (2-column grid)** [U]: Performance (Today, This week, This month bold, This year, Since start date; columns Sales, Expenses, Net, Margin) · Account balances (live) with the note about Centipid withdrawals · Sales by income type · Expenses by category (7 categories incl. Other + Total with mix bars) · Partner snapshot · Wealth & debt summary · Recurring bills needing attention.

UX: all cards read `NR_PERIOD` where relevant; Today's sales always uses today. Empty states show muted text, never blank cells.

### 4.2 Analytics (`Analytics`)
1. Header, nav, global bar. **Controls row** [N]: period segmented control, date-range cell (start – end), compare toggle (default ON) and "Compare with" range (previous period of equal length), LIVE, Print, Export PDF, Share report.
2. **Compare strip** [N]: five stats (Sales, Average per day, Best day, Weakest day, Days recorded) each with current value, "was" value and delta chip (green ≥ 0, warn small drop, danger large drop). Mock: 7 days vs previous 7 (81,103 vs 83,300).
3. **Dark summary card** [N] (the only dark card; fill ink `#1B1B1B`, white text): eyebrow "PROJECTED SALES · month", number at 72px [319,676] = month-to-date + days-left × average daily sales, chip vs previous month [+2.6%], sub-line the assumption; three mini stats (Month to date, Days left, Needed per day to hit target); right: area/line chart of daily sales for 14 days with a dashed average line.
4. **Three cards** [N]: Monthly target (from Settings, progress, pace marker, behind/ahead chip) · Scenarios (month average vs recent pace vs target-required, each with value and bar; footnote "run-rates, not forecasts") · Bandwidth bill forecast (see 4.11 for the logic).
5. **Month pace** [N] (cumulative line chart day 1 to 31, one line per month: this month vs last month vs the month before, dashed for the projected remainder, marker at today; right panel lists same-day totals and % differences) and **Equipment payback tracker** [N] (recovered % = operating profit to date ÷ equipment invested; remaining; monthly profit; projected break-even month; sensitivity table at three monthly profit levels).
6. **KPI rows** [U] 5 × 2: Avg daily sales 14 days, Best day, Days recorded, Expense ratio, Projected sales; Avg daily expenses, Net margin YTD, Strongest weekday, Operating margin YTD, Equipment invested (payback in months).
7. **Charts** [U]: Sales and expenses last 14 days (bars with avg dashed line, selected day highlighted, 7/14-day toggle); Sales by weekday (horizontal bars, highlight strongest, By average / Mon–Sun toggle); Sales, operating costs and equipment by month (grouped bars); Weekly sales last 10 weeks.
8. **Daily heatmap + Anomaly flags** [N]: heatmap of every recorded day laid out as rows = weeks (label = Monday date), columns = Mon to Sun, colour scale by sales; missing days (no entry) = danger tint with "–"; weak day (under the Settings weak-day % of the 14-day average) gets a danger outline; side panel with days recorded, missing, weakest and strongest. Anomaly flags list any day under threshold or with no entry, each with a "Review" button that writes a row to `Weak_Day_Tags`.
9. **Sales by income type** [U] (Estimated split chip) and **Spending by category** [U] (Year to date / This month toggle, highlighted top category).
10. **Daily data** table (last 14 days with total) and **Weekday summary** (all seven weekdays visible, no scrollbar) [U].
11. **What the data says** [U] (tagged insights: Trend, Margin, Capital, Payback, Pattern, Watch) and **Data quality** [U] (Fix first / Review / Fixed here).
12. **Goal tracking** [N]: four rows against Settings targets (monthly sales target, expense ratio limit, weak days, payback target) with progress bar and chip. **Why did sales change** [N]: week-on-week by weekday as diverging bars (sums to the total change). **What-if planner** [N]: table of scenarios (today, prices +5%, volume –10%, new cost) → monthly profit and payback months; inputs are Settings-style cells.

### 4.3 Sales (`Sales`, view over `Sales_Entries`) [N view]
Controls row, five KPIs (Today, This month, Year to date, Best day, Split basis "Estimated"), then: **Daily sales table** (last 14 days: date, sales, mobile money, cash, with an Estimated split chip and a total), **Add a sale form** (date, amount, income type, account; Save buttons write a row to `Sales_Entries` through Apps Script and clear the form), **Sales by income type** (bars), **Best days**, **Imports** (Centipid CSV rows, entry form rows, duplicates), **Data checks** (4 missing days, estimated split, 500 difference, duplicates), **Weekday pattern**.
New features: **Weak-day diary** (table of flagged days with a reason dropdown: Outage, Power cut, Holiday, Late entry, Other; saves to `Weak_Day_Tags`, which Analytics reads to annotate bars), **Split correction** (month, estimated mobile, estimated cash, input cells for actual; "Apply correction" writes actual values to a `Split_Actuals` sheet and the Balance composition and Reconcile read actual first, estimate second), **Voucher batches** (new sheet `Voucher_Batches`: batch, vouchers, price, sold, remaining), **Mobile entry** phone preview, **Audit trail**.

### 4.4 Expenses (`Expenses`, over `Expense_Entries`) [N view]
KPIs (This month, YTD, Expense ratio with warn threshold, Avg per day, Approval queue). Cards: **By category this month** (table with share and mix bars + total), **Add an expense** form (above the approval limit goes to the queue), **By category YTD** (bars with %), **Operating vs equipment** split bar, **Alerts** (bandwidth not booked, Other is largest, expense ratio OK), **Category budgets** (limit input, this month, warn at 80%), **Recurring costs**.
New: **Receipt photos** (grid of four slots; upload writes a Drive link into a `Receipts` sheet linked by entry ID), **Supplier tracking** (new `Suppliers` sheet; paid YTD per supplier via SUMIFS), **Recurring-expense detector** (formula or script that finds the same amount appearing at a regular interval per category and offers "Create bill" which appends to `Recurring_Bills`), **Audit trail**.

### 4.5 Movements (`Movements_View`, over `Movements`) [N view]
KPIs (Movements recorded 0, Cash on hand, Centipid mobile, Capital in, Default fee). **Money map** (five boxes: Sales → Centipid mobile → Cash on hand → Partners, with labels "estimated 50/50", "withdrawal", "payout"; values live). **Ledger** (empty state when none) and **Record a movement** form (date, type, from, to, amount, fee % which defaults to Settings fee). **Movement types** table (five types, kind, flow; order locked). **Withdrawal planner** (amount, fee, net received, cash after).
New: **One-click Centipid withdrawal** (button that records a withdrawal of the full Centipid balance, books the fee if fee tracking is On, and updates balances), **Cash count helper** (note denominations 50,000 / 20,000 / 10,000 / 5,000 / 2,000 / 1,000 with count inputs; total vs book balance; difference), **Money flow report** (sales, expenses, movements, expected balance vs book balance and the unexplained amount, see section 7), **Audit trail**.

### 4.6 Savings (`Savings`, over `Savings_Investments`) [N view]
KPIs (Current value, Contributions, Gain/loss, Cash buffer in days, Could set aside = 30% of monthly operating profit). **Holdings** table (empty state until rows exist), **Add a holding** form, **Goals** (reach low-cash alert level, recover equipment spend, first partner payout), **Set-aside planner** (10 / 20 / 30% of monthly profit, per month and in 12 months), **Allocation** (empty state, donut when holdings exist). New: **Reserve target** (months of costs × average monthly operating cost; compare with cash; months to reach at the set-aside %), **Returns vs paying down equipment** (amount, return %, one-year return, payback months saved), **Audit trail**.

### 4.7 Loans (`Loans_View`, over `Loans`) [N view]
KPIs (Active loans, Monthly payments, Outstanding, Debt capacity = 30% of monthly operating profit, Equipment financing). **Loans** table + **Add a loan** form, **Loan planner** (principal, annual rate, term → payment with `PMT()`, total repaid, interest, comparison with debt capacity), **Affordability** bars, **Repayment schedule** (generated with `ARRAYFORMULA` from the loan row). New: **Early repayment simulation** (extra payment at month N: new balance, new payment, interest saved) and **Impact on equipment payback** (monthly profit minus loan payments, new payback months), **Audit trail**. The 1,000,000 / 18% / 12-month figures in the mock are an **example**.

### 4.8 Daily Report (`Daily_Report_View`, over `Daily_Report`) [N view]
KPIs (Today's sales, Cash on hand, Delivery time, Recipients, Checks). **Report preview** (message bubble using a template cell with merge fields: date, sales today, week, month, expenses, cash, Centipid, flags), **Last 7 days** table with Recorded status, **Delivery settings** toggles, **Recipients** table (partner, channel chips, status). New: **Weekly digest preview** (Monday 08:00; week sales, change %, best, weakest, balances, open flags), **Delivery status** (sent / delivered / read per recipient from the messaging provider or "Scheduled"), **WhatsApp reply commands** (`balance`, `today`, `week`, `cash`; implemented by an Apps Script web hook that answers registered numbers only), **Mobile view**, **Audit trail**. "Send now" and "Send test message" call the same Apps Script that the 18:00 trigger uses.

### 4.9 Monthly P&L (`Monthly_PnL_View`) [N view]
KPIs (Sales YTD, Operating costs, Operating profit with margin, Equipment, Net profit). **P&L by month** table (columns Jul 19–31, Aug, Sep, Oct 1–25, Year to date; rows Sales, Operating costs, Operating profit, Operating margin, Equipment, Net profit). Cells that are not yet split show "–" and a warn chip; do not invent values. **Year-to-date statement** (vertical P&L), **Operating margin** bars (including a "with 65,000 bandwidth accrued" bar), **Sales, costs and equipment** bars. New: **Budget versus actual** (budget from Settings targets, actual, variance), **Month-end close checklist** (four steps tied to Reconcile and the period lock; progress), **Shareable PDF statement** (options: include equipment, include partner balances; "Generate PDF" and "Copy share link" via Apps Script), **Audit trail**.

### 4.10 Partners (`Partner_Statement`) [U + N]
Keep the existing table and the partner selector. Build: controls row (period, "Statement for" dropdown, Print, Export PDF, Send statement, Share report); **KPIs** (Total YTD net profit, Payouts taken, Ownership allocated, Capital balance, Break-even); **four partner cards** (initials, ownership, balance in danger colour while negative, progress to eligibility, "Not ready" chip); **Capital accounts table** [E] with columns Partner Name, Ownership Share, Gross Profit Share, Payouts Taken YTD, Ending Capital Balance + total row; **Profit distribution** donut with "Total 100 OK" chip; **Individual statement** [E] with partner tabs, opening capital, contributions, gross share, payouts, current balance and Download PDF / Send by email / Send by WhatsApp; **Payout planner** (payout day, minimum, auto-calc, next run, eligible count, plain-language note). New: **Where the loss comes from** (operating profit vs equipment bars), **Reconciliation across tabs** (Dashboard vs Partners vs Analytics net, differences), **Monthly profit share scenarios**, **Payout rules and alerts** toggles, **Capital and payout ledger** (reads `Movements`, empty state), **Ownership change history**, **Partner portal preview** (each partner sees only their statement; implement as a protected per-partner sheet or filtered view by email), **Capital call planner** (amount per partner, due date, reason, notify), **Payout approvals** with second sign-off, **Audit trail**.

### 4.11 Bills (`Bills`, over `Recurring_Bills`) [N view]
KPIs (Bills tracked, Due soon, Next bill, Monthly equivalent, Paid YTD). **Bills table** (bill, amount, every, next due, status chip "Not booked", "Mark paid" action that writes an expense), **Add a bill**, **Next 90 days** calendar blocks, **Margin impact** (as recorded 84% → with 65,000 accrued ≈ 58% → with full 130,000 ≈ 34%; formula: other operating costs implied by the 84% figure, plus the accrual or the full amount, over sales), **Reminders**. New: **Payment calendar sync** (Calendar events via Apps Script, `.ics` link), **Supplier price history** (bar per payment with % change), **Accrual automation** ("Book 65,000 a month" creates a monthly expense in the bill's category), **Audit trail**.

### 4.12 Reconcile (`Reconcile`) [N]
KPIs (Accounts, Open issues, Dashboard vs entries difference, Tolerance from Settings, Locked through). **Account reconciliation** (book balance, counted input, difference), **Steps** (count cash, confirm Centipid, clear checks, sign off and lock), **Checks** list (each with chip and "Open ›" link; same rules as `Issues`), **Sign-off card** (progress, "Sign off and lock <month>" button that writes the lock date to Settings). New: **Auto-match: Centipid CSV** (rows imported, matched to entries, entries without a CSV row, the row that causes any difference), **Variance explainer** (each difference with cause and action), **Closing certificate** (a printable summary with accounts counted, open issues, signed by, date), **Audit trail**.

### 4.13 Settings (six sheets) [U]
Every Settings sheet has: header, nav (Settings active), global bar, **sub-tab bar** (General · Finance · Rules · Data · Access · Releases, ink underline on active, right-aligned one-line description, "v3.1" info chip on Releases), a 5-card KPI strip, then a two-column card layout. Cards use eyebrow + 17px title + muted description + body rows (label left with optional muted description, control right). Input cells = accent-bg; toggles per section 2.

- **Settings (General):** Setup checklist (progress bar 86% + 7 rows with Done/Review chips; "Fix in Business profile ›" link on the Review row), Business profile (name, start date, reporting year, opening cash, opening Centipid, currency, entry form link), Format and regional (date format, week start, financial year start, time zone, thousands separators, compact chart labels), Setup score history [N].
- **Settings_Finance:** Income types and default account (Estimated split chip), Accounts (+ Add account), Movement types (locked order, kind in monospace and read-only), Expense categories (group chips: Operating / Equipment), Bills setup [N] (bill, amount, every, next due, accrue monthly), Category budgets [N] (limit, this month, warn at %, over-budget alert).
- **Settings_Rules:** Partners and profit shares (total must equal 100, OK chip, payout day, minimum payout, auto-calculate), Period locking and approvals (lock toggle, locked through, approval limit, fee tracking, default fee), Approval queue [N] (entry, amount, requested by, approve/reject), Targets and equipment (monthly sales target, expense ratio warning, payback target months, weak-day %, show equipment in margin, projected sales), Alerts and reminders (low cash, bill reminders, daily report delivery, send time, channel, missing-day warning, **Send test message** button [N]).
- **Settings_Data:** Data quality rules, Integrations and imports, Import history [N], Backup and export (daily backup toggle, time, copies, monthly export, last backup + Healthy chip, Back up now), Backup restore points [N] (list of copies with Restore), Sandbox mode [N] (create a copy, compare, apply).
- **Settings_Access:** Users and roles (user, assigned role dropdown, status, added), Role templates [N] (template, "can do n of 7", preview-as), Feature permissions (ALLOW/DENY chips per role; 7 features), Recent settings changes, Audit log detail [N] (old → new values, filters by type and user), Audit trail card.
- **Settings_Releases [N]:** Releases and upgrades (current version, channel Stable/Beta, auto-update, upgrade window, back up before upgrading, notify users, **Check for updates**), Upgrade readiness (checklist chips, **Upgrade now**, **Schedule**), Preview features (toggles: cash runway card, daily heatmap, category budgets, compare mode; "Beta" chip), Release notes, Release history and rollback (v3.1 available, v3 current, "Before v3.1" restore point with Roll back). Implement with a `Releases` sheet (version, date, status, notes) and an Apps Script that makes a full copy of the workbook into a Drive folder before any upgrade. "Upgrade now" is a documented manual step in this version (it opens the checklist and a link to the new template); do not auto-overwrite live data.

## 5. Formulas to implement (verify with the mock values)

- Net this month = sales – expenses (200,303). Margin = net ÷ sales (77.8%).
- Cash runway days = cash on hand ÷ average daily expenses this month (46,100 ÷ 2,280 ≈ 20).
- Month pace = day of month ÷ days in month (25/31 = 80.6%). Projected sales = month-to-date + days left × month average (319,676). Needed per day = (target – MTD) ÷ days left ((350,000 – 257,303) ÷ 6 = 15,449).
- Operating profit YTD = sales – operating costs (1,023,914 – 692,400 = 331,514; Analytics counts 1,024,414 because of the stray 500). Equipment recovered % = operating profit ÷ equipment invested (14.7%). Remaining = invested – operating profit. Break-even months = remaining ÷ monthly operating profit (12.3 at 157,000).
- Bandwidth margin impact: implied other costs = (1 – 84%) × sales; margin with accrual = 1 – (implied + 65,000) ÷ sales (≈ 58%); with the full 130,000 (≈ 34%).
- Unexplained funding = book balance – (sales YTD – expenses YTD + recorded movements) = 119,100 – (1,023,914 – 2,952,964 + 0) = 2,048,150.
- Compare deltas = current ÷ previous – 1. Anomaly = day sales < weak-day % × 14-day average (60% × 11,743 = 7,046).
- Loan payment = `PMT(rate/12, term, -principal)` (91,680 for the example).
- Set-aside planner = % × monthly operating profit. Debt capacity = 30% × monthly operating profit.

## 6. UX behaviour summary
- One click goes anywhere: every "›" text link is a hyperlink. Every number that is derived has a cell note stating its formula and source.
- Every list has an empty state in muted text with the next action (never blank).
- Input cells are the only editable cells; the rest is protected. Invalid input shows a validation message in the validation rule.
- Status is never colour-only: chips always carry text.
- Print/PDF: each view sheet has a print range B:N, portrait, fit to width, page breaks between card rows.
- Performance: avoid whole-column volatile references; use bounded ranges and a hidden `Calc` sheet for heavy aggregates.

## 7. Known data issues the redesign must surface (do not silently "fix")
1. **500 difference:** Dashboard sales 257,303 vs entries 257,803 (a "since start" 500 row). The Partners tab shows total net profit (1,929,550) against the Dashboard (1,929,050), so each 30% share is 150 off and the reserve 50 off.
2. **Unexplained funding:** the book balance (119,100) cannot be reached from sales and expenses (–1,929,050) with zero movements. 2,048,150 is unrecorded; likely partner capital in. Raise this in Movements and Reconcile.
3. **Estimated Centipid split:** 190 of 192 sales rows are CSV imports with an estimated 50/50 mobile money / cash split. Everything derived from the split must show an "Estimated split" chip until `Split_Actuals` is filled.
4. **Four days with no sales:** 23 to 26 July.
5. **Day-level mismatch:** the Dashboard shows today's sales as 21,500 while Analytics lists Sun 25 Oct as 22,000. Flag as a Review item; identify whether it is a late entry or the 500.
6. **Bandwidth not booked** this cycle (130,000 every two months), which inflates October margin (84% looks better than it is).
7. **Month comparison:** the insights use entries basis (257,803) for "+1.5% vs September" while KPIs use 257,303 (+1.3%). Pick one basis per card and label it.

## 8. Mock content that is a SAMPLE or an ESTIMATE (build the mechanism, not the value)
Setup score history (72%, 58%); release notes and the v3.1 release; audit "old → new" values; the 1,000,000 / 18% loan example; heatmap cells for days before 12 Oct (only 12 to 25 Oct have real daily values in the mock); month-pace curves for earlier months (straight lines between totals); July and September operating-cost and equipment split in Monthly P&L; the July sales ≈ 48,607 (derived); delivery status (Sent/Delivered/Read) before the first report; supplier names; estimated Centipid split numbers (128,652 / 128,651).

## 9. Build order and acceptance checks
**Order:** (1) tokens and shared styles (named ranges, Lists, Nav, Issues, Audit_Log) → (2) nav, header, global bar, footer on every sheet → (3) Dashboard → (4) Analytics → (5) Partners → (6) Settings sheets → (7) the nine new view sheets → (8) Reconcile and Issues rules → (9) Apps Script (forms, PDF, WhatsApp, calendar, backups) → (10) Mobile.
**Acceptance:** (a) every figure in the previews' **real** data matches the sheet within the tolerance in Settings; (b) nav fits on one line at 100% zoom and every link works; (c) no hard-coded numbers except Settings inputs; (d) all input cells are accent-bg and the rest is protected; (e) `Issues` reproduces the seven items in section 7 and the notification count equals the open rows; (f) each sheet prints to one page wide; (g) the old data tabs and the entry form still work; (h) a short changelog tab lists every sheet and named range added.

When finished, return: a list of sheets/ranges created, any item you could not implement with the reason, and the Apps Script files with triggers installed.
