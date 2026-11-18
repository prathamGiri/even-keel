// QA scenario: covers every IDEA.json test_scenario plus edge cases.
module.exports = async (page, rawShot) => {
  const shot = async (n) => { await page.evaluate(() => document.getElementById('toast').classList.remove('on')); await page.waitForTimeout(300); return rawShot(n); };
  const w = (ms = 450) => page.waitForTimeout(ms);
  const ymd = (d) => d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
  const now = new Date(); now.setHours(12, 0, 0, 0);
  const plusDays = (n, base) => { const d = base ? new Date(base + 'T12:00:00') : new Date(now); d.setDate(d.getDate() + n); return ymd(d); };
  const plusMonths = (n) => { const d = new Date(now); d.setMonth(d.getMonth() + n); return ymd(d); };
  const assert = (c, m) => { if (!c) throw new Error('ASSERT: ' + m); };
  const state = () => page.evaluate(() => JSON.parse(JSON.stringify(EvenKeel.state())));
  const stored = () => page.evaluate(() => JSON.parse(localStorage.getItem('evenkeel.v1')));
  const moneyNum = (s) => parseFloat(String(s).replace(/[^0-9.]/g, ''));
  const bridge = () => page.evaluate(() => { window.__shared = []; window.__vib = 0; window.Android = { share: (t) => window.__shared.push(t), vibrate: () => { window.__vib++; }, toast: () => {} }; });
  const biweeklyCount = (from, due) => { let n = 0, p = from; while (p <= due) { n++; p = plusDays(14, p); } return n; };
  const log = [];

  // No network at any point
  const net = [];
  page.on('request', (r) => { if (!/^(file|data|about|blob):/.test(r.url())) net.push(r.url()); });

  await bridge();

  // Back on onboarding step 0 should not throw and returns false (let app exit)
  assert(await page.evaluate(() => window.onAndroidBack()) === false, 'back on welcome should return false');

  // ---------- Scenario 1: first run biweekly ----------
  await page.click('[data-act=ob-next]'); await w();
  await page.click('[data-act=ob-freq][data-val=biweekly]'); await w(200);
  // edge: past payday rejected
  await page.fill('#obPayday', plusDays(-5));
  await page.click('[data-act=ob-next]'); await w(200);
  assert(await page.isVisible('#obErr'), 'past payday should show error');
  await page.fill('#obPayday', plusDays(7));
  await shot('onboard-pay');
  // back handler steps back inside onboarding
  await page.click('[data-act=ob-next]'); await w();
  await page.evaluate(() => window.onAndroidBack()); await w(200);
  assert(await page.isVisible('#obPayday'), 'back returns to pay step');
  assert(await page.inputValue('#obPayday') === plusDays(7), 'payday kept after back');
  await page.click('[data-act=ob-next]'); await w();
  await shot('onboard-presets');
  await page.click('[data-act=ob-finish]'); await w(600);
  let st = await state();
  assert(st.settings.onboarded && st.settings.payFrequency === 'biweekly' && st.settings.nextPayday === plusDays(7), 'onboarding saved');
  await shot('home-empty');

  // Add bill: empty validation
  await page.click('#fab'); await w(500);
  await page.click('#fSave'); await w(200);
  assert(await page.isVisible('#fErr'), 'empty name error');
  await page.fill('#fName', 'Car insurance');
  await page.click('#fSave'); await w(200);
  assert((await page.textContent('#fErr')).includes('amount'), 'empty amount error');
  await page.fill('#fAmount', '1,200');
  await page.fill('#fDue', plusMonths(6));
  await w(200);
  const expN1 = biweeklyCount(plusDays(7), plusMonths(6));
  const expCar = Math.ceil(1200 / expN1);
  const prevTxt = await page.textContent('#fPreview');
  assert(prevTxt.includes('$' + expCar), 'live preview shows ' + expCar + ' got ' + prevTxt);
  await shot('add-bill');
  await page.click('#fSave'); await w(600);
  st = await state();
  assert(st.funds.length === 1 && st.funds[0].amount === 1200, 'car saved, comma amount parsed');
  const car = st.funds[0];
  let p = await page.evaluate((id) => EvenKeel.plan(id), car.id);
  log.push(['car', expN1, p.n, p.per]);
  assert(p.n === expN1 && p.per === expCar, `car per-paycheck expected ${expCar} over ${expN1}, got ${p.per} over ${p.n}`);
  let heroTxt = await page.textContent('#scr-home .hero .big');
  assert(moneyNum(heroTxt) === expCar, 'hero shows car total ' + heroTxt);

  // ---------- Scenario 2: Registration ----------
  await page.click('#fab'); await w(500);
  await page.fill('#fName', 'Registration');
  await page.fill('#fAmount', '180');
  await page.fill('#fDue', plusDays(21));
  await page.click('#fSave'); await w(600);
  st = await state();
  const reg = st.funds.find((f) => f.name === 'Registration');
  p = await page.evaluate((id) => EvenKeel.plan(id), reg.id);
  const expN2 = biweeklyCount(plusDays(7), plusDays(21));
  log.push(['reg', expN2, p.n, p.per, p.status]);
  assert(p.n === expN2 && p.per === Math.ceil(180 / expN2), 'registration per-paycheck');
  assert(p.status === 'soon' || p.status === 'behind', 'registration due-soon styling');
  assert(await page.locator(`.fund.soon[data-id="${reg.id}"], .fund.behind[data-id="${reg.id}"]`).count() === 1, 'registration card styled');
  const t2 = await page.evaluate(() => EvenKeel.totals());
  assert(t2.per === expCar + Math.ceil(180 / expN2), 'total sum of both');
  heroTxt = await page.textContent('#scr-home .hero .big');
  assert(moneyNum(heroTxt) === t2.per, 'hero shows sum');

  // Long name + huge amount edge
  await page.click('#fab'); await w(500);
  await page.fill('#fName', 'A really really long bill name that keeps going and going forever ok');
  await page.fill('#fAmount', '1234567.89');
  await page.fill('#fDue', plusMonths(11));
  await page.click('[data-seg=rep] [data-val=once]'); await w(100);
  await page.click('#fSave'); await w(600);
  st = await state();
  const longF = st.funds.find((f) => f.repeat.type === 'once');
  assert(longF && longF.name.length <= 60, 'long name clipped');
  await shot('home-long');
  // check no horizontal overflow on home
  const overflow = await page.evaluate(() => { const s = document.getElementById('scr-home'); return s.scrollWidth > s.clientWidth + 1; });
  assert(!overflow, 'home horizontal overflow');

  // Rapid FAB taps should leave exactly one sheet usable
  await page.evaluate(() => { const f = document.getElementById('fab'); f.click(); document.getElementById('sheetScrim').click(); f.click(); });
  await w(500);
  const sheetOk = await page.evaluate(() => !document.getElementById('sheet').hidden && !!document.getElementById('fName'));
  assert(sheetOk, 'sheet should be open with form after rapid open/close/open');
  await page.evaluate(() => window.onAndroidBack()); await w(400);
  assert(await page.evaluate(() => document.getElementById('sheet').hidden), 'back closes sheet');

  // delete the long one again (via detail) to keep later math simple
  await page.click(`.fund[data-id="${longF.id}"]`); await w(500);
  await page.click('#detail [data-act=delete]'); await w(300);
  await page.click('[data-act=dlg][data-i="1"]'); await w(500);
  st = await state();
  assert(st.funds.length === 2, 'deleted');

  // ---------- Scenario 3: Payday checklist ----------
  await page.click('.tab[data-tab=payday]'); await w(500);
  await shot('payday');
  const pdBefore = st.settings.nextPayday;
  const savedBefore = Object.fromEntries(st.funds.map((f) => [f.id, f.saved]));
  // rapid double-tap on tick = tick + untick
  await page.click(`[data-act=tick][data-id="${reg.id}"]`); await page.click(`[data-act=tick][data-id="${reg.id}"]`); await w(900);
  st = await state();
  assert(st.contributions.length === 0 && !st.paydaysCompleted.includes(pdBefore), 'double tap toggles off, no completion');
  await page.click(`[data-act=tick][data-id="${reg.id}"]`); await w(500);
  await shot('payday-ticked');
  st = await state();
  assert(st.contributions.length === 1, 'tick logs contribution');
  await page.click('[data-act=mark-all]'); await w(1400);
  await shot('payday-done');
  st = await state();
  assert(st.paydaysCompleted.includes(pdBefore), 'payday completed');
  assert(st.settings.nextPayday === plusDays(14, pdBefore), 'advanced to next biweekly payday');
  assert(st.contributions.length === 2, 'two contributions');
  st.funds.forEach((f) => assert(f.saved > savedBefore[f.id], 'saved went up for ' + f.name));
  assert(await page.evaluate(() => window.__vib) > 0, 'vibration called');
  await page.click('.tab[data-tab=home]'); await w(400);
  const lbl = await page.textContent('#scr-home .hero .lbl');
  assert(lbl.includes('in 21 days'), 'hero points to next payday: ' + lbl);
  const water = await page.getAttribute(`.fund[data-id="${car.id}"] .water i`, 'style');
  assert(!/width:0(\.0)?%/.test(water), 'progress bar moved');

  // ---------- Reload persistence ----------
  const beforeReload = await state();
  await page.reload(); await w(800); await bridge();
  const afterReload = await state();
  assert(JSON.stringify(afterReload) === JSON.stringify(beforeReload), 'state survives reload');
  assert(await page.isHidden('#onboard'), 'no onboarding after reload');

  // ---------- Scenario 5: Paid it ($20 less) ----------
  await page.click(`.fund[data-id="${car.id}"]`); await w(600);
  await shot('detail');
  await page.click('[data-act=paid]'); await w(400);
  const carSaved = (await state()).funds.find((f) => f.id === car.id).saved;
  // empty amount rejected
  await page.fill('#pAmt', '');
  await page.click('[data-act=dlg][data-i="1"]'); await w(200);
  assert(await page.isVisible('#pAmt'), 'empty paid amount keeps dialog open');
  await page.fill('#pAmt', String(carSaved - 20));
  await w(200);
  assert(!(await page.getAttribute('#pAmt', 'class')).includes('bad'), 'error border cleared after valid input');
  await shot('paid-dialog');
  await page.click('[data-act=dlg][data-i="1"]'); await w(600);
  st = await state();
  const carAfter = st.funds.find((f) => f.id === car.id);
  log.push(['afterPay', carAfter.nextDue, carAfter.saved]);
  assert(st.payments.length === 1 && st.payments[0].actual === carSaved - 20, 'payment recorded');
  const yr = new Date(car.nextDue + 'T12:00:00'); yr.setFullYear(yr.getFullYear() + 1);
  assert(carAfter.nextDue === ymd(yr), 'nextDue +1 year');
  assert(carAfter.saved === 20, 'surplus carried');
  await shot('detail-after-pay');
  await page.evaluate(() => window.onAndroidBack()); await w(400);
  assert(await page.isHidden('#detail'), 'back closes detail');

  // One-off fund gets archived
  await page.click('#fab'); await w(500);
  await page.fill('#fName', 'Dentist');
  await page.fill('#fAmount', '300');
  await page.fill('#fSaved', '300');
  await page.fill('#fDue', plusDays(10));
  await page.click('[data-seg=rep] [data-val=once]'); await w(100);
  await page.click('#fSave'); await w(600);
  st = await state();
  const dent = st.funds.find((f) => f.name === 'Dentist');
  await page.click(`.fund[data-id="${dent.id}"]`); await w(500);
  await page.click('[data-act=paid]'); await w(300);
  await page.click('[data-act=dlg][data-i="1"]'); await w(600);
  st = await state();
  assert(st.funds.find((f) => f.id === dent.id).archived, 'one-off archived');
  assert(await page.locator(`.fund[data-id="${dent.id}"]`).count() === 0, 'archived not listed');

  // ---------- Scenario 4: Skip a payday ----------
  await page.evaluate((d) => { const s = JSON.parse(localStorage.getItem('evenkeel.v1')); s.settings.nextPayday = d; s.funds.forEach((f) => { f.createdAt = '2020-01-01'; }); localStorage.setItem('evenkeel.v1', JSON.stringify(s)); }, plusDays(-3));
  await page.reload(); await w(800); await bridge();
  st = await state();
  log.push(['skip', st.settings.nextPayday, st.skipped]);
  assert(st.settings.nextPayday === plusDays(11), 'rolled forward to correct payday (got ' + st.settings.nextPayday + ')');
  assert(st.skipped.length === 1 && st.skipped[0] === plusDays(-3), 'skipped recorded');
  await page.click('.tab[data-tab=payday]'); await w(500);
  assert(await page.locator('#scr-payday .note').filter({ hasText: 'missed' }).count() === 1, 'catch-up note visible');
  assert(await page.locator('#scr-payday .up').count() >= 1, 'per-line catch-up shown');
  await shot('payday-catchup');

  // ---------- Scenario 6: semi-monthly ----------
  await page.click('.tab[data-tab=settings]'); await w(400);
  await page.click('[data-seg=freq] [data-val=semimonthly]'); await w(500);
  st = await state();
  const d = new Date(now); let expPd;
  if (d.getDate() <= 1) expPd = ymd(new Date(d.getFullYear(), d.getMonth(), 1, 12));
  else if (d.getDate() <= 15) expPd = ymd(new Date(d.getFullYear(), d.getMonth(), 15, 12));
  else expPd = ymd(new Date(d.getFullYear(), d.getMonth() + 1, 1, 12));
  log.push(['semi', st.settings.nextPayday, expPd]);
  assert(st.settings.nextPayday === expPd, 'semimonthly next payday ' + st.settings.nextPayday + ' vs ' + expPd);
  assert(await page.locator('#setSemi1').count() === 1, 'semi day pickers shown');
  for (const f of st.funds.filter((x) => !x.archived)) {
    // independently count 1st/15th paydays in [pd, due]
    let n = 0; const s = new Date(expPd + 'T12:00:00'), e = new Date(f.nextDue + 'T12:00:00');
    for (let x = new Date(s); x <= e; x.setDate(x.getDate() + 1)) if (x.getDate() === 1 || x.getDate() === 15) n++;
    const pl = await page.evaluate((id) => EvenKeel.plan(id), f.id);
    const rem = Math.max(0, f.amount - f.saved);
    const exp = rem <= 0 ? 0 : Math.min(rem, Math.ceil(rem / Math.max(1, n)));
    assert(pl.n === n && pl.per === exp, `semi recalculation for ${f.name}: n ${pl.n}/${n} per ${pl.per}/${exp}`);
  }
  assert(st.skipped.length === 0, 'schedule change clears skipped');
  await shot('settings');

  // ---------- Scenario 7: Calendar ----------
  await page.click('.tab[data-tab=calendar]'); await w(700);
  const cal = await page.evaluate(() => {
    const S = EvenKeel.state(); const t = new Date(); const out = [];
    for (let i = 0; i < 12; i++) { const y = t.getFullYear() + Math.floor((t.getMonth() + i) / 12), m = (t.getMonth() + i) % 12; out.push(y + '-' + String(m + 1).padStart(2, '0')); }
    return { keys: out, funds: S.funds.filter((f) => !f.archived) };
  });
  const sums = cal.keys.map(() => 0);
  for (const f of cal.funds) {
    let dd = f.nextDue;
    for (let g = 0; g < 50; g++) {
      const i = cal.keys.indexOf(dd.slice(0, 7)); if (i >= 0) sums[i] += f.amount;
      if (f.repeat.type === 'once' || dd.slice(0, 7) > cal.keys[11]) break;
      const x = new Date(dd + 'T12:00:00'); const day = x.getDate(); x.setDate(1); x.setMonth(x.getMonth() + f.repeat.every);
      x.setDate(Math.min(day, new Date(x.getFullYear(), x.getMonth() + 1, 0).getDate())); dd = ymd(x);
    }
  }
  const smoothExp = cal.funds.reduce((s, f) => s + (f.repeat.type === 'once' ? 0 : f.amount / f.repeat.every), 0);
  const smoothTxt = await page.textContent('#scr-calendar .tile:nth-child(2) .v');
  assert(Math.abs(moneyNum(smoothTxt) - Math.round(smoothExp)) <= 1, 'smoothed monthly ' + smoothTxt + ' vs ' + smoothExp);
  for (let i = 0; i < 12; i++) {
    const label = await page.getAttribute(`.bar[data-i="${i}"]`, 'aria-label');
    assert(Math.abs(moneyNum(label.split(' ').slice(1).join(' ')) - sums[i]) < 0.01, `month ${i} bar ${label} expected ${sums[i]}`);
  }
  const mi = sums.findIndex((s) => s > 0);
  await page.click(`.bar[data-i="${mi}"]`); await w(400);
  const items = await page.locator('.mPanel .mItem').count();
  assert(items >= 1, 'tapping month lists bills');
  const empty = sums.findIndex((s) => s === 0);
  if (empty >= 0) { await page.click(`.bar[data-i="${empty}"]`); await w(300); assert(await page.locator('.mPanel .mItem').count() === 0, 'empty month shows none'); await page.click(`.bar[data-i="${mi}"]`); await w(300); }
  await shot('calendar');

  // ---------- Scenario 9: Share ----------
  await page.click('.tab[data-tab=settings]'); await w(400);
  await page.click('#scr-settings [data-act=share]'); await w(300);
  const shared = await page.evaluate(() => window.__shared);
  assert(shared.length === 1, 'share bridge called');
  const txt = shared[0];
  assert(txt.includes('Car insurance') && txt.includes('Registration') && /%/.test(txt) && /move \$[\d,]+/.test(txt), 'share text readable: ' + txt);
  log.push(['share', txt]);

  // ---------- Scenario 8: Export -> reset -> import ----------
  const fullBefore = await state();
  await page.click('[data-act=export]'); await w(400);
  const json = await page.inputValue('#expTa');
  await shot('export');
  await page.evaluate(() => window.onAndroidBack()); await w(300);
  assert(await page.isHidden('#dialog'), 'back closes dialog');
  await page.click('[data-act=reset]'); await w(300);
  await page.click('[data-act=dlg][data-i="1"]'); await w(600);
  st = await state();
  assert(st.funds.length === 0 && (await stored()).funds.length === 0, 'reset');
  await page.click('[data-act=ob-next]'); await w(300);
  await page.click('[data-act=ob-next]'); await w(300);
  await page.click('[data-act=ob-finish]'); await w(500);
  await page.click('.tab[data-tab=settings]'); await w(300);
  // bad import keeps dialog + error
  await page.click('[data-act=import]'); await w(300);
  await page.fill('#impTa', 'not json');
  await page.click('[data-act=dlg][data-i="1"]'); await w(300);
  assert(await page.isVisible('#impErr'), 'bad import error');
  await page.fill('#impTa', json);
  await page.click('[data-act=dlg][data-i="1"]'); await w(500);
  st = await state();
  const strip = (s) => JSON.stringify({ ...s, settings: { ...s.settings, onboarded: true } });
  assert(strip(st) === strip(fullBefore), 'import fully restored state');
  await page.reload(); await w(800); await bridge();
  assert(strip(await state()) === strip(fullBefore), 'import persisted after reload');
  await page.click('.tab[data-tab=home]').catch(() => {}); await w(500);
  await shot('home-restored');

  // XSS-ish name
  await page.click('#fab'); await w(450);
  await page.fill('#fName', '<img src=x onerror=alert(1)> "quote"');
  await page.fill('#fAmount', '50');
  await page.click('#fSave'); await w(500);
  assert(await page.locator('#scr-home img').count() === 0, 'name escaped');

  // Fuller dashboard for screenshots
  for (const i of [2, 4, 5]) {
    await page.click('#fab'); await w(450);
    await page.click(`[data-act=preset-fill][data-i="${i}"]`); await w(150);
    if (i === 4) await page.fill('#fSaved', '900');
    await page.click('#fSave'); await w(500);
  }
  await page.evaluate(() => document.getElementById('scr-home').scrollTo(0, 0));
  await shot('home-full');
  await page.click('.tab[data-tab=calendar]'); await w(700);
  await shot('calendar-full');
  await page.click('.tab[data-tab=payday]'); await w(600);
  await shot('payday-full');
  // back from a tab goes home
  await page.evaluate(() => window.onAndroidBack()); await w(400);
  assert(await page.isVisible('#scr-home'), 'back from tab goes home');

  assert(net.length === 0, 'network requests: ' + net.join(', '));
  console.error(JSON.stringify(log, null, 1));
};
