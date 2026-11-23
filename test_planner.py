"""장신대 플래너 — 주일 포함 · 진도 재조정 검증 (Playwright, 390px)

    LD_LIBRARY_PATH=/workspace/tmp/libroot/usr/lib/x86_64-linux-gnu:/workspace/work/chromedeps/usr/lib/x86_64-linux-gnu \
      python3 test_planner.py

검증 항목
- 주일 포함 373일 / 주일 제외 320일, 1~10회독 일정
- 기존 localStorage(v2) 기록 유지 (2026-11-23 Day 1 완료)
- '오늘부터 다시 맞추기' — 남은 분량 재배분, 밀린 날 포함, 기록 유지, 되돌리기
- 새로고침 후 유지, 주일 토글
- 콘솔 오류 0건, 390px 가로 넘침 없음
"""
import functools
import http.server
import json
import os
import socketserver
import threading

from playwright.sync_api import sync_playwright

ROOT = os.path.dirname(os.path.abspath(__file__))
SHOTS = os.path.join(ROOT, 'shots')
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
TOTAL_Q = 9018   # 3,006문항 × 3회독


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
    """기존 기록(seed)을 넣고 오늘 날짜를 고정해 연다. 새로고침해도 seed가 되살아나지 않는다."""
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


def round_items(pg, no):
    pg.click('.chip[data-round="%d"]' % no)
    pg.wait_for_timeout(180)
    return pg.evaluate("""() => {
      const out = [];
      document.querySelectorAll('main .list > .item, main .list > button.item').forEach(el => {
        const t1 = el.querySelector('.t1');
        if (!t1) return;
        const lead = t1.childNodes.length ? t1.childNodes[0].textContent : t1.textContent;
        const m = String(lead).match(/Day (\\d+)/);
        if (!m) return;
        const q = el.querySelector('.qcount');
        out.push({
          day: Number(m[1]),
          date: el.dataset.date || null,
          q: q ? Number(q.textContent.replace(/[^0-9]/g, '')) : 0,
          done: el.classList.contains('done'),
          skip: el.classList.contains('skip'),
        });
      });
      return out;
    }""")


def all_items(pg, n):
    tab(pg, 'rounds')
    out = []
    for r in range(1, n + 1):
        out += round_items(pg, r)
    return sorted(out, key=lambda x: x['day'])


def day_q_base(pg, today, date):
    """재조정 전 기본 계획에서 그 날 문항 수"""
    tab(pg, 'rounds')
    items = all_items(pg, 3)
    for x in items:
        if x['date'] == date:
            return x['q']
    return None


with sync_playwright() as p:
    browser = p.chromium.launch(args=['--no-sandbox', '--disable-dev-shm-usage'])

    # =========================================================
    # A. 기존 사용자 기록 + 주일 포함 계획 (373일)
    # =========================================================
    seed = {'v': 2, 'target': 3, 'checks': {'2026-11-23': 1763800000000}}
    ctx, pg = new_page(browser)
    open_app(pg, seed, '2026-11-24')
    txt = pg.inner_text('main')
    check('앱 제목', pg.title() == '장신대 플래너', pg.title())
    check('전체 진행률 373일 기준', '완료 1일 / 373일' in txt, txt[:500])
    check('오늘 카드 Day 2', 'Day 2' in txt, txt[:700])
    st = store(pg)
    check('includeSun 기본 ON', st.get('includeSun') in (None, True), st and st.get('includeSun'))
    check('기존 체크 보존', '2026-11-23' in st['checks'], st['checks'])

    items = all_items(pg, 3)
    check('일정 373일', len(items) == 373, len(items))
    check('첫날 2026-11-23 Day 1', items[0]['date'] == '2026-11-23' and items[0]['day'] == 1, items[0])
    check('마지막 2027-11-30 Day 373', items[-1]['date'] == '2027-11-30' and items[-1]['day'] == 373, items[-1])
    check('Day 1 완료 표시', items[0]['done'] is True, items[0])
    q_day1 = items[0]['q']
    qs = [x['q'] for x in items]
    check('373일 합계 9,018문항', sum(qs) == TOTAL_Q, sum(qs))
    check('하루 분량 21~29', 21 <= min(qs) and max(qs) <= 29, (min(qs), max(qs)))
    pg.click('.chip[data-round="1"]')
    pg.wait_for_timeout(150)
    rtxt = pg.inner_text('main')
    check('회독 구간 표시', '2026.11.23 ~ 2027.03.27' in rtxt, rtxt[:400])

    pg.click('.chip[data-round="1"]')
    pg.wait_for_timeout(150)
    tab(pg, 'calendar')
    cell = pg.evaluate("""() => {
      const b = [...document.querySelectorAll('.cell')].find(x => (x.getAttribute('aria-label') || '').startsWith('2026-11-29 '));
      return b ? {label: b.querySelector('.cs').textContent, cls: b.className, aria: b.getAttribute('aria-label')} : null;
    }""")
    check('주일 11/29도 학습일', cell is not None and 'sun' not in cell['cls'], cell)
    check('A 콘솔 오류 0건', len(pg.errors) == 0, pg.errors)

    # =========================================================
    # B. 주일 토글 (373 ↔ 320)
    # =========================================================
    open_app(pg, seed, '2026-11-24')
    tab(pg, 'more')
    mtxt = pg.inner_text('main')
    check('더보기에 주일 토글', '주일에도 공부하기' in mtxt, mtxt[:400])
    check('토글 기본 ON', pg.get_attribute('[data-action="toggleSun"]', 'aria-checked') == 'true')
    check('학습일 373일 표시', '373일 (주일 포함)' in mtxt, mtxt[:900])

    pg.click('[data-action="toggleSun"]')
    pg.wait_for_timeout(320)
    mtxt = pg.inner_text('main')
    check('주일 끄면 320일', '320일 (주일 제외)' in mtxt, mtxt[:900])
    check('주일 끄면 토글 OFF', pg.get_attribute('[data-action="toggleSun"]', 'aria-checked') == 'false')
    check('주일 설정 저장', store(pg).get('includeSun') is False, store(pg).get('includeSun'))
    pg.reload(wait_until='networkidle')
    pg.wait_for_timeout(300)
    check('새로고침 후 320일', '320일' in pg.inner_text('main'), pg.inner_text('main')[:500])
    tab(pg, 'calendar')
    suncell = pg.evaluate("""() => {
      const b = [...document.querySelectorAll('.cell')].find(x => x.getAttribute('aria-label') === '2026-11-29');
      return b ? {label: b.querySelector('.cs').textContent, cls: b.className} : null;
    }""")
    check('주일 끄면 11/29 주일 휴식', bool(suncell) and suncell['label'] == '주일' and 'sun' in suncell['cls'], suncell)
    tab(pg, 'more')
    pg.click('[data-action="toggleSun"]')
    pg.wait_for_timeout(320)
    check('다시 켜면 373일', '373일 (주일 포함)' in pg.inner_text('main'), pg.inner_text('main')[:900])
    check('토글 후에도 체크 유지', '2026-11-23' in store(pg)['checks'], store(pg)['checks'])
    check('B 콘솔 오류 0건', len(pg.errors) == 0, pg.errors)

    # =========================================================
    # C. 밀린 날 재조정 — 오늘부터 다시 맞추기 (11/27)
    # =========================================================
    open_app(pg, seed, '2026-11-27')
    txt = pg.inner_text('main')
    check('밀림 감지 3일', '진도가 밀렸어요' in txt and '3일' in txt, txt[:600])
    check('다시 맞추기 버튼', pg.locator('main [data-action="rebalance"]').count() > 0)
    pg.click('main [data-action="rebalance"]')
    pg.wait_for_timeout(500)
    toast = pg.inner_text('#toast')
    check('재조정 토스트(밀린 분량 포함)', '다시 나눴어요' in toast and '밀린' in toast, toast)
    st = store(pg)
    reb = st['reb']
    check('재조정 저장 · 11/27부터', bool(reb) and reb['from'] == '2026-11-27', reb and reb['from'])
    check('재조정 일수 369일', reb['dayCount'] == 369, reb['dayCount'])
    check('기록 유지', st['checks'] == {'2026-11-23': 1763800000000}, st['checks'])
    check('남은 문항 = 9,018 - Day1', reb['items'] == TOTAL_Q - q_day1, (reb['items'], q_day1))
    check('재조정 합계 = 남은 문항', sum(d['q'] for d in reb['days']) == TOTAL_Q - q_day1,
          sum(d['q'] for d in reb['days']))
    check('마지막 재조정 날 2027-11-30', reb['days'][-1]['date'] == '2027-11-30', reb['days'][-1]['date'])

    items = all_items(pg, 3)
    live = [x for x in items if not x['skip']]
    skipped = [x for x in items if x['skip']]
    check('넘어간 날 3일(11/24~26)', [x['date'] for x in skipped] == ['2026-11-24', '2026-11-25', '2026-11-26'],
          [x['date'] for x in skipped])
    check('재조정 후 총 373줄', len(items) == 373, len(items))
    check('재조정 후 합계 9,018문항', sum(x['q'] for x in live) == TOTAL_Q, sum(x['q'] for x in live))
    check('마지막 학습일 2027-11-30', live[-1]['date'] == '2027-11-30', live[-1])
    qs = [x['q'] for x in live if x['date'] >= '2026-11-27']
    check('남은 날 하루 22~27문항', 22 <= min(qs) and max(qs) <= 27, (min(qs), max(qs)))
    check('오늘(11/27) 분량 배정', any(x['date'] == '2026-11-27' for x in live))

    # 권별 일정도 66권 3,006문항이 그대로 남아 있는지
    pg.click('[data-action="mode"][data-mode="book"]')
    pg.wait_for_timeout(250)
    books = pg.evaluate("""() => [...document.querySelectorAll('main .list > button.item')].map(el => {
        const t2 = el.querySelector('.t2');
        const m = t2 ? t2.textContent.match(/완료 (\\d+) \\/ (\\d+)문항/) : null;
        return m ? Number(m[2]) : null;
      }).filter(v => v !== null)""")
    check('권별 66권', len(books) == 66, len(books))
    check('권별 합계 3,006문항', sum(books) == 3006, sum(books))
    pg.click('[data-action="mode"][data-mode="date"]')
    pg.wait_for_timeout(200)

    pg.reload(wait_until='networkidle')
    pg.wait_for_timeout(300)
    check('새로고침 후 재조정 유지', bool(store(pg).get('reb')))
    today_txt = pg.inner_text('main')
    check('새로고침 후 오늘 카드', 'Day 5' in today_txt, today_txt[:600])
    check('새로고침 후 완료 기록 유지', store(pg)['checks'] == {'2026-11-23': 1763800000000})

    # 되돌리기
    pg.click('main [data-action="undoRebalance"]')
    pg.wait_for_timeout(400)
    check('되돌리기 토스트', '되돌렸어요' in pg.inner_text('#toast'), pg.inner_text('#toast'))
    check('되돌리면 reb 삭제', store(pg).get('reb') is None)
    check('되돌리면 밀린 날 3일', '진도가 밀렸어요' in pg.inner_text('main'))
    items = all_items(pg, 3)
    check('되돌리면 373일', len([x for x in items if not x['skip']]) == 373, len(items))
    check('되돌려도 기록 유지', store(pg)['checks'] == {'2026-11-23': 1763800000000})
    check('C 콘솔 오류 0건', len(pg.errors) == 0, pg.errors)

    # =========================================================
    # D. 오늘 이미 완료 → 다음 날부터 재조정 + 스크린샷
    # =========================================================
    seed3 = {'v': 2, 'target': 3, 'checks': {'2026-11-23': 1763800000000, '2026-11-24': 1763900000000}}
    open_app(pg, seed3, '2026-11-24')
    tab(pg, 'more')
    pg.click('main [data-action="rebalance"]')
    pg.wait_for_timeout(500)
    tab(pg, 'today')
    pg.wait_for_timeout(300)
    reb = store(pg)['reb']
    check('오늘 완료면 11/25부터', bool(reb) and reb['from'] == '2026-11-25', reb and reb['from'])
    check('오늘 완료면 371일', reb and reb['dayCount'] == 371, reb and reb['dayCount'])
    check('오늘 완료면 시작일 이전 기록 불변',
          store(pg)['checks'] == {'2026-11-23': 1763800000000, '2026-11-24': 1763900000000})
    pg.wait_for_timeout(2000)
    pg.screenshot(path=os.path.join(SHOTS, 'planner-rebalance-390.png'))
    pg.screenshot(path=os.path.join(SHOTS, 'planner-rebalance-390-full.png'), full_page=True)
    check('D 콘솔 오류 0건', len(pg.errors) == 0, pg.errors)

    # =========================================================
    # E. 10회독 + 재조정
    # =========================================================
    open_app(pg, seed, '2026-12-01')
    pg.click('[data-action="openTarget"]')
    pg.wait_for_timeout(300)
    pg.click('[data-action="setTarget"][data-n="10"]')
    pg.wait_for_timeout(400)
    check('10회독 전환', '10회독으로 바꿨어요' in pg.inner_text('#toast'), pg.inner_text('#toast'))
    pg.click('#sheetBody [data-action="closeSheet"]')
    pg.wait_for_timeout(300)
    tab(pg, 'rounds')
    base10 = [x for x in round_items(pg, 1) if x['date'] == '2026-11-23']
    q0 = base10[0]['q'] if base10 else 0
    tab(pg, 'today')
    pg.click('main [data-action="rebalance"]')
    pg.wait_for_timeout(600)
    reb = store(pg)['reb']
    check('10회독 재조정 남은 30,060문항', bool(reb) and sum(d['q'] for d in reb['days']) == 30060 - q0,
          (reb and sum(d['q'] for d in reb['days']), q0))
    check('10회독 재조정 12/01부터', bool(reb) and reb['from'] == '2026-12-01', reb and reb['from'])
    over = pg.evaluate('Math.max(document.documentElement.scrollWidth, document.body.scrollWidth) - window.innerWidth')
    check('390px 가로 넘침 없음', over <= 0, over)
    check('E 콘솔 오류 0건', len(pg.errors) == 0, pg.errors)

    # =========================================================
    # F. 1.x(Day 번호) 기록 이전
    # =========================================================
    ctx.close()
    ctx, pg = new_page(browser)
    pg.goto(BASE + 'index.html', wait_until='domcontentloaded')
    pg.evaluate("""() => {
      localStorage.clear();
      localStorage.setItem('jangsin-planner-v1', JSON.stringify({v:1, target:3, checks:{'1': 1763800000000, '2': 1763900000000}}));
    }""")
    pg.goto(BASE + 'index.html?today=2026-11-24', wait_until='networkidle')
    pg.wait_for_timeout(350)
    txt = pg.inner_text('main')
    check('1.x 기록 이전 — 11/23·11/24 완료', '완료 2일 / 373일' in txt, txt[:400])
    check('1.x 기록 이전 — Day 번호 그대로', 'Day 2' in txt, txt[:500])
    check('F 콘솔 오류 0건', len(pg.errors) == 0, pg.errors)

    # =========================================================
    # G. 백업 → 복원 (다시 맞추기 포함)
    # =========================================================
    open_app(pg, seed3, '2026-11-24')
    tab(pg, 'more')
    pg.click('main [data-action="rebalance"]')
    pg.wait_for_timeout(400)
    before = store(pg)
    with pg.expect_download() as dl:
        pg.click('[data-action="export"]')
    path = os.path.join(ROOT, 'shots', 'backup-test.json')
    dl.value.save_as(path)
    payload = json.load(open(path))
    check('백업에 includeSun·reb 포함', payload.get('includeSun') is True and bool(payload.get('reb')),
          list(payload.keys()))
    pg.evaluate('localStorage.clear()')
    pg.reload(wait_until='networkidle')
    pg.wait_for_timeout(300)
    check('초기화 후 기록 없음', '완료 0일' in pg.inner_text('main'), pg.inner_text('main')[:400])
    pg.on('dialog', lambda d: d.accept())
    tab(pg, 'more')
    with pg.expect_file_chooser() as fc:
        pg.click('[data-action="import"]')
    fc.value.set_files(path)
    pg.wait_for_timeout(700)
    after = store(pg)
    check('복원 후 체크 기록', after['checks'] == before['checks'], after['checks'])
    check('복원 후 다시 맞추기', bool(after.get('reb')) and after['reb']['from'] == before['reb']['from'],
          after.get('reb') and after['reb']['from'])
    check('G 콘솔 오류 0건', len(pg.errors) == 0, pg.errors)

    ctx.close()
    browser.close()

print('\n%d PASS / %d FAIL' % (len(PASSES), len(FAILS)))
if FAILS:
    print('실패:')
    for f in FAILS:
        print(' - ' + f)
    raise SystemExit(1)
