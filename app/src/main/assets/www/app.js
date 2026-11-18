/* Even Keel — sinking funds for lumpy bills. Offline, vanilla JS. */
(function () {
  'use strict';

  var KEY = 'evenkeel.v1';
  var $ = function (s, r) { return (r || document).querySelector(s); };
  var $$ = function (s, r) { return Array.prototype.slice.call((r || document).querySelectorAll(s)); };
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function uid() { return Date.now().toString(36) + Math.random().toString(36).slice(2, 7); }
  function num(v) { var n = parseFloat(String(v == null ? '' : v).replace(/[^0-9.\-]/g, '')); return isFinite(n) ? n : NaN; }
  function r2(n) { return Math.round(n * 100) / 100; }

  /* ---------------- Dates (local, YYYY-MM-DD) ---------------- */
  var MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  var MONTHS_L = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
  var DOW = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  function pad(n) { return (n < 10 ? '0' : '') + n; }
  function ymd(d) { return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()); }
  function isYmd(s) { return typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s); }
  function parse(s) { var a = s.split('-'); return new Date(+a[0], +a[1] - 1, +a[2], 12); }
  function today() { return ymd(new Date()); }
  function addDays(s, n) { var d = parse(s); d.setDate(d.getDate() + n); return ymd(d); }
  function daysBetween(a, b) { return Math.round((parse(b) - parse(a)) / 864e5); }
  function dim(y, m) { return new Date(y, m + 1, 0).getDate(); }
  function addMonths(s, n, anchorDay) {
    var d = parse(s), day = anchorDay || d.getDate();
    var m = d.getMonth() + n, y = d.getFullYear() + Math.floor(m / 12);
    m = ((m % 12) + 12) % 12;
    return ymd(new Date(y, m, Math.min(day, dim(y, m)), 12));
  }
  function maxDate(a, b) { return a > b ? a : b; }
  function fmtDate(s) {
    var d = parse(s), t = parse(today());
    return DOW[d.getDay()] + ', ' + MONTHS[d.getMonth()] + ' ' + d.getDate() + (d.getFullYear() !== t.getFullYear() ? ', ' + d.getFullYear() : '');
  }
  function shortDate(s) {
    var d = parse(s), t = parse(today());
    return MONTHS[d.getMonth()] + ' ' + d.getDate() + (d.getFullYear() !== t.getFullYear() ? ' ’' + String(d.getFullYear()).slice(2) : '');
  }
  function relDays(n) {
    if (n === 0) return 'today';
    if (n === 1) return 'tomorrow';
    if (n === -1) return 'yesterday';
    if (n < 0) return Math.abs(n) + ' days ago';
    if (n < 60) return 'in ' + n + ' days';
    var m = Math.round(n / 30.44);
    return 'in ' + m + ' months';
  }
  function ordinal(n) { var s = ['th', 'st', 'nd', 'rd'], v = n % 100; return n + (s[(v - 20) % 10] || s[v] || s[0]); }

  /* ---------------- State ---------------- */
  var S;
  function defaultState() {
    return {
      settings: { currency: '$', payFrequency: 'biweekly', nextPayday: addDays(today(), 7), semiMonthlyDays: [1, 15], monthDay: parse(addDays(today(), 7)).getDate(), rounding: '1', carryOver: true, onboarded: false },
      funds: [], contributions: [], payments: [], paydaysCompleted: [], skipped: []
    };
  }
  function arr(a) { return Array.isArray(a) ? a : []; }
  // Ids are injected into HTML attributes; keep them to a safe charset (imported backups are untrusted).
  function safeId(v) { return String(v == null ? '' : v).replace(/[^\w-]/g, '').slice(0, 40); }
  function normFund(f) {
    f = f || {};
    var rep = f.repeat || {};
    var type = rep.type === 'once' ? 'once' : (rep.type === 'months' ? 'months' : 'yearly');
    var every = type === 'yearly' ? 12 : Math.max(1, Math.round(num(rep.every)) || 12);
    return {
      id: safeId(f.id) || uid(), name: String(f.name || 'Bill').slice(0, 60), icon: String(f.icon || '🧾'),
      amount: Math.max(0, num(f.amount) || 0), nextDue: isYmd(f.nextDue) ? f.nextDue : addMonths(today(), 6),
      repeat: { type: type, every: every }, saved: Math.max(0, num(f.saved) || 0), notes: String(f.notes || ''),
      createdAt: isYmd(f.createdAt) ? f.createdAt : today(), lastPaid: isYmd(f.lastPaid) ? f.lastPaid : '', archived: !!f.archived
    };
  }
  function normalize(o) {
    var d = defaultState();
    o = o && typeof o === 'object' ? o : {};
    var st = Object.assign({}, d.settings, o.settings || {});
    if (['weekly', 'biweekly', 'semimonthly', 'monthly'].indexOf(st.payFrequency) < 0) st.payFrequency = 'biweekly';
    if (!isYmd(st.nextPayday)) st.nextPayday = d.settings.nextPayday;
    var sd = arr(st.semiMonthlyDays).map(function (x) { return Math.min(31, Math.max(1, Math.round(num(x)) || 1)); });
    st.semiMonthlyDays = sd.length === 2 && sd[0] !== sd[1] ? sd.sort(function (a, b) { return a - b; }) : [1, 15];
    st.monthDay = Math.min(31, Math.max(1, Math.round(num(st.monthDay)) || parse(st.nextPayday).getDate()));
    if (['exact', '1', '5'].indexOf(String(st.rounding)) < 0) st.rounding = '1';
    st.rounding = String(st.rounding);
    st.currency = String(st.currency || '$').slice(0, 4);
    st.carryOver = st.carryOver !== false;
    st.onboarded = !!st.onboarded;
    return {
      settings: st,
      funds: arr(o.funds).map(normFund),
      contributions: arr(o.contributions).filter(function (c) { return c && c.fundId && isFinite(num(c.amount)); }).map(function (c) { return { id: safeId(c.id) || uid(), fundId: safeId(c.fundId), date: isYmd(c.date) ? c.date : today(), amount: num(c.amount), paydayKey: String(c.paydayKey || '') }; }),
      payments: arr(o.payments).filter(function (p) { return p && p.fundId; }).map(function (p) { return Object.assign({}, p, { fundId: safeId(p.fundId), actual: num(p.actual) || 0, budgeted: num(p.budgeted) || 0, date: isYmd(p.date) ? p.date : today() }); }),
      paydaysCompleted: arr(o.paydaysCompleted).filter(isYmd),
      skipped: arr(o.skipped).filter(isYmd)
    };
  }
  function load() {
    try { var raw = localStorage.getItem(KEY); if (raw) { S = normalize(JSON.parse(raw)); return; } } catch (e) { /* fall through */ }
    S = defaultState();
  }
  function save() { try { localStorage.setItem(KEY, JSON.stringify(S)); } catch (e) { /* storage full or blocked */ } }

  /* ---------------- Pay schedule engine ---------------- */
  var PER_YEAR = { weekly: 52, biweekly: 26, semimonthly: 24, monthly: 12 };
  var FREQ_LABEL = { weekly: 'Weekly', biweekly: 'Every 2 weeks', semimonthly: 'Twice a month', monthly: 'Monthly' };
  function firstDayOnOrAfter(date, days) {
    var d = parse(date), sorted = days.slice().sort(function (a, b) { return a - b; });
    for (var k = 0; k < 3; k++) {
      var y = d.getFullYear(), m = d.getMonth() + k;
      y += Math.floor(m / 12); m = m % 12;
      for (var i = 0; i < sorted.length; i++) {
        var c = ymd(new Date(y, m, Math.min(sorted[i], dim(y, m)), 12));
        if (c >= date) return c;
      }
    }
    return addDays(date, 14);
  }
  function nextPaydayAfter(d, st) {
    st = st || S.settings;
    switch (st.payFrequency) {
      case 'weekly': return addDays(d, 7);
      case 'monthly': return firstDayOnOrAfter(addDays(d, 1), [st.monthDay]);
      case 'semimonthly': return firstDayOnOrAfter(addDays(d, 1), st.semiMonthlyDays);
      default: return addDays(d, 14);
    }
  }
  // Number of paydays p with fromPayday <= p <= due
  function paycheckCount(fromPayday, due, st) {
    var n = 0, p = fromPayday;
    while (p <= due && n < 2000) { n++; p = nextPaydayAfter(p, st); }
    return n;
  }
  function rollForward() {
    var st = S.settings, t = today(), changed = false, guard = 0;
    while (st.nextPayday < t && guard++ < 500) {
      if (S.paydaysCompleted.indexOf(st.nextPayday) < 0 && S.skipped.indexOf(st.nextPayday) < 0) {
        // Only count it as skipped if there was something to move.
        if (activeFunds().some(function (f) { return f.amount - f.saved > 0.004; })) S.skipped.push(st.nextPayday);
      }
      st.nextPayday = nextPaydayAfter(st.nextPayday);
      changed = true;
    }
    if (S.skipped.length > 12) S.skipped = S.skipped.slice(-12);
    if (changed) save();
  }
  function roundUp(x) {
    if (x <= 0.004) return 0;
    var r = S.settings.rounding;
    if (r === 'exact') return Math.ceil(x * 100 - 1e-6) / 100;
    var step = r === '5' ? 5 : 1;
    return Math.ceil(x / step - 1e-9) * step;
  }
  function activeFunds() { return S.funds.filter(function (f) { return !f.archived; }); }
  function fundById(id) { for (var i = 0; i < S.funds.length; i++) if (S.funds[i].id === id) return S.funds[i]; return null; }
  function monthlyCost(f) {
    if (f.repeat.type === 'once') {
      var d = daysBetween(today(), f.nextDue);
      return f.amount / Math.max(1, Math.ceil(d / 30.44));
    }
    return f.amount / f.repeat.every;
  }
  function repeatLabel(rep) {
    if (rep.type === 'once') return 'One-off';
    if (rep.every === 12) return 'Yearly';
    if (rep.every === 6) return 'Every 6 months';
    if (rep.every === 3) return 'Quarterly';
    if (rep.every === 1) return 'Monthly';
    if (rep.every === 24) return 'Every 2 years';
    return 'Every ' + rep.every + ' months';
  }
  function contributedThis(fid, pd) {
    var s = 0;
    S.contributions.forEach(function (c) { if (c.fundId === fid && c.paydayKey === pd) s += c.amount; });
    return r2(s);
  }
  function need(remaining, n) { return remaining <= 0.004 ? 0 : Math.min(r2(remaining), roundUp(remaining / Math.max(1, n))); }

  function plan(f) {
    var st = S.settings, t = today(), pd = st.nextPayday;
    var remaining = Math.max(0, r2(f.amount - f.saved));
    var n = paycheckCount(pd, f.nextDue);
    var daysLeft = daysBetween(t, f.nextDue);
    var done = contributedThis(f.id, pd);
    var per = done > 0 ? done : need(remaining, n);
    // Catch-up: compare to the amount had the skipped paydays been used.
    var catchUp = 0, missed = 0;
    if (!done && remaining > 0) {
      missed = S.skipped.filter(function (d) { return d >= f.createdAt && (!f.lastPaid || d > f.lastPaid) && d <= f.nextDue; }).length;
      if (missed) catchUp = Math.max(0, r2(per - need(remaining, n + missed)));
    }
    // Expected balance on a straight-line plan since this cycle started.
    var cycleStart = f.repeat.type === 'once' ? f.createdAt : addMonths(f.nextDue, -f.repeat.every);
    var start = maxDate(maxDate(cycleStart, f.createdAt), f.lastPaid || '0000-00-00');
    var span = Math.max(1, daysBetween(start, f.nextDue));
    var frac = Math.min(1, Math.max(0, daysBetween(start, t) / span));
    var expected = f.amount * frac;
    var status;
    if (remaining <= 0.004) status = 'ready';
    else if (daysLeft < 0) status = 'overdue';
    else if (daysLeft <= 30) status = 'soon';
    else if (f.saved + (done ? 0 : per) + 0.5 < expected || catchUp > 0) status = 'behind';
    else status = 'ontrack';
    var pct = f.amount > 0 ? Math.min(1, f.saved / f.amount) : 1;
    return { remaining: remaining, n: n, per: per, done: done > 0, catchUp: catchUp, missed: missed, daysLeft: daysLeft, status: status, pct: pct, monthly: monthlyCost(f), shortBy: n === 0 ? remaining : 0 };
  }
  var STATUS_LABEL = { ready: 'Ready', overdue: 'Due now', soon: 'Due soon', behind: 'Behind', ontrack: 'On track' };

  function totals() {
    var funds = activeFunds(), per = 0, moved = 0, monthly = 0, saved = 0, target = 0, items = [];
    funds.forEach(function (f) {
      var p = plan(f);
      monthly += p.monthly; saved += Math.min(f.saved, f.amount); target += f.amount;
      if (p.per > 0) { per += p.per; if (p.done) moved += p.per; items.push({ f: f, p: p }); }
    });
    items.sort(function (a, b) { return a.f.nextDue < b.f.nextDue ? -1 : 1; });
    return { per: r2(per), moved: r2(moved), monthly: monthly, perPaycheck: monthly * 12 / PER_YEAR[S.settings.payFrequency], funded: target > 0 ? saved / target : 0, saved: saved, target: target, items: items, count: funds.length };
  }

  function projectPaydays(k) {
    var sim = activeFunds().map(function (f) { return { f: f, saved: f.saved, due: f.nextDue, dead: false }; });
    var pd = S.settings.nextPayday, out = [];
    for (var i = 0; i < k; i++) {
      var total = 0;
      sim.forEach(function (x) {
        if (x.dead) return;
        if (i === 0) { var p = plan(x.f); total += p.per; if (!p.done) x.saved += p.per; return; }
        var g = 0;
        while (x.due < pd && g++ < 50) {
          if (x.f.repeat.type === 'once') { x.dead = true; return; }
          x.due = addMonths(x.due, x.f.repeat.every); x.saved = 0;
        }
        var per = need(Math.max(0, x.f.amount - x.saved), paycheckCount(pd, x.due));
        x.saved += per; total += per;
      });
      out.push({ date: pd, total: r2(total) });
      pd = nextPaydayAfter(pd);
    }
    return out;
  }

  /* ---------------- Formatting ---------------- */
  function money(n, opts) {
    opts = opts || {};
    var c = S.settings.currency, neg = n < 0;
    n = Math.abs(n);
    var cents = opts.cents || (!opts.whole && Math.round(n * 100) % 100 !== 0);
    if (opts.whole) n = Math.round(n);
    var s = n.toLocaleString('en-US', { minimumFractionDigits: cents ? 2 : 0, maximumFractionDigits: cents ? 2 : 0 });
    return (neg ? '−' : '') + c + s;
  }
  function moneyBig(n) {
    var s = money(n), c = S.settings.currency;
    return '<small>' + esc(c) + '</small>' + esc(s.replace(c, ''));
  }

  /* ---------------- Native bridge ---------------- */
  function buzz(ms) { try { if (window.Android && window.Android.vibrate) window.Android.vibrate(ms); } catch (e) { /* noop */ } }
  var toastTimer;
  function toast(msg) {
    var t = $('#toast');
    t.textContent = msg; t.classList.add('on');
    clearTimeout(toastTimer); toastTimer = setTimeout(function () { t.classList.remove('on'); }, 2400);
  }
  function shareText(text, title) {
    try { if (window.Android && window.Android.share) { window.Android.share(text); return; } } catch (e) { /* fall back */ }
    openDialog({
      title: title || 'Share',
      body: '<p>Sharing isn’t available here — copy the text below instead.</p><textarea class="inp code" readonly id="shareTa">' + esc(text) + '</textarea>',
      actions: [{ label: 'Close', cls: 'ghost' }, { label: 'Copy', keep: true, onClick: function () { copyText($('#shareTa')); } }]
    });
  }
  function copyText(ta) {
    var v = ta.value;
    ta.removeAttribute('readonly'); ta.select();
    var ok = false;
    try { ok = document.execCommand('copy'); } catch (e) { ok = false; }
    ta.setAttribute('readonly', '');
    if (!ok && navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(v).then(function () { toast('Copied to clipboard'); }, function () { toast('Select the text and copy it manually'); });
      return;
    }
    toast(ok ? 'Copied to clipboard' : 'Select the text and copy it manually');
  }

  /* ---------------- Presets & icons ---------------- */
  function nextMonthDay(m, d) {
    var y = parse(today()).getFullYear();
    var c = ymd(new Date(y, m, d, 12));
    if (c <= today()) c = ymd(new Date(y + 1, m, d, 12));
    return c;
  }
  var PRESETS = [
    { icon: '🚗', name: 'Car registration', amount: 180, every: 12, due: function () { return addMonths(today(), 4); } },
    { icon: '🛡️', name: 'Car insurance', amount: 1200, every: 12, due: function () { return addMonths(today(), 6); } },
    { icon: '🎁', name: 'Christmas & gifts', amount: 800, every: 12, due: function () { return nextMonthDay(11, 15); } },
    { icon: '📺', name: 'Annual subscriptions', amount: 140, every: 12, due: function () { return addMonths(today(), 3); } },
    { icon: '🏠', name: 'Property tax', amount: 2400, every: 6, due: function () { return addMonths(today(), 5); } },
    { icon: '🐾', name: 'Vet checkup', amount: 250, every: 12, due: function () { return addMonths(today(), 8); } },
    { icon: '🎒', name: 'Back-to-school', amount: 400, every: 12, due: function () { return nextMonthDay(7, 10); } },
    { icon: '✈️', name: 'Summer holiday', amount: 1500, every: 12, due: function () { return nextMonthDay(6, 1); } }
  ];
  var ICONS = ['🧾', '🚗', '🛡️', '🎁', '📺', '🏠', '🐾', '🎒', '✈️', '🏥', '🦷', '👓', '💡', '📱', '💻', '🎓', '🎄', '🎂', '💍', '🔧', '🏍️', '🐶', '🏋️', '🌱', '⚽', '🎫', '🧯', '🚙'];
  var CURRENCIES = ['$', '€', '£', '₹', '¥', 'A$', 'C$'];
  var ICON_GUESS = [
    [/insur|policy|cover/, '🛡️'], [/regist|rego|car|auto|vehicle|tyre|tire|mot\b|smog/, '🚗'], [/christmas|xmas|gift|holiday gift/, '🎁'],
    [/netflix|spotify|prime|subscri|stream|disney|hulu|youtube/, '📺'], [/property|council|tax|rates|hoa|mortgage|home|house|rent/, '🏠'],
    [/vet|pet|cat\b/, '🐾'], [/dog/, '🐶'], [/school|tuition|uni|college|course/, '🎒'], [/holiday|vacation|trip|flight|travel/, '✈️'],
    [/dent/, '🦷'], [/doctor|medical|health|checkup|hospital/, '🏥'], [/glasses|optical|eye|contact/, '👓'], [/electric|power|gas|water|utility/, '💡'],
    [/phone|mobile/, '📱'], [/laptop|computer|software|domain|hosting|icloud|cloud/, '💻'], [/birthday/, '🎂'], [/wedding|anniversary/, '💍'],
    [/gym|fitness|sport/, '🏋️'], [/repair|service|maint/, '🔧'], [/ticket|concert|festival/, '🎫'], [/motorbike|motorcycle/, '🏍️']
  ];
  function guessIcon(name) {
    var n = String(name || '').toLowerCase();
    for (var i = 0; i < ICON_GUESS.length; i++) if (ICON_GUESS[i][0].test(n)) return ICON_GUESS[i][1];
    return '🧾';
  }
  var CHECK_SVG = '<svg viewBox="0 0 24 24"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg>';
  function wavesSvg() {
    var p = 'M0 40 Q100 18 200 40 T400 40 T600 40 T800 40 V80 H0Z';
    return '<div class="waves"><svg class="w1" viewBox="0 0 800 80" preserveAspectRatio="none"><path d="' + p + '"/></svg><svg class="w2" viewBox="0 0 800 80" preserveAspectRatio="none"><path d="M0 46 Q100 28 200 46 T400 46 T600 46 T800 46 V80 H0Z"/></svg></div>';
  }
  var LOGO = '<svg class="logo" viewBox="0 0 120 120"><defs><linearGradient id="lg" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#1D3F44"/><stop offset="1" stop-color="#10221F"/></linearGradient></defs><circle cx="60" cy="60" r="58" fill="url(#lg)" stroke="rgba(255,255,255,.12)"/><path d="M61 24v34h22z" fill="#4FD1A5"/><path d="M57 31v27H40z" fill="#A8F0D6"/><rect x="57.5" y="22" width="3" height="41" rx="1" fill="#E8F2EF"/><path d="M35 66h50l-7 10H42z" fill="#E8F2EF"/><path d="M26 84q8.5-5 17 0t17 0 17 0 17 0v5q-8.5-5-17 0t-17 0-17 0-17 0z" fill="#4FD1A5"/><path d="M34 93q6.5-4 13 0t13 0 13 0 13 0v4q-6.5-4-13 0t-13 0-13 0-13 0z" fill="#2E8C70"/></svg>';

  /* ---------------- Navigation ---------------- */
  var ui = { tab: 'home', detailId: null, calSel: null, justCompleted: null, obStep: 0, ob: null };
  var stack = []; // overlay close functions, topmost last

  function setTab(tab) {
    if (ui.tab === tab) { var sc = $('#scr-' + tab); sc.scrollTo({ top: 0, behavior: 'smooth' }); return; }
    ui.tab = tab;
    $$('.tab').forEach(function (b) { b.classList.toggle('active', b.getAttribute('data-tab') === tab); });
    $$('.screen').forEach(function (s) { var on = s.getAttribute('data-tab') === tab; s.hidden = !on; if (on) { s.classList.remove('enter'); void s.offsetWidth; s.classList.add('enter'); s.scrollTop = 0; } });
    if (tab !== 'payday') ui.justCompleted = null;
    render();
  }

  function render() {
    rollForward();
    var t = totals();
    var dot = $('#payDot');
    dot.hidden = !(t.per - t.moved > 0 && daysBetween(today(), S.settings.nextPayday) <= 0);
    if (ui.tab === 'home') renderHome(t);
    else if (ui.tab === 'payday') renderPayday(t);
    else if (ui.tab === 'calendar') renderCalendar(t);
    else renderSettings(t);
    if (ui.detailId) renderDetail();
  }

  /* ---------------- Home ---------------- */
  function greeting() { var h = new Date().getHours(); return h < 12 ? 'Good morning' : h < 18 ? 'Good afternoon' : 'Good evening'; }
  function fundCard(f) {
    var p = plan(f);
    var perTxt = p.status === 'ready' ? '<b class="mint">Funded</b><span>ready to pay</span>'
      : '<b class="num">' + money(p.per) + '</b><span>' + (p.done ? 'moved ✓' : 'this payday') + '</span>';
    return '<button class="fund ' + p.status + '" data-act="open" data-id="' + f.id + '">' +
      '<div class="r1"><div class="ico">' + esc(f.icon) + '</div><div class="grow"><div class="nm">' + esc(f.name) + '</div>' +
      '<div class="meta">Due ' + shortDate(f.nextDue) + ' · ' + relDays(p.daysLeft) + '</div></div><div class="pp">' + perTxt + '</div></div>' +
      '<div class="water ' + p.status + '"><i style="width:' + (p.pct * 100).toFixed(1) + '%"></i></div>' +
      '<div class="r2"><span class="num">' + money(f.saved) + ' of ' + money(f.amount) + '</span><span class="badge ' + p.status + '">' + STATUS_LABEL[p.status] + '</span></div></button>';
  }
  function renderHome(t) {
    var st = S.settings, pdIn = daysBetween(today(), st.nextPayday);
    var h = '<div class="top"><div><div class="eyebrow">' + greeting() + '</div><h1>Even Keel</h1></div>' +
      '<button class="iconBtn" data-act="share" aria-label="Share summary"><svg viewBox="0 0 24 24"><path d="M12 15V3M7 8l5-5 5 5"/><path d="M5 13v6a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-6"/></svg></button></div>';
    if (!t.count) {
      h += '<div class="hero"><div class="lbl">Next payday ' + relDays(pdIn) + ' · ' + fmtDate(st.nextPayday) + '</div>' +
        '<div class="big num">' + moneyBig(0) + '</div><div class="desc">Add the bills that don’t arrive every month. We’ll tell you exactly what to set aside each payday.</div>' +
        '<div class="cta"><button class="btn" data-act="add"><svg viewBox="0 0 24 24"><path d="M12 5v14M5 12h14"/></svg>Add a lumpy bill</button></div>' + wavesSvg() + '</div>';
      h += '<div class="secHead"><h2>Quick add</h2><span>tap to customise</span></div><div class="chips left" style="margin-bottom:18px">' +
        PRESETS.map(function (p, i) { return '<button class="chip" data-act="preset-add" data-i="' + i + '">' + p.icon + ' ' + esc(p.name) + '</button>'; }).join('') + '</div>';
      h += '<div class="empty"><div class="e">⚓</div><h3>No surprise bills on deck</h3><p>Car registration, annual insurance, Christmas, property tax… list them once and stay on an even keel all year.</p></div>';
      $('#scr-home').innerHTML = h; return;
    }
    var remainingThis = r2(t.per - t.moved);
    var lbl = pdIn === 0 ? '<span class="pill">Payday is today</span>' : 'Next payday ' + relDays(pdIn) + ' · ' + fmtDate(st.nextPayday);
    h += '<div class="hero"><div class="lbl">' + lbl + '</div>' +
      '<div class="big num">' + moneyBig(remainingThis > 0 ? remainingThis : t.per) + '</div>' +
      '<div class="desc">' + (t.per === 0 ? 'Every fund is topped up. Nothing to move this payday.' : remainingThis > 0 ? (t.moved > 0 ? 'still to set aside (' + money(t.moved) + ' already moved)' : 'to set aside for ' + t.items.length + ' fund' + (t.items.length === 1 ? '' : 's') + ' this payday') : 'all moved for this payday — nice.') + '</div>' +
      (S.skipped.length ? '<div class="lbl" style="margin-top:10px"><span class="pill amber">↑ Catching up after ' + S.skipped.length + ' missed payday' + (S.skipped.length > 1 ? 's' : '') + '</span></div>' : '') +
      '<div class="cta"><button class="btn small" data-act="tab" data-tab="payday">Open payday checklist →</button></div>' + wavesSvg() + '</div>';
    h += '<div class="stats"><div class="tile"><div class="k">True cost</div><div class="v num">' + money(t.monthly, { whole: true }) + '<small>/mo</small></div><div class="s num">' + money(t.perPaycheck, { whole: true }) + ' per paycheck</div></div>' +
      '<div class="tile"><div class="k">Funded</div><div class="v num">' + Math.round(t.funded * 100) + '<small>%</small></div><div class="water" style="margin-top:8px"><i style="width:' + (t.funded * 100).toFixed(1) + '%"></i></div></div></div>';
    h += '<div class="secHead"><h2>Your funds</h2><span>' + t.count + ' · by due date</span></div>';
    activeFunds().slice().sort(function (a, b) { return a.nextDue < b.nextDue ? -1 : a.nextDue > b.nextDue ? 1 : 0; }).forEach(function (f) { h += fundCard(f); });
    var arch = S.funds.filter(function (f) { return f.archived; }).length;
    if (arch) h += '<p class="meta" style="text-align:center;margin-top:12px">✓ ' + arch + ' one-off bill' + (arch > 1 ? 's' : '') + ' paid off and archived</p>';
    $('#scr-home').innerHTML = h;
  }

  /* ---------------- Payday ---------------- */
  function renderPayday(t) {
    var st = S.settings, pd = st.nextPayday, pdIn = daysBetween(today(), pd);
    var h = '<div class="top"><div><div class="eyebrow">' + (pdIn === 0 ? 'Today' : 'Next payday · ' + relDays(pdIn)) + '</div><h1>Payday checklist</h1></div></div>';
    if (ui.justCompleted) {
      var jc = ui.justCompleted;
      h += '<div class="celebrate"><div class="bigCheck">' + CHECK_SVG + '</div><h3>' + money(jc.total) + ' moved</h3><p>' + shortDate(jc.date) + ' payday complete. Next one is ' + fmtDate(pd) + '.</p>' + wavesSvg() + '</div>';
    }
    if (!t.count) {
      h += '<div class="empty"><div class="e">💸</div><h3>Nothing to move yet</h3><p>Add a lumpy bill and this screen turns into a one-tap payday routine.</p><button class="btn" data-act="add">Add a bill</button></div>';
      $('#scr-payday').innerHTML = h; return;
    }
    var allDone = t.items.length > 0 && t.items.every(function (x) { return x.p.done; });
    h += '<div class="hero payHero"><div class="lbl">' + fmtDate(pd) + '</div>' +
      '<div class="desc" style="margin-top:6px">Move to savings ' + (pdIn === 0 ? 'today' : pdIn < 0 ? 'now' : 'on payday') + '</div>' +
      '<div class="big num">' + moneyBig(t.per) + '</div>' +
      (t.per > 0 ? '<div class="prog"><div class="tx num"><span>' + money(t.moved) + ' moved</span><span>' + money(Math.max(0, t.per - t.moved)) + ' left</span></div><div class="water"><i style="width:' + (t.per ? (t.moved / t.per * 100) : 0).toFixed(1) + '%"></i></div></div>' : '') +
      wavesSvg() + '</div>';
    if (S.skipped.length) {
      h += '<div class="note"><span class="e">↑</span><div>You missed the <b>' + S.skipped.map(shortDate).join(', ') + '</b> payday' + (S.skipped.length > 1 ? 's' : '') + '. ' + (t.items.some(function (x) { return x.p.catchUp > 0; }) ? 'Amounts went up so every fund still lands on time.' : 'Your funds are still on course — no catch-up needed.') + '</div></div>';
    }
    if (pdIn > 0 && t.per > 0) h += '<div class="note info"><span class="e">ℹ️</span><div>Payday hasn’t arrived yet — you can still move money early and tick it off.</div></div>';
    if (t.per === 0) {
      h += '<div class="empty" style="margin-bottom:14px"><div class="e">🎉</div><h3>All funds are topped up</h3><p>Nothing to set aside this payday.</p><button class="btn soft" data-act="complete-empty">Mark payday done</button></div>';
    } else {
      h += '<div class="secHead"><h2>Transfers</h2><span>tap to tick off</span></div>';
      t.items.forEach(function (x) {
        var f = x.f, p = x.p;
        var meta = 'Due ' + shortDate(f.nextDue) + ' · ' + (p.n <= 1 ? (p.n === 0 ? 'before this payday' : 'last paycheck') : p.n + ' paychecks left');
        if (p.catchUp > 0) meta += '<br><span class="up">↑ +' + money(p.catchUp) + ' catch-up</span>';
        else if (p.n === 0 && !p.done) meta += '<br><span class="up" style="color:var(--coral)">Short ' + money(p.remaining) + ' — top up now</span>';
        h += '<button class="line' + (p.done ? ' done' : '') + '" data-act="tick" data-id="' + f.id + '"><span class="check">' + CHECK_SVG + '</span>' +
          '<span class="ico">' + esc(f.icon) + '</span><span class="grow"><div class="nm">' + esc(f.name) + '</div><div class="meta">' + meta + '</div></span>' +
          '<span class="amt num">' + money(p.per) + '</span></button>';
      });
      h += '<button class="btn block" data-act="mark-all" style="margin:6px 0 4px"' + (allDone ? ' disabled' : '') + '>' + CHECK_SVG.replace('<svg', '<svg style="stroke:#06231A"') + 'Mark all moved</button>';
    }
    var proj = projectPaydays(5).slice(1);
    if (proj.length) {
      h += '<div class="secHead" style="margin-top:18px"><h2>Coming up</h2><span>if you stay on plan</span></div><div class="upc">' +
        proj.map(function (x) { return '<div class="hi"><span>' + fmtDate(x.date) + '</span><b class="num">' + money(x.total) + '</b></div>'; }).join('') + '</div>';
    }
    $('#scr-payday').innerHTML = h;
  }
  function addContribution(f, amount, pd) {
    S.contributions.push({ id: uid(), fundId: f.id, date: today(), amount: amount, paydayKey: pd });
    f.saved = r2(f.saved + amount);
  }
  function toggleTick(id) {
    var f = fundById(id); if (!f) return;
    var pd = S.settings.nextPayday, done = contributedThis(id, pd);
    if (done > 0) {
      S.contributions = S.contributions.filter(function (c) { return !(c.fundId === id && c.paydayKey === pd); });
      f.saved = Math.max(0, r2(f.saved - done));
      buzz(10);
    } else {
      var p = plan(f); if (p.per <= 0) return;
      addContribution(f, p.per, pd);
      buzz(25);
    }
    save(); render();
    var t = totals();
    if (t.items.length && t.items.every(function (x) { return x.p.done; })) setTimeout(function () {
      // Re-check: the user may have un-ticked a line in the meantime.
      var t2 = totals();
      if (t2.items.length && t2.items.every(function (x) { return x.p.done; })) completePayday(t2.moved);
    }, 650);
  }
  function markAll() {
    var pd = S.settings.nextPayday;
    totals().items.forEach(function (x) { if (!x.p.done) addContribution(x.f, x.p.per, pd); });
    buzz(40); save(); render();
    setTimeout(function () {
      var t2 = totals();
      if (t2.items.every(function (x) { return x.p.done; })) completePayday(t2.moved);
    }, 700);
  }
  function completePayday(total) {
    var pd = S.settings.nextPayday;
    if (S.paydaysCompleted.indexOf(pd) >= 0) return;
    S.paydaysCompleted.push(pd);
    if (S.paydaysCompleted.length > 200) S.paydaysCompleted = S.paydaysCompleted.slice(-200);
    S.skipped = [];
    S.settings.nextPayday = nextPaydayAfter(pd);
    ui.justCompleted = { date: pd, total: total };
    save(); buzz(60);
    toast('Payday logged — you’re on an even keel');
    if (ui.tab === 'payday') { $('#scr-payday').scrollTop = 0; }
    render();
  }

  /* ---------------- Calendar ---------------- */
  function calendarData() {
    var t = parse(today());
    var months = [];
    for (var i = 0; i < 12; i++) {
      var y = t.getFullYear() + Math.floor((t.getMonth() + i) / 12), m = (t.getMonth() + i) % 12;
      months.push({ y: y, m: m, key: y + '-' + pad(m + 1), total: 0, bills: [] });
    }
    var startKey = months[0].key + '-01', endKey = months[11].key + '-31';
    activeFunds().forEach(function (f) {
      var d = f.nextDue, g = 0;
      while (d <= endKey && g++ < 400) {
        if (d >= startKey) {
          var k = d.slice(0, 7);
          for (var j = 0; j < 12; j++) if (months[j].key === k) { months[j].total += f.amount; months[j].bills.push({ f: f, date: d }); }
        }
        if (f.repeat.type === 'once') break;
        d = addMonths(d, f.repeat.every);
      }
    });
    var smooth = activeFunds().reduce(function (s, f) { return s + monthlyCost(f); }, 0);
    return { months: months, smooth: smooth };
  }
  function renderCalendar() {
    var cd = calendarData(), months = cd.months, smooth = cd.smooth;
    var h = '<div class="top"><div><div class="eyebrow">Next 12 months</div><h1>Ouch months</h1></div></div>';
    if (!activeFunds().length) {
      h += '<div class="empty"><div class="e">📅</div><h3>Your year at a glance</h3><p>Once you add bills you’ll see which months would hurt — and how smoothing flattens them.</p><button class="btn" data-act="add">Add a bill</button></div>';
      $('#scr-calendar').innerHTML = h; return;
    }
    var max = Math.max(smooth * 1.15, 1);
    months.forEach(function (m) { if (m.total > max) max = m.total; });
    max *= 1.08;
    var worst = months.reduce(function (a, b) { return b.total > a.total ? b : a; }, months[0]);
    if (ui.calSel == null) ui.calSel = months.indexOf(worst);
    h += '<div class="stats"><div class="tile"><div class="k">Worst month</div><div class="v num">' + money(worst.total, { whole: true }) + '</div><div class="s">' + MONTHS_L[worst.m] + ' without smoothing</div></div>' +
      '<div class="tile"><div class="k">Smoothed</div><div class="v num mint">' + money(smooth, { whole: true }) + '<small>/mo</small></div><div class="s">every month, no surprises</div></div></div>';
    h += '<div class="chartCard"><div class="chart">';
    months.forEach(function (m, i) {
      var cls = m.total === 0 ? 'b-none' : m.total > smooth * 2 ? 'b-ouch' : m.total > smooth ? 'b-hi' : 'b-lo';
      var ht = m.total ? Math.max(3, m.total / max * 100) : 2;
      h += '<button class="bar ' + cls + (ui.calSel === i ? ' sel' : '') + '" data-act="cal" data-i="' + i + '" aria-label="' + MONTHS_L[m.m] + ' ' + money(m.total) + '"><i style="height:' + ht.toFixed(1) + '%"></i></button>';
    });
    var sl = (smooth / max * 100);
    h += '<div class="smooth" style="bottom:' + sl.toFixed(1) + '%"></div></div>';
    h += '<div class="mlabels">' + months.map(function (m, i) { return '<span class="' + (ui.calSel === i ? 'sel' : '') + '">' + MONTHS[m.m].charAt(0) + (m.m === 0 ? '’' + String(m.y).slice(2) : MONTHS[m.m].slice(1, 3)) + '</span>'; }).join('') + '</div></div>';
    h += '<div class="legend"><span><i style="background:var(--coral)"></i>Ouch (2×)</span><span><i style="background:var(--amber)"></i>Above flat</span><span><i class="dash"></i>Smoothed ' + money(smooth, { whole: true }) + '/mo</span></div>';
    var sel = months[ui.calSel] || months[0];
    h += '<div class="mPanel"><div class="secHead" style="margin:0 0 4px"><h3>' + MONTHS_L[sel.m] + ' ' + sel.y + '</h3><b class="num ' + (sel.total > smooth * 2 ? 'coral' : sel.total > smooth ? 'amber' : '') + '">' + money(sel.total) + '</b></div>';
    if (!sel.bills.length) h += '<p class="meta" style="padding:6px 0 12px;margin:0">No lumpy bills land this month. Your set-asides keep building quietly.</p>';
    else {
      sel.bills.sort(function (a, b) { return a.date < b.date ? -1 : 1; }).forEach(function (b) {
        h += '<button class="mItem" data-act="open" data-id="' + b.f.id + '"><span class="ico">' + esc(b.f.icon) + '</span><span class="grow"><div style="font-weight:680">' + esc(b.f.name) + '</div><div class="meta">' + fmtDate(b.date) + ' · ' + repeatLabel(b.f.repeat) + '</div></span><b class="num">' + money(b.f.amount) + '</b></button>';
      });
      var diff = sel.total - smooth;
      if (diff > 0) h += '<p class="meta" style="margin:8px 0 10px">Without smoothing this month costs <b class="coral">' + money(diff, { whole: true }) + '</b> more than your flat ' + money(smooth, { whole: true }) + '/mo.</p>';
    }
    h += '</div>';
    $('#scr-calendar').innerHTML = h;
  }

  /* ---------------- Settings ---------------- */
  function segHtml(name, opts, val) {
    return '<div class="seg" data-seg="' + name + '">' + opts.map(function (o) { return '<button data-act="seg" data-val="' + esc(o[0]) + '" class="' + (String(val) === String(o[0]) ? 'on' : '') + '">' + esc(o[1]) + '</button>'; }).join('') + '</div>';
  }
  function dayOptions(sel) { var o = ''; for (var i = 1; i <= 31; i++) o += '<option value="' + i + '"' + (i === sel ? ' selected' : '') + '>' + (i === 31 ? 'Last day (31st)' : ordinal(i)) + '</option>'; return o; }
  function scheduleFields(st, prefix) {
    var h = '';
    if (st.payFrequency === 'semimonthly') {
      h += '<div class="two"><div><label class="lab">First payday</label><select class="inp" id="' + prefix + 'Semi1" data-chg="semi">' + dayOptions(st.semiMonthlyDays[0]) + '</select></div>' +
        '<div><label class="lab">Second payday</label><select class="inp" id="' + prefix + 'Semi2" data-chg="semi">' + dayOptions(st.semiMonthlyDays[1]) + '</select></div></div>';
    } else {
      h += '<label class="lab">Next payday</label><input class="inp" type="date" id="' + prefix + 'Payday" data-chg="payday" value="' + st.nextPayday + '" min="' + today() + '">';
    }
    return h;
  }
  function renderSettings() {
    var st = S.settings;
    var h = '<div class="top"><div><div class="eyebrow">Even Keel</div><h1>Settings</h1></div></div>';
    h += '<div class="gtitle">Pay schedule</div><div class="group"><div class="gi">' +
      segHtml('freq', [['weekly', 'Weekly'], ['biweekly', '2 weeks'], ['semimonthly', '2× month'], ['monthly', 'Monthly']], st.payFrequency) + '</div>' +
      '<div class="gi">' + scheduleFields(st, 'set') + '<div class="nextPd"><span>Next payday</span><b>' + fmtDate(st.nextPayday) + ' · ' + relDays(daysBetween(today(), st.nextPayday)) + '</b></div></div></div>';
    h += '<div class="gtitle">Money</div><div class="group"><div class="gi"><label class="lab">Currency symbol</label><div class="chips left">' +
      CURRENCIES.map(function (c) { return '<button class="chip' + (st.currency === c ? ' on' : '') + '" data-act="currency" data-val="' + esc(c) + '">' + esc(c) + '</button>'; }).join('') +
      '</div></div><div class="gi"><label class="lab">Round set-asides up to</label>' + segHtml('rounding', [['exact', 'Exact cents'], ['1', 'Nearest 1'], ['5', 'Nearest 5']], st.rounding) + '</div>' +
      '<div class="gi"><label class="toggle"><span class="tx"><b>Carry surplus forward</b><span>When a bill comes in under budget, keep the leftover in that fund</span></span><input type="checkbox" id="carryT" data-chg="carry"' + (st.carryOver ? ' checked' : '') + '><span class="sw"></span></label></div></div>';
    h += '<div class="gtitle">Your data</div><div class="group">' +
      gbtn('share', 'Share summary', 'Funds and this payday’s transfers as text', '<path d="M12 15V3M7 8l5-5 5 5"/><path d="M5 13v6a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-6"/>') +
      gbtn('export', 'Export backup', 'Copy your data as JSON', '<path d="M4 17v3h16v-3"/><path d="M12 3v12M7 10l5 5 5-5"/>') +
      gbtn('import', 'Import backup', 'Paste JSON to restore', '<path d="M4 17v3h16v-3"/><path d="M12 15V3M7 8l5-5 5 5"/>') +
      gbtn('reset', 'Reset all data', 'Start over from scratch', '<path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13"/>', 'danger') + '</div>';
    h += '<div class="about">Even Keel · v1.0<br>Works fully offline. No bank logins, no accounts, no tracking.<br>Your data stays on this phone.</div>';
    $('#scr-settings').innerHTML = h;
  }
  function gbtn(act, title, sub, path, cls) {
    return '<button class="gbtn ' + (cls || '') + '" data-act="' + act + '"><span class="gic"><svg viewBox="0 0 24 24">' + path + '</svg></span><span>' + title + '<small>' + sub + '</small></span><span class="chev">›</span></button>';
  }
  function applySchedule(st, freq) {
    st.payFrequency = freq;
    if (freq === 'semimonthly') st.nextPayday = firstDayOnOrAfter(today(), st.semiMonthlyDays);
    else if (freq === 'monthly') { if (st.nextPayday < today()) st.nextPayday = addDays(today(), 7); st.monthDay = parse(st.nextPayday).getDate(); }
    else if (st.nextPayday < today()) st.nextPayday = addDays(today(), freq === 'weekly' ? 3 : 7);
  }
  function scheduleChanged() {
    S.skipped = [];
    save(); render(); buzz(15);
    toast('Pay schedule updated — amounts recalculated');
  }

  /* ---------------- Detail page ---------------- */
  function openDetail(id) {
    ui.detailId = id;
    var el = $('#detail');
    el.classList.remove('out'); el.hidden = false; el.scrollTop = 0;
    renderDetail();
    pushOverlay(closeDetail, 'detail');
  }
  function closeDetail() {
    var el = $('#detail');
    el.classList.add('out');
    ui.detailId = null;
    setTimeout(function () { if (!ui.detailId) { el.hidden = true; el.classList.remove('out'); } }, 220);
    removeOverlay('detail');
  }
  function tankSvg(pct, status) {
    var y = 8 + 104 * (1 - pct) - 4;
    var wave = function (cls, yo) {
      return '<path class="' + cls + '" d="M0 ' + yo + ' q15 -6 30 0 t30 0 t30 0 t30 0 t30 0 t30 0 t30 0 V200 H0Z"/>';
    };
    return '<svg class="tank ' + status + '" viewBox="0 0 120 120"><defs><clipPath id="tankClip"><circle cx="60" cy="60" r="52"/></clipPath></defs>' +
      '<circle class="ring" cx="60" cy="60" r="57"/><g clip-path="url(#tankClip)"><rect class="bgc" width="120" height="120"/>' +
      '<g class="lvl" style="transform:translateY(' + (pct >= 1 ? -10 : y).toFixed(1) + 'px)"><g class="mv2">' + wave('wv2', 2) + '</g><g class="mv1">' + wave('wv', 5) + '</g></g></g></svg>';
  }
  function renderDetail() {
    var f = fundById(ui.detailId), el = $('#detail');
    if (!f || f.archived) { if (ui.detailId) closeDetail(); return; }
    var p = plan(f);
    var hist = [];
    S.contributions.forEach(function (c) { if (c.fundId === f.id) hist.push({ date: c.date, html: '<span><b>+' + money(c.amount) + '</b><span class="meta">Payday ' + (isYmd(c.paydayKey) ? shortDate(c.paydayKey) : '') + '</span></span><span class="meta">' + shortDate(c.date) + '</span>' }); });
    S.payments.forEach(function (pm) {
      if (pm.fundId !== f.id) return;
      var diff = r2((pm.budgeted || 0) - pm.actual);
      hist.push({ date: pm.date, html: '<span><b>Paid ' + money(pm.actual) + '</b><span class="meta">' + (diff > 0 ? '<span class="mint">' + money(diff) + ' surplus</span>' : diff < 0 ? '<span class="coral">' + money(-diff) + ' short</span>' : 'exactly as saved') + ' · saved ' + money(pm.budgeted || 0) + '</span></span><span class="meta">' + shortDate(pm.date) + '</span>' });
    });
    hist.sort(function (a, b) { return a.date < b.date ? 1 : -1; });
    var payPrimary = p.daysLeft <= 21 || p.status === 'ready';
    var h = '<div class="pageTop"><button class="iconBtn" data-act="back" aria-label="Back"><svg viewBox="0 0 24 24"><path d="M15 5l-7 7 7 7"/></svg></button><span class="t">Fund</span>' +
      '<button class="iconBtn" data-act="edit" data-id="' + f.id + '" aria-label="Edit"><svg viewBox="0 0 24 24"><path d="M4 20h4L19 9l-4-4L4 16z"/><path d="M13.5 6.5l4 4"/></svg></button></div>';
    h += '<div class="tankWrap">' + tankSvg(p.pct, p.status) + '<div class="tankIn"><div class="e">' + esc(f.icon) + '</div><div class="p num">' + Math.round(p.pct * 100) + '%</div></div></div>';
    h += '<div class="dTitle"><h2>' + esc(f.name) + '</h2><div class="amtLine num">' + money(f.saved) + ' saved of ' + money(f.amount) + '</div><span class="badge ' + p.status + '">' + STATUS_LABEL[p.status] + '</span></div>';
    h += '<div class="kv"><div class="tile"><div class="k">Due</div><div class="v">' + shortDate(f.nextDue) + '</div><div class="s">' + relDays(p.daysLeft) + '</div></div>' +
      '<div class="tile"><div class="k">This payday</div><div class="v num">' + (p.status === 'ready' ? '—' : money(p.per)) + '</div><div class="s">' + (p.done ? 'moved ✓' : p.n + ' paycheck' + (p.n === 1 ? '' : 's') + ' left') + '</div></div>' +
      '<div class="tile"><div class="k">Repeats</div><div class="v" style="font-size:17px">' + repeatLabel(f.repeat) + '</div></div>' +
      '<div class="tile"><div class="k">True cost</div><div class="v num">' + money(p.monthly, { whole: true }) + '<small>/mo</small></div></div></div>';
    if (p.catchUp > 0) h += '<div class="note"><span class="e">↑</span><div>Up <b>' + money(p.catchUp) + '</b> per paycheck to catch up after a missed payday.</div></div>';
    if (p.status === 'ready') h += '<div class="note info"><span class="e">✓</span><div>Fully funded. When the bill arrives, tap <b>Paid it</b>.</div></div>';
    else if (p.n === 0) h += '<div class="note coral"><span class="e">!</span><div>This is due before your next payday and is short <b>' + money(p.remaining) + '</b>.</div></div>';
    h += '<button class="btn block ' + (payPrimary ? '' : 'soft') + '" data-act="paid" data-id="' + f.id + '" style="margin-bottom:16px">' + CHECK_SVG + 'Paid it</button>';
    if (f.notes) h += '<div class="notes">' + esc(f.notes) + '</div>';
    h += '<div class="secHead"><h2>History</h2><span>' + hist.length + '</span></div>';
    h += hist.length ? '<div class="hist">' + hist.map(function (x) { return '<div class="hi">' + x.html + '</div>'; }).join('') + '</div>'
      : '<p class="meta" style="margin:0 2px 16px">No contributions yet. They’ll appear here each time you tick this fund off on payday.</p>';
    h += '<button class="btn block danger" data-act="delete" data-id="' + f.id + '">Delete fund</button>';
    el.innerHTML = h;
  }

  /* ---------------- Overlays ---------------- */
  function pushOverlay(close, name) { stack.push({ close: close, name: name }); }
  function removeOverlay(name) { for (var i = stack.length - 1; i >= 0; i--) if (stack[i].name === name) { stack.splice(i, 1); break; } }
  function closeTop() { var t = stack[stack.length - 1]; if (t) { t.close(); return true; } return false; }

  function openSheet(html, onClose) {
    var sh = $('#sheet'), sc = $('#sheetScrim');
    sh.innerHTML = '<div class="grab"></div>' + html;
    sh.classList.remove('out'); sc.classList.remove('out');
    sh.hidden = false; sc.hidden = false; sh.scrollTop = 0;
    pushOverlay(function () { closeSheet(); if (onClose) onClose(); }, 'sheet');
  }
  function closeSheet() {
    var sh = $('#sheet'), sc = $('#sheetScrim');
    if (sh.hidden) return;
    sh.classList.add('out'); sc.classList.add('out');
    removeOverlay('sheet');
    setTimeout(function () { if (!sh.classList.contains('out')) return; sh.hidden = true; sc.hidden = true; sh.innerHTML = ''; sh.classList.remove('out'); sc.classList.remove('out'); }, 210);
  }
  var dlgActions = [];
  function openDialog(o) {
    var d = $('#dialog'), sc = $('#dlgScrim');
    dlgActions = o.actions || [{ label: 'OK' }];
    d.innerHTML = '<h3>' + esc(o.title) + '</h3>' + (o.body || '') + '<div class="actions">' + dlgActions.map(function (a, i) { return '<button class="btn ' + (a.cls || '') + '" data-act="dlg" data-i="' + i + '">' + esc(a.label) + '</button>'; }).join('') + '</div>';
    d.classList.remove('out'); sc.classList.remove('out');
    d.hidden = false; sc.hidden = false;
    removeOverlay('dialog');
    pushOverlay(closeDialog, 'dialog');
    if (o.onOpen) o.onOpen(d);
  }
  function closeDialog() {
    var d = $('#dialog'), sc = $('#dlgScrim');
    if (d.hidden) return;
    d.classList.add('out'); sc.classList.add('out');
    removeOverlay('dialog');
    setTimeout(function () { if (d.classList.contains('out')) { d.hidden = true; sc.hidden = true; d.innerHTML = ''; d.classList.remove('out'); sc.classList.remove('out'); } }, 180);
  }
  function confirmDialog(title, body, okLabel, onOk, danger) {
    openDialog({ title: title, body: '<p>' + body + '</p>', actions: [{ label: 'Cancel', cls: 'ghost' }, { label: okLabel, cls: danger ? 'danger' : '', onClick: onOk }] });
  }

  /* ---------------- Add / Edit bill sheet ---------------- */
  var form = null;
  function openFundSheet(fund, preset) {
    var isNew = !fund;
    var f = fund ? JSON.parse(JSON.stringify(fund)) : { name: '', icon: '🧾', amount: '', nextDue: addMonths(today(), 6), repeat: { type: 'yearly', every: 12 }, saved: '', notes: '' };
    if (preset) { f.name = preset.name; f.icon = preset.icon; f.amount = preset.amount; f.nextDue = preset.due(); f.repeat = { type: preset.every === 12 ? 'yearly' : 'months', every: preset.every }; }
    form = { id: fund ? fund.id : null, isNew: isNew, icon: f.icon, repType: f.repeat.type === 'once' ? 'once' : (f.repeat.every === 12 ? '12' : f.repeat.every === 6 ? '6' : f.repeat.every === 3 ? '3' : 'n'), every: f.repeat.every, showIcons: false, iconTouched: !!fund || !!preset, createdAt: fund ? fund.createdAt : today() };
    var c = esc(S.settings.currency);
    var h = '<div class="sheetHead"><h2>' + (isNew ? 'New lumpy bill' : 'Edit bill') + '</h2><button class="iconBtn" data-act="sheet-close" aria-label="Close"><svg viewBox="0 0 24 24"><path d="M6 6l12 12M18 6L6 18"/></svg></button></div>';
    if (isNew) h += '<div class="hscroll">' + PRESETS.map(function (p, i) { return '<button class="chip" data-act="preset-fill" data-i="' + i + '">' + p.icon + ' ' + esc(p.name) + '</button>'; }).join('') + '</div>';
    h += '<div class="field"><label class="lab" for="fName">Name</label><div class="nameRow"><button class="icoBtn" id="fIconBtn" data-act="icon-toggle" aria-label="Choose icon">' + esc(f.icon) + '</button>' +
      '<input class="inp" id="fName" maxlength="60" placeholder="e.g. Car insurance" value="' + esc(f.name) + '" autocomplete="off"></div><div id="iconGrid"></div></div>';
    h += '<div class="two"><div class="field"><label class="lab" for="fAmount">Amount</label><div class="money"><span>' + c + '</span><input class="inp" id="fAmount" inputmode="decimal" placeholder="0" value="' + esc(f.amount) + '"></div></div>' +
      '<div class="field"><label class="lab" for="fDue">Next due</label><input class="inp" type="date" id="fDue" value="' + esc(f.nextDue) + '"></div></div>';
    h += '<div class="field"><label class="lab">Repeats</label>' + segHtml('rep', [['12', 'Yearly'], ['6', '6 mo'], ['3', 'Quarterly'], ['n', 'Every N'], ['once', 'One-off']], form.repType) +
      '<div class="everyRow" id="everyRow"' + (form.repType === 'n' ? '' : ' hidden') + '>Every <input class="inp" id="fEvery" inputmode="numeric" value="' + (form.repType === 'n' ? f.repeat.every : 2) + '"> months</div></div>';
    h += '<div class="field"><label class="lab" for="fSaved">Already saved</label><div class="money"><span>' + c + '</span><input class="inp" id="fSaved" inputmode="decimal" placeholder="0" value="' + esc(f.saved || '') + '"></div></div>';
    h += '<div class="preview" id="fPreview"></div>';
    h += '<div class="field"><label class="lab" for="fNotes">Notes</label><textarea class="inp" id="fNotes" maxlength="400" placeholder="Policy number, where to pay, last year’s price…">' + esc(f.notes) + '</textarea></div>';
    h += '<div class="err" id="fErr" hidden></div>';
    h += '<button class="btn block" data-act="save-fund" id="fSave" style="margin-top:6px">' + (isNew ? 'Add bill' : 'Save changes') + '</button>';
    openSheet(h, function () { form = null; });
    updatePreview();
  }
  function readForm() {
    var every = form.repType === 'once' ? 12 : form.repType === 'n' ? Math.max(1, Math.min(120, Math.round(num($('#fEvery').value)) || 0)) : +form.repType;
    return {
      name: $('#fName').value.trim(), icon: form.icon, amount: num($('#fAmount').value), nextDue: $('#fDue').value,
      repeat: { type: form.repType === 'once' ? 'once' : (every === 12 ? 'yearly' : 'months'), every: every },
      saved: num($('#fSaved').value) || 0, notes: $('#fNotes').value.trim(), createdAt: form.createdAt
    };
  }
  function updatePreview() {
    if (!form) return;
    var v = readForm(), el = $('#fPreview');
    if (!(v.amount > 0) || !isYmd(v.nextDue)) {
      el.innerHTML = '<div class="k">Per paycheck</div><div class="v num">—</div><div class="s">Enter an amount and due date to see what to set aside.</div>' ;
      return;
    }
    var tmp = normFund(Object.assign({ id: form.id || '_preview' }, v));
    tmp.saved = Math.max(0, v.saved);
    var remaining = Math.max(0, tmp.amount - tmp.saved);
    var n = paycheckCount(S.settings.nextPayday, tmp.nextDue);
    var per = need(remaining, n);
    var s;
    if (remaining <= 0) s = 'Already fully funded.';
    else if (n === 0) s = 'Due before your next payday (' + shortDate(S.settings.nextPayday) + ') — you’d be short ' + money(remaining) + '.';
    else s = n + ' paycheck' + (n === 1 ? '' : 's') + ' until ' + shortDate(tmp.nextDue) + ' · true cost ' + money(monthlyCost(tmp), { whole: true }) + '/mo';
    el.innerHTML = '<div class="k">Set aside per paycheck</div><div class="v num">' + money(per) + '<small> × ' + Math.max(n, remaining > 0 ? 1 : 0) + '</small></div><div class="s">' + s + '</div>';
  }
  function saveFund() {
    var v = readForm(), err = '';
    if (!v.name) err = 'Give this bill a name.';
    else if (!(v.amount > 0)) err = 'Enter the bill amount.';
    else if (!isYmd(v.nextDue)) err = 'Pick the next due date.';
    else if (v.saved < 0) err = 'Already saved can’t be negative.';
    var e = $('#fErr');
    if (err) { e.textContent = err; e.hidden = false; buzz(30); return; }
    if (form.isNew) {
      var nf = normFund(Object.assign({ id: uid() }, v));
      S.funds.push(nf);
      toast(nf.name + ' added');
    } else {
      var f = fundById(form.id); if (!f) return;
      var keep = { id: f.id, createdAt: f.createdAt, lastPaid: f.lastPaid, archived: f.archived };
      Object.assign(f, normFund(Object.assign({}, v, keep)));
      toast('Saved');
    }
    buzz(20); save(); closeSheet(); form = null; render();
  }

  /* ---------------- Paid it ---------------- */
  function openPaid(id) {
    var f = fundById(id); if (!f) return;
    var once = f.repeat.type === 'once';
    var c = esc(S.settings.currency);
    var body = '<p>Saved so far: <b class="num" style="color:var(--text)">' + money(f.saved) + '</b> of ' + money(f.amount) + '.</p>' +
      '<div class="field"><label class="lab" for="pAmt">Actual amount paid</label><div class="money"><span>' + c + '</span><input class="inp" id="pAmt" inputmode="decimal" value="' + r2(f.amount) + '"></div></div>' +
      '<div class="note info" id="pDiff" style="margin-bottom:8px"></div>' +
      (once ? '<p style="margin-bottom:8px">This one-off fund will be archived once it’s paid.</p>' :
        '<label class="toggle"><span class="tx"><b>Carry surplus forward</b><span>Leftover stays in the fund for next time</span></span><input type="checkbox" id="pCarry"' + (S.settings.carryOver ? ' checked' : '') + '><span class="sw"></span></label>' +
        '<label class="toggle"><span class="tx"><b>Use as next target</b><span>Update the amount to what you actually paid</span></span><input type="checkbox" id="pTarget"><span class="sw"></span></label>' +
        '<p style="margin:6px 0 10px;font-size:13px">Next due: <b style="color:var(--text)">' + fmtDate(nextDueAfterPay(f)) + '</b></p>');
    openDialog({
      title: 'Paid ' + f.name + '?', body: body,
      actions: [{ label: 'Cancel', cls: 'ghost' }, { label: 'Record it', onClick: function () { return recordPayment(f.id); } }],
      onOpen: function (d) {
        var upd = function () {
          var a = num($('#pAmt').value), el = $('#pDiff');
          $('#pAmt').classList.remove('bad');
          if (!(a >= 0)) { el.innerHTML = 'Enter what the bill actually cost.'; return; }
          var diff = r2(f.saved - a);
          el.className = 'note ' + (diff >= 0 ? 'info' : 'coral');
          el.innerHTML = diff > 0 ? '<span class="e">✓</span><div><b>' + money(diff) + ' surplus.</b> ' + (once ? 'Nice — that’s yours to keep.' : 'Carry it into the next cycle or spend it.') + '</div>'
            : diff < 0 ? '<span class="e">!</span><div><b>' + money(-diff) + ' shortfall</b> covered from elsewhere this time.</div>'
              : '<span class="e">✓</span><div>Exactly what you saved. Smooth sailing.</div>';
        };
        $('#pAmt', d).addEventListener('input', upd); upd();
      }
    });
  }
  function nextDueAfterPay(f) {
    var nd = addMonths(f.nextDue, f.repeat.every), g = 0;
    while (nd <= today() && g++ < 200) nd = addMonths(nd, f.repeat.every);
    return nd;
  }
  function recordPayment(id) {
    var f = fundById(id), a = num($('#pAmt').value);
    if (!f) return;
    if (!(a >= 0)) { $('#pAmt').classList.add('bad'); buzz(30); return false; }
    var carry = $('#pCarry') ? $('#pCarry').checked : false, upd = $('#pTarget') ? $('#pTarget').checked : false;
    var diff = r2(f.saved - a);
    S.payments.push({ id: uid(), fundId: f.id, date: today(), budgeted: r2(f.saved), actual: r2(a), target: f.amount });
    if (f.repeat.type === 'once') {
      f.archived = true; f.saved = 0;
      toast(f.name + ' paid off and archived');
    } else {
      f.nextDue = nextDueAfterPay(f);
      if (upd && a > 0) f.amount = r2(a);
      f.saved = carry && diff > 0 ? diff : 0;
      f.lastPaid = today();
      toast('Payment recorded — next due ' + shortDate(f.nextDue));
    }
    buzz(40); save(); render();
  }

  /* ---------------- Summary / backup ---------------- */
  function summaryText() {
    var t = totals(), st = S.settings;
    var lines = ['Even Keel — lumpy bill summary', '', 'Next payday: ' + fmtDate(st.nextPayday) + ' — move ' + money(t.per) + ' to savings' + (t.moved ? ' (' + money(t.moved) + ' already moved)' : ''), ''];
    activeFunds().slice().sort(function (a, b) { return a.nextDue < b.nextDue ? -1 : 1; }).forEach(function (f) {
      var p = plan(f);
      lines.push(f.icon + ' ' + f.name + ': ' + money(f.saved) + ' of ' + money(f.amount) + ' (' + Math.round(p.pct * 100) + '%) · due ' + shortDate(f.nextDue) + ' · ' + (p.status === 'ready' ? 'ready' : money(p.per) + ' this payday') + ' · ' + STATUS_LABEL[p.status].toLowerCase());
    });
    if (!t.count) lines.push('No funds yet.');
    lines.push('', 'True monthly cost: ' + money(t.monthly, { whole: true }) + '/mo (' + money(t.perPaycheck, { whole: true }) + ' per paycheck, ' + FREQ_LABEL[st.payFrequency].toLowerCase() + ')');
    lines.push('Overall funded: ' + Math.round(t.funded * 100) + '%');
    return lines.join('\n');
  }
  function exportData() {
    var json = JSON.stringify(S, null, 1);
    openDialog({
      title: 'Export backup',
      body: '<p>Copy this text somewhere safe (notes, email to yourself). Paste it into Import to restore.</p><textarea class="inp code" id="expTa" readonly>' + esc(json) + '</textarea>',
      actions: [{ label: 'Done', cls: 'ghost' }].concat(window.Android && window.Android.share ? [{ label: 'Share', keep: true, onClick: function () { shareText(json); } }] : []).concat([{ label: 'Copy', keep: true, onClick: function () { copyText($('#expTa')); } }])
    });
  }
  function importData() {
    openDialog({
      title: 'Import backup',
      body: '<p>Paste a backup exported from Even Keel. This replaces everything currently in the app.</p><textarea class="inp code" id="impTa" placeholder="{ &quot;settings&quot;: … }"></textarea><div class="err" id="impErr" hidden></div>',
      actions: [{ label: 'Cancel', cls: 'ghost' }, {
        label: 'Import', onClick: function () {
          var raw = $('#impTa').value.trim(), err = $('#impErr');
          try {
            var o = JSON.parse(raw);
            if (!o || typeof o !== 'object' || !Array.isArray(o.funds) || !o.settings) throw new Error('shape');
            S = normalize(o); S.settings.onboarded = true;
            save(); render(); toast('Backup restored — ' + activeFunds().length + ' funds'); buzz(30);
          } catch (e) {
            err.textContent = 'That doesn’t look like an Even Keel backup. Paste the full JSON text.'; err.hidden = false; buzz(30);
            return false;
          }
        }
      }]
    });
  }

  /* ---------------- Onboarding ---------------- */
  function showOnboarding() {
    ui.obStep = 0;
    var st = defaultState().settings;
    ui.ob = { freq: S.settings.payFrequency, payday: S.settings.nextPayday < today() ? st.nextPayday : S.settings.nextPayday, semi: S.settings.semiMonthlyDays.slice(), currency: S.settings.currency, picks: {} };
    $('#onboard').hidden = false;
    renderOnboarding();
  }
  function renderOnboarding() {
    var o = ui.ob, s = ui.obStep, h = '<div class="ob">';
    if (s === 0) {
      h += '<div class="obHero">' + LOGO + '<h1>Even Keel</h1><p>Never get ambushed by a yearly bill again.</p></div>' +
        '<div class="obList"><div><span class="e">🗓️</span><span><b>List your lumpy bills</b><span>Registration, insurance, Christmas, property tax — anything that isn’t monthly.</span></span></div>' +
        '<div><span class="e">💸</span><span><b>Know your number each payday</b><span>Exactly how much to set aside so every bill is covered on time.</span></span></div>' +
        '<div><span class="e">🔒</span><span><b>Private by design</b><span>No bank login, no account. Everything stays on your phone.</span></span></div></div>' +
        '<div class="spacer"></div><div class="obFoot"><button class="btn block" data-act="ob-next">Get started</button></div>';
    } else if (s === 1) {
      h += '<div class="steps"><i class="on"></i><i></i></div><h2>When do you get paid?</h2><p class="lead">We split each bill across the paychecks you have left before it’s due.</p><div class="freq">' +
        [['weekly', 'Weekly', 'Every week'], ['biweekly', 'Biweekly', 'Every 2 weeks'], ['semimonthly', 'Semi-monthly', 'Two set days a month'], ['monthly', 'Monthly', 'Once a month']].map(function (x) {
          return '<button class="' + (o.freq === x[0] ? 'on' : '') + '" data-act="ob-freq" data-val="' + x[0] + '"><b>' + x[1] + '</b><span>' + x[2] + '</span></button>';
        }).join('') + '</div>';
      if (o.freq === 'semimonthly') {
        h += '<div class="two field"><div><label class="lab">First payday</label><select class="inp" id="obSemi1">' + dayOptions(o.semi[0]) + '</select></div><div><label class="lab">Second payday</label><select class="inp" id="obSemi2">' + dayOptions(o.semi[1]) + '</select></div></div>';
      } else {
        h += '<div class="field"><label class="lab" for="obPayday">Next payday</label><input class="inp" type="date" id="obPayday" value="' + o.payday + '" min="' + today() + '"></div>';
      }
      h += '<div class="field"><label class="lab">Currency</label><div class="chips left">' + CURRENCIES.map(function (c) { return '<button class="chip' + (o.currency === c ? ' on' : '') + '" data-act="ob-cur" data-val="' + esc(c) + '">' + esc(c) + '</button>'; }).join('') + '</div></div>';
      h += '<div class="err" id="obErr" hidden></div><div class="spacer"></div><div class="obFoot"><button class="btn block" data-act="ob-next">Continue</button><button class="btn block ghost" data-act="ob-back">Back</button></div>';
    } else {
      var n = Object.keys(o.picks).length;
      h += '<div class="steps"><i class="on"></i><i class="on"></i></div><h2>Any of these sound familiar?</h2><p class="lead">Pick a few to start. You can tweak amounts and dates anytime.</p>';
      PRESETS.forEach(function (p, i) {
        h += '<button class="preset' + (o.picks[i] ? ' on' : '') + '" data-act="ob-pick" data-i="' + i + '"><span class="ico">' + p.icon + '</span><span class="grow"><b>' + esc(p.name) + '</b><div class="meta">' + esc(o.currency) + p.amount.toLocaleString('en-US') + ' · ' + repeatLabel({ type: 'months', every: p.every }).toLowerCase() + ' · due ' + shortDate(p.due()) + '</div></span><span class="check">' + CHECK_SVG + '</span></button>';
      });
      h += '<div class="spacer"></div><div class="obFoot"><button class="btn block" data-act="ob-finish">' + (n ? 'Start with ' + n + ' bill' + (n > 1 ? 's' : '') : 'Skip — I’ll add my own') + '</button><button class="btn block ghost" data-act="ob-back">Back</button></div>';
    }
    h += '</div>';
    var el = $('#onboard'); el.innerHTML = h; el.scrollTop = 0;
  }
  function obCapture() {
    var o = ui.ob;
    if ($('#obPayday')) o.payday = $('#obPayday').value || o.payday;
    if ($('#obSemi1')) o.semi = [+$('#obSemi1').value, +$('#obSemi2').value];
  }
  function finishOnboarding() {
    var o = ui.ob, st = S.settings;
    st.currency = o.currency;
    st.semiMonthlyDays = o.semi.slice().sort(function (a, b) { return a - b; });
    st.nextPayday = o.payday;
    applySchedule(st, o.freq);
    st.onboarded = true;
    S.skipped = [];
    Object.keys(o.picks).forEach(function (i) {
      var p = PRESETS[i];
      S.funds.push(normFund({ id: uid(), name: p.name, icon: p.icon, amount: p.amount, nextDue: p.due(), repeat: { type: p.every === 12 ? 'yearly' : 'months', every: p.every }, saved: 0 }));
    });
    save();
    var el = $('#onboard');
    el.style.transition = 'opacity .3s'; el.style.opacity = '0';
    setTimeout(function () { el.hidden = true; el.style.opacity = ''; el.innerHTML = ''; }, 300);
    render(); buzz(30);
  }

  /* ---------------- Events ---------------- */
  document.addEventListener('click', function (e) {
    var b = e.target.closest('[data-act]');
    if (!b) return;
    var act = b.getAttribute('data-act'), id = b.getAttribute('data-id'), i = +b.getAttribute('data-i');
    switch (act) {
      case 'tab': if (ui.detailId) closeDetail(); setTab(b.getAttribute('data-tab')); break;
      case 'add': openFundSheet(null); break;
      case 'preset-add': openFundSheet(null, PRESETS[i]); break;
      case 'preset-fill': {
        var p = PRESETS[i]; $('#fName').value = p.name; $('#fAmount').value = p.amount; $('#fDue').value = p.due();
        form.icon = p.icon; form.iconTouched = true; $('#fIconBtn').textContent = p.icon;
        form.repType = p.every === 12 ? '12' : String(p.every);
        $$('#sheet [data-seg=rep] button').forEach(function (x) { x.classList.toggle('on', x.getAttribute('data-val') === form.repType); });
        $('#everyRow').hidden = true; updatePreview(); buzz(10); break;
      }
      case 'icon-toggle': {
        form.showIcons = !form.showIcons;
        $('#iconGrid').innerHTML = form.showIcons ? '<div class="emojiGrid">' + ICONS.map(function (x) { return '<button data-act="icon" data-val="' + x + '" class="' + (x === form.icon ? 'on' : '') + '">' + x + '</button>'; }).join('') + '</div>' : '';
        break;
      }
      case 'icon': form.iconTouched = true; form.icon = b.getAttribute('data-val'); $('#fIconBtn').textContent = form.icon; form.showIcons = false; $('#iconGrid').innerHTML = ''; break;
      case 'save-fund': saveFund(); break;
      case 'sheet-close': closeTop(); break;
      case 'open': openDetail(id); break;
      case 'back': closeTop(); break;
      case 'edit': openFundSheet(fundById(id)); break;
      case 'paid': openPaid(id); break;
      case 'delete': {
        var f = fundById(id);
        confirmDialog('Delete ' + f.name + '?', 'This removes the fund and its history. This can’t be undone.', 'Delete', function () {
          S.funds = S.funds.filter(function (x) { return x.id !== id; });
          S.contributions = S.contributions.filter(function (c) { return c.fundId !== id; });
          S.payments = S.payments.filter(function (c) { return c.fundId !== id; });
          save(); closeDetail(); render(); toast('Fund deleted');
        }, true);
        break;
      }
      case 'tick': toggleTick(id); break;
      case 'mark-all': markAll(); break;
      case 'complete-empty': completePayday(0); break;
      case 'cal': ui.calSel = i; buzz(8); render(); break;
      case 'share': shareText(summaryText(), 'Share summary'); break;
      case 'export': exportData(); break;
      case 'import': importData(); break;
      case 'reset':
        confirmDialog('Reset all data?', 'Every fund, contribution and setting will be erased. Export a backup first if you might want it back.', 'Erase everything', function () {
          S = defaultState(); save(); ui.calSel = null; ui.justCompleted = null;
          setTab('home'); render(); showOnboarding();
        }, true);
        break;
      case 'currency': S.settings.currency = b.getAttribute('data-val'); save(); render(); break;
      case 'seg': {
        var seg = b.parentNode.getAttribute('data-seg'), val = b.getAttribute('data-val');
        $$('button', b.parentNode).forEach(function (x) { x.classList.toggle('on', x === b); });
        if (seg === 'freq') { applySchedule(S.settings, val); scheduleChanged(); }
        else if (seg === 'rounding') { S.settings.rounding = val; save(); render(); toast('Rounding updated'); }
        else if (seg === 'rep') { form.repType = val; $('#everyRow').hidden = val !== 'n'; updatePreview(); }
        break;
      }
      case 'dlg': {
        var a = dlgActions[i];
        var r = a && a.onClick ? a.onClick() : undefined;
        if (r !== false && !(a && a.keep)) closeDialog();
        break;
      }
      case 'ob-next':
        if (ui.obStep === 1) {
          obCapture();
          if (ui.ob.freq !== 'semimonthly' && (!isYmd(ui.ob.payday) || ui.ob.payday < today())) { var oe = $('#obErr'); oe.textContent = 'Pick your next payday (today or later).'; oe.hidden = false; return; }
          if (ui.ob.freq === 'semimonthly' && ui.ob.semi[0] === ui.ob.semi[1]) { var oe2 = $('#obErr'); oe2.textContent = 'Choose two different days.'; oe2.hidden = false; return; }
        }
        ui.obStep++; renderOnboarding(); break;
      case 'ob-back': obCapture(); ui.obStep = Math.max(0, ui.obStep - 1); renderOnboarding(); break;
      case 'ob-freq': obCapture(); ui.ob.freq = b.getAttribute('data-val'); buzz(8); renderOnboarding(); break;
      case 'ob-cur': obCapture(); ui.ob.currency = b.getAttribute('data-val'); renderOnboarding(); break;
      case 'ob-pick': if (ui.ob.picks[i]) delete ui.ob.picks[i]; else ui.ob.picks[i] = true; buzz(8); renderOnboarding(); break;
      case 'ob-finish': finishOnboarding(); break;
    }
  });
  $('#sheetScrim').addEventListener('click', function () { closeTop(); });
  $('#dlgScrim').addEventListener('click', function () { closeDialog(); });
  document.addEventListener('input', function (e) {
    if (form && e.target.closest('#sheet')) {
      if (e.target.id === 'fName' && !form.iconTouched) { form.icon = guessIcon(e.target.value); $('#fIconBtn').textContent = form.icon; }
      updatePreview(); if (e.target.id !== 'fNotes') $('#fErr').hidden = true; }
  });
  document.addEventListener('change', function (e) {
    var c = e.target.getAttribute('data-chg');
    if (!c) return;
    var st = S.settings;
    if (c === 'payday') {
      var v = e.target.value;
      if (!isYmd(v) || v < today()) { toast('Pick a date from today onward'); e.target.value = st.nextPayday; return; }
      st.nextPayday = v; if (st.payFrequency === 'monthly') st.monthDay = parse(v).getDate();
      scheduleChanged();
    } else if (c === 'semi') {
      var a = +$('#setSemi1').value, b = +$('#setSemi2').value;
      if (a === b) { toast('Choose two different days'); render(); return; }
      st.semiMonthlyDays = [a, b].sort(function (x, y) { return x - y; });
      st.nextPayday = firstDayOnOrAfter(today(), st.semiMonthlyDays);
      scheduleChanged();
    } else if (c === 'carry') { st.carryOver = e.target.checked; save(); }
  });

  window.onAndroidBack = function () {
    if (!$('#onboard').hidden) {
      if (ui.obStep > 0) { obCapture(); ui.obStep--; renderOnboarding(); return true; }
      return false;
    }
    if (closeTop()) return true;
    if (ui.tab !== 'home') { setTab('home'); return true; }
    return false;
  };
  document.addEventListener('keydown', function (e) { if (e.key === 'Escape') window.onAndroidBack(); });
  document.addEventListener('visibilitychange', function () { if (!document.hidden) render(); });

  /* ---------------- Boot ---------------- */
  load();
  render();
  if (!S.settings.onboarded) showOnboarding();
  // Exposed for QA scripts.
  window.EvenKeel = { state: function () { return S; }, plan: function (id) { return plan(fundById(id)); }, totals: totals, reload: function () { load(); render(); } };
})();
