#!/usr/bin/env python3
"""Admin LINE browser smoke tests using API fixtures, never a live database.

Start the application on port 3000 and run:
    python scripts/test-admin-line-browser.py

BASE_URL and CHROMIUM_PATH can override the local server/browser. These tests
exercise UI behavior; the API/SQL suites separately verify authorization and
atomic scoring. All /api/admin requests are intercepted here.
"""

import json
import os
import re
import unittest
from pathlib import Path
from urllib.parse import unquote, urlparse

from playwright.sync_api import expect, sync_playwright


BASE_URL = os.environ.get("BASE_URL", "http://localhost:3000")
SCREENSHOT = Path("/workspace/scratch/food-camp-admin-line.png")
JOINED_AT = "2026-11-10T09:00:00Z"
TEST_URL = "https://line.me/ti/g/admin-smoke-test"


def team_fixture(code, *, joined=0, completed=False, configured=True):
    members = [
        {"id": f"player-{code}-{n}", "name": f"สมาชิก {code}{n}",
         "fullName": f"สมาชิก {code}{n} ทดสอบ", "joinedAt": JOINED_AT if n <= joined else None}
        for n in [1, 2]
    ]
    return {
        "id": f"team-{code}", "name": f"ทีม{code}",
        "line_group_code": code if configured else None,
        "line_group_url": f"https://line.me/ti/g/test-{code}" if configured else None,
        "line_completed_at": JOINED_AT if completed else None,
        "line_finish_rank": 1 if completed else None,
        "line_reward_tokens": 20 if completed else 0,
        "total": 2, "joinedCount": joined, "members": members,
    }


class AdminLineBrowser(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.playwright = sync_playwright().start()
        cls.browser = cls.playwright.chromium.launch(
            executable_path=os.environ.get("CHROMIUM_PATH", "/usr/bin/chromium"),
            headless=True, args=["--no-sandbox"],
        )
        SCREENSHOT.parent.mkdir(parents=True, exist_ok=True)

    @classmethod
    def tearDownClass(cls):
        cls.browser.close()
        cls.playwright.stop()

    def setUp(self):
        self.context = self.browser.new_context(viewport={"width": 1366, "height": 1000})
        self.page = self.context.new_page()
        self.page.set_default_timeout(12000)
        self.role = "admin"
        self.line_open = False
        self.teams = [team_fixture("D", joined=2, completed=True),
                      team_fixture("C", joined=1), team_fixture("A"),
                      team_fixture("O", configured=False)]
        self.posts = []
        self.unexpected = []
        self.page_errors = []
        self.page.on("pageerror", lambda error: self.page_errors.append(str(error)))
        self.context.route("**/api/**", self.api_route)

    def tearDown(self):
        self.context.close()
        self.assertEqual(self.page_errors, [], "Browser JavaScript errors")
        self.assertEqual(self.unexpected, [], "Unexpected API request escaped test fixture coverage")

    def respond(self, route, body, status=200):
        route.fulfill(status=status, content_type="application/json", body=json.dumps(body))

    def summary_teams(self):
        return [{"team_id": t["id"], "name": t["name"], "participants": t["total"],
                 "completed": 0, "in_progress": 0, "balance": t["line_reward_tokens"],
                 "spent": 0, "leader": None, "line_group_code": t["line_group_code"],
                 "line_completed_at": t["line_completed_at"]} for t in self.teams]

    def participants(self):
        return [{"id": member["id"], "name": member["fullName"], "nick_name": member["name"],
                 "team_id": team["id"], "team_name": team["name"], "squad_id": None,
                 "squad_name": None, "status": "not_started", "has_code": True,
                 "correct_count": 0, "tokens_earned": 0, "completed_at": None,
                 "is_leader": False, "has_avatar": False, "avatar_url": None,
                 "avatar_emoji": None, "line_group_code": team["line_group_code"],
                 "line_joined_at": member["joinedAt"], "line_completed_at": team["line_completed_at"]}
                for team in self.teams for member in team["members"]]

    def api_route(self, route):
        request = route.request
        action = unquote(urlparse(request.url).path).removeprefix("/api/admin/")
        if request.method == "GET":
            if action == "session":
                return self.respond(route, {"role": self.role})
            if action == "badges":
                return self.respond(route, {"pendingPhotos": 0})
            if action == "overview":
                return self.respond(route, {"settings": {"team_goal_pct": 0, "tokens_per_correct": 10},
                                            "teams": self.summary_teams(), "pendingPickup": 0,
                                            "pendingPhotos": 0, "checkedIn": 0})
            if action == "line.groups":
                return self.respond(route, {"open": self.line_open, "teams": self.teams})
            if action == "teams":
                return self.respond(route, {"teams": self.summary_teams()})
            if action == "participants":
                return self.respond(route, {"participants": self.participants()})
            if action == "squads":
                return self.respond(route, {"squads": []})
        elif request.method == "POST":
            body = request.post_data_json
            self.posts.append((action, body))
            if action == "game.set" and set(body) == {"line_open"}:
                self.line_open = body["line_open"]
                return self.respond(route, {"ok": True})
            if action == "line.group.save":
                team = next(t for t in self.teams if t["id"] == body["team_id"])
                team["line_group_code"] = body["group"] or None
                team["line_group_url"] = body["url"] or None
                return self.respond(route, {"ok": True})
        self.unexpected.append((request.method, action))
        return self.respond(route, {"message": f"Unexpected mocked request: {action}"}, 400)

    def visit(self):
        self.page.goto(BASE_URL + "/admin")
        expect(self.page.get_by_role("navigation", name="เมนูผู้จัด")).to_be_visible()

    def open_line(self):
        self.visit()
        self.page.get_by_role("button", name="กลุ่ม LINE", exact=True).click()
        expect(self.page.get_by_role("heading", name="สถานะทั้ง 4 กลุ่ม")).to_be_visible()

    def team_card(self, code):
        return self.page.locator(".card").filter(has=self.page.get_by_role("heading", name=f"ทีม ทีม{code}", exact=True))

    def test_admin_can_open_line_tab_and_see_all_four_groups(self):
        self.open_line()
        board = self.page.locator(".card").filter(has=self.page.get_by_role("heading", name="สถานะทั้ง 4 กลุ่ม"))
        rows = board.locator("tbody tr")
        expect(rows).to_have_count(4)
        for code in ["D", "C", "A", "O"]:
            expect(board.get_by_role("cell", name=code, exact=True)).to_be_visible()
        expect(rows.nth(0)).to_contain_text("2/2 คน")
        expect(rows.nth(0)).to_contain_text("+20")
        expect(rows.nth(1)).to_contain_text("1/2 คน")
        expect(rows.nth(3)).to_contain_text("ยังไม่ได้กำหนด")
        card = self.team_card("C")
        card.get_by_text("รายชื่อสมาชิก (2 คน)", exact=True).click()
        expect(card.get_by_text("✅ เข้า join LINE แล้ว", exact=True)).to_be_visible()
        expect(card.get_by_text("⏳ ยังไม่กดเชื่อมต่อ", exact=True)).to_be_visible()
        self.page.screenshot(path=str(SCREENSHOT), full_page=True)

    def test_staff_cannot_see_admin_line_tab(self):
        self.role = "staff"
        self.visit()
        nav = self.page.get_by_role("navigation", name="เมนูผู้จัด")
        expect(nav.get_by_role("button", name=re.compile("กลุ่ม LINE"))).to_have_count(0)
        expect(nav.get_by_role("button", name=re.compile("เช็กอินวันงาน"))).to_be_visible()

    def test_saving_config_sends_assigned_team_group_and_invitation(self):
        self.open_line()
        card = self.team_card("O")
        card.get_by_label("กลุ่ม LINE", exact=True).select_option("O")
        card.get_by_label("ลิงก์เชิญเข้ากลุ่ม LINE", exact=True).fill(TEST_URL)
        card.get_by_role("button", name="บันทึกกลุ่ม LINE", exact=True).click()
        expect(self.page.get_by_role("status")).to_contain_text("บันทึกกลุ่ม LINE ของทีม ทีมO แล้ว")
        self.assertIn(("line.group.save", {"team_id": "team-O", "group": "O", "url": TEST_URL}), self.posts)
        expect(card.get_by_label("ลิงก์เชิญเข้ากลุ่ม LINE", exact=True)).to_have_value(TEST_URL)

    def test_line_toggle_sends_open_then_close(self):
        self.open_line()
        self.page.get_by_role("button", name="⚪ ปิดอยู่ (กดเพื่อเปิด)", exact=True).click()
        opened = self.page.get_by_role("button", name="🟢 เปิดอยู่ (กดเพื่อปิด)", exact=True)
        expect(opened).to_be_enabled()
        self.assertIn(("game.set", {"line_open": True}), self.posts)
        opened.click()
        expect(self.page.get_by_role("button", name="⚪ ปิดอยู่ (กดเพื่อเปิด)", exact=True)).to_be_enabled()
        self.assertIn(("game.set", {"line_open": False}), self.posts)

    def test_joined_and_completed_group_configuration_is_locked(self):
        self.open_line()
        for code in ["D", "C"]:
            card = self.team_card(code)
            expect(card.get_by_label("กลุ่ม LINE", exact=True)).to_be_disabled()
            expect(card.get_by_label("ลิงก์เชิญเข้ากลุ่ม LINE", exact=True)).to_be_disabled()
            expect(card.get_by_role("button", name="บันทึกกลุ่ม LINE", exact=True)).to_be_disabled()
        completed = self.team_card("D")
        expect(completed.get_by_text("🏆 อันดับ 1 · +20 โทเคน", exact=True)).to_be_visible()
        expect(completed.get_by_text(re.compile("ล็อกกลุ่ม ลิงก์ และรายชื่อสมาชิก"))).to_be_visible()
        expect(self.team_card("A").get_by_label("กลุ่ม LINE", exact=True)).to_be_enabled()

    def test_completed_roster_cannot_add_move_or_delete_members(self):
        self.visit()
        self.page.get_by_role("button", name="ทีมและผู้เล่น", exact=True).click()
        selector = self.page.get_by_role("combobox", name="ทีมและกลุ่ม LINE ของผู้เล่น")
        expect(selector).to_be_enabled()
        expect(selector.locator('option[value="team-D"]')).to_be_disabled()
        member_row = self.page.locator("tbody tr").filter(has=self.page.get_by_role("cell", name="สมาชิก D1 ทดสอบ", exact=True))
        expect(member_row.get_by_role("button", name="ลบ", exact=True)).to_be_disabled()
        member_row.get_by_role("button", name="แก้ไข", exact=True).click()
        expect(selector).to_be_disabled()
        expect(selector).to_have_value("team-D")
        expect(self.page.get_by_text(re.compile("สมาชิกคนนี้จะเข้ากลุ่ม LINE D ตามทีมที่เลือก"))).to_be_visible()


if __name__ == "__main__":
    unittest.main(verbosity=2)
