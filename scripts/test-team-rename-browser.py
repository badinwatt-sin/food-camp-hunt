#!/usr/bin/env python3
"""Rename refresh regression using API fixtures only; never writes to a real account."""
import json
import os
import sys
sys.dont_write_bytecode = True
from urllib.parse import urlparse
from playwright.sync_api import expect, sync_playwright
from importlib.util import spec_from_file_location, module_from_spec
from pathlib import Path
spec = spec_from_file_location('responsive', Path(__file__).with_name('test-responsive-browser.py'))
m = module_from_spec(spec); spec.loader.exec_module(m)

class RenameFixture(m.Fixture):
    current = m.TEAM
    def response(self, route, data, status=200):
        # Simulate all joined API labels reading the same renamed team row.
        if urlparse(route.request.url).path == '/api/admin/redemptions':
            data = dict(redemptions=[dict(id='r1', team_name=m.TEAM, item_name='ข้าว', quantity=1, total_cost=5, created_at='2026-11-10T10:00:00Z', fulfilled_at=None, confirmed_by='fixture')])
        elif urlparse(route.request.url).path == '/api/admin/hunt':
            data['claims'] = [dict(spot_id='spot1', team=m.TEAM, squad='', by='fixture', at='2026-11-10T10:00:00Z')]
        text = json.dumps(data, ensure_ascii=False).replace(m.TEAM, self.current)
        route.fulfill(status=status, content_type='application/json', body=text)


def refresh(page):
    page.evaluate("window.dispatchEvent(new Event('focus'))")


def nav(page, label):
    page.get_by_role('navigation', name='เมนูผู้จัด').get_by_role('button', name=label, exact=True).click()

checks = []
with sync_playwright() as p:
    browser = p.chromium.launch(executable_path=os.environ.get('CHROMIUM_PATH', '/usr/bin/chromium'), headless=True, args=['--no-sandbox'])
    for width in [393, 1440]:
        ctx = browser.new_context(viewport=dict(width=width, height=900))
        page = ctx.new_page(); f = RenameFixture(page)
        for game in f.games.values(): game['top'] = [dict(name='ผู้เล่นทดสอบ', team=m.TEAM, tokens=20, me=True)]
        page.goto(m.BASE)
        expect(page.get_by_role('heading', name=m.NAME, exact=True)).to_be_visible()
        m.click(page, 'สมาชิกในทีม')
        draft = page.get_by_label('ชื่อ Squad ใหม่', exact=True); draft.fill('ข้อความร่างยังอยู่')
        f.current = 'ทีมครัวสีเขียว'
        refresh(page)
        expect(page.get_by_role('heading', name='สมาชิกทีม '+f.current, exact=True)).to_be_visible()
        expect(draft).to_have_value('ข้อความร่างยังอยู่')
        m.home(page); m.click(page, 'ตลาดของ')
        expect(page.get_by_text('โทเคนของทีม '+f.current, exact=True)).to_be_visible()
        f.current = 'New Camp Team'
        refresh(page)
        expect(page.get_by_text('โทเคนของทีม '+f.current, exact=True)).to_be_visible()
        m.home(page); m.click(page, 'เริ่มภารกิจ'); m.click(page, 'ภารกิจประจำสัปดาห์')
        expect(page.locator('.weekly-hub')).to_be_visible()
        f.current = 'ทีมอาหารสร้างสุข'
        refresh(page)
        page.locator('details').first.locator('summary').click()
        expect(page.locator('details').first).to_contain_text(f.current)
        # The hub refresh must pause while playing, preserving the open card and attempt.
        memory = page.locator('.card').filter(has=page.get_by_role('heading', name='Camp Memory Flip', exact=True))
        memory.get_by_role('button', name='เริ่มภารกิจ', exact=True).click()
        page.get_by_role('button', name='▶️ เริ่มเล่น', exact=True).click()
        page.get_by_role('button', name='การ์ดใบที่ 1', exact=True).click()
        expect(page.get_by_role('button', name='ข้าวสาร', exact=True)).to_be_visible()
        before = sum(path == '/api/minigames' for method, path in f.requests)
        f.current = 'Camp Final Name'; refresh(page)
        page.wait_for_timeout(400)
        expect(page.get_by_role('button', name='ข้าวสาร', exact=True)).to_be_visible()
        assert before == sum(path == '/api/minigames' for method, path in f.requests)
        assert len([body for path, body in f.posts if path == '/api/minigames/memory' and body['action'] == 'start']) == 1
        assert not f.errors and not f.unexpected, (f.errors, f.unexpected)
        checks.append(dict(width=width, player=['team', 'market', 'leaderboard'], squadDraftPreserved=True, activeGamePreserved=True))
        ctx.close()

        ctx = browser.new_context(viewport=dict(width=width, height=900))
        page = ctx.new_page(); f = RenameFixture(page, admin=True)
        page.goto(m.BASE+'/admin')
        nav(page, 'ทีมและผู้เล่น')
        draft = page.get_by_placeholder('ชื่อทีมใหม่'); draft.fill('ทีมร่างยังไม่บันทึก')
        f.current = 'ทีมใหม่ในรายชื่อ'; refresh(page)
        expect(page.locator('select').filter(has=page.locator('option', has_text=f.current)).first).to_be_visible()
        expect(draft).to_have_value('ทีมร่างยังไม่บันทึก')
        nav(page, 'ตลาดสินค้า')
        f.current = 'ทีมใหม่ในตลาด'; refresh(page)
        expect(page.locator('option').filter(has_text=f.current).first).to_have_count(1)
        nav(page, 'ล่าสมบัติ')
        f.current = 'ทีมใหม่ในล่าสมบัติ'; refresh(page)
        expect(page.get_by_role('cell', name=f.current, exact=True)).to_be_visible()
        nav(page, 'ประวัติ')
        f.current = 'ทีมใหม่ในประวัติ'; refresh(page)
        expect(page.get_by_role('cell', name=f.current, exact=True)).to_be_visible()
        assert not f.errors and not f.unexpected and not f.posts, (f.errors, f.unexpected, f.posts)
        checks.append(dict(width=width, admin=['people','market','hunt','history'], teamDraftPreserved=True, mutations=0))
        ctx.close()
    browser.close()
print(json.dumps(dict(checks=checks), ensure_ascii=False))
