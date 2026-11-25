#!/usr/bin/env python3
"""장신대 플래너 데이터 생성기.

- 성경문제: downloads/jangsin_bible/answers.json 의 66권 문항 수
- 개론 예상문제: work/jangsin_gaeron/questions_gaeron.json 의 66권 예상문제 수

회독 수(1~10)는 앱에서 고르므로 schedule.js 에는
- 공부 기간(2026-11-23 ~ 2027-11-30)
- 66권의 인쇄 문항 수와 삭제 문항, 개론 문항 수
만 담고, 하루 분량 배분은 app.js 가 회독 수에 맞춰 계산한다.

    python3 build_schedule.py \
      --answers ../../downloads/jangsin_bible/answers.json \
      --gaeron ../../work/jangsin_gaeron/questions_gaeron.json
"""
import argparse
import json
import os
from datetime import date, timedelta

HERE = os.path.dirname(os.path.abspath(__file__))
START = date(2026, 11, 23)
END = date(2027, 11, 30)
GAERON_START = date(2026, 11, 25)     # 개론 예상문제 배분 시작일(사용자가 요청한 '오늘')
# 개론 전사본과 플래너의 책 이름 표기 차이
NAME_ALIAS = {'오바댜': '오바다'}


def iso(d):
    return d.strftime('%Y-%m-%d')


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--answers', default=os.path.join(HERE, '..', '..', 'downloads', 'jangsin_bible', 'answers.json'))
    ap.add_argument('--gaeron', default=os.path.join(HERE, '..', '..', 'work', 'jangsin_gaeron', 'questions_gaeron.json'))
    ap.add_argument('--out', default=os.path.join(HERE, 'schedule.js'))
    args = ap.parse_args()

    data = json.load(open(args.answers, encoding='utf-8'))
    books = []
    for b in sorted(data['books'], key=lambda x: x['order']):
        mc, sub = b['multiple_choice'], b['subjective']
        nums = sorted(set(int(k) for k in mc) | set(int(k) for k in sub))
        deleted = sorted(n for n in nums
                         if mc.get(f'{n:03d}', {}).get('status') == 'deleted'
                         or sub.get(f'{n:03d}', {}).get('status') == 'deleted')
        books.append({
            'name': b['book'], 'testament': b['testament'], 'order': b['order'],
            'printed': len(nums),          # 인쇄 번호 기준 문항 수 (삭제 포함)
            'total': len(nums) - len(deleted),
            'deleted': deleted,
        })

    for b in books:
        assert b['printed'] == max(b['printed'], b['total'] + len(b['deleted']))

    # ---- 개론 예상문제 ----
    gdata = json.load(open(args.gaeron, encoding='utf-8'))
    gq = gdata['questions']
    gcount = {}
    gorder = []
    for x in gq:
        name = NAME_ALIAS.get(x['book'], x['book'])
        if not gorder or gorder[-1] != name:
            gorder.append(name)
        gcount[name] = gcount.get(name, 0) + 1
    assert len(gorder) == len(books) == 66, (len(gorder), len(books))
    assert gorder == [b['name'] for b in books], \
        [n for n, b in zip(gorder, books) if n != b['name']]
    gaeron_books = [{'name': b['name'], 'count': gcount[b['name']]} for b in books]
    for b in gaeron_books:
        assert b['count'] >= 1, b
    gaeron_total = sum(b['count'] for b in gaeron_books)
    assert gaeron_total == 467 == gdata['counts']['total'], gaeron_total

    days = 0
    d = START
    while d <= END:
        if d.weekday() != 6:
            days += 1
        d += timedelta(days=1)

    printed_total = sum(b['printed'] for b in books)
    active_total = sum(b['total'] for b in books)

    payload = {
        'meta': {
            'title': '장신대 플래너',
            'source': data['title'],
            'edition': data['document_info'].get('적용판', ''),
            'start': iso(START),
            'end': iso(END),
            'exam': iso(END),
            'studyDays': days,
            'books': len(books),
            'oldTestament': sum(1 for b in books if b['testament'] == '구약'),
            'newTestament': sum(1 for b in books if b['testament'] == '신약'),
            'printedQuestions': printed_total,
            'activeQuestions': active_total,
            'deleted': data['deleted_questions'],
            'defaultRounds': 3,
            'maxRounds': 10,
        },
        'books': books,
        'gaeron': {
            'title': gdata['title'],
            'source': gdata['source'].get('book_pages', ''),
            'start': iso(GAERON_START),
            'total': gaeron_total,
            'multipleChoice': gdata['counts'].get('multiple_choice'),
            'subjective': gdata['counts'].get('subjective'),
            'books': gaeron_books,
        },
    }
    assert printed_total == 3009 and active_total == 3006 and days == 320, payload['meta']

    with open(args.out, 'w', encoding='utf-8') as f:
        f.write('/* 자동 생성: build_schedule.py — 직접 고치지 마세요 */\n')
        f.write('window.STUDY_DATA = ')
        json.dump(payload, f, ensure_ascii=False, separators=(',', ':'))
        f.write(';\n')

    print('books', len(books), 'printed', printed_total, 'active', active_total, 'days', days)
    print('gaeron books', len(gaeron_books), 'total', gaeron_total, 'start', iso(GAERON_START))
    print('size', os.path.getsize(args.out))


if __name__ == '__main__':
    main()
