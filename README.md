# Finance Control v5 — UX Cleanup

Mobile-first personal finance PWA for GitHub Pages. v5 focuses on simplicity: fewer dashboard blocks, clearer debt/planning structure, recurring obligations, better transaction interaction on iPhone, and safer local persistence.

## What changed in v5

### Dashboard = daily cockpit
- Swipeable **Available / Saved** wallet cards remain.
- Dashboard is shorter: four key metrics only — monthly spending, safe/day, what you owe, what is owed to you.
- New **Next** card shows the nearest scheduled or minimum debt payment.
- Only the last 3 transactions are shown on Home.
- `Safe / day` now uses the **next salary date** when salary day is configured, not only calendar month-end.
- Safe/day reserves the protected cash floor, scheduled payments due before payday, and minimum debt payments due before payday.

### Debt Center
- `Debts` now has two views: **I owe** and **Owed to me**.
- Receivables no longer live in Plan.
- Closed debts are archived instead of disappearing.
- When a debt is fully paid, it moves into `Closed debts` with the closure date.
- Minimum debt payments automatically appear in Plan; no duplicate planned payment is required.

### Owed to me
When creating a receivable you can choose:
- **Just record it** — current balance is unchanged.
- **I am giving the money now** — available balance decreases, but this is not counted as lifestyle spending.

You can also tap an existing expense and choose **“Owed to me for this”**. The transaction becomes a receivable movement instead of normal spending.

### Plan / mandatory payments
- Plan now contains only future obligations.
- Payments can repeat: **Once / Monthly / Yearly**.
- Checking `Paid` creates the actual expense.
- For recurring payments, the next occurrence is created automatically.
- Automatic debt minimums are shown as a separate section.

### Transactions
- Transaction rows are tap-first; no hidden hover/press edit controls on iPhone.
- Tap a transaction to open a bottom sheet with details and relevant actions.
- History is grouped by date.
- Only 50 items render at first; `Show more` loads the next 50.
- Primary filters are `All / Expenses / Income`; secondary types are under `Filters`.

### Import
- Prepared Finance Control JSON import remains fully local.
- Bank CSV + AI import remains supported.
- Supabase/OpenAI technical configuration is collapsed under **AI / Supabase settings**.
- During bank import, Finance Control attempts to reconcile matching unpaid scheduled payments and receivables instead of duplicating them.

### Data safety
- Main storage remains local to the device/browser for compatibility with existing versions.
- v5 mirrors state into **IndexedDB** as a second local recovery snapshot when available.
- Settings shows when the last manual JSON backup was created.
- Existing v4.4 data migrates automatically.

## Navigation
- **Home** — today’s financial position.
- **Transactions** — history and import.
- **Debts** — I owe + owed to me.
- **Plan** — future mandatory payments.
- Tap the round **F** icon at top-left to open Settings.

## Deploy to GitHub Pages
Upload the **contents** of this folder to the root of your existing GitHub Pages repository, replacing the previous app files.

Important files:
- `index.html`
- `styles-v5.css`
- `app-v5.js`
- `ai-import-v5.css`
- `ai-import-v5.js`
- `manifest.webmanifest`
- `sw.js`
- icons
- `supabase/` if you use AI import

After GitHub Pages finishes deployment, fully close the installed iPhone PWA and open it again. v5 uses a new service-worker cache name so old v4 assets are removed automatically.

## Data migration
v5 stores the migrated state under `finance-control-v7` and automatically reads the previous `finance-control-v6` / older keys. Do not clear Safari website data during the update.

Before a major update, use **Settings → Export backup** once.
