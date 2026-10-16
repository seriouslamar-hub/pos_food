# Hardware

The POS runs in a web browser, so any device that runs a current Chrome or Edge works. Install the till, kitchen screen and pickup board as apps (Chrome menu → **Install**) so they open full screen and keep working offline.

## Tills

| Item               | Recommended                                                | Notes                                                                                                                                                              |
| ------------------ | ---------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Tablet or touch PC | 10" or larger, landscape, 1280×800 or more                 | Tested at 1280×800 and 1024×768. Android tablets with Chrome, Windows touch PCs with Chrome or Edge, iPad with Safari (printing is easier on Android and Windows). |
| Receipt printer    | 80 mm (or 58 mm) thermal, with a cash-drawer port          | Set as the device's default printer.                                                                                                                               |
| Cash drawer        | Any drawer that plugs into the receipt printer (RJ11/RJ12) | Opens when a receipt prints (printer driver setting).                                                                                                              |
| Network            | Wi-Fi or Ethernet                                          | The till keeps selling offline.                                                                                                                                    |

### Printer setup (Windows or ChromeOS)

1. Install the printer's driver and make it the default printer.
2. In the driver's paper settings, choose the roll width (80 mm or 58 mm, matching **Settings → Receipt paper width**) with no margins.
3. Turn on **open cash drawer** in the driver (often under "Peripherals" or "Cash drawer: open before printing"). A web page can't send the drawer command itself.
4. Start Chrome with `--kiosk-printing`, so receipts print without the print dialog:
   - Windows: add it to the shortcut's target.
   - ChromeOS: use a kiosk policy.
5. Print a test receipt and check the logo, order number, totals and the footer.

For direct ESC/POS printing (faster, and it opens the drawer itself), a QZ Tray driver is stubbed in `lib/printing.ts` for later.

## Kitchen display

- Any screen with a browser, 21" or larger, mounted where the cooks can read it. Touch makes bumping easy; a USB bump bar or keypad works too (keys 1–9 bump tickets, 0 recalls).
- Register it as a **KDS** device. Set its station (Grill, Fryer and so on) on the device, or open `/kds?station=Grill`.
- Turn screen sleep off. In Chrome, allow sound for the site, or start it with `--autoplay-policy=no-user-gesture-required` for alerts.

## Pickup board

- A TV with a small PC or stick (e.g. a Chromebox or an Android TV box with Chrome) in kiosk mode, opening `/pickup`.
- Register it as a **Pickup** device.

## Before opening

- [ ] Every till prints a receipt, opens the drawer and shows the right branch.
- [ ] The kitchen screen gets a test order within 2 seconds, and bumping moves it to the pickup board.
- [ ] Unplug the router: the till keeps selling and prints kitchen tickets, and the sales send when it's plugged back in.
