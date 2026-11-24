/* 장신대 플래너 — 앱 로직 */
(function () {
  'use strict';

  var DATA = window.STUDY_DATA;
  var view = document.getElementById('view');
  if (!DATA) {
    view.innerHTML = '<p class="muted">일정 데이터(schedule.js)를 불러오지 못했어요.</p>';
    return;
  }

  var META = DATA.meta, BOOKS = DATA.books;
  var MAXR = META.maxRounds || 10;
  var DEFR = META.defaultRounds || 3;
  var DOW = ['일', '월', '화', '수', '목', '금', '토'];

  /* ---------- 날짜 ---------- */
  function pad2(n) { return n < 10 ? '0' + n : '' + n; }
  function pad3(n) { return ('00' + n).slice(-3); }
  function ymd(d) { return d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate()); }
  function parse(iso) { var p = iso.split('-'); return new Date(Number(p[0]), Number(p[1]) - 1, Number(p[2])); }
  function diffDays(a, b) { return Math.round((parse(b) - parse(a)) / 86400000); }
  function md(iso) { var d = parse(iso); return (d.getMonth() + 1) + '.' + d.getDate() + '(' + DOW[d.getDay()] + ')'; }
  function longKo(iso) {
    var d = parse(iso);
    return d.getFullYear() + '. ' + (d.getMonth() + 1) + '. ' + d.getDate() + '(' + DOW[d.getDay()] + ')';
  }
  function nf(n) { return n.toLocaleString('ko-KR'); }
  function isIso(s) { return typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s); }
  function clampInt(v, lo, hi) { v = Math.round(Number(v) || 0); return Math.max(lo, Math.min(hi, v)); }

  var qs = new URLSearchParams(location.search);
  var TODAY = (function () {
    var v = qs.get('today');
    return v && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : ymd(new Date());
  })();

  /* ---------- 공부 날짜 집합 (주일 포함 / 제외) ---------- */
  function datesBetween(incSun) {
    var out = [], d = parse(META.start), end = parse(META.end);
    while (d <= end) {
      if (incSun || d.getDay() !== 0) out.push(ymd(d));
      d = new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1);
    }
    return out;
  }
  var DATES_SUN = datesBetween(true);   // 2026-11-23 ~ 2027-11-30 전체 373일
  var DATES_WEEK = datesBetween(false); // 주일 제외 320일

  /* ---------- 문항 순서 ---------- */
  var FLAT = [];
  BOOKS.forEach(function (b, bi) {
    for (var n = 1; n <= b.printed; n++) {
      FLAT.push({ b: bi, n: n, del: b.deleted.indexOf(n) >= 0 });
    }
  });
  var PRINTED = FLAT.length;
  var BOOK_START = [];
  BOOKS.reduce(function (acc, b, i) { BOOK_START[i] = acc; return acc + b.printed; }, 0);

  /* ---------- 회독 수별 기본 계획 ---------- */
  var PLAN_CACHE = {};
  function planBase(N, incSun) {
    N = Math.max(1, Math.min(MAXR, Number(N) || DEFR));
    incSun = !!incSun;
    var key = N + (incSun ? 's' : 'w');
    if (PLAN_CACHE[key]) return PLAN_CACHE[key];

    var dates = incSun ? DATES_SUN : DATES_WEEK;
    var dayBase = Math.floor(dates.length / N);
    var dayRem = dates.length % N;
    var days = [], rounds = [], cursor = 0, gid = 0;

    for (var r = 1; r <= N; r++) {
      var cnt = dayBase + (r <= dayRem ? 1 : 0);
      var first = null, last = null, qsum = 0;

      // 하루 분량: 남은 문항 ÷ 남은 날 로 계산하고, 책 경계에 가까우면 그 경계로 맞춘다
      var ends = [], pos0 = 0;
      for (var e = 0; e < cnt; e++) {
        var leftDays = cnt - e, leftQ = PRINTED - pos0;
        var target = (leftDays === 1) ? leftQ : Math.max(1, Math.round(leftQ / leftDays));
        var cut = Math.min(pos0 + target, PRINTED);
        if (cut < PRINTED) {
          var bi = FLAT[cut - 1].b;
          if (FLAT[cut].b === bi) {
            var bStart = BOOK_START[bi], bEnd = bStart + BOOKS[bi].printed;
            if (cut - bStart < 3 && bStart > pos0 && bStart - pos0 >= target - 3) cut = bStart;
            else if (bEnd - cut < 3 && bEnd < PRINTED && bEnd - pos0 <= target + 3) cut = bEnd;
          }
        }
        ends.push(cut);
        pos0 = cut;
      }

      var pos = 0;
      for (var i = 0; i < cnt; i++) {
        var chunk = FLAT.slice(pos, ends[i]);
        pos = ends[i];
        var segs = [];
        for (var k = 0; k < chunk.length; k++) {
          var x = chunk[k], lastSeg = segs[segs.length - 1];
          if (lastSeg && lastSeg.b === x.b) {
            lastSeg.e = x.n;
            if (x.del) lastSeg.del.push(x.n); else lastSeg.n++;
          } else {
            segs.push({ b: x.b, s: x.n, e: x.n, n: x.del ? 0 : 1, del: x.del ? [x.n] : [] });
          }
        }
        var date = dates[cursor++];
        var day = {
          id: ++gid, date: date, dow: parse(date).getDay(),
          round: r, rday: i + 1,
          q: segs.reduce(function (a, s) { return a + s.n; }, 0),
          segs: segs
        };
        if (!first) first = day;
        last = day;
        qsum += day.q;
        days.push(day);
      }
      rounds.push({ no: r, start: first.date, end: last.date, days: cnt, questions: qsum });
    }

    var plan = {
      n: N, includeSun: incSun, dates: dates.slice(),
      days: days, rounds: rounds, byDate: {}, byId: {}, segs: []
    };
    days.forEach(function (d) { plan.byDate[d.date] = d; plan.byId[d.id] = d; });
    for (var ri = 0; ri < N; ri++) plan.segs.push(BOOKS.map(function () { return []; }));
    days.forEach(function (d) {
      d.segs.forEach(function (s) { plan.segs[d.round - 1][s.b].push({ day: d, seg: s }); });
    });

    PLAN_CACHE[key] = plan;
    return plan;
  }

  /* ---------- 저장 ---------- */
  var KEY = 'jangsin-planner-v2';
  var OLD_KEY = 'jangsin-planner-v1';
  var storageOK = true;
  var store = loadStore();

  function clampTarget(v) {
    v = Math.round(Number(v) || DEFR);
    return Math.max(1, Math.min(MAXR, v));
  }
  function loadStore() {
    try {
      var raw = localStorage.getItem(KEY);
      if (raw) {
        var o = JSON.parse(raw);
        return {
          v: 3,
          target: clampTarget(o && o.target),
          includeSun: (o && typeof o.includeSun === 'boolean') ? o.includeSun : true,
          checks: (o && o.checks && typeof o.checks === 'object') ? o.checks : {},
          reb: sanitizeReb(o && o.reb, clampTarget(o && o.target))
        };
      }
      var old = localStorage.getItem(OLD_KEY);
      if (old) {
        // 1.x: Day 번호로 저장했던 기록 → 320일(주일 제외) 3회독 일정의 날짜로 옮긴다
        var oo = JSON.parse(old), p3 = planBase(3, false), ch = {};
        Object.keys(oo.checks || {}).forEach(function (k) {
          var dd = p3.byId[Number(k)];
          if (dd) ch[dd.date] = oo.checks[k];
        });
        return { v: 3, target: 3, includeSun: true, checks: ch, reb: null };
      }
    } catch (e) { storageOK = false; }
    return { v: 3, target: DEFR, includeSun: true, checks: {}, reb: null };
  }
  function persist() {
    try {
      localStorage.setItem(KEY, JSON.stringify({
        v: 3, target: target, includeSun: store.includeSun, checks: store.checks, reb: store.reb
      }));
    } catch (e) { storageOK = false; }
  }

  /* ---------- '오늘부터 다시 맞추기' 기록 ---------- */
  function sanitizeSegs(raw) {
    if (!Array.isArray(raw)) return [];
    var out = [];
    raw.forEach(function (s) {
      if (!s || typeof s !== 'object') return;
      var b = Number(s.b);
      if (!(b >= 0 && b < BOOKS.length)) return;
      var printed = BOOKS[b].printed;
      var st = clampInt(s.s, 1, printed), en = clampInt(s.e, 1, printed);
      if (en < st) return;
      var del = Array.isArray(s.del) ? s.del.map(function (n) { return Number(n); }) : [];
      var delIn = del.filter(function (n) { return n >= st && n <= en; });
      out.push({ b: b, s: st, e: en, n: Math.max(0, en - st + 1 - delIn.length), del: delIn });
    });
    return out;
  }
  function sanitizeReb(raw, n) {
    if (!raw || typeof raw !== 'object' || !isIso(raw.from)) return null;
    if (!Array.isArray(raw.days) || !raw.days.length) return null;
    var days = [];
    for (var i = 0; i < raw.days.length; i++) {
      var x = raw.days[i];
      if (!x || !isIso(x.date) || x.date < raw.from) return null;
      var segs = sanitizeSegs(x.segs);
      var q = segs.reduce(function (a, s) { return a + s.n; }, 0);
      if (!q) continue;
      days.push({ date: x.date, round: clampInt(x.round, 1, n), rday: 0, q: q, segs: segs });
    }
    if (!days.length) return null;
    var reason = raw.reason === 'partial' ? 'partial' : 'rebalance';
    var orig = [];
    if (Array.isArray(raw.orig)) {
      var seen = {};
      raw.orig.forEach(function (it) {
        if (!it || typeof it !== 'object') return;
        var b = Number(it.b), q = Number(it.n);
        if (!(b >= 0 && b < BOOKS.length)) return;
        if (!(q >= 1 && q <= BOOKS[b].printed)) return;
        if ((BOOKS[b].deleted || []).indexOf(q) >= 0) return;
        var key = b + ':' + q;
        if (seen[key]) return;
        seen[key] = 1;
        orig.push({ b: b, n: q });
      });
    }
    return {
      from: raw.from,
      createdAt: typeof raw.createdAt === 'string' ? raw.createdAt : '',
      items: Math.max(0, Number(raw.items) || 0),
      dayCount: days.length,
      reason: reason,
      partialDate: (reason === 'partial' && isIso(raw.partialDate)) ? raw.partialDate : '',
      partialQ: Math.max(0, Number(raw.partialQ) || 0),
      partialTotal: Math.max(0, Number(raw.partialTotal) || 0),
      prevDone: !!raw.prevDone,
      orig: orig,
      days: days
    };
  }

  /* ---------- 오늘의 계획 (기본 + 다시 맞추기) ---------- */
  var target = clampTarget(store.target);
  var P = buildPlan();

  function buildPlan() {
    var base = planBase(target, store.includeSun);
    return store.reb ? withRebalance(base, store.reb) : base;
  }
  function replan() { P = buildPlan(); }

  function withRebalance(base, reb) {
    var days = [];
    base.days.forEach(function (d) {
      if (d.date >= reb.from) return;
      if (isDone(d.date)) {
        days.push({ id: 0, date: d.date, dow: d.dow, round: d.round, rday: 0, q: d.q, segs: d.segs });
        return;
      }
      // 다시 맞추기로 넘어간 지난 날 — 분량은 앞으로 옮겼으므로 빈 날로 둔다
      days.push({ id: 0, date: d.date, dow: d.dow, round: d.round, rday: 0, q: 0, segs: [], skip: true });
    });
    reb.days.forEach(function (x) {
      var segs = x.segs.map(function (s) {
        return { b: s.b, s: s.s, e: s.e, n: s.n, del: (s.del || []).slice() };
      });
      days.push({ id: 0, date: x.date, dow: parse(x.date).getDay(), round: x.round, rday: 0,
        q: segs.reduce(function (a, s) { return a + s.n; }, 0), segs: segs });
    });
    days.sort(function (a, b) { return a.date < b.date ? -1 : a.date > b.date ? 1 : 0; });
    days.forEach(function (d, i) { d.id = i + 1; });

    var rounds = [], rc = {};
    for (var r = 1; r <= base.n; r++) { rc[r] = 0; rounds.push({ no: r, start: '', end: '', days: 0, questions: 0 }); }
    days.forEach(function (d) {
      var x = rounds[d.round - 1];
      if (!x) return;
      d.rday = ++rc[d.round];
      if (d.skip) return;
      if (!x.start) x.start = d.date;
      x.end = d.date;
      x.days++;
      x.questions += d.q;
    });

    var plan = {
      n: base.n, includeSun: base.includeSun, dates: base.dates,
      days: days, rounds: rounds, byDate: {}, byId: {}, segs: []
    };
    days.forEach(function (d) { plan.byDate[d.date] = d; plan.byId[d.id] = d; });
    for (var ri = 0; ri < base.n; ri++) plan.segs.push(BOOKS.map(function () { return []; }));
    days.forEach(function (d) {
      if (d.skip) return;
      d.segs.forEach(function (s) { plan.segs[d.round - 1][s.b].push({ day: d, seg: s }); });
    });
    return plan;
  }

  function isDone(date) { return !!store.checks[date]; }

  /* ---------- 계산 ---------- */
  function statFor(days) {
    var done = 0, total = 0, doneDays = 0, studyDays = 0;
    for (var i = 0; i < days.length; i++) {
      var d = days[i];
      if (!d || !d.q) continue;
      studyDays++;
      total += d.q;
      if (isDone(d.date)) { done += d.q; doneDays++; }
    }
    return { done: done, total: total, doneDays: doneDays, days: studyDays, pct: total ? done / total * 100 : 0 };
  }
  function roundDays(no) { return P.days.filter(function (d) { return d.round === no && !d.skip; }); }
  function roundOfDate(iso) {
    if (P.byDate[iso] && !P.byDate[iso].skip) return P.byDate[iso].round;
    if (iso < META.start) return 1;
    return P.n;
  }
  // 이번 주 7칸: 일요일(주일) 시작 ~ 토요일 끝. 캘린더 탭(일~토)과 같은 주 경계를 쓴다.
  function weekOf(iso) {
    var t = parse(iso);
    var sunday = new Date(t.getFullYear(), t.getMonth(), t.getDate() - t.getDay());
    var out = [];
    for (var i = 0; i < 7; i++) out.push(new Date(sunday.getFullYear(), sunday.getMonth(), sunday.getDate() + i));
    return out;
  }
  function statWeek() {
    var days = weekOf(TODAY).map(function (d) { return P.byDate[ymd(d)]; }).filter(Boolean);
    return statFor(days);
  }
  function overdueDays() {
    var n = 0;
    for (var i = 0; i < P.days.length; i++) {
      var d = P.days[i];
      if (d.skip || isDone(d.date)) continue;
      if (d.date < TODAY) n++;
    }
    return n;
  }
  function nextStudyDay(iso) {
    for (var i = 0; i < P.days.length; i++) if (P.days[i].date > iso && !P.days[i].skip) return P.days[i];
    return null;
  }
  function fmtPct(v) {
    if (!v || v <= 0) return '0%';
    if (v >= 100) return '100%';
    return v.toFixed(1).replace(/\.0$/, '') + '%';
  }
  function perDayOf(days) { return days ? '약 ' + Math.round(PRINTED / days) + '문항' : '-'; }
  function perDayLabel(n) { return perDayOf(planBase(n, store.includeSun).rounds[0].days); }
  function studyDayLabel() {
    return P.dates.length + '일 (' + (store.includeSun ? '주일 포함' : '주일 제외') + ')';
  }

  /* ---------- 조각 ---------- */
  var CHK = '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M3 8.6 6.2 11.8 13 5"/></svg>';

  function segsHtml(d) {
    return d.segs.map(function (s) {
      var del = (s.del && s.del.length)
        ? '<span class="del"> · 삭제 ' + s.del.map(pad3).join(', ') + '</span>' : '';
      return '<div class="seg-line"><span>' + BOOKS[s.b].name + ' ' + pad3(s.s) + '~' + pad3(s.e) + del +
        '</span><span class="n">' + s.n + '문항</span></div>';
    }).join('');
  }
  function segsPlain(d) {
    return d.segs.map(function (s) {
      return BOOKS[s.b].name + ' ' + pad3(s.s) + '~' + pad3(s.e) + ' (' + s.n + '문항)';
    }).join(' · ');
  }
  // 오늘 일부만 완료해 조정한 날이면, 남은 문항이 어디로 갔는지 한 줄로 알린다
  function partialNote(d) {
    var r = store.reb;
    if (!r || r.reason !== 'partial' || r.partialDate !== d.date) return '';
    if (!(r.partialTotal > r.partialQ)) return '';
    return '<p class="tiny" style="margin-top:12px;color:var(--tx2)">' + r.partialTotal + '문항 중 ' + r.partialQ +
      '문항 완료 · 남은 ' + (r.partialTotal - r.partialQ) + '문항은 다음 학습일부터 다시 나눠 담았어요</p>';
  }
  function metric(name, sub, st, extra) {
    return '<div class="metric">' +
      '<div class="lab"><span class="name">' + name + (sub ? '<span>' + sub + '</span>' : '') + '</span>' +
      '<span class="val' + (st.pct > 0 ? '' : ' zero') + '">' + fmtPct(st.pct) + '</span></div>' +
      '<div class="bar"><i style="width:' + (st.pct > 0 ? Math.max(1.5, st.pct) : 0) + '%"></i></div>' +
      '<div class="foot"><span>' + extra[0] + '</span><span>' + extra[1] + '</span></div>' +
      '</div>';
  }

  /* ---------- 화면: 오늘 ---------- */
  function viewToday() {
    var t = TODAY;
    var day = P.byDate[t];
    var isSun = parse(t).getDay() === 0;
    var toExam = diffDays(t, META.exam);
    var toStart = diffDays(t, META.start);
    var curRound = roundOfDate(t);
    var all = statFor(P.days);
    var rd = statFor(roundDays(curRound));
    var wk = statWeek();
    var late = overdueDays();
    var h = '';

    h += '<section class="card">' +
      '<div class="row"><span class="pill gray">2028학년도 대비</span>' +
      '<button type="button" class="pill blue" data-action="openTarget">' + P.n + '회독 목표 ›</button></div>' +
      '<div class="dday">' + (toExam > 0 ? 'D-' + toExam : toExam === 0 ? 'D-DAY' : 'D+' + (-toExam)) +
      '<small>일 남음</small></div>' +
      '<p class="muted">2027. 11. 30(화) 장신대 신학대학원 입학고사' +
      (toStart > 0 ? ' · <b>공부 시작 D-' + toStart + '</b>'
        : toStart === 0 ? ' · <b>오늘이 첫날이에요</b>'
          : t > META.end ? ' · <b>공부 기간이 끝났어요</b>' : '') + '</p>' +
      '</section>';

    h += '<section class="card">' +
      metric('전체 ' + P.n + '회독', '', all, ['완료 ' + all.doneDays + '일 / ' + all.days + '일',
        nf(all.done) + ' / ' + nf(all.total) + '문항']) +
      '<div class="divider"></div>' +
      metric(curRound + '회독', '지금 회독 · ' + P.n + '회독 중', rd, ['완료 ' + rd.doneDays + '일 / ' + rd.days + '일',
        nf(rd.done) + ' / ' + nf(rd.total) + '문항']) +
      '<div class="divider"></div>' +
      metric('이번 주', '', wk, ['완료 ' + wk.doneDays + '일 / ' + wk.days + '일',
        wk.days ? nf(wk.done) + ' / ' + nf(wk.total) + '문항' : '학습일이 없어요']) +
      '</section>';

    if (late > 0 || store.reb) {
      var partToday = !!store.reb && store.reb.reason === 'partial' && store.reb.partialDate === TODAY;
      var adjHead = late > 0 ? '진도가 밀렸어요' : (partToday ? '공부량 조정됨' : '다시 맞춘 계획');
      var adjDesc = late > 0
        ? '지난 ' + late + '일 분량까지 오늘부터 시험 전날까지 다시 나눠요. 완료한 기록은 그대로 남아요.'
        : (partToday
          ? md(store.reb.partialDate) + '에 고른 ' + store.reb.partialQ + '문항만 완료로 남기고' +
            (store.reb.partialTotal > store.reb.partialQ
              ? ' 남은 ' + (store.reb.partialTotal - store.reb.partialQ) + '문항은 다음 학습일부터 다시 나눠 담았어요.'
              : ' 남은 문항 없이 전부 마쳤어요.') + ' 완료한 기록은 그대로예요.'
          : '남은 분량을 ' + store.reb.dayCount + '일에 나눠 담았어요. 완료한 기록은 그대로예요.');
      h += '<section class="card">' +
        '<div class="row"><div class="study-top"><div class="study-badge">↻</div>' +
        '<div><p class="muted">일정 조정</p><div class="h2" style="margin-top:2px">' + adjHead +
        '</div></div></div>' +
        (late > 0 ? '<span class="pill red">' + late + '일</span>'
          : '<span class="pill blue">' + md(partToday ? store.reb.partialDate : store.reb.from) +
            (partToday ? ' 조정' : '부터') + '</span>') +
        '</div>' +
        '<p class="muted" style="margin-top:12px">' + adjDesc + '</p>' +
        (late > 0 ? '<button class="btn" type="button" data-action="rebalance">오늘부터 다시 맞추기</button>' : '') +
        (store.reb ? '<button class="btn ghost" type="button" data-action="undoRebalance">원래대로 되돌리기</button>' : '') +
        '</section>';
    }

    if (day && !day.skip) {
      var done = isDone(day.date);
      h += '<section class="card' + (done ? ' soft' : '') + '">' +
        '<div class="row">' +
        '<div class="study-top"><div class="study-badge">' + day.round + '회독</div>' +
        '<div><p class="muted">오늘의 공부</p><div class="h2" style="margin-top:2px">Day ' + day.id + '</div></div></div>' +
        '<span class="pill ' + (done ? 'green' : 'blue') + '">' + (done ? '완료' : day.q + '문항') + '</span>' +
        '</div>' +
        '<div class="seg-list">' + segsHtml(day) + '</div>' +
        partialNote(day) +
        '<div class="btn-row">' +
        '<button class="btn ghost wide" type="button" data-action="openAdjust" data-date="' + day.date + '">공부량 조정</button>' +
        '<button class="btn ' + (done ? 'done' : '') + '" type="button" data-action="toggle" data-date="' + day.date + '">' +
        (done ? '완료 취소' : '완료') + '</button>' +
        '</div>' +
        '</section>';
    } else if (day && day.skip) {
      h += '<section class="card">' +
        '<p class="muted">오늘의 공부</p>' +
        '<div class="h2" style="margin-top:2px">다시 맞추며 넘어간 날</div>' +
        '<p class="muted" style="margin-top:8px">이 날 분량은 앞으로 옮겨 담았어요. 남은 일정을 보세요.</p>' +
        '</section>';
    } else if (isSun && !store.includeSun && t >= META.start && t <= META.end) {
      var nx = nextStudyDay(t);
      h += '<section class="card soft">' +
        '<div class="row"><div class="study-top"><div class="study-badge">주일</div>' +
        '<div><p class="muted">오늘은 주일</p><div class="h2" style="margin-top:2px">주일 휴식</div></div></div>' +
        '<span class="pill green">쉬는 날</span></div>' +
        '<p class="muted" style="margin-top:14px">오늘은 공부를 쉬어가요. 주일은 계획에서 빼두었어요.</p>' +
        (nx ? '<div style="margin-top:14px"><p class="tiny">다음 학습 · ' + longKo(nx.date) + ' · Day ' + nx.id + '</p>' +
          '<div class="seg-list">' + segsHtml(nx) + '</div></div>' : '') +
        '</section>';
    } else if (t < META.start) {
      var d1 = P.days[0];
      h += '<section class="card">' +
        '<div class="row"><div class="study-top"><div class="study-badge">시작</div>' +
        '<div><p class="muted">아직 시작 전이에요</p><div class="h2" style="margin-top:2px">' +
        longKo(META.start) + ' 시작</div></div></div>' +
        '<span class="pill blue">D-' + toStart + '</span></div>' +
        '<div style="margin-top:14px"><p class="tiny">첫날 공부 · Day 1</p>' +
        '<div class="seg-list">' + segsHtml(d1) + '</div></div>' +
        '<p class="tiny" style="margin-top:14px">시작하는 날 이 화면에서 바로 완료 체크를 할 수 있어요.</p>' +
        '</section>';
    } else {
      h += '<section class="card">' +
        '<p class="muted">공부 기간이 끝났어요</p>' +
        '<div class="h2" style="margin-top:4px">모두 수고했어요</div>' +
        '<p class="muted" style="margin-top:8px">기록은 그대로 남아 있어요. 시험 준비 마무리까지 화이팅!</p>' +
        '</section>';
    }

    var cells = weekOf(t).map(function (dt) {
      var iso = ymd(dt), d = P.byDate[iso], sun = dt.getDay() === 0;
      var cls = 'wcell', lab = '';
      if (sun && !store.includeSun) { cls += ' sun'; lab = '주일'; }
      else if (d && d.skip) { lab = '–'; }
      else if (d && isDone(d.date)) { cls += ' done'; lab = '완료'; }
      else if (iso === t) { lab = '오늘'; }
      else if (d && iso < t) { cls += ' miss'; lab = '미완료'; }
      if (iso === t) cls += ' today';
      return '<button type="button" class="' + cls + '" data-action="jump" data-date="' + iso + '" aria-label="' + iso + '">' +
        '<span class="wd">' + DOW[dt.getDay()] + '</span><span class="wn">' + dt.getDate() + '</span>' +
        '<span class="ws">' + lab + '</span></button>';
    }).join('');
    h += '<div class="section-title">이번 주</div><section class="card week">' + cells + '</section>';

    return h;
  }

  /* ---------- 화면: 회독 ---------- */
  function viewRounds() {
    var r = P.rounds[state.round - 1] || { no: state.round, start: '', end: '', days: 0, questions: 0 };
    var days = roundDays(state.round);
    var rowDays = P.days.filter(function (d) { return d.round === state.round; });
    var st = statFor(days);
    var h = '';

    h += '<section class="card">' +
      '<div class="row"><div><p class="muted">목표 회독</p>' +
      '<div class="h2" style="margin-top:2px">' + P.n + '회독</div></div>' +
      '<button type="button" class="btn ghost sm" data-action="openTarget">회독 수 변경</button></div>' +
      '<p class="tiny" style="margin-top:10px">' + studyDayLabel() + ' · 회독당 ' + r.days + '일 · 하루 ' + perDayOf(r.days) + '</p>' +
      '</section>';

    h += '<div class="chips">' + P.rounds.map(function (x) {
      return '<button type="button" class="chip' + (x.no === state.round ? ' on' : '') + '" data-action="round" data-round="' + x.no + '">' +
        x.no + '회독</button>';
    }).join('') + '</div>';

    h += '<section class="card" style="margin-top:8px">' +
      '<div class="row"><span class="range-line">' +
      (r.start ? r.start.replace(/-/g, '.') + ' ~ ' + r.end.replace(/-/g, '.') : '남은 일정 없음') + '</span>' +
      '<span class="pill gray">' + st.days + '일</span></div>' +
      '<div class="metric" style="margin-top:14px">' +
      '<div class="lab"><span class="name">' + state.round + '회독 진행률</span>' +
      '<span class="val' + (st.pct > 0 ? '' : ' zero') + '">' + fmtPct(st.pct) + '</span></div>' +
      '<div class="bar"><i style="width:' + (st.pct > 0 ? Math.max(1.5, st.pct) : 0) + '%"></i></div>' +
      '<div class="foot"><span>완료 ' + st.doneDays + '일 / ' + st.days + '일</span>' +
      '<span>' + nf(st.done) + ' / ' + nf(st.total) + '문항</span></div></div>' +
      '</section>';

    h += '<div class="seg-row"><span class="section-title" style="margin:0">' +
      (state.mode === 'date' ? '날짜별 일정' : '권별 일정') + '</span>' +
      '<div class="seg small" style="width:150px">' +
      '<button type="button" class="' + (state.mode === 'date' ? 'on' : '') + '" data-action="mode" data-mode="date">날짜별</button>' +
      '<button type="button" class="' + (state.mode === 'book' ? 'on' : '') + '" data-action="mode" data-mode="book">권별</button>' +
      '</div></div>';

    if (state.mode === 'date') {
      var cur = '', list = '';
      rowDays.forEach(function (d) {
        var mk = d.date.slice(0, 7);
        if (mk !== cur) {
          if (list) h += list + '</div>';
          cur = mk;
          var my = Number(mk.slice(0, 4)), mm = Number(mk.slice(5, 7));
          var mdays = rowDays.filter(function (x) { return x.date.slice(0, 7) === mk; });
          var mst = statFor(mdays);
          h += '<div class="section-title">' + my + '년 ' + mm + '월' +
            '<span class="muted" style="font-weight:700;font-size:12px;margin-left:6px">' +
            mst.doneDays + '/' + mst.days + '일 완료</span></div>';
          list = '<div class="list">';
        }
        var done = isDone(d.date);
        if (d.skip) {
          list += '<div class="item skip" data-date="' + d.date + '">' +
            '<span class="grow"><span class="t1">Day ' + d.id + '<span class="d">' + md(d.date) + '</span></span>' +
            '<span class="t2">다시 맞추며 앞으로 옮긴 날</span></span>' +
            '<span class="qcount">–</span></div>';
          return;
        }
        list += '<button type="button" class="item' + (done ? ' done' : '') + '" data-action="toggle" data-date="' + d.date + '">' +
          '<span class="chk">' + CHK + '</span>' +
          '<span class="grow"><span class="t1">Day ' + d.id + '<span class="d">' + md(d.date) + '</span>' +
          (d.date === TODAY ? '<span class="pill blue" style="padding:2px 6px;font-size:10px">오늘</span>' : '') + '</span>' +
          d.segs.map(function (s) {
            return '<span class="t2">' + BOOKS[s.b].name + ' ' + pad3(s.s) + '~' + pad3(s.e) +
              (s.del && s.del.length ? ' · 삭제' : '') + '</span>';
          }).join('') + '</span>' +
          '<span class="qcount">' + d.q + '문항</span>' +
          '</button>';
      });
      if (list) h += list + '</div>';
    } else {
      h += '<div class="list">';
      BOOKS.forEach(function (b, i) {
        var segs = P.segs[state.round - 1][i];
        var total = segs.reduce(function (a, x) { return a + x.seg.n; }, 0);
        var done = segs.reduce(function (a, x) { return a + (isDone(x.day.date) ? x.seg.n : 0); }, 0);
        var open = state.book === i;
        h += '<button type="button" class="item' + (total && done === total ? ' done' : '') + (open ? ' open' : '') +
          '" data-action="book" data-book="' + i + '">' +
          '<span class="grow"><span class="t1">' + b.name + ' <span class="tag">' + b.testament + '</span></span>' +
          '<span class="t2">' + state.round + '회독 완료 ' + done + ' / ' + total + '문항' +
          (b.deleted.length ? ' · 삭제 ' + b.deleted.map(pad3).join(', ') + ' 제외' : '') + '</span></span>' +
          '<span class="chev">›</span></button>';
        if (open) {
          h += '<div class="sub-list">' + segs.map(function (x) {
            var dd = isDone(x.day.date);
            return '<button type="button" class="srow' + (dd ? ' done' : '') + '" data-action="toggle" data-date="' + x.day.date + '">' +
              '<span class="chk">' + CHK + '</span>' +
              '<span class="grow"><span class="st">' + pad3(x.seg.s) + '~' + pad3(x.seg.e) + '</span> ' +
              '<span class="sd">· ' + x.seg.n + '문항</span></span>' +
              '<span class="sd">Day ' + x.day.id + ' · ' + md(x.day.date) + '</span></button>';
          }).join('') + '</div>';
        }
      });
      h += '</div>';
    }
    return h;
  }

  /* ---------- 화면: 캘린더 ---------- */
  function calInit() {
    var d = parse(TODAY), y = d.getFullYear(), m = d.getMonth() + 1;
    if (y < 2026 || (y === 2026 && m < 11)) { y = 2026; m = 11; }
    if (y > 2027 || (y === 2027 && m > 11)) { y = 2027; m = 11; }
    return { y: y, m: m };
  }
  function viewCalendar() {
    if (!state.cal) state.cal = calInit();
    var y = state.cal.y, m = state.cal.m;
    var first = new Date(y, m - 1, 1);
    var lead = first.getDay();
    var lastDate = new Date(y, m, 0).getDate();
    var total = Math.ceil((lead + lastDate) / 7) * 7;
    var h = '';

    var canPrev = !(y === 2026 && m === 11);
    var canNext = !(y === 2027 && m === 11);

    var mdays = P.days.filter(function (d) { return d.date.slice(0, 7) === y + '-' + pad2(m); });
    var mst = statFor(mdays);

    h += '<section class="card cal">' +
      '<div class="cal-head">' +
      '<button type="button" class="navbtn" data-action="calPrev"' + (canPrev ? '' : ' disabled') + ' aria-label="이전 달">‹</button>' +
      '<div class="cal-title">' + y + '년 ' + m + '월</div>' +
      '<button type="button" class="navbtn" data-action="calNext"' + (canNext ? '' : ' disabled') + ' aria-label="다음 달">›</button>' +
      '</div>' +
      '<div class="cal-sum">학습일 ' + mst.days + '일 · 완료 ' + mst.doneDays + '일</div>' +
      '<div class="dow-row"><span>일</span><span>월</span><span>화</span><span>수</span><span>목</span><span>금</span><span>토</span></div>' +
      '<div class="cal-grid">';

    for (var i = 0; i < total; i++) {
      var dn = i - lead + 1;
      if (dn < 1 || dn > lastDate) { h += '<div class="cell out"></div>'; continue; }
      var dt = new Date(y, m - 1, dn);
      var iso = ymd(dt);
      var day = P.byDate[iso];
      var sun = dt.getDay() === 0;
      var cls = 'cell', lab = '';
      if (sun && !store.includeSun) { cls += ' sun'; lab = '주일'; }
      else if (day && day.skip) { cls += ' off'; lab = '–'; }
      else if (day && isDone(day.date)) { cls += ' done'; lab = '완료'; }
      else if (day && iso < TODAY) { cls += ' miss'; lab = '미완료'; }
      else if (day) { cls += ' plan'; }
      if (iso === TODAY) cls += ' today';
      if (state.sel === iso) cls += ' sel';
      h += '<button type="button" class="' + cls + '" data-action="calSelect" data-date="' + iso + '"' +
        ' aria-label="' + iso + (day && !day.skip ? ' ' + day.round + '회독 Day ' + day.id : '') + '">' +
        '<span class="cn">' + dn + '</span><span class="cs">' + lab + '</span></button>';
    }
    h += '</div>' +
      '<div class="legend">' +
      '<span><i style="background:var(--pri)"></i>완료</span>' +
      '<span><i style="background:var(--red-soft);box-shadow:inset 0 0 0 1px var(--red)"></i>미완료</span>' +
      '<span><i style="background:#fff;box-shadow:inset 0 0 0 2px var(--pri)"></i>오늘</span>' +
      (store.includeSun ? '' : '<span><i style="background:#FAFBFC;box-shadow:inset 0 0 0 1px var(--line)"></i>주일 휴식</span>') +
      '</div></section>';

    if (!state.sel) state.sel = TODAY;
    var sel = state.sel;
    var sday = P.byDate[sel];
    var ssun = parse(sel).getDay() === 0;
    h += '<section class="card" style="margin-top:12px">';
    if (sday && !sday.skip) {
      var done = isDone(sday.date);
      h += '<div class="row"><div class="grow"><p class="muted">' + sday.round + '회독 · Day ' + sday.id + '</p>' +
        '<div class="h2" style="margin-top:2px">' + longKo(sel) + '</div></div>' +
        '<span class="pill ' + (done ? 'green' : 'blue') + '">' + (done ? '완료' : sday.q + '문항') + '</span></div>' +
        '<div class="seg-list">' + segsHtml(sday) + '</div>' +
        '<button class="btn ' + (done ? 'ghost' : '') + '" type="button" data-action="toggle" data-date="' + sday.date + '">' +
        (done ? '✓ 완료했어요 · 되돌리기' : '공부 완료로 표시') + '</button>';
    } else if (sday && sday.skip) {
      h += '<div class="row"><div class="grow"><p class="muted">' + sday.round + '회독</p>' +
        '<div class="h2" style="margin-top:2px">' + longKo(sel) + '</div></div>' +
        '<span class="pill gray">넘어감</span></div>' +
        '<p class="muted" style="margin-top:10px">일정을 다시 맞추면서 이 날 분량을 앞으로 옮겼어요.</p>';
    } else if (ssun && !store.includeSun) {
      var nx2 = nextStudyDay(sel);
      h += '<div class="row"><div class="grow"><p class="muted">주일</p>' +
        '<div class="h2" style="margin-top:2px">' + longKo(sel) + '</div></div>' +
        '<span class="pill green">휴식</span></div>' +
        '<p class="muted" style="margin-top:10px">주일은 공부 계획에서 빼두었어요.</p>' +
        (nx2 ? '<p class="tiny" style="margin-top:8px">다음 학습 · Day ' + nx2.id + ' · ' + segsPlain(nx2) + '</p>' : '');
    } else {
      h += '<p class="muted">' + longKo(sel) + '</p>' +
        '<div class="h2" style="margin-top:4px">학습 기간이 아니에요</div>' +
        '<p class="muted" style="margin-top:8px">공부 기간은 ' + longKo(META.start) + ' ~ ' + longKo(META.end) + ' 이에요.</p>';
    }
    h += '</section>';
    return h;
  }

  /* ---------- 화면: 더보기 ---------- */
  function viewMore() {
    var all = statFor(P.days);
    var last = null;
    Object.keys(store.checks).forEach(function (k) {
      var v = Number(store.checks[k]) || 0;
      if (!last || v > last) last = v;
    });
    var h = '';

    h += '<section class="card"><div class="more-hero">' +
      '<img class="logo" src="icon-192.png" alt="" width="52" height="52">' +
      '<div class="grow"><div class="h2">장신대 플래너</div>' +
      '<p class="muted" style="margin-top:2px">2028학년도 장신대 신학대학원 입학고사 ' + P.n + '회독</p></div></div></section>';

    h += '<div class="section-title">공부 기록</div><div class="list">' +
      '<div class="info-row"><span class="k">완료한 날</span><span class="v">' + all.doneDays + '일 / ' + all.days + '일</span></div>' +
      '<div class="info-row"><span class="k">완료한 문항</span><span class="v">' + nf(all.done) + ' / ' + nf(all.total) + '문항</span></div>' +
      '<div class="info-row"><span class="k">마지막 체크</span><span class="v">' + (last ? longKo(ymd(new Date(last))) : '아직 없음') + '</span></div>' +
      '</div>';

    h += '<div class="section-title">공부 계획</div><div class="list">' +
      '<button type="button" class="item" data-action="openTarget"><span class="grow">' +
      '<span class="t1">목표 회독</span><span class="t2">1회독부터 ' + MAXR + '회독까지 고를 수 있어요</span></span>' +
      '<span class="v" style="font-weight:800;color:var(--pri)">' + P.n + '회독 ›</span></button>' +
      '<button type="button" class="item" data-action="toggleSun" role="switch" aria-checked="' + (store.includeSun ? 'true' : 'false') + '">' +
      '<span class="grow"><span class="t1">주일에도 공부하기</span>' +
      '<span class="t2">일요일도 학습일에 넣어요 · 주일 포함 ' + DATES_SUN.length + '일 · 제외 ' + DATES_WEEK.length + '일</span></span>' +
      '<span class="sw' + (store.includeSun ? ' on' : '') + '"><i></i></span></button>' +
      '<div class="info-row"><span class="k">회독당</span><span class="v">' + P.rounds[0].days + '일 · 하루 ' + perDayOf(P.rounds[0].days) + '</span></div>' +
      '<div class="info-row"><span class="k">1회독 범위</span><span class="v">' + META.books + '권 ' + nf(META.printedQuestions) + '문항</span></div>' +
      '</div>';

    h += '<div class="section-title">일정 조정</div><div class="list">' +
      '<button type="button" class="item" data-action="rebalance"><span class="grow">' +
      '<span class="t1">오늘부터 다시 맞추기</span>' +
      '<span class="t2">밀린 분량까지 오늘부터 시험 전날까지 다시 나눠요</span></span>' +
      '<span class="chev">›</span></button>' +
      (store.reb
        ? '<button type="button" class="item" data-action="undoRebalance"><span class="grow">' +
          '<span class="t1">원래대로 되돌리기</span>' +
          '<span class="t2">다시 맞추기 전 계획으로 돌아가요</span></span>' +
          '<span class="chev">›</span></button>' +
          '<div class="info-row"><span class="k">다시 맞춘 날</span><span class="v">' +
          store.reb.from.replace(/-/g, '.') + '부터 ' + store.reb.dayCount + '일</span></div>'
        : '<div class="info-row"><span class="k">지난 미완료</span><span class="v">' + overdueDays() + '일</span></div>') +
      '</div>';

    h += '<div class="section-title">곧 추가될 탭</div><div class="list">' +
      slot('pen', '논술 공부', '논술 예상문제·답안 정리 계획') +
      slot('run', '운동 루틴', '매일 운동 체크와 기록') +
      slot('plus', '다른 공부', '원하는 과목을 탭으로 추가') +
      '</div>' +
      '<p class="tiny" style="margin:8px 4px 0">이 앱은 탭을 늘려 쓸 수 있게 만들어 두었어요. 필요하면 말씀해 주세요.</p>';

    h += '<div class="section-title">데이터</div><div class="list">' +
      '<button type="button" class="item" data-action="export"><span class="grow">' +
      '<span class="t1">JSON으로 내보내기(백업)</span><span class="t2">체크 기록과 회독 수를 파일로 저장해요</span></span>' +
      '<span class="chev">›</span></button>' +
      '<button type="button" class="item" data-action="import"><span class="grow">' +
      '<span class="t1">JSON 불러오기(복원)</span><span class="t2">백업 파일로 기록을 되살려요</span></span>' +
      '<span class="chev">›</span></button>' +
      '<button type="button" class="item" data-action="reset"><span class="grow">' +
      '<span class="t1" style="color:var(--red)">전체 초기화</span><span class="t2">모든 체크를 지워요</span></span>' +
      '<span class="chev">›</span></button>' +
      '</div>';

    h += '<div class="section-title">학습 정보</div><div class="list">' +
      '<div class="info-row"><span class="k">공부 기간</span><span class="v">' + META.start.replace(/-/g, '.') + ' ~ ' + META.end.replace(/-/g, '.') + '</span></div>' +
      '<div class="info-row"><span class="k">학습일</span><span class="v">' + studyDayLabel() + '</span></div>' +
      '<div class="info-row"><span class="k">범위</span><span class="v">' + META.books + '권 ' + nf(META.printedQuestions) + '문항 × ' + P.n + '회독</span></div>' +
      '<div class="info-row"><span class="k">삭제 문항</span><span class="v" style="font-size:12.5px">' + META.deleted.join(' · ') + '</span></div>' +
      '<div class="info-row"><span class="k">앱 버전</span><span class="v">1.4.0</span></div>' +
      '</div>';

    h += '<div class="section-title">홈 화면에 추가</div>' +
      '<details class="guide"><summary>아이폰 단독 앱처럼 쓰는 방법</summary><div class="guide-body">' +
      '<ol><li>사파리에서 이 페이지를 열어요.</li>' +
      '<li>하단 가운데 <b>공유</b> 버튼(□↑)을 눌러요.</li>' +
      '<li>목록에서 <b>홈 화면에 추가</b>를 선택해요.</li>' +
      '<li>홈 화면의 <b>장신대 플래너</b> 아이콘으로 열면 주소창 없는 앱처럼 실행돼요.</li></ol>' +
      '<p style="margin-top:8px">체크 기록은 이 기기(브라우저) 안에만 저장돼요. 사파리와 홈 화면 앱은 저장 공간이 나뉠 수 있으니, ' +
      '기기를 바꾸거나 기록이 안 보이면 위의 <b>JSON 내보내기 → 불러오기</b>로 옮겨 주세요.</p>' +
      '</div></details>';

    h += '<p class="tiny" style="margin:14px 4px 0;color:var(--tx3)">일정 기준 · ' + META.source + ' (' + META.edition + ')</p>';
    return h;
  }

  var ICO = {
    pen: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 20h4.2L19 9.2a2.9 2.9 0 0 0-4.2-4.2L4 15.8V20z"/><path d="M14.2 5.6 18.4 9.8"/></svg>',
    run: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3.5 13.2h3.3l2-5.2 3.1 9.6 2.1-4.4h5"/></svg>',
    plus: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 5v14M5 12h14"/></svg>'
  };
  function slot(ico, t1, t2) {
    return '<div class="slot"><div class="ico">' + (ICO[ico] || ico) + '</div><div class="grow">' +
      '<div class="t1">' + t1 + ' <span class="pill gray" style="padding:2px 6px;font-size:10px">준비 중</span></div>' +
      '<div class="t2">' + t2 + '</div></div></div>';
  }

  /* ---------- 상태 & 렌더 ---------- */
  var state = {
    tab: 'today',
    round: roundOfDate(TODAY),
    mode: 'date',
    cal: null,
    sel: TODAY,
    book: -1
  };

  var VIEWS = { today: viewToday, rounds: viewRounds, calendar: viewCalendar, more: viewMore };

  function titleFor() {
    if (state.tab === 'today') return '오늘';
    if (state.tab === 'rounds') return P.n + '회독';
    if (state.tab === 'calendar') return '캘린더';
    return '더보기';
  }
  function subFor() {
    if (state.tab === 'today') return md(TODAY);
    if (state.tab === 'rounds') return state.round + ' / ' + P.n + '회독 · ' + roundDays(state.round).length + '일';
    if (state.tab === 'calendar') return state.cal ? state.cal.y + '년 ' + state.cal.m + '월' : '';
    return '설정 · 백업';
  }
  function updateChrome() {
    Array.prototype.forEach.call(document.querySelectorAll('.tab'), function (b) {
      b.classList.toggle('on', b.dataset.tab === state.tab);
    });
    var rl = document.querySelector('.tab[data-tab="rounds"] span');
    if (rl) rl.textContent = P.n + '회독';
    document.getElementById('appTitle').textContent = titleFor();
    document.getElementById('appSub').textContent = subFor();
  }
  function render() {
    view.innerHTML = VIEWS[state.tab]();
    updateChrome();
  }
  function switchTab(tab, opts) {
    state.tab = tab;
    if (opts && opts.date) {
      var d = parse(opts.date);
      state.cal = { y: d.getFullYear(), m: d.getMonth() + 1 };
      state.sel = opts.date;
    }
    render();
    window.scrollTo(0, 0);
  }

  /* ---------- 시트 ---------- */
  var sheet = document.getElementById('sheet');
  var sheetBody = document.getElementById('sheetBody');
  var backdrop = document.getElementById('backdrop');
  var sheetState = null;

  function daySheetHtml(date) {
    var d = P.byDate[date];
    if (!d || d.skip) {
      return '<p class="muted">' + (d ? d.round + '회독' : '') + '</p>' +
        '<h3>' + longKo(date) + '</h3>' +
        '<p class="muted" style="margin-top:10px">일정을 다시 맞추면서 이 날 분량을 앞으로 옮겼어요.</p>' +
        '<button class="btn ghost" type="button" data-action="closeSheet" style="margin-top:16px">닫기</button>';
    }
    var done = isDone(date);
    return '<p class="muted">' + d.round + '회독 · Day ' + d.id + ' / ' + P.n + '회독 계획</p>' +
      '<h3>' + longKo(date) + '</h3>' +
      '<p class="tiny" style="margin-top:2px">' + (done ? '완료한 날이에요' : '아직 체크하지 않았어요') + '</p>' +
      '<div class="seg-list" style="margin-top:16px">' + segsHtml(d) + '</div>' +
      '<button class="btn ' + (done ? 'ghost' : '') + '" type="button" data-action="toggle" data-date="' + date + '">' +
      (done ? '✓ 완료했어요 · 되돌리기' : '공부 완료로 표시') + '</button>' +
      '<button class="btn ghost" type="button" data-action="closeSheet" style="margin-top:8px">닫기</button>';
  }
  function targetSheetHtml() {
    var rows = '';
    for (var n = 1; n <= MAXR; n++) {
      var p = planBase(n, store.includeSun);
      rows += '<button type="button" class="opt' + (n === P.n ? ' on' : '') + '" data-action="setTarget" data-n="' + n + '">' +
        '<span><span class="n">' + n + '회독</span>' +
        '<span class="d">' + p.rounds[0].days + '일 · 하루 ' + perDayLabel(n) + '</span></span>' +
        '<span class="ck">' + (n === P.n ? '✓' : '') + '</span></button>';
    }
    return '<h3 style="margin-top:2px">목표 회독</h3>' +
      '<p class="tiny" style="margin-top:4px">' + studyDayLabel() + '을 몇 번 나눠 풀지 골라 주세요.</p>' +
      '<div class="opt-grid">' + rows + '</div>' +
      '<p class="tiny" style="margin-top:12px">회독 수를 바꾸면 하루 분량이 다시 나뉘어요. 이미 체크한 날짜 기록은 그대로 남아요.</p>' +
      '<button class="btn ghost" type="button" data-action="closeSheet">닫기</button>';
  }
  /* ---------- 시트: 공부량 조정 ---------- */
  function adjustSheetHtml() {
    var date = sheetState.date;
    var d = P.byDate[date];
    var items = sheetState.items || [];
    var sel = sheetState.sel || {};
    if (!d || d.skip || !items.length) {
      return '<h3>공부량 조정</h3>' +
        '<p class="muted" style="margin-top:10px">조정할 수 있는 날이 아니에요.</p>' +
        '<button class="btn ghost" type="button" data-action="closeSheet" style="margin-top:16px">닫기</button>';
    }
    var groups = [], cur = null;
    items.forEach(function (it) {
      if (!cur || cur.b !== it.b) { cur = { b: it.b, s: it.n, e: it.n, items: [] }; groups.push(cur); }
      cur.e = it.n;
      cur.items.push(it);
    });
    var selCount = Object.keys(sel).length;
    var h = '<p class="muted">' + d.round + '회독 · Day ' + d.id + ' · ' + md(date) + '</p>' +
      '<h3>오늘 푼 문항</h3>' +
      '<p class="tiny" style="margin-top:6px">푼 번호를 콕콕 눌러 주세요. 고른 만큼만 오늘 완료로 기록하고, 남은 문항은 다음 학습일부터 다시 나누어 담아요.</p>' +
      '<div class="adj-sum"><span id="adjCount">' + selCount + ' / ' + items.length + '문항</span>' +
      '<button type="button" class="linkbtn" data-action="adjAll">' +
      (selCount === items.length ? '전체 해제' : '전체 선택') + '</button></div>' +
      '<div class="adj-wrap">';
    groups.forEach(function (g) {
      h += '<div class="adj-book">' +
        '<div class="adj-book-head">' + BOOKS[g.b].name +
        '<span>' + pad3(g.s) + '~' + pad3(g.e) + ' · ' + g.items.length + '문항</span></div>' +
        '<div class="chgrid">' + g.items.map(function (it) {
          var k = it.b + ':' + it.n;
          return '<button type="button" class="chcell' + (sel[k] ? ' on' : '') + '" data-action="adjToggle"' +
            ' data-key="' + k + '" aria-pressed="' + (sel[k] ? 'true' : 'false') + '">' + it.n + '</button>';
        }).join('') + '</div></div>';
    });
    h += '</div>' +
      '<div class="btn-row">' +
      '<button type="button" class="btn ghost" data-action="closeSheet">취소</button>' +
      '<button type="button" class="btn" data-action="adjApply">완료</button>' +
      '</div>';
    return h;
  }

  function openAdjust(date) {
    var d = P.byDate[date];
    if (!d || d.skip) return;
    var items = adjustUniverse(date);
    var sel = {};
    if (isDone(date)) itemsOfDay(d).forEach(function (it) { sel[it.b + ':' + it.n] = true; });
    sheetState = { type: 'adjust', date: date, items: items, sel: sel };
    renderSheet();
    sheet.classList.add('on');
    backdrop.classList.add('on');
    sheet.setAttribute('aria-hidden', 'false');
  }

  function updateAdjustUI() {
    if (!sheetState || sheetState.type !== 'adjust') return;
    var sel = sheetState.sel;
    var cells = sheetBody.querySelectorAll('.chcell');
    for (var i = 0; i < cells.length; i++) {
      var on = !!sel[cells[i].dataset.key];
      cells[i].classList.toggle('on', on);
      cells[i].setAttribute('aria-pressed', on ? 'true' : 'false');
    }
    var n = Object.keys(sel).length;
    var c = sheetBody.querySelector('#adjCount');
    if (c) c.textContent = n + ' / ' + sheetState.items.length + '문항';
    var allBtn = sheetBody.querySelector('[data-action="adjAll"]');
    if (allBtn) allBtn.textContent = (n === sheetState.items.length) ? '전체 해제' : '전체 선택';
  }

  function applyAdjust() {
    var date = sheetState.date;
    var sel = sheetState.sel || {};
    var prev = store.reb;
    var prevPartial = !!(prev && prev.reason === 'partial' && prev.partialDate === date);
    var universe = adjustUniverse(date);
    var chosen = universe.filter(function (it) { return sel[it.b + ':' + it.n]; });
    if (!chosen.length) { toast('푼 문항을 하나 이상 골라 주세요'); return; }
    var rest = universe.length - chosen.length;
    if (!rest && !prevPartial) {
      store.checks[date] = Date.now();
      persist();
      closeSheet();
      render();
      toast('완료! ' + universe.length + '문항 진행률에 반영했어요');
      return;
    }
    doPartial(date, chosen, universe);
  }

  function renderSheet() {
    if (!sheetState) return;
    var type = sheetState.type;
    sheetBody.innerHTML = type === 'day' ? daySheetHtml(sheetState.date)
      : type === 'adjust' ? adjustSheetHtml()
        : targetSheetHtml();
  }
  function openSheet(st) {
    sheetState = st;
    renderSheet();
    sheet.classList.add('on');
    backdrop.classList.add('on');
    sheet.setAttribute('aria-hidden', 'false');
  }
  function closeSheet() {
    sheetState = null;
    sheet.classList.remove('on');
    backdrop.classList.remove('on');
    sheet.setAttribute('aria-hidden', 'true');
  }

  /* ---------- 토스트 ---------- */
  var toastEl = document.getElementById('toast');
  var toastTimer = null;
  function toast(msg) {
    toastEl.textContent = msg;
    toastEl.classList.add('on');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { toastEl.classList.remove('on'); }, 2200);
  }

  /* ---------- 백업 ---------- */
  function exportJSON() {
    var payload = {
      app: 'jangsin-planner', version: 3, exportedAt: new Date().toISOString(),
      target: P.n, includeSun: store.includeSun, checks: store.checks, reb: store.reb
    };
    var blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url;
    a.download = '장신대플래너_백업_' + TODAY + '.json';
    document.body.appendChild(a);
    a.click();
    setTimeout(function () { URL.revokeObjectURL(url); a.remove(); }, 1500);
    toast('백업 파일을 내려받았어요');
  }

  function normalizeImport(obj) {
    if (!obj || typeof obj !== 'object') return null;
    var src = (obj.checks && typeof obj.checks === 'object') ? obj.checks : obj;
    var out = {};
    Object.keys(src).forEach(function (k) {
      var key = String(k);
      if (/^\d{4}-\d{2}-\d{2}$/.test(key)) {
        out[key] = Number(src[k]) || Date.now();
      } else if (/^\d+$/.test(key)) {          // 1.x 버전(3회독 Day 번호)
        var d3 = planBase(3, false).byId[Number(key)];
        if (d3) out[d3.date] = Number(src[k]) || Date.now();
      }
    });
    return Object.keys(out).length ? out : null;
  }

  function importFile(file) {
    var reader = new FileReader();
    reader.onload = function () {
      var parsed = null;
      try { parsed = JSON.parse(String(reader.result)); } catch (e) { parsed = null; }
      var checks = normalizeImport(parsed);
      if (!checks) { toast('백업 파일을 읽지 못했어요'); return; }
      var n = Object.keys(checks).length;
      if (!window.confirm('백업 파일의 체크 ' + n + '개로 현재 기록을 바꿀까요?')) return;
      store.checks = checks;
      if (parsed && parsed.target) store.target = clampTarget(parsed.target);
      else store.target = target;
      if (parsed && typeof parsed.includeSun === 'boolean') store.includeSun = parsed.includeSun;
      target = store.target;
      store.reb = parsed ? sanitizeReb(parsed.reb, target) : null;
      persist();
      replan();
      state.round = roundOfDate(TODAY);
      if (state.round > P.n) state.round = P.n;
      state.book = -1;
      if (!P.byDate[state.sel]) state.sel = TODAY;
      if (sheetState) renderSheet();
      render();
      toast(n + '개 기록을 불러왔어요');
    };
    reader.readAsText(file);
  }

  /* ---------- 오늘부터 다시 맞추기 ---------- */
  function itemsOfDay(d) {
    var out = [];
    if (!d || d.skip) return out;
    for (var i = 0; i < d.segs.length; i++) {
      var s = d.segs[i];
      var del = BOOKS[s.b].deleted || [];
      for (var n = s.s; n <= s.e; n++) if (del.indexOf(n) < 0) out.push({ b: s.b, n: n });
    }
    return out;
  }
  function segsFromItems(items) {
    var segs = [];
    for (var i = 0; i < items.length; i++) {
      var x = items[i], last = segs[segs.length - 1];
      if (last && last.b === x.b) { last.e = x.n; last.n++; }
      else segs.push({ b: x.b, s: x.n, e: x.n, n: 1, del: [] });
    }
    for (var k = 0; k < segs.length; k++) {
      var s = segs[k], del = BOOKS[s.b].deleted || [];
      s.del = del.filter(function (n) { return n >= s.s && n <= s.e; });
    }
    return segs;
  }
  // 남은 날 수에 맞춰 회독마다 며칠씩 줄지 고르게 나눈다(각 회독 최소 1일 · 남은 문항 수를 넘지 않게)
  function allocDays(weights, D) {
    var sum = weights.reduce(function (a, b) { return a + b; }, 0);
    var n = weights.length;
    if (!sum || !n) return [];
    D = Math.min(D, sum); // 남은 문항 수보다 많은 날을 주지 않는다
    var base = weights.map(function (w) { return Math.max(1, Math.floor(D * w / sum)); });
    var rem = weights.map(function (w, i) { return D * w / sum - base[i]; });
    var tot = base.reduce(function (a, b) { return a + b; }, 0);
    while (tot > D) {
      var idx = -1;
      for (var i = 0; i < n; i++) if (base[i] > 1 && (idx < 0 || base[i] > base[idx])) idx = i;
      if (idx < 0) break;
      base[idx]--; tot--;
    }
    while (tot < D) {
      var j = 0;
      for (var k = 1; k < n; k++) if (rem[k] > rem[j]) j = k;
      base[j]++; rem[j] -= 1; tot++;
    }
    // 한 회독이 남은 문항보다 많은 날을 받지 않도록 넘치는 날은 다른 회독으로 넘긴다
    var surplus = 0;
    for (var a = 0; a < n; a++) {
      if (base[a] > weights[a]) { surplus += base[a] - weights[a]; base[a] = weights[a]; }
    }
    while (surplus > 0) {
      var moved = false;
      for (var b = 0; b < n && surplus > 0; b++) {
        if (base[b] < weights[b]) { base[b]++; surplus--; moved = true; }
      }
      if (!moved) break;
    }
    return base;
  }
  // 한 회독의 남은 문항을 남은 날에 나눌 때의 끝 위치(책 경계에 가까우면 맞춘다)
  function splitEnds(list, cnt) {
    var N = list.length, pos = 0, ends = [], left = cnt;
    for (var i = 0; i < cnt; i++) {
      left--;
      var rest = N - pos;
      var k = left === 0 ? rest : Math.round(rest / (left + 1));
      if (k < 1) k = 1;
      if (rest - k < left) k = rest - left;
      if (k < 1) k = 1;
      var cut = pos + k;
      if (i < cnt - 1 && cut > pos && cut < N) {
        var b = list[cut - 1].b, bEnd = cut, bStart = cut;
        while (bEnd < N && list[bEnd].b === b) bEnd++;
        while (bStart > pos && list[bStart - 1].b === b) bStart--;
        if (bEnd - cut <= 2 && N - bEnd >= left) cut = bEnd;
        else if (cut - bStart <= 2 && bStart - pos >= 1) cut = bStart;
      }
      if (cut <= pos) cut = pos + 1;
      if (N - cut < left) cut = N - left;
      if (cut > N) cut = N;
      ends.push(cut);
      pos = cut;
    }
    return ends;
  }
  // 여러 날짜 중 가장 이른 값
  function minDate() {
    var v = null;
    for (var i = 0; i < arguments.length; i++) {
      var x = arguments[i];
      if (!x) continue;
      if (!v || x < v) v = x;
    }
    return v;
  }
  // 오늘(또는 오늘 이후 처음 미완료한 날)부터가 다시 맞출 구간
  function rebalanceFrom() {
    for (var i = 0; i < P.days.length; i++) {
      var d = P.days[i];
      if (d.date < TODAY) continue;
      if (d.skip || isDone(d.date)) continue;
      return d.date;
    }
    return null;
  }
  function sameDay(a, b) { return a.date < b.date ? -1 : a.date > b.date ? 1 : 0; }
  // 하루치 기록을 저장용 조각으로 복사한다
  function dayEntry(d) {
    return {
      date: d.date, round: d.round, rday: 0, q: d.q,
      segs: d.segs.map(function (s) {
        return { b: s.b, s: s.s, e: s.e, n: s.n, del: (s.del || []).slice() };
      })
    };
  }

  // 남은 문항을 남은 날짜에 회독 순서대로 고르게 배분한다
  function distribute(lists, dates) {
    var active = [];
    lists.forEach(function (l, i) { if (l.length) active.push({ r: i + 1, list: l }); });
    var D = dates.length;
    var outDays = [];
    if (!active.length || !D) return outDays;

    if (D >= active.length) {
      var alloc = allocDays(active.map(function (x) { return x.list.length; }), D);
      var di = 0;
      for (var ai = 0; ai < active.length; ai++) {
        var cnt = alloc[ai];
        var ends = splitEnds(active[ai].list, cnt);
        var pos = 0;
        for (var j = 0; j < cnt; j++) {
          var items = active[ai].list.slice(pos, ends[j]);
          pos = ends[j];
          var segs = segsFromItems(items);
          outDays.push({
            date: dates[di++], round: active[ai].r, rday: j + 1,
            q: segs.reduce(function (a, s) { return a + s.n; }, 0), segs: segs
          });
        }
      }
    } else {
      // 남은 날이 남은 회독 수보다 적은 마지막 구간: 남은 문항을 한 줄로 이어 담는다
      var all = [];
      active.forEach(function (x) { x.list.forEach(function (it) { all.push({ b: it.b, n: it.n, r: x.r }); }); });
      var useD = Math.min(D, all.length);
      var endsAll = splitEnds(all, useD);
      var posAll = 0;
      for (var q = 0; q < useD; q++) {
        var chunk = all.slice(posAll, endsAll[q]); posAll = endsAll[q];
        if (!chunk.length) continue;
        var sg = segsFromItems(chunk.map(function (x) { return { b: x.b, n: x.n }; }));
        outDays.push({
          date: dates[outDays.length], round: chunk[0].r, rday: outDays.length + 1,
          q: sg.reduce(function (a, s) { return a + s.n; }, 0), segs: sg
        });
      }
    }
    return outDays;
  }

  function doRebalance() {
    var from0 = rebalanceFrom();
    if (!from0) { toast('다시 맞출 남은 일정이 없어요'); return; }
    // 이미 다시 맞춘 계획이 있으면 그 시작점은 그대로 두고 이어서 맞춘다
    var keepFrom = minDate(store.reb ? store.reb.from : null, from0) || from0;

    var keep = [], lists = [], dates = [], missed = 0, total = 0;
    for (var r = 0; r < P.n; r++) lists[r] = [];
    var moved = {};

    P.days.forEach(function (d) {
      if (d.skip) return;
      if (d.date < from0) {
        if (isDone(d.date)) { if (d.date >= keepFrom) keep.push(dayEntry(d)); return; }
        // 안 하고 지난 날의 분량도 앞으로 넘겨 담는다
        var pm = itemsOfDay(d);
        missed += pm.length;
        pm.forEach(function (it) { (moved[d.round - 1] = moved[d.round - 1] || []).push(it); });
        return;
      }
      if (isDone(d.date)) { keep.push(dayEntry(d)); return; }
      dates.push(d.date);
      itemsOfDay(d).forEach(function (it) { lists[d.round - 1].push(it); });
    });
    Object.keys(moved).forEach(function (k) { lists[k] = moved[k].concat(lists[k]); });
    lists.forEach(function (l) { total += l.length; });
    if (!total) { toast('밀린 분량이 없어요'); return; }
    if (!dates.length) { toast('남은 학습일이 없어요'); return; }

    var outDays = distribute(lists, dates);
    if (!outDays.length) { toast('남은 학습일이 없어요'); return; }

    var meta = {};
    var prev = store.reb;
    if (prev && prev.reason === 'partial' && prev.partialDate >= keepFrom && isDone(prev.partialDate)) {
      meta = {
        reason: 'partial', partialDate: prev.partialDate, partialQ: prev.partialQ,
        partialTotal: prev.partialTotal, prevDone: prev.prevDone, orig: prev.orig
      };
    }
    var payload = {
      from: keepFrom, createdAt: new Date().toISOString(), items: total,
      days: keep.concat(outDays).sort(sameDay)
    };
    Object.keys(meta).forEach(function (key) { payload[key] = meta[key]; });

    store.reb = sanitizeReb(payload, P.n);
    if (!store.reb) { toast('일정을 다시 맞추지 못했어요'); return; }

    persist();
    replan();
    state.round = roundOfDate(TODAY);
    if (state.round > P.n) state.round = P.n;
    state.book = -1;
    if (!P.byDate[state.sel]) state.sel = TODAY;
    render();
    if (sheetState) renderSheet();
    toast('남은 ' + nf(total) + '문항' + (missed ? '(밀린 ' + nf(missed) + '문항 포함)' : '') +
      '을 ' + outDays.length + '일에 다시 나눴어요 · 하루 약 ' + Math.round(total / outDays.length) + '문항');
  }

  /* ---------- 오늘 공부량 미세 조정 ---------- */
  // 오늘 날짜의 전체 문항(조정 전 기준). 이미 조정한 날이면 그때의 원래 문항을 돌려준다.
  function adjustUniverse(date) {
    var d = P.byDate[date];
    if (!d || d.skip) return [];
    var r = store.reb;
    if (r && r.reason === 'partial' && r.partialDate === date && r.orig && r.orig.length) {
      return r.orig.map(function (it) { return { b: it.b, n: it.n }; });
    }
    return itemsOfDay(d);
  }

  // 고른 문항만 오늘 완료로 남기고, 나머지는 다음 학습일부터 다시 나누어 담는다
  function doPartial(date, chosen, universe) {
    var day = P.byDate[date];
    if (!day || day.skip) { toast('조정할 수 없는 날이에요'); return; }

    var keepFrom = minDate(store.reb ? store.reb.from : null, date) || date;
    var uniKey = {};
    universe.forEach(function (it) { uniKey[it.b + ':' + it.n] = 1; });
    var chKey = {};
    chosen.forEach(function (it) { chKey[it.b + ':' + it.n] = 1; });
    var rest = universe.filter(function (it) { return !chKey[it.b + ':' + it.n]; });

    var keep = [], lists = [], dates = [];
    for (var r = 0; r < P.n; r++) lists[r] = [];
    var moved = {};

    P.days.forEach(function (d) {
      if (d.skip) return;
      if (d.date < date) {
        if (isDone(d.date)) { if (d.date >= keepFrom) keep.push(dayEntry(d)); return; }
        itemsOfDay(d).forEach(function (it) { (moved[d.round - 1] = moved[d.round - 1] || []).push(it); });
        return;
      }
      if (d.date === date) return;
      if (isDone(d.date)) { keep.push(dayEntry(d)); return; }
      dates.push(d.date);
      itemsOfDay(d).forEach(function (it) {
        if (d.round === day.round && uniKey[it.b + ':' + it.n]) return;   // 오늘로 되돌아온 문항은 아래에서 다시 넣는다
        lists[d.round - 1].push(it);
      });
    });

    Object.keys(moved).forEach(function (k) { lists[k] = moved[k].concat(lists[k]); });
    if (rest.length) {
      if (!dates.length) { toast('남은 학습일이 없어 조정할 수 없어요'); return; }
      lists[day.round - 1] = rest.concat(lists[day.round - 1]);
    }

    var outDays = distribute(lists, dates);
    var todayEntry = dayEntry({ date: date, round: day.round, q: chosen.length, segs: segsFromItems(chosen) });
    var allDays = keep.concat([todayEntry]).concat(outDays).sort(sameDay);
    var restTotal = outDays.reduce(function (a, d) { return a + d.q; }, 0);

    var prevDone = (store.reb && store.reb.partialDate === date) ? !!store.reb.prevDone : isDone(date);
    store.reb = sanitizeReb({
      from: keepFrom, createdAt: new Date().toISOString(), items: restTotal,
      reason: 'partial', partialDate: date, partialQ: chosen.length, partialTotal: universe.length,
      prevDone: prevDone, orig: universe, days: allDays
    }, P.n);
    if (!store.reb) { toast('공부량을 조정하지 못했어요'); return; }

    store.checks[date] = Date.now();
    persist();
    replan();
    state.round = roundOfDate(TODAY);
    if (state.round > P.n) state.round = P.n;
    state.book = -1;
    if (!P.byDate[state.sel]) state.sel = TODAY;
    closeSheet();
    render();
    toast(rest.length
      ? '오늘 ' + chosen.length + '문항 완료 · 남은 ' + rest.length + '문항을 ' + outDays.length + '일에 다시 나눴어요'
      : '오늘 ' + chosen.length + '문항 완료 · 계획을 다시 정리했어요');
  }

  function undoRebalance() {
    if (!store.reb) { toast('되돌릴 다시 맞추기가 없어요'); return; }
    var wasPartial = store.reb.reason === 'partial';
    if (wasPartial && isIso(store.reb.partialDate) && !store.reb.prevDone) delete store.checks[store.reb.partialDate];
    store.reb = null;
    persist();
    replan();
    state.round = roundOfDate(TODAY);
    if (state.round > P.n) state.round = P.n;
    state.book = -1;
    if (!P.byDate[state.sel]) state.sel = TODAY;
    render();
    if (sheetState) renderSheet();
    toast(wasPartial ? '공부량 조정 전으로 되돌렸어요' : '원래 일정으로 되돌렸어요');
  }

  function setIncludeSun(on) {
    if (store.includeSun === on) return;
    var hadReb = !!store.reb;
    store.includeSun = on;
    store.reb = null;
    persist();
    replan();
    state.round = roundOfDate(TODAY);
    if (state.round > P.n) state.round = P.n;
    state.book = -1;
    if (!P.byDate[state.sel]) state.sel = TODAY;
    render();
    if (sheetState) renderSheet();
    toast((on ? '주일도 공부일에 넣었어요 · ' + P.dates.length + '일'
      : '주일을 뺐어요 · ' + P.dates.length + '일') + (hadReb ? ' · 다시 맞추기는 해제됐어요' : ''));
  }

  /* ---------- 이벤트 ---------- */
  function applyTarget(n) {
    n = clampTarget(n);
    if (n === target) { closeSheet(); return; }
    var hadReb = !!store.reb;
    target = n;
    store.target = target;
    store.reb = null;
    persist();
    replan();
    state.round = roundOfDate(TODAY);
    if (state.round > P.n) state.round = P.n;
    state.book = -1;
    if (!P.byDate[state.sel]) state.sel = TODAY;
    render();
    if (sheetState && sheetState.type === 'target') renderSheet();
    toast(target + '회독으로 바꿨어요' + (hadReb ? ' · 다시 맞추기는 해제됐어요' : ''));
  }

  document.addEventListener('click', function (e) {
    var el = e.target.closest('[data-action]');
    if (!el) return;
    var a = el.dataset.action;

    if (a === 'tab') {
      if (state.tab === el.dataset.tab) { window.scrollTo({ top: 0, behavior: 'smooth' }); return; }
      switchTab(el.dataset.tab);
      return;
    }
    if (a === 'toggle') {
      e.preventDefault();
      var date = el.dataset.date;
      if (!P.byDate[date] || P.byDate[date].skip) return;
      if (isDone(date)) { delete store.checks[date]; toast('완료를 취소했어요'); }
      else { store.checks[date] = Date.now(); toast('완료! 진행률이 올라갔어요'); }
      persist();
      render();
      if (sheetState && sheetState.type === 'day') renderSheet();
      return;
    }
    if (a === 'round') { state.round = Number(el.dataset.round); state.book = -1; render(); return; }
    if (a === 'mode') { state.mode = el.dataset.mode; state.book = -1; render(); return; }
    if (a === 'book') {
      var bi = Number(el.dataset.book);
      state.book = (state.book === bi) ? -1 : bi;
      render();
      return;
    }
    if (a === 'openTarget') { openSheet({ type: 'target' }); return; }
    if (a === 'setTarget') { applyTarget(Number(el.dataset.n)); return; }
    if (a === 'openAdjust') { openAdjust(el.dataset.date); return; }
    if (a === 'adjToggle') {
      var ak = el.dataset.key;
      if (sheetState && sheetState.type === 'adjust') {
        if (sheetState.sel[ak]) delete sheetState.sel[ak];
        else sheetState.sel[ak] = true;
        updateAdjustUI();
      }
      return;
    }
    if (a === 'adjAll') {
      if (sheetState && sheetState.type === 'adjust') {
        var allOn = Object.keys(sheetState.sel).length === sheetState.items.length;
        sheetState.sel = {};
        if (!allOn) sheetState.items.forEach(function (it) { sheetState.sel[it.b + ':' + it.n] = true; });
        updateAdjustUI();
      }
      return;
    }
    if (a === 'adjApply') { applyAdjust(); return; }
    if (a === 'openDay') { openSheet({ type: 'day', date: el.dataset.date }); return; }
    if (a === 'toggleSun') { setIncludeSun(!store.includeSun); return; }
    if (a === 'rebalance') { doRebalance(); return; }
    if (a === 'undoRebalance') { undoRebalance(); return; }
    if (a === 'calPrev' || a === 'calNext') {
      var y = state.cal.y, m = state.cal.m + (a === 'calNext' ? 1 : -1);
      if (m < 1) { m = 12; y--; }
      if (m > 12) { m = 1; y++; }
      if (y < 2026 || (y === 2026 && m < 11) || y > 2027 || (y === 2027 && m > 11)) return;
      state.cal = { y: y, m: m };
      render();
      return;
    }
    if (a === 'calSelect') { state.sel = el.dataset.date; render(); return; }
    if (a === 'jump') { switchTab('calendar', { date: el.dataset.date }); return; }
    if (a === 'closeSheet') { closeSheet(); return; }
    if (a === 'export') { exportJSON(); return; }
    if (a === 'import') {
      var inp = document.createElement('input');
      inp.type = 'file';
      inp.accept = 'application/json,.json';
      inp.addEventListener('change', function () {
        if (inp.files && inp.files[0]) importFile(inp.files[0]);
      });
      inp.click();
      return;
    }
    if (a === 'reset') {
      if (!Object.keys(store.checks).length) { toast('지울 기록이 없어요'); return; }
      if (!window.confirm('모든 체크 기록(' + Object.keys(store.checks).length + '개)을 지울까요? 되돌릴 수 없어요.')) return;
      store.checks = {};
      persist();
      render();
      if (sheetState) renderSheet();
      toast('기록을 모두 지웠어요');
      return;
    }
  });

  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape' && sheetState) closeSheet();
  });

  /* ---------- 시작 ---------- */
  if (!storageOK) setTimeout(function () { toast('이 브라우저에서는 기록 저장이 막혀 있어요'); }, 600);
  render();

  if ('serviceWorker' in navigator && /^https?:$/.test(location.protocol)) {
    window.addEventListener('load', function () {
      navigator.serviceWorker.register('sw.js').catch(function () { });
    });
  }
})();
