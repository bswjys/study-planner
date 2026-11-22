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

  var qs = new URLSearchParams(location.search);
  var TODAY = (function () {
    var v = qs.get('today');
    return v && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : ymd(new Date());
  })();

  /* ---------- 공부 날짜 · 문항 순서 ---------- */
  var STUDY_DATES = (function () {
    var out = [], d = parse(META.start), end = parse(META.end);
    while (d <= end) {
      if (d.getDay() !== 0) out.push(ymd(d));
      d = new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1);
    }
    return out;
  })();

  // 인쇄 번호 순서대로 3,009문항
  var FLAT = [];
  BOOKS.forEach(function (b, bi) {
    for (var n = 1; n <= b.printed; n++) {
      FLAT.push({ b: bi, n: n, del: b.deleted.indexOf(n) >= 0 });
    }
  });
  var PRINTED = FLAT.length;
  var BOOK_START = [];
  BOOKS.reduce(function (acc, b, i) { BOOK_START[i] = acc; return acc + b.printed; }, 0);

  /* ---------- 회독 수별 계획 ---------- */
  var PLAN_CACHE = {};
  function planFor(N) {
    N = Math.max(1, Math.min(MAXR, Number(N) || DEFR));
    if (PLAN_CACHE[N]) return PLAN_CACHE[N];

    var dayBase = Math.floor(STUDY_DATES.length / N);
    var dayRem = STUDY_DATES.length % N;
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
        var date = STUDY_DATES[cursor++];
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

    var byDate = {}, byId = {};
    days.forEach(function (d) { byDate[d.date] = d; byId[d.id] = d; });

    // [회독-1][책index] = [{day, seg}]
    var segs = [];
    for (var ri = 0; ri < N; ri++) segs.push(BOOKS.map(function () { return []; }));
    days.forEach(function (d) {
      d.segs.forEach(function (s) { segs[d.round - 1][s.b].push({ day: d, seg: s }); });
    });

    var plan = { n: N, days: days, rounds: rounds, byDate: byDate, byId: byId, segs: segs };
    PLAN_CACHE[N] = plan;
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
        return { v: 2, target: clampTarget(o.target), checks: (o && o.checks && typeof o.checks === 'object') ? o.checks : {} };
      }
      var old = localStorage.getItem(OLD_KEY);
      if (old) {
        var oo = JSON.parse(old), p3 = planFor(3), ch = {};
        Object.keys(oo.checks || {}).forEach(function (k) {
          var dd = p3.byId[Number(k)];
          if (dd) ch[dd.date] = oo.checks[k];
        });
        return { v: 2, target: 3, checks: ch };
      }
    } catch (e) { storageOK = false; }
    return { v: 2, target: DEFR, checks: {} };
  }
  function persist() {
    try { localStorage.setItem(KEY, JSON.stringify({ v: 2, target: target, checks: store.checks })); }
    catch (e) { storageOK = false; }
  }

  var target = clampTarget(store.target);
  var P = planFor(target);
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
  function roundDays(no) { return P.days.filter(function (d) { return d.round === no; }); }
  function roundOfDate(iso) { return P.byDate[iso] ? P.byDate[iso].round : (iso < META.start ? 1 : P.n); }
  function weekOf(iso) {
    var t = parse(iso);
    var monday = new Date(t.getFullYear(), t.getMonth(), t.getDate() - ((t.getDay() + 6) % 7));
    var out = [];
    for (var i = 0; i < 7; i++) out.push(new Date(monday.getFullYear(), monday.getMonth(), monday.getDate() + i));
    return out;
  }
  function statWeek() {
    var days = weekOf(TODAY).map(function (d) { return P.byDate[ymd(d)]; }).filter(Boolean);
    return statFor(days);
  }
  function overdueDays() {
    var n = 0;
    for (var i = 0; i < P.days.length; i++) {
      if (P.days[i].date < TODAY && !isDone(P.days[i].date)) n++;
    }
    return n;
  }
  function nextStudyDay(iso) {
    for (var i = 0; i < P.days.length; i++) if (P.days[i].date > iso) return P.days[i];
    return null;
  }
  function fmtPct(v) {
    if (!v || v <= 0) return '0%';
    if (v >= 100) return '100%';
    return v.toFixed(1).replace(/\.0$/, '') + '%';
  }
  function perDayLabel(n) {
    var p = planFor(n);
    return '약 ' + Math.round(PRINTED / p.rounds[0].days) + '문항';
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
      (late > 0 ? '<div class="divider"></div><div class="row"><span class="muted">아직 체크하지 않은 지난 학습일</span>' +
        '<span class="pill red">' + late + '일</span></div>' : '') +
      '</section>';

    if (day) {
      var done = isDone(day.date);
      h += '<section class="card' + (done ? ' soft' : '') + '">' +
        '<div class="row">' +
        '<div class="study-top"><div class="study-badge">' + day.round + '회독</div>' +
        '<div><p class="muted">오늘의 공부</p><div class="h2" style="margin-top:2px">Day ' + day.id + '</div></div></div>' +
        '<span class="pill ' + (done ? 'green' : 'blue') + '">' + (done ? '완료' : day.q + '문항') + '</span>' +
        '</div>' +
        '<div class="seg-list">' + segsHtml(day) + '</div>' +
        '<button class="btn ' + (done ? 'ghost' : '') + '" type="button" data-action="toggle" data-date="' + day.date + '">' +
        (done ? '✓ 완료했어요 · 되돌리기' : '공부 완료로 표시') + '</button>' +
        '</section>';
    } else if (isSun && t >= META.start && t <= META.end) {
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
      if (sun) { cls += ' sun'; lab = '주일'; }
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
    var r = P.rounds[state.round - 1];
    var days = roundDays(state.round);
    var st = statFor(days);
    var h = '';

    h += '<section class="card">' +
      '<div class="row"><div><p class="muted">목표 회독</p>' +
      '<div class="h2" style="margin-top:2px">' + P.n + '회독</div></div>' +
      '<button type="button" class="btn ghost sm" data-action="openTarget">회독 수 변경</button></div>' +
      '<p class="tiny" style="margin-top:10px">' + META.studyDays + '일을 ' + P.n + '번 · 회독당 ' + r.days + '일 · 하루 ' + perDayLabel(P.n) + '</p>' +
      '</section>';

    h += '<div class="chips">' + P.rounds.map(function (x) {
      return '<button type="button" class="chip' + (x.no === state.round ? ' on' : '') + '" data-action="round" data-round="' + x.no + '">' +
        x.no + '회독</button>';
    }).join('') + '</div>';

    h += '<section class="card" style="margin-top:8px">' +
      '<div class="row"><span class="range-line">' + r.start.replace(/-/g, '.') + ' ~ ' + r.end.replace(/-/g, '.') + '</span>' +
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
      days.forEach(function (d) {
        var mk = d.date.slice(0, 7);
        if (mk !== cur) {
          if (list) h += list + '</div>';
          cur = mk;
          var my = Number(mk.slice(0, 4)), mm = Number(mk.slice(5, 7));
          var mdays = days.filter(function (x) { return x.date.slice(0, 7) === mk; });
          var mst = statFor(mdays);
          h += '<div class="section-title">' + my + '년 ' + mm + '월' +
            '<span class="muted" style="font-weight:700;font-size:12px;margin-left:6px">' +
            mst.doneDays + '/' + mst.days + '일 완료</span></div>';
          list = '<div class="list">';
        }
        var done = isDone(d.date);
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
      if (sun) { cls += ' sun'; lab = '주일'; }
      else if (day && isDone(day.date)) { cls += ' done'; lab = '완료'; }
      else if (day && iso < TODAY) { cls += ' miss'; lab = '미완료'; }
      else if (day) { cls += ' plan'; }
      if (iso === TODAY) cls += ' today';
      if (state.sel === iso) cls += ' sel';
      h += '<button type="button" class="' + cls + '" data-action="calSelect" data-date="' + iso + '"' +
        ' aria-label="' + iso + (day ? ' ' + day.round + '회독 Day ' + day.id : '') + '">' +
        '<span class="cn">' + dn + '</span><span class="cs">' + lab + '</span></button>';
    }
    h += '</div>' +
      '<div class="legend">' +
      '<span><i style="background:var(--pri)"></i>완료</span>' +
      '<span><i style="background:var(--red-soft);box-shadow:inset 0 0 0 1px var(--red)"></i>미완료</span>' +
      '<span><i style="background:#fff;box-shadow:inset 0 0 0 2px var(--pri)"></i>오늘</span>' +
      '<span><i style="background:#FAFBFC;box-shadow:inset 0 0 0 1px var(--line)"></i>주일 휴식</span>' +
      '</div></section>';

    if (!state.sel) state.sel = TODAY;
    var sel = state.sel;
    var sday = P.byDate[sel];
    var ssun = parse(sel).getDay() === 0;
    h += '<section class="card" style="margin-top:12px">';
    if (sday) {
      var done = isDone(sday.date);
      h += '<div class="row"><div class="grow"><p class="muted">' + sday.round + '회독 · Day ' + sday.id + '</p>' +
        '<div class="h2" style="margin-top:2px">' + longKo(sel) + '</div></div>' +
        '<span class="pill ' + (done ? 'green' : 'blue') + '">' + (done ? '완료' : sday.q + '문항') + '</span></div>' +
        '<div class="seg-list">' + segsHtml(sday) + '</div>' +
        '<button class="btn ' + (done ? 'ghost' : '') + '" type="button" data-action="toggle" data-date="' + sday.date + '">' +
        (done ? '✓ 완료했어요 · 되돌리기' : '공부 완료로 표시') + '</button>';
    } else if (ssun) {
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
      var t = Number(store.checks[k]) || 0;
      if (!last || t > last) last = t;
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
      '<div class="info-row"><span class="k">회독당</span><span class="v">' + P.rounds[0].days + '일 · 하루 ' + perDayLabel(P.n) + '</span></div>' +
      '<div class="info-row"><span class="k">1회독 범위</span><span class="v">' + META.books + '권 ' + nf(META.printedQuestions) + '문항</span></div>' +
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
      '<div class="info-row"><span class="k">학습일</span><span class="v">' + META.studyDays + '일 (주일 제외)</span></div>' +
      '<div class="info-row"><span class="k">범위</span><span class="v">' + META.books + '권 ' + nf(META.printedQuestions) + '문항 × ' + P.n + '회독</span></div>' +
      '<div class="info-row"><span class="k">삭제 문항</span><span class="v" style="font-size:12.5px">' + META.deleted.join(' · ') + '</span></div>' +
      '<div class="info-row"><span class="k">앱 버전</span><span class="v">1.1.0</span></div>' +
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
    run: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 9.5v5M7.5 7v10M16.5 7v10M20 9.5v5M7.5 12h9"/></svg>',
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
      var p = planFor(n);
      rows += '<button type="button" class="opt' + (n === P.n ? ' on' : '') + '" data-action="setTarget" data-n="' + n + '">' +
        '<span><span class="n">' + n + '회독</span>' +
        '<span class="d">' + p.rounds[0].days + '일 · 하루 ' + perDayLabel(n) + '</span></span>' +
        '<span class="ck">' + (n === P.n ? '✓' : '') + '</span></button>';
    }
    return '<h3 style="margin-top:2px">목표 회독</h3>' +
      '<p class="tiny" style="margin-top:4px">' + META.studyDays + '일(주일 제외)을 몇 번 나눠 풀지 골라 주세요.</p>' +
      '<div class="opt-grid">' + rows + '</div>' +
      '<p class="tiny" style="margin-top:12px">회독 수를 바꾸면 하루 분량이 다시 나뉘어요. 이미 체크한 날짜 기록은 그대로 남아요.</p>' +
      '<button class="btn ghost" type="button" data-action="closeSheet">닫기</button>';
  }
  function renderSheet() {
    if (!sheetState) return;
    sheetBody.innerHTML = sheetState.type === 'day' ? daySheetHtml(sheetState.date) : targetSheetHtml();
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
    toastTimer = setTimeout(function () { toastEl.classList.remove('on'); }, 1800);
  }

  /* ---------- 백업 ---------- */
  function exportJSON() {
    var payload = {
      app: 'jangsin-planner', version: 2, exportedAt: new Date().toISOString(),
      target: P.n, checks: store.checks
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
        if (P.byDate[key]) out[key] = Number(src[k]) || Date.now();
      } else if (/^\d+$/.test(key)) {          // 예전 버전(3회독 Day 번호)
        var d3 = planFor(3).byId[Number(key)];
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
      if (parsed && parsed.target) {
        target = clampTarget(parsed.target);
        P = planFor(target);
        if (state.round > P.n) state.round = P.n;
        store.target = target;
      }
      persist();
      if (sheetState) renderSheet();
      render();
      toast(n + '개 기록을 불러왔어요');
    };
    reader.readAsText(file);
  }

  /* ---------- 이벤트 ---------- */
  function applyTarget(n) {
    target = clampTarget(n);
    P = planFor(target);
    store.target = target;
    persist();
    state.round = roundOfDate(TODAY);
    if (state.round > P.n) state.round = P.n;
    state.book = -1;
    if (!P.byDate[state.sel]) state.sel = TODAY;
    render();
    if (sheetState && sheetState.type === 'target') renderSheet();
    toast(target + '회독으로 바꿨어요');
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
      if (!P.byDate[date]) return;
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
    if (a === 'openDay') { openSheet({ type: 'day', date: el.dataset.date }); return; }
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
