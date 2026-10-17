# Quick start: using the whole system

One page per role, in the order a real day runs: admin sets up → manager
opens the day → cashiers sell → kitchen and pickup screens show progress →
manager closes the day.

**Live system:** https://pos-food-system.vercel.app
**Logins and PINs:** kept out of this file on purpose (this repo is public
on GitHub). See `docs/private/staff-logins.md` on your own computer, or ask
whoever set the system up.

Longer, role-specific guides: [admin.md](admin.md), [manager.md](manager.md),
[cashier.md](cashier.md).

---

## 1. Admin — one-time setup

Sign in at `/login` with your email and password → lands on `/admin`.

1. **Branches:** check address, phone, receipt header/footer and timezone are
   correct (Admin → Branches).
2. **Taxes:** add the rates your accountant confirms (Admin → Taxes). Until
   you do, prices are charged with no tax.
3. **Payment methods:** turn on cash, card and/or mobile money (Admin →
   Payment methods).
4. **Menu:** check items, prices and photos (Admin → Menu).
5. **Staff:** create managers and cashiers, set their PINs (Admin → Staff).
6. **Devices:** register the till, kitchen display and pickup board, and open
   each one's setup code on that device (Admin → Devices).
7. **Stock** (optional at first): ingredients, recipes and an opening count
   (Admin → Stock).

The **"Getting ready to open"** panel on the admin home page tracks all of
this and only disappears once every step is done.

Ongoing, as admin you also handle: changing the menu, adding staff, checking
the **audit log** (every void/refund/discount, who did it and who approved
it), and **reports** across all branches.

---

## 2. Manager — every morning and every night

Signs in to the back office the same way as admin (if given a login), or
with a PIN at the till.

**Morning**
1. Open the business day: back office **Business day → Open**, or on the
   till under **End of day → Open business day**.
2. Each cashier opens their own shift (see below) — the day has to be open
   first.

**During the day**
- Approves anything a cashier's PIN alone can't: void after the kitchen has
  it, refund, a discount bigger than the cashier's limit, opening the drawer
  without a sale, or changing a price. The till shows a PIN pad for this —
  the manager types their own PIN, not the cashier's.
- **Availability:** marks items out of stock (Manager → Availability or on
  the till). It greys out on every till within seconds.
- Watches the kitchen and the **Exceptions** page (voids, refunds, discounts
  by cashier).

**Night**
1. Each cashier closes their shift and does a blind cash count (they don't
   see what the system expects — that's deliberate).
2. Manager reviews each shift: counted vs. expected cash, **Approve** or
   **Flag** with a note (Manager → Business day).
3. **Close day** — this prints the Z report (the day's totals), kept under
   **Z reports**.

A business day can't close until every shift on it is closed.

---

## 3. Cashier — the till, order by order

1. Tap the till screen, type your **PIN**.
2. If it says the day isn't open, get a manager.
3. **Open shift**: count the float (starting cash) note by note, confirm.
4. Take orders:
   - Choose **Dine in**, **Takeaway** or **Delivery** (delivery asks for
     phone + address).
   - Tap a category, then an item. Items with sizes/extras/meals open a
     sheet — pick what the customer wants.
   - The cart on the right shows running totals; tap a line to change
     quantity, add a note, or remove it.
   - **Hold** parks an order under a name; **Recall** brings it back.
5. **Charge**:
   - Cash — tap a quick amount or type what was handed over; the till shows
     change.
   - Card/mobile money — take payment on the terminal/phone, then type the
     reference.
   - Split — part on one method, the rest on another.
6. Receipt prints automatically (or tap **Print receipt** / **Reprint
   last receipt**).
7. Mistakes: unsent items can be removed with no approval; anything after
   that (void, refund, big discount, no-sale) needs a manager's PIN.
8. **End of shift**: **Close my shift**, count the drawer blind, confirm.
   **X report** shows your shift's running totals any time before that.

If the internet drops, keep selling — the till saves everything locally and
sends it once the connection returns. A banner shows how many sales are
still waiting to sync. Shift close is blocked until that banner clears.

---

## 4. Kitchen display (KDS) — kitchen staff

No personal login; the screen itself is signed in as a device (set up once
by admin/manager at `/device/setup`).

- Paid orders appear automatically, split by station (fryer, grill, etc. —
  whatever each item is tagged with).
- Tap an item, or the whole ticket, to **bump** it as done. A bump bar
  (keys 1–9) works too if one's connected.
- Card changes colour as it waits longer (set in Admin → Settings).
- Voided items show struck through with an alert — stop preparing them.
- Once every station on an order is bumped, it moves to the pickup board.

---

## 5. Pickup board — customer-facing screen

No login; set up once as a device.

- **Preparing** / **Ready** columns with big order numbers.
- A number moves to Ready automatically once the kitchen finishes it.
- A chime can be turned on for new Ready numbers (Admin → Settings).
- Numbers clear themselves after collection, or after a few minutes either
  way.

---

## 6. Kiosk — self-order, in the restaurant only

No login; a device set up the same way as the till.

- Customers build their own order on a big touch screen.
- At checkout they say how they'll pay (cash, card or mobile money) — no
  online payment happens here. The order waits, unpaid, under its number
  until the counter takes the payment and sends it to the kitchen.

This system has no online ordering or delivery-app integration — everything
happens in the restaurant, by design.

---

## Who to call

- **Till, kitchen screen or pickup board acting up:** reload the page first
  (or close and reopen it if installed as an app). If that doesn't fix it,
  check Admin → Devices for "last seen" to confirm it's actually online.
- **A PIN doesn't work or needs resetting:** admin (or manager, for
  cashiers) does this from Admin/Manager → Staff.
- **A number looks wrong on a report or Z report:** check the **Audit log**
  first — every money-moving action is recorded there with who did it.
