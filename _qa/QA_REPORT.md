# QA Report: Even Keel

**Status: PASS.** `_qa/test/report.json` reports `"ok": true` with no JS errors. `assembleRelease` succeeded and produced `app-release.apk`, about 39 KB.

## What was tested (`_qa/scenario.js`, Playwright)
All 9 IDEA.json test scenarios, checked against independently computed values:
1. First run, biweekly pay with payday in 7 days. Car insurance $1,200 due in 6 months comes to 13 paychecks at **$93**. The live preview and the Home hero both show $93.
2. Registration $180 due in 3 weeks: 2 paychecks at $90, "Due soon" styling, and the total is the sum of both funds.
3. Payday checklist. A rapid double-tap toggles a line on and off. Ticking one line and then "Mark all moved" logs the contributions, raises the saved balances and progress bars, marks the payday complete, moves to the next payday (+14 days) and triggers the vibrate bridge.
4. Skipped payday (nextPayday 3 days in the past). The app rolls forward to the correct payday, records the skip, and shows the catch-up note and a per-line "+$X catch-up".
5. "Paid it" for $20 under budget. The payment is recorded, nextDue moves +1 year and the $20 surplus is carried over. A one-off fund is archived and hidden.
6. Switching to semi-monthly (1st/15th). The next payday is correct and every fund's paycheck count and per-paycheck amount match an independent day-by-day count.
7. Calendar. All 12 month bars match the independently summed totals, the smoothed figure equals the sum of amount ÷ repeat-months, tapping a month lists its bills, and an empty month lists none.
8. Data survives reload. Export JSON, reset, onboard again, import: the state is restored exactly and still survives another reload. Invalid JSON shows an error.
9. Share summary goes through `Android.share` with each fund, its %, and the "move $X" total. No network requests happened during the run.

Edge cases: empty name and empty amount validation, "1,200" comma parsing, a past payday rejected in onboarding, a 60+ character name clipped, a $1.2M amount with no horizontal overflow, an HTML/XSS name escaped, rapid open/close/open of the sheet, an empty paid amount rejected, and the Android back handler on onboarding, sheet, detail, dialog and tab.

## Bugs found and fixed
1. **Misleading catch-up note.** After a missed payday the checklist always said "Amounts went up" even when no fund's amount had changed, for example when every fund was created after the missed payday. The note now says that only when at least one line has a catch-up. Otherwise it says the funds are still on course.
2. **Wrong catch-up after a payment.** Missed paydays from before a fund's last payment were still counted toward that fund's catch-up. They are now excluded.
3. **Paid-it dialog error border stuck.** After entering an empty amount, the red error border stayed on even once a valid amount was typed. It now clears on input.

The scenario's skip test now backdates `createdAt` on the funds so a payday missed 3 days ago is realistic. A fund created today cannot have missed it.

## Known limitations
- Recording "Paid it" before the due date moves the next due date forward a full cycle from the original due date. This is intended: the payment counts as that occurrence paid early.
- One-off bills count toward "true monthly cost" as amount ÷ months until due.
- The release build failed twice because a OneDrive/Windows file lock blocked deleting `app/build/intermediates/incremental/packageRelease`. Removing that folder by hand fixed it.
