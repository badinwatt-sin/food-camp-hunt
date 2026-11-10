#!/usr/bin/env python3
"""Live competition display checks. All API requests are fixtures; no account or data writes.

Run Next locally, then python scripts/test-live-browser.py. BASE_URL,
CHROMIUM_PATH and SCREENSHOT_DIR can override the defaults.
"""
import json
import os
import re
import tempfile
from pathlib import Path
from playwright.sync_api import expect, sync_playwright

BASE = os.environ.get('BASE_URL', 'http://127.0.0.1:3000')
OUT = Path(os.environ.get('SCREENSHOT_DIR', str(Path(tempfile.gettempdir()) / 'food-camp-live')))
OUT.mkdir(parents=True, exist_ok=True)


def team(name, participants, balance=0, completed=0, hunt_found=0):
    return dict(id=name, name=name, lineGroupCode={'DCAO1':'D','DCAO2':'C','DCAO3':'A','DCAO4':'O'}.get(name), balance=balance, spent=0, participants=participants,
                completed=completed, inProgress=0, huntFound=hunt_found, quizTokens=0,
                huntTokens=0, puzzleTokens=0, goalNeed=21, goalMet=False)


def payload():
    return dict(open=False, huntOpen=False, puzzleOpen=False, totalSpots=5, goalPct=0,
                teams=[team(f'DCAO{i+1}', n) for i, n in enumerate([26, 26, 26, 27])]
                + [team('committee', 19, 99999, 19, 7), team('กรรมการ', 0, 99999)],
                feed=[dict(at='2026-11-10T12:00:00Z', kind='quiz', teamId='committee', team='committee', text='STAFF-ONLY')])


def check_bounds(page):
    metrics = page.evaluate('''() => ({width:innerWidth,doc:document.documentElement.scrollWidth,
      clipped:[...document.querySelectorAll('.live-row')].map(row=>({r:row.getBoundingClientRect(),b:row.querySelector('.live-body').getBoundingClientRect()}))
        .filter(({r,b})=>b.top<r.top-1||b.bottom>r.bottom+1).length})''')
    assert metrics['doc'] <= metrics['width'] + 1 and metrics['clipped'] == 0, metrics


checks = []
with sync_playwright() as p:
    browser = p.chromium.launch(executable_path=os.environ.get('CHROMIUM_PATH', '/usr/bin/chromium'), headless=True, args=['--no-sandbox'])
    for width, height in [(393, 852), (1366, 768), (1920, 1080)]:
        ctx = browser.new_context(viewport=dict(width=width, height=height))
        page = ctx.new_page()
        state = payload()
        errors, posts = [], []
        page.on('pageerror', lambda error: errors.append(str(error)))

        def respond(route):
            assert route.request.url.split('?')[0].endswith('/api/admin/live'), route.request.url
            if route.request.method != 'GET':
                posts.append(route.request.url)
            route.fulfill(content_type='application/json', body=json.dumps(state, ensure_ascii=False))

        page.route('**/api/**', respond)
        page.goto(BASE + '/admin/live', wait_until='domcontentloaded', timeout=60000)
        expect(page.locator('.live-row')).to_have_count(4)
        expect(page.locator('.live-name > span:first-child')).to_have_text(['DCAO1', 'DCAO2', 'DCAO3', 'DCAO4'])
        expect(page.get_by_role('img', name='รอเริ่มสะสม Tokens', exact=True)).to_have_count(4)
        expect(page.get_by_role('img', name=re.compile('^อันดับ '))).to_have_count(0)
        expect(page.locator('.live-stats > div > b')).to_have_text(['0/105', '0', '0'])
        expect(page.locator('.live-ranking-note')).to_contain_text('ยังไม่จัดอันดับ')
        expect(page.get_by_text('ยังไม่มีความเคลื่อนไหว', exact=True)).to_be_visible()
        expect(page.get_by_text('committee', exact=True)).to_have_count(0)
        expect(page.get_by_text('กรรมการ', exact=True)).to_have_count(0)
        expect(page.get_by_text('STAFF-ONLY', exact=True)).to_have_count(0)
        page.evaluate('document.fonts.ready')
        check_bounds(page)
        page.screenshot(path=str(OUT / f'live-waiting-{width}.png'))
        checks.append(dict(width=width, state='zero', teams=4, participants=105, medals=0))

        # Team IDs/codes stay unchanged while every label is edited, including old events.
        renamed = ['ครัวสร้างสรรค์สีเขียวและเพื่อนร่วมค่าย', 'Camp Together', 'ทีมอาหารสร้างสุข', 'เพื่อนร่วมแคมป์']
        for index, name in enumerate(renamed):
            state['teams'][index]['name'] = name
        state['feed'].append(dict(at='2026-11-10T12:00:00Z', kind='hunt', teamId='DCAO1', team='DCAO1', text='RENAMED-EVENT'))
        expect(page.locator('.live-name > span:first-child')).to_have_text(renamed, timeout=10000)
        expect(page.locator('.live-feed li')).to_contain_text([renamed[0] + ' RENAMED-EVENT'])
        expect(page.locator('.live-stats > div > b')).to_have_text(['0/105', '0', '0'])
        expect(page.get_by_role('img', name='รอเริ่มสะสม Tokens', exact=True)).to_have_count(4)
        check_bounds(page)
        page.screenshot(path=str(OUT / f'live-renamed-{width}.png'), full_page=width < 900)
        checks.append(dict(width=width, state='renamed-without-navigation', teams=4, medals=0))
        state['feed'] = state['feed'][:1]

        # Exercise the existing five-second refresh without a navigation or write.
        for index, balance in enumerate([10, 20, 30, 40]):
            state['teams'][index]['balance'] = balance
        state['feed'].append(dict(at='2026-11-10T12:00:00Z', kind='hunt', teamId='DCAO1', team='DCAO1', text='TEAM-UPDATE'))
        expect(page.get_by_role('img', name='อันดับ 4', exact=True)).to_be_attached(timeout=10000)
        expect(page.locator('.live-name > span:first-child')).to_have_text(list(reversed(renamed)))
        expect(page.get_by_role('img', name='อันดับ 4', exact=True)).to_have_text('🎖️')
        expect(page.locator('.live-stats > div > b')).to_have_text(['0/105', '0', '100'])
        expect(page.locator('.live-feed li')).to_have_count(1)
        expect(page.get_by_text('TEAM-UPDATE', exact=False)).to_be_visible()
        check_bounds(page)
        page.screenshot(path=str(OUT / f'live-ranked-{width}.png'))
        checks.append(dict(width=width, state='ranked', fourthIcon='🎖️', totalTokens=100))

        for index, balance in enumerate([20, 20, 10, 0]):
            state['teams'][index]['balance'] = balance
        state['goalPct'] = 80
        page.reload(wait_until='domcontentloaded')
        expect(page.get_by_role('img', name='อันดับ 1 ร่วม', exact=True)).to_have_count(2)
        expect(page.get_by_role('img', name='อันดับ 3', exact=True)).to_have_count(1)
        expect(page.get_by_role('img', name='รอเริ่มสะสม Tokens', exact=True)).to_have_count(1)
        check_bounds(page)
        checks.append(dict(width=width, state='ties-and-goal', sharedFirst=2))
        assert not errors and not posts, (errors, posts)
        ctx.close()
    browser.close()

print(json.dumps(dict(checks=checks, javascriptErrors=0, mutations=0, screenshots=str(OUT)), ensure_ascii=False))
