# Finance Control v5.1 — Savings Ledger

v5.1 turns **Отложено** into a real money pocket with its own history instead of a single balance number.

## New in v5.1
- Tap the **Отложено** card (or `история →`) to open the savings ledger.
- Three savings actions: **Отложить / Вернуть / Потратить**.
- Transfers `Доступно ↔ Отложено` are internal movements and are not income/expense.
- **Потратить из отложенных** is a real expense, but it reduces only the saved pocket — not `Доступно сейчас`.
- Every savings movement has date, note, amount and **Остаток после**.
- Savings movements can be edited or deleted.
- Spending from savings has a normal expense category and appears in expense statistics.
- Monthly savings detail shows how much was added, returned and spent.
- Goal editing moved into the savings detail sheet while the progress remains visible on the card.
- Existing v5 data migrates automatically from `finance-control-v7` to `finance-control-v8`.

## Balance logic
`Общие деньги = Доступно сейчас + Отложено`

Moving €100 from available to saved changes only the split. Spending €100 from saved reduces total capital and monthly expenses by €100 while leaving available unchanged.

## Deploy
Upload the **contents** of this folder to the root of the existing GitHub Pages repository and replace the previous files. Then fully close and reopen the iPhone PWA once so the v5.1 service worker cache replaces v5.
