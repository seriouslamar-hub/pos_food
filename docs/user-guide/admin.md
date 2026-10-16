# Admin guide

## First-time setup (in this order)

1. **Branches:** name, timezone, currency, receipt header, footer and logo.
2. **Taxes:** each tax's rate, whether it's included in prices, and its tax category. Have your accountant confirm the rates.
3. **Payment methods:** turn on the ones you take, and say which need a reference number.
4. **Menu:**
   - categories, items (with images), modifier groups and extras, and meals (combos) with their slots, choices and upsizes
   - per-branch prices if they differ
   - **Load sample menu** fills an empty menu to try things out
5. **Ingredients, Recipes, Suppliers** for stock: what each item and extra uses.
6. **Staff:**
   - **Managers and admins** get an email login; a temporary password is shown once.
   - **Cashiers** only need a PIN.
7. **Devices:**
   - Add each till, kitchen screen and pickup board. The setup code is shown once.
   - On the device, open `/device/setup` and enter the code.
   - The Devices page shows which are online and which have sales waiting to send.
8. **Settings:**
   - auto-lock minutes and discount limits
   - receipt paper width
   - kitchen ticket colours and the cash alert amount
   - offline card payments
   - loyalty points (earn rate and value)
9. **Permissions:** what each role may do. The admin row can't be changed.

## Promotions

**Promotions → New promotion:**

- **Types:**
  - percent off
  - amount off
  - a fixed price per item
  - buy X get Y (the cheapest go free, or at a percentage off)
- **Limits:**
  - items or categories
  - dates, weekdays and a daily time window (each branch's own time)
  - branches, channels, order types and a minimum spend
  - a coupon code, and the most uses in total or per customer

**Priority** decides which goes first. A promotion that doesn't **stack** is used only on its own. The server works out every promotion again when the order is charged, so the till can't be tricked.

## Training mode

On a device's page, **Switch to training mode**.

- **What happens:** the device then sells into "Branch (training)". Staff use their own PINs, receipts say TRAINING, and nothing counts in the real branch's reports, cash, stock, customers' points or coupon limits.
- **Before you switch:** close any open shift on the device.
- **Practice days:** to sell in training, a training business day must be open. A manager opens it on the training till with their PIN.
- **Switching back:** **Back to live selling**.

## Reports

**Reports** with **All branches** compares branches. Each branch's tax, discounts and promotions are there too, plus CSV exports of sales, payments and tax for the accountant.

## Audit log

Every sensitive action, across all branches: who did it, who approved it, and what changed.
