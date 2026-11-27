"""장신대 플래너 — 개론 예상문제 467문항 반영 검증 (Playwright, 390px)

    LD_LIBRARY_PATH=/workspace/tmp/libroot/usr/lib/x86_64-linux-gnu:/workspace/work/chromedeps/usr/lib/x86_64-linux-gnu \
      python3 test_gaeron.py

검증 항목
- schedule.js 에 66권 467문항(저본 questions_gaeron.json 과 일치) 이 실리고 성경 3,006문항은 그대로
- 사용자 설정(5회독 · 주일 포함 373일)에서 11/23·11/24 기존 완료 기록이 그대로 보존
- 11/25부터 오늘의 공부 카드에 📖 성경문제 + 📚 개론 예상문제가 함께, 하루 문항 수 표시
- 회독마다 개론 467문항이 남은 학습일에 배분(5회독 합계 2,335문항 보존)
- [완료]·[완료 취소] 가 성경과 개론을 함께 처리, 교재별 개별 체크도 동작
- [공부량 조정] 에서 성경 번호 칸 + 개론 번호 칸을 각각 체크, 안 푼 개론은 다음 학습일로 재배분
- 진도가 밀린 날의 개론 분량이 오늘부터 다시 배분
- 3·10회독, 백업·복원, 콘솔 오류 0건, 390px 가로 넘침 없음
"""
import functools
import http.server
import json
import os
import re
import socketserver
import tempfile
import threading
from datetime import datetime
from zoneinfo import ZoneInfo

from playwright.sync_api import sync_playwright

ROOT = os.path.dirname(os.path.abspath(__file__))
SHOTS = os.environ.get('SHOT_DIR') or os.path.join(ROOT, 'shots')
os.makedirs(SHOTS, exist_ok=True)

FAILS = []
PASSES = []


def check(name, cond, extra=''):
    if cond:
        PASSES.append(name)
        print('PASS  ' + name)
    else:
        FAILS.append(name)
        print('FAIL  ' + name + ((' — ' + str(extra)) if extra else ''))


class Handler(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *args):
        pass


httpd = socketserver.TCPServer(('127.0.0.1', 0), functools.partial(Handler, directory=ROOT))
PORT = httpd.server_address[1]
threading.Thread(target=httpd.serve_forever, daemon=True).start()
BASE = 'http://127.0.0.1:%d/' % PORT
KEY = 'jangsin-planner-v2'
KST = ZoneInfo('Asia/Seoul')


def ts(y, m, d):
    return int(datetime(y, m, d, 9, 30, tzinfo=KST).timestamp() * 1000)


GTOTAL = 467
TOTAL = {3: 9018, 5: 15030, 10: 30060}


def gaeron_data():
    src = os.path.join(ROOT, '..', '..', 'work', 'jangsin_gaeron', 'questions_gaeron.json')
    g = json.load(open(src, encoding='utf-8'))
    alias = {'오바댜': '오바다'}
    counts = {}
    for q in g['questions']:
        n = alias.get(q['book'], q['book'])
        counts[n] = counts.get(n, 0) + 1
    return g, counts


def load_schedule():
    raw = open(os.path.join(ROOT, 'schedule.js'), encoding='utf-8').read()
    return json.loads(raw.split('window.STUDY_DATA = ', 1)[1].rstrip().rstrip(';'))


def new_page(browser):
    ctx = browser.new_context(
        viewport={'width': 390, 'height': 844},
        timezone_id='Asia/Seoul',
        locale='ko-KR',
        device_scale_factor=2,
        has_touch=True,
        is_mobile=True,
    )
    pg = ctx.new_page()
    errors = []
    pg.on('console', lambda m: errors.append('console:' + m.text) if m.type == 'error' else None)
    pg.on('pageerror', lambda e: errors.append('pageerror:' + str(e)))
    pg.errors = errors
    return ctx, pg


def open_app(pg, seed, today):
    pg.goto(BASE + 'index.html', wait_until='domcontentloaded')
    pg.evaluate("""([k, v]) => { localStorage.clear(); if (v) localStorage.setItem(k, v); }""",
                [KEY, json.dumps(seed, ensure_ascii=False) if seed else None])
    pg.goto(BASE + 'index.html?today=' + today, wait_until='networkidle')
    pg.wait_for_timeout(350)


def store(pg):
    raw = pg.evaluate("localStorage.getItem('%s')" % KEY)
    return json.loads(raw) if raw else None


def tab(pg, name):
    pg.click('.tab[data-tab="%s"]' % name)
    pg.wait_for_timeout(220)


def today_card(pg):
    tab(pg, 'today')
    return pg.evaluate("""() => {
      const cards = [...document.querySelectorAll('main section.card')];
      const c = cards.find(x => x.textContent.includes('오늘의 공부'));
      if (!c) return null;
      return {
        text: c.textContent.replace(/\\s+/g, ' ').trim(),
        btns: [...c.querySelectorAll('button')].map(b => ({text: b.textContent.trim(),
          action: b.dataset.action || '', track: b.dataset.track || ''})),
      };
    }""")


def rounds_items(pg, n):
    tab(pg, 'rounds')
    out = {}
    for r in range(1, n + 1):
        pg.click('.chip[data-round="%d"]' % r)
        pg.wait_for_timeout(140)
        out[r] = pg.evaluate("""() => [...document.querySelectorAll('main .list > button.item')].map(el => {
          const t1 = el.querySelector('.t1');
          if (!t1) return null;
          const lead = t1.childNodes.length ? t1.childNodes[0].textContent : t1.textContent;
          const m = String(lead).match(/Day (\\d+)/);
          if (!m) return null;
          const g = el.querySelector('.t2.g');
          let gq = 0;
          if (g) {
            const tt = g.textContent.replace(/\\s+/g, ' ');
            const mm = tt.match(/(\\d+) \\/ (\\d+)문항/) || tt.match(/(\\d+)문항/);
            gq = mm ? Number(mm[1]) : 0;
          }
          return {
            day: Number(m[1]), date: el.dataset.date || null,
            q: Number((el.querySelector('.qcount') || {textContent: '0'}).textContent.replace(/[^0-9]/g, '')),
            gtxt: g ? g.textContent.replace(/\\s+/g, ' ').trim() : null, gq: gq,
            done: el.classList.contains('done'), skip: el.classList.contains('skip'),
          };
        }).filter(Boolean)""")
    return out


def gsum(items):
    return {r: sum(x['gq'] for x in rows) for r, rows in items.items()}


def open_adjust(pg, date=None):
    tab(pg, 'today')
    sel = 'main [data-action="openAdjust"]' + ('[data-date="%s"]' % date if date else '')
    pg.click(sel)
    pg.wait_for_timeout(320)


def adj_state(pg):
    return pg.evaluate("""() => {
      const s = document.getElementById('sheet');
      const cells = [...s.querySelectorAll('.chcell')];
      const gc = [...s.querySelectorAll('.gchcell')];
      return {
        open: s.classList.contains('on'),
        cells: cells.length, gcells: gc.length,
        adj: (s.querySelector('#adjCount') || {}).textContent || null,
        gadj: (s.querySelector('#gadjCount') || {}).textContent || null,
        gbooks: [...s.querySelectorAll('.adj-book-head.g')].map(x => x.textContent.replace(/\\s+/g, ' ').trim()),
        btns: [...s.querySelectorAll('.btn')].map(b => b.textContent.trim()),
      };
    }""")


def click_cells(pg, idx_list, cls='chcell'):
    pg.evaluate("""([idx, cls]) => {
      const cells = [...document.querySelectorAll('#sheet .' + cls)];
      idx.forEach(i => cells[i].click());
    }""", [idx_list, cls])
    pg.wait_for_timeout(150)


def finish_adjust(pg):
    pg.click('#sheetBody [data-action="adjApply"]')
    pg.wait_for_timeout(500)


def no_overflow(pg):
    return pg.evaluate('Math.max(document.documentElement.scrollWidth, document.body.scrollWidth) '
                       '- window.innerWidth') <= 0


SEED5 = {'v': 3, 'target': 5, 'includeSun': True,
         'checks': {'2026-11-23': ts(2026, 11, 23), '2026-11-24': ts(2026, 11, 24)}}

gdata, gcounts = gaeron_data()
sched = load_schedule()

with sync_playwright() as p:
    browser = p.chromium.launch(args=['--no-sandbox', '--disable-dev-shm-usage'])

    # =========================================================
    # 0. 데이터 — schedule.js 에 66권 467문항이 그대로
    # =========================================================
    ga = sched.get('gaeron')
    check('schedule.js 개론 데이터 있음', bool(ga), list(sched.keys()))
    check('개론 합계 467문항', ga and ga['total'] == GTOTAL and sum(b['count'] for b in ga['books']) == GTOTAL,
          ga and sum(b['count'] for b in ga['books']))
    check('개론 66권', ga and len(ga['books']) == 66 == len(sched['books']), ga and len(ga['books']))
    check('권별 개론 문항 수가 원본과 같음',
          ga and all(b['count'] == gcounts[b['name']] for b in ga['books']),
          ga and [(b['name'], b['count'], gcounts.get(b['name'])) for b in ga['books'] if b['count'] != gcounts.get(b['name'])][:5])
    check('개론 시작일 2026-11-25', ga and ga['start'] == '2026-11-25', ga and ga['start'])
    check('성경 3,006문항 그대로', sched['meta']['activeQuestions'] == 3006, sched['meta']['activeQuestions'])

    # =========================================================
    # A. 사용자 설정 — 11/23·11/24 기록 보존 + 오늘(11/25) 카드에 성경·개론 함께
    # =========================================================
    ctx, pg = new_page(browser)
    open_app(pg, SEED5, '2026-11-25')
    card = today_card(pg)
    check('오늘 카드 Day 3', card and 'Day 3' in card['text'], card and card['text'])
    check('성경문제 줄 표시', card and '📖' in card['text'] and '성경문제' in card['text'], card and card['text'])
    check('개론 예상문제 줄 표시', card and '📚' in card['text'] and '개론 예상문제' in card['text'], card and card['text'])
    check('성경 40문항 · 개론 6문항 함께 표시', card and '40문항' in card['text'] and '6문항' in card['text'],
          card and card['text'])
    st = store(pg)
    check('기존 11/23 기록 그대로', st['checks'].get('2026-11-23') == ts(2026, 11, 23), st['checks'])
    check('기존 11/24 기록 그대로', st['checks'].get('2026-11-24') == ts(2026, 11, 24), st['checks'])
    check('앱이 기록을 마이그레이션해도 checks 는 날짜→숫자 그대로',
          all(isinstance(v, (int, float)) for v in st['checks'].values()), st['checks'])
    check('개론 기록은 따로(g) 저장', st.get('g') in ({}, None), st.get('g'))
    txt = pg.inner_text('main')
    check('통계 카드에 교재별 진행률', '교재별 진행률' in txt, txt[:600])
    check('성경 3,006문항 × 5회독 표시', '3,006문항 × 5회독' in txt, txt[:900])
    check('개론 467문항 × 5회독 표시', '467문항 × 5회독' in txt, txt[:900])
    check('개론 총 2,335문항 표시', '2,335문항' in txt, txt[:1200])
    pg.screenshot(path=os.path.join(SHOTS, 'gaeron-today-390.png'))

    items = rounds_items(pg, 5)
    sums = gsum(items)
    check('회독마다 개론 467문항', all(sums[r] == GTOTAL for r in range(1, 6)), sums)
    check('개론 전체 2,335문항', sum(sums.values()) == GTOTAL * 5, sum(sums.values()))
    live = [x for x in items[1] if not x['skip']]
    check('11/23·11/24 는 개론 없음', all(not x['gtxt'] for x in live if x['date'] in ('2026-11-23', '2026-11-24')),
          [x for x in live if x['date'] in ('2026-11-23', '2026-11-24')])
    check('11/25 부터 개론 시작', any(x['gtxt'] for x in live if x['date'] == '2026-11-25'),
          [x for x in live if x['date'] == '2026-11-25'])
    g_first = [x['gq'] for x in live if x['date'] >= '2026-11-25']
    check('개론 하루 4~10문항 (고르게 배분)', 4 <= min(g_first) and max(g_first) <= 10,
          (min(g_first), max(g_first)))
    check('성경 회독 합계 15,030문항 그대로', sum(x['q'] for r in range(1, 6) for x in items[r]) == TOTAL[5],
          sum(x['q'] for r in range(1, 6) for x in items[r]))
    check('A 콘솔 오류 0건', len(pg.errors) == 0, pg.errors)
    check('A 390px 넘침 없음', no_overflow(pg))

    # =========================================================
    # B. [완료] — 성경 + 개론 함께 완료, 되돌리기
    # =========================================================
    tab(pg, 'today')
    pg.click('main section.card [data-action="toggle"]')
    pg.wait_for_timeout(400)
    st = store(pg)
    check('완료 → 성경 기록', '2026-11-25' in st['checks'], list(st['checks']))
    rec = (st.get('g') or {}).get('2026-11-25')
    check('완료 → 개론 기록', bool(rec) and len(rec['k']) == len(rec['o']) == 6, rec)
    card = today_card(pg)
    check('완료 후 두 교재 모두 체크 표시',
          card and card['text'].count('완료') >= 1 and '6문항' in card['text'], card and card['text'])
    txt = pg.inner_text('main')
    check('개론 진행률에 반영', '6 / 2,335문항' in txt or '6 / 2,335' in txt, txt[:1400])
    items = rounds_items(pg, 5)
    sums = gsum(items)
    check('완료 후에도 회독별 개론 467문항', all(sums[r] == GTOTAL for r in range(1, 6)), sums)
    check('완료 후에도 성경 합계 보존', sum(x['q'] for r in range(1, 6) for x in items[r]) == TOTAL[5],
          sum(x['q'] for r in range(1, 6) for x in items[r]))

    tab(pg, 'today')
    pg.click('main section.card [data-action="toggle"]')
    pg.wait_for_timeout(400)
    st = store(pg)
    check('완료 취소 → 성경·개론 기록 삭제',
          '2026-11-25' not in st['checks'] and '2026-11-25' not in (st.get('g') or {}),
          (list(st['checks']), st.get('g')))
    check('B 콘솔 오류 0건', len(pg.errors) == 0, pg.errors)

    # =========================================================
    # C. 교재별 개별 체크
    # =========================================================
    open_app(pg, SEED5, '2026-11-25')
    tab(pg, 'today')
    pg.click('main [data-action="toggleTrack"][data-track="bible"]')
    pg.wait_for_timeout(350)
    st = store(pg)
    check('성경만 체크 → checks 에만 기록', '2026-11-25' in st['checks'] and not (st.get('g') or {}).get('2026-11-25'),
          (list(st['checks']), st.get('g')))
    pg.click('main [data-action="toggleTrack"][data-track="gaeron"]')
    pg.wait_for_timeout(350)
    st = store(pg)
    rec = (st.get('g') or {}).get('2026-11-25')
    check('개론도 체크 → g 기록', bool(rec) and len(rec['k']) == 6, rec)
    pg.click('main [data-action="toggleTrack"][data-track="gaeron"]')
    pg.wait_for_timeout(350)
    st = store(pg)
    check('개론 체크 취소', not (st.get('g') or {}).get('2026-11-25'), st.get('g'))
    check('성경 기록은 남음', '2026-11-25' in st['checks'], list(st['checks']))
    check('C 콘솔 오류 0건', len(pg.errors) == 0, pg.errors)

    # =========================================================
    # D. [공부량 조정] — 성경 40칸 + 개론 6칸, 개론 일부만 완료 → 남은 문항 다음 학습일로
    # =========================================================
    open_app(pg, SEED5, '2026-11-25')
    open_adjust(pg)
    a = adj_state(pg)
    check('조정 모달 열림', a['open'] is True)
    check('성경 번호 칸 40개', a['cells'] == 40, a['cells'])
    check('개론 번호 칸 6개', a['gcells'] == 6, a['gcells'])
    check('개론 칸 처음엔 0 / 6문항', a['gadj'] == '0 / 6문항', a['gadj'])
    check('개론 그리드 책 이름', a['gbooks'] and '창세기' in a['gbooks'][0], a['gbooks'])
    check('하단 [취소] · [완료]', a['btns'] == ['취소', '완료'], a['btns'])
    pg.screenshot(path=os.path.join(SHOTS, 'gaeron-adjust-390.png'))
    click_cells(pg, [0, 1, 2], 'gchcell')
    a = adj_state(pg)
    check('개론 3개 체크', a['gadj'] == '3 / 6문항', a['gadj'])
    finish_adjust(pg)
    st = store(pg)
    rec = (st.get('g') or {}).get('2026-11-25')
    check('개론 3문항만 완료로 저장', bool(rec) and len(rec['k']) == 3 and len(rec['o']) == 6, rec)
    check('성경은 아직 완료 아님', '2026-11-25' not in st['checks'], list(st['checks']))
    card = today_card(pg)
    check('카드에 개론 3 / 6문항', card and '3 / 6문항' in card['text'], card and card['text'])
    check('남은 개론 안내', card and '남은 3문항' in card['text'], card and card['text'])
    items = rounds_items(pg, 5)
    sums = gsum(items)
    check('개론 조정 후에도 회독 합계 467', all(sums[r] == GTOTAL for r in range(1, 6)), sums)
    nxt = [x for x in items[1] if x['date'] == '2026-11-26']
    check('다음 날에 안 푼 개론(창세기 004~)이 이어짐', nxt and '창세기 004' in (nxt[0]['gtxt'] or ''),
          nxt and nxt[0]['gtxt'])
    check('D 콘솔 오류 0건', len(pg.errors) == 0, pg.errors)
    tab(pg, 'today')
    pg.screenshot(path=os.path.join(SHOTS, 'gaeron-card-partial-390.png'))

    # =========================================================
    # E. 진도가 밀린 날 — 개론도 오늘부터 다시 배분
    # =========================================================
    open_app(pg, SEED5, '2026-11-28')
    items = rounds_items(pg, 5)
    live = [x for x in items[1] if not x['skip']]
    past = [x for x in live if x['date'] in ('2026-11-25', '2026-11-26', '2026-11-27')]
    check('밀린 3일은 개론 표시 없음', all(not x['gtxt'] for x in past), [(x['date'], x['gtxt']) for x in past])
    check('밀린 뒤에도 회독 합계 467', sum(x['gq'] for x in live) == GTOTAL, sum(x['gq'] for x in live))
    check('개론은 11/28부터', any(x['gtxt'] for x in live if x['date'] == '2026-11-28'),
          [x for x in live if x['date'] == '2026-11-28'])
    check('밀린 만큼 하루 개론이 늘어남', 6 <= max(x['gq'] for x in live if x['date'] >= '2026-11-28') <= 9,
          max(x['gq'] for x in live if x['date'] >= '2026-11-28'))
    check('E 콘솔 오류 0건', len(pg.errors) == 0, pg.errors)

    # =========================================================
    # F. 3회독 / 10회독
    # =========================================================
    open_app(pg, {'v': 3, 'target': 3, 'includeSun': True, 'checks': {}}, '2026-11-25')
    card = today_card(pg)
    check('3회독 — 개론 3~4문항', card and re.search(r'개론 예상문제\s*\d+문항', card['text']) is not None,
          card and card['text'])
    items = rounds_items(pg, 3)
    sums = gsum(items)
    check('3회독 — 회독별 개론 467', all(sums[r] == GTOTAL for r in range(1, 4)), sums)
    check('3회독 — 성경 9,018문항 보존', sum(x['q'] for r in range(1, 4) for x in items[r]) == TOTAL[3],
          sum(x['q'] for r in range(1, 4) for x in items[r]))
    tab(pg, 'today')
    check('3회독 — 390px 넘침 없음', no_overflow(pg))

    open_app(pg, {'v': 3, 'target': 10, 'includeSun': True, 'checks': {}}, '2026-11-25')
    items = rounds_items(pg, 10)
    sums = gsum(items)
    check('10회독 — 회독별 개론 467', all(sums[r] == GTOTAL for r in range(1, 11)), sums)
    check('10회독 — 성경 30,060문항 보존', sum(x['q'] for r in range(1, 11) for x in items[r]) == TOTAL[10],
          sum(x['q'] for r in range(1, 11) for x in items[r]))
    open_adjust(pg)
    a = adj_state(pg)
    check('10회독 — 조정 모달에 개론 칸도 있음', a['gcells'] >= 10, a['gcells'])
    check('10회독 — 390px 넘침 없음', no_overflow(pg))
    check('F 콘솔 오류 0건', len(pg.errors) == 0, pg.errors)

    # =========================================================
    # G. 백업 → 복원에 개론 기록 포함
    # =========================================================
    open_app(pg, SEED5, '2026-11-25')
    open_adjust(pg)
    click_cells(pg, [0, 1], 'gchcell')
    finish_adjust(pg)
    tab(pg, 'more')
    with pg.expect_download() as dl:
        pg.click('[data-action="export"]')
    path = os.path.join(tempfile.mkdtemp(), 'backup-gaeron.json')
    dl.value.save_as(path)
    payload = json.load(open(path))
    check('백업에 개론 기록 포함', bool(payload.get('g') and payload['g'].get('2026-11-25')),
          list(payload.keys()))
    before = store(pg)
    pg.evaluate('localStorage.clear()')
    pg.reload(wait_until='networkidle')
    pg.wait_for_timeout(300)
    pg.on('dialog', lambda d: d.accept())
    tab(pg, 'more')
    with pg.expect_file_chooser() as fc:
        pg.click('[data-action="import"]')
    fc.value.set_files(path)
    pg.wait_for_timeout(700)
    after = store(pg)
    check('복원 후 성경 기록', after['checks'] == before['checks'], after['checks'])
    check('복원 후 개론 기록',
          (after.get('g') or {}).get('2026-11-25', {}).get('k') == before['g']['2026-11-25']['k'],
          after.get('g'))
    check('G 콘솔 오류 0건', len(pg.errors) == 0, pg.errors)

    # =========================================================
    # H. 캐시 버전
    # =========================================================
    idx = open(os.path.join(ROOT, 'index.html'), encoding='utf-8').read()
    sw = open(os.path.join(ROOT, 'sw.js'), encoding='utf-8').read()
    check('index.html 스크립트 버전 맞춤', 'app.js?v=7' in idx and 'schedule.js?v=7' in idx,
          [l for l in idx.splitlines() if 'app.js' in l or 'schedule.js' in l])
    check('sw.js 캐시 v7', "jangsin-planner-v7" in sw, sw.splitlines()[2])
    check('sw.js 자산 버전 맞춤', "./app.js?v=7" in sw and "./schedule.js?v=7" in sw)

    # 라이브 화면(390px) 캡처 — 오늘 탭
    open_app(pg, SEED5, '2026-11-25')
    tab(pg, 'today')
    pg.wait_for_timeout(300)
    pg.screenshot(path=os.path.join(SHOTS, 'gaeron-final-390.png'))

    ctx.close()
    browser.close()

print('\n%d PASS / %d FAIL' % (len(PASSES), len(FAILS)))
if FAILS:
    print('실패:')
    for f in FAILS:
        print(' - ' + f)
    raise SystemExit(1)
