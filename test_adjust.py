"""장신대 플래너 — 오늘의 공부량 미세 조정 검증 (Playwright, 390px)

    LD_LIBRARY_PATH=/workspace/tmp/libroot/usr/lib/x86_64-linux-gnu:/workspace/work/chromedeps/usr/lib/x86_64-linux-gnu \
      python3 test_adjust.py

검증 항목
- 오늘의 공부 카드에 [공부량 조정] · [완료] 두 버튼이 나란히
- [공부량 조정] → 문항 번호 그리드 모달, 일부만 체크 후 완료
- 체크한 만큼만 오늘 완료 기록, 남은 문항이 다음 학습일부터 재배분(총 문항 보존)
- 같은 날 다시 조정, 전체 선택 = 기존 완료, 되돌리기, 새로고침 유지
- 부분 완료 후 '오늘부터 다시 맞추기'에서도 그 기록 보존
- 3·5·10회독, 콘솔 오류 0건, 390px 가로 넘침 없음
"""
import functools
import http.server
import json
import os
import socketserver
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


TOTAL = {3: 9018, 5: 15030, 10: 30060}   # 3,006문항 × 회독


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


def goto_today(pg, today):
    pg.goto(BASE + 'index.html?today=' + today, wait_until='networkidle')
    pg.wait_for_timeout(350)


def store(pg):
    raw = pg.evaluate("localStorage.getItem('%s')" % KEY)
    return json.loads(raw) if raw else None


def tab(pg, name):
    pg.click('.tab[data-tab="%s"]' % name)
    pg.wait_for_timeout(220)


def all_items(pg, n):
    """회독 탭 날짜별 일정 → [{date, day, q, done, skip}] (Day 번호 순)"""
    tab(pg, 'rounds')
    out = []
    for r in range(1, n + 1):
        pg.click('.chip[data-round="%d"]' % r)
        pg.wait_for_timeout(140)
        out += pg.evaluate("""() => {
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
              txt: el.textContent,
            });
          });
          return out;
        }""")
    out.sort(key=lambda x: x['day'])
    return out


def today_card(pg):
    tab(pg, 'today')
    return pg.evaluate("""() => {
      const cards = [...document.querySelectorAll('main section.card')];
      const c = cards.find(x => x.textContent.includes('오늘의 공부'));
      if (!c) return null;
      const btns = [...c.querySelectorAll('button')].map(b => {
        const r = b.getBoundingClientRect();
        return {text: b.textContent.trim(), action: b.dataset.action || '',
                x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height)};
      });
      return {text: c.textContent.replace(/\\s+/g, ' ').trim(), btns: btns};
    }""")


def open_adjust(pg, date=None):
    tab(pg, 'today')
    sel = 'main [data-action="openAdjust"]' + ('[data-date="%s"]' % date if date else '')
    pg.click(sel)
    pg.wait_for_timeout(320)


def adj_state(pg):
    return pg.evaluate("""() => {
      const sheet = document.getElementById('sheet');
      const cells = [...sheet.querySelectorAll('.chcell')];
      const cnt = sheet.querySelector('#adjCount');
      const books = [...sheet.querySelectorAll('.adj-book-head')].map(x => x.textContent.trim());
      return {
        open: sheet.classList.contains('on'),
        cells: cells.length,
        labels: cells.map(c => c.textContent.trim()),
        on: cells.filter(c => c.classList.contains('on')).length,
        count: cnt ? cnt.textContent.trim() : null,
        books: books,
        title: (sheet.querySelector('h3') || {}).textContent || '',
        btns: [...sheet.querySelectorAll('.btn')].map(b => b.textContent.trim()),
      };
    }""")


def click_cells(pg, idx_list):
    pg.evaluate("""(idx) => {
      const cells = [...document.querySelectorAll('#sheet .chcell')];
      idx.forEach(i => cells[i].click());
    }""", idx_list)
    pg.wait_for_timeout(120)


def finish_adjust(pg):
    pg.click('#sheetBody [data-action="adjApply"]')
    pg.wait_for_timeout(450)


def sheet_open(pg):
    return pg.evaluate("document.getElementById('sheet').classList.contains('on')")


def no_overflow(pg):
    return pg.evaluate('Math.max(document.documentElement.scrollWidth, document.body.scrollWidth) '
                       '- window.innerWidth') <= 0


with sync_playwright() as p:
    browser = p.chromium.launch(args=['--no-sandbox', '--disable-dev-shm-usage'])

    # =========================================================
    # A. 사용자 설정(5회독 · 주일 포함 373일) — 두 버튼 + 번호 그리드 + 20/39 완료
    # =========================================================
    seed5 = {'v': 3, 'target': 5, 'includeSun': True, 'checks': {'2026-11-23': ts(2026, 11, 23)}}
    ctx, pg = new_page(browser)
    open_app(pg, seed5, '2026-11-24')

    card = today_card(pg)
    check('오늘 카드 Day 2 · 창세기 041~079 39문항',
          card and 'Day 2' in card['text'] and '041~079' in card['text'] and '39문항' in card['text'],
          card and card['text'])
    labels = [b['text'] for b in card['btns']]
    check('두 버튼 [공부량 조정] · [완료]', '공부량 조정' in labels and '완료' in labels, labels)
    adj = next((b for b in card['btns'] if b['text'] == '공부량 조정'), None)
    fin = next((b for b in card['btns'] if b['text'] == '완료'), None)
    check('두 버튼이 한 줄에 나란히', adj and fin and abs(adj['y'] - fin['y']) <= 2 and adj['x'] < fin['x'],
          (adj, fin))
    check('공부량 조정 버튼이 완료보다 넓음', adj and fin and adj['w'] > fin['w'], (adj and adj['w'], fin and fin['w']))

    open_adjust(pg)
    st = adj_state(pg)
    check('조정 모달 열림', st['open'] is True)
    check('번호 칸 39개 (41~79)', st['cells'] == 39 and st['labels'][0] == '41' and st['labels'][-1] == '79',
          (st['cells'], st['labels'][:3], st['labels'][-3:]))
    check('처음엔 전부 미체크 · 0 / 39문항', st['on'] == 0 and st['count'] == '0 / 39문항', st['count'])
    check('모달 하단 [취소] · [완료]', st['btns'] == ['취소', '완료'], st['btns'])
    pg.screenshot(path=os.path.join(SHOTS, 'adjust-modal-empty-390.png'))

    click_cells(pg, list(range(20)))
    st = adj_state(pg)
    check('20개 체크 → 20 / 39문항', st['on'] == 20 and st['count'] == '20 / 39문항', st['count'])
    pg.screenshot(path=os.path.join(SHOTS, 'adjust-modal-390.png'))

    finish_adjust(pg)
    check('완료 후 모달 닫힘', sheet_open(pg) is False)
    toast = pg.inner_text('#toast')
    check('조정 토스트', '20문항 완료' in toast and '남은 19문항' in toast, toast)

    st = store(pg)
    reb = st.get('reb')
    check('오늘(11/24) 완료 기록', '2026-11-24' in st['checks'], st['checks'])
    check('기존 11/23 기록 보존', st['checks'].get('2026-11-23') == ts(2026, 11, 23), st['checks'])
    check('조정 기록 저장', bool(reb) and reb['reason'] == 'partial' and reb['partialDate'] == '2026-11-24'
          and reb['partialQ'] == 20 and reb['partialTotal'] == 39, reb and {k: reb[k] for k in
                                                                         ('reason', 'partialDate', 'partialQ', 'partialTotal')})

    card = today_card(pg)
    check('오늘 카드 20문항만 남음', card and '041~060' in card['text'] and '20문항' in card['text'], card and card['text'])
    check('남은 문항 안내', card and '39문항 중 20문항 완료' in card['text'] and '남은 19문항' in card['text'],
          card and card['text'])
    check('완료 취소 버튼으로 바뀜', card and '완료 취소' in [b['text'] for b in card['btns']],
          card and [b['text'] for b in card['btns']])
    check('일정 조정 카드 = 공부량 조정됨', '공부량 조정됨' in pg.inner_text('main'), pg.inner_text('main')[:600])

    items = all_items(pg, 5)
    live = [x for x in items if not x['skip']]
    by_date = {x['date']: x for x in live}
    check('계획 총 문항 보존 (5회독 15,030)', sum(x['q'] for x in live) == TOTAL[5], sum(x['q'] for x in live))
    check('11/24 = 20문항 완료', by_date['2026-11-24']['q'] == 20 and by_date['2026-11-24']['done'], by_date.get('2026-11-24'))
    check('11/25는 061번부터 (안 푼 19문항이 먼저)', '061' in (by_date['2026-11-25']['txt'] or ''),
          by_date.get('2026-11-25'))
    q_next = by_date['2026-11-25']['q']
    check('11/25 분량이 안 푼 19문항을 포함해 40문항', q_next == 40, q_next)
    check('11/23 그대로 40문항', by_date['2026-11-23']['q'] == 40, by_date.get('2026-11-23'))
    check('5회독 그대로', st['target'] == 5 and len([r for r in range(1, 6)]) == 5)
    check('A 가로 넘침 없음', no_overflow(pg))
    tab(pg, 'today')
    pg.wait_for_timeout(200)
    pg.screenshot(path=os.path.join(SHOTS, 'adjust-card-390.png'))
    check('A 콘솔 오류 0건', len(pg.errors) == 0, pg.errors)

    # =========================================================
    # B. 새로고침해도 유지
    # =========================================================
    goto_today(pg, '2026-11-24')
    card = today_card(pg)
    check('새로고침 후 조정 유지', card and '041~060' in card['text'] and '남은 19문항' in card['text'],
          card and card['text'])
    b_items = all_items(pg, 5)
    check('새로고침 후 총 문항 보존', sum(x['q'] for x in b_items if not x['skip']) == TOTAL[5],
          sum(x['q'] for x in b_items if not x['skip']))

    # =========================================================
    # C. 같은 날 다시 조정 — 원래 39문항 그리드가 다시 나오고, 늘리면 중복 없이 재계산
    # =========================================================
    open_adjust(pg)
    st = adj_state(pg)
    check('다시 조정 — 39칸 · 20개 선택 유지', st['cells'] == 39 and st['on'] == 20, (st['cells'], st['on']))
    click_cells(pg, list(range(20, 30)))
    st = adj_state(pg)
    check('다시 조정 — 30개 선택', st['on'] == 30 and st['count'] == '30 / 39문항', st['count'])
    finish_adjust(pg)
    st = store(pg)
    check('다시 조정 저장 30문항', st['reb']['partialQ'] == 30, st['reb']['partialQ'])
    items = all_items(pg, 5)
    live = [x for x in items if not x['skip']]
    by_date = {x['date']: x for x in live}
    check('다시 조정 후에도 총 문항 보존', sum(x['q'] for x in live) == TOTAL[5], sum(x['q'] for x in live))
    check('11/24 = 30문항', by_date['2026-11-24']['q'] == 30, by_date.get('2026-11-24'))
    check('11/25는 071번부터', '071' in (by_date['2026-11-25']['txt'] or ''), by_date.get('2026-11-25'))

    # =========================================================
    # D. 되돌리기 → 원래 39문항 · 기록 삭제
    # =========================================================
    tab(pg, 'today')
    pg.click('main [data-action="undoRebalance"]')
    pg.wait_for_timeout(450)
    check('되돌리기 토스트', '되돌렸어요' in pg.inner_text('#toast'), pg.inner_text('#toast'))
    st = store(pg)
    check('되돌리면 reb 삭제', st.get('reb') is None, st.get('reb'))
    check('되돌리면 11/24 체크 삭제', '2026-11-24' not in st['checks'], st['checks'])
    check('되돌리면 11/23 기록 유지', '2026-11-23' in st['checks'], st['checks'])
    card = today_card(pg)
    check('되돌리면 다시 39문항', card and '041~079' in card['text'] and '39문항' in card['text'], card and card['text'])
    items = all_items(pg, 5)
    check('되돌리면 373일 · 총 문항 보존',
          len([x for x in items if not x['skip']]) == 373 and sum(x['q'] for x in items if not x['skip']) == TOTAL[5],
          len([x for x in items if not x['skip']]))
    check('D 콘솔 오류 0건', len(pg.errors) == 0, pg.errors)

    # =========================================================
    # E. 전부 선택 = 그냥 완료 / 0개 선택은 막힘
    # =========================================================
    open_adjust(pg)
    finish_adjust(pg)
    check('0개 선택 완료 → 안내만', '하나 이상' in pg.inner_text('#toast') and '2026-11-24' not in store(pg)['checks'],
          pg.inner_text('#toast'))
    pg.click('#sheetBody [data-action="adjAll"]')
    pg.wait_for_timeout(150)
    st = adj_state(pg)
    check('전체 선택 버튼', st['on'] == 39 and st['count'] == '39 / 39문항', st['count'])
    finish_adjust(pg)
    st = store(pg)
    check('전체 선택 완료 = 보통 완료 (조정 없음)',
          st.get('reb') is None and '2026-11-24' in st['checks'], (st.get('reb'), st['checks']))

    # =========================================================
    # F. 3회독 기본 계획에서 부분 완료
    # =========================================================
    ctx.close()
    ctx, pg = new_page(browser)
    seed3 = {'v': 3, 'target': 3, 'includeSun': True, 'checks': {}}
    open_app(pg, seed3, '2026-11-24')
    card = today_card(pg)
    check('3회독 — Day 2 24문항', card and 'Day 2' in card['text'] and '24문항' in card['text'], card and card['text'])
    open_adjust(pg)
    st = adj_state(pg)
    check('3회독 — 번호 칸 24개', st['cells'] == 24, st['cells'])
    click_cells(pg, list(range(10)))
    finish_adjust(pg)
    st = store(pg)
    check('3회독 — 10문항 조정 저장', st['reb']['partialQ'] == 10 and st['reb']['partialTotal'] == 24,
          (st['reb']['partialQ'], st['reb']['partialTotal']))
    items = all_items(pg, 3)
    live = [x for x in items if not x['skip']]
    check('3회독 — 총 9,018문항 보존', sum(x['q'] for x in live) == TOTAL[3], sum(x['q'] for x in live))
    check('3회독 — 11/24 10문항', {x['date']: x for x in live}['2026-11-24']['q'] == 10)
    check('F 콘솔 오류 0건', len(pg.errors) == 0, pg.errors)

    # =========================================================
    # G. 10회독(하루 여러 권) 부분 완료
    # =========================================================
    seed10 = {'v': 3, 'target': 10, 'includeSun': True, 'checks': {}}
    open_app(pg, seed10, '2026-11-24')
    q_today = next((x['q'] for x in all_items(pg, 10) if x['date'] == '2026-11-24'), 0)
    open_adjust(pg)
    st = adj_state(pg)
    check('10회독 — 하루 분량만큼 번호 칸', st['cells'] == q_today and st['cells'] >= 70,
          (st['cells'], q_today))
    check('10회독 — 두 권 이상 그리드', len(st['books']) >= 2, st['books'])
    click_cells(pg, list(range(30)))
    finish_adjust(pg)
    items = all_items(pg, 10)
    live = [x for x in items if not x['skip']]
    check('10회독 — 총 30,060문항 보존', sum(x['q'] for x in live) == TOTAL[10], sum(x['q'] for x in live))
    check('10회독 — 오늘 30문항', {x['date']: x for x in live}['2026-11-24']['q'] == 30)
    check('10회독 — 가로 넘침 없음', no_overflow(pg))
    check('G 콘솔 오류 0건', len(pg.errors) == 0, pg.errors)

    # =========================================================
    # I. 부분 완료 → 전부 선택으로 다시 조정 (되돌려 담기, 중복 없음)
    # =========================================================
    ctx.close()
    ctx, pg = new_page(browser)
    open_app(pg, seed5, '2026-11-24')
    open_adjust(pg)
    click_cells(pg, list(range(20)))
    finish_adjust(pg)
    open_adjust(pg)
    pg.click('#sheetBody [data-action="adjAll"]')
    pg.wait_for_timeout(150)
    finish_adjust(pg)
    items = all_items(pg, 5)
    live = [x for x in items if not x['skip']]
    by_date = {x['date']: x for x in live}
    check('전부 다시 고르면 오늘 39문항 완료', by_date['2026-11-24']['q'] == 39 and by_date['2026-11-24']['done'],
          by_date.get('2026-11-24'))
    check('되돌려 담아도 총 문항 보존', sum(x['q'] for x in live) == TOTAL[5], sum(x['q'] for x in live))
    check('내일은 080번 다음(출애굽기)부터', '출애굽기' in (by_date['2026-11-25']['txt'] or ''),
          by_date.get('2026-11-25'))
    check('I 콘솔 오류 0건', len(pg.errors) == 0, pg.errors)

    # =========================================================
    # J. 부분 완료 → 완료 취소 → 다시 조정
    # =========================================================
    open_app(pg, seed5, '2026-11-24')
    open_adjust(pg)
    click_cells(pg, list(range(15)))
    finish_adjust(pg)
    card = today_card(pg)
    pg.click('main [data-action="toggle"]')
    pg.wait_for_timeout(350)
    st = store(pg)
    check('완료 취소 — 체크 삭제', '2026-11-24' not in st['checks'], st['checks'])
    card = today_card(pg)
    check('완료 취소 — 15문항 카드 · 다시 완료 가능', card and '15문항' in card['text'] and '완료' in
          [b['text'] for b in card['btns']], card and card['text'])
    open_adjust(pg)
    st2 = adj_state(pg)
    check('완료 취소 후 조정 — 원래 39칸 다시 표시', st2['cells'] == 39 and st2['on'] == 0,
          (st2['cells'], st2['on']))
    pg.click('#sheetBody [data-action="closeSheet"]')
    pg.wait_for_timeout(300)
    check('J 콘솔 오류 0건', len(pg.errors) == 0, pg.errors)

    # =========================================================
    # H. 부분 완료 다음 날 '오늘부터 다시 맞추기' — 조정 기록 보존
    # =========================================================
    ctx.close()
    ctx, pg = new_page(browser)
    open_app(pg, seed5, '2026-11-24')
    open_adjust(pg)
    click_cells(pg, list(range(20)))
    finish_adjust(pg)
    goto_today(pg, '2026-11-26')          # 11/25는 안 하고 11/26에 접속
    txt = pg.inner_text('main')
    check('밀린 날 감지', '진도가 밀렸어요' in txt, txt[:600])
    pg.click('main [data-action="rebalance"]')
    pg.wait_for_timeout(500)
    items = all_items(pg, 5)
    live = [x for x in items if not x['skip']]
    by_date = {x['date']: x for x in live}
    check('다시 맞추기 후에도 총 문항 보존', sum(x['q'] for x in live) == TOTAL[5], sum(x['q'] for x in live))
    check('다시 맞추기 후 11/24 = 20문항 완료 유지',
          by_date['2026-11-24']['q'] == 20 and by_date['2026-11-24']['done'], by_date.get('2026-11-24'))
    check('안 한 11/25는 넘어감', by_date.get('2026-11-25') is None or by_date['2026-11-25'].get('skip'),
          by_date.get('2026-11-25'))
    check('H 콘솔 오류 0건', len(pg.errors) == 0, pg.errors)

    ctx.close()
    browser.close()

print('\n%d PASS / %d FAIL' % (len(PASSES), len(FAILS)))
if FAILS:
    print('실패:')
    for f in FAILS:
        print(' - ' + f)
    raise SystemExit(1)
