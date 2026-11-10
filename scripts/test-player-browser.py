#!/usr/bin/env python3
"""Player browser smoke tests with explicitly mocked API fixtures (no live database).

Start the app on port 3000, then run python scripts/test-player-browser.py.
BASE_URL and CHROMIUM_PATH can override the local server and browser executable.
"""

import json
import os
import re
import unittest
from pathlib import Path
from urllib.parse import urlparse

from playwright.sync_api import expect, sync_playwright


BASE_URL = os.environ.get("BASE_URL", "http://localhost:3000")
SCREENSHOTS = Path(os.environ.get("SCREENSHOT_DIR", "/workspace/scratch"))
LINE_URL = "https://line.me/ti/g/food-camp-smoke-test"


def fixture(*, joined=True, menus=None):
    access = dict(quiz=False, hunt=False, photos=False, games=False,
                  market=False, missions=False, checkin=False)
    access.update(menus or {})
    access["missions"] = any(access[name] for name in ["quiz", "hunt", "photos", "games"])
    return {
        "participant": {"name": "มะลิ", "fullName": "มะลิ ทดสอบ", "status": "not_started"},
        "team": {"name": "D", "balance": 20},
        "squad": None,
        "goal": {"goalPct": 0, "completed": 0, "participants": 2, "met": True, "need": 0},
        "avatar": {"url": None, "emoji": "🌼"},
        "checkin": {"open": False, "done": False, "at": None},
        "isLeader": False, "leaderName": "ต้น", "marketOpen": access["market"],
        "menus": access,
        "line": {
            "open": True, "configured": True, "group": "D", "url": LINE_URL,
            "joined": joined, "joinedAt": "2026-11-10T09:00:00Z" if joined else None,
            "total": 2, "joinedCount": 2 if joined else 1,
            "complete": joined, "rank": 1 if joined else None, "tokens": 20 if joined else 0,
            "members": [
                {"name": "มะลิ", "joined": joined, "isMe": True},
                {"name": "ต้น", "joined": True, "isMe": False},
            ],
        },
        "inventory": [], "game": {"open": access["quiz"], "tokensPerCorrect": 10},
        "total": 5, "answered": 0, "current": None, "result": None,
        "history": [], "market": [],
    }


class PlayerBrowser(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.playwright = sync_playwright().start()
        cls.browser = cls.playwright.chromium.launch(
            executable_path=os.environ.get("CHROMIUM_PATH", "/usr/bin/chromium"),
            headless=True, args=["--no-sandbox"],
        )
        SCREENSHOTS.mkdir(parents=True, exist_ok=True)

    @classmethod
    def tearDownClass(cls):
        cls.browser.close()
        cls.playwright.stop()

    def setUp(self):
        self.context = self.browser.new_context(viewport={"width": 390, "height": 844},
                                                is_mobile=True, has_touch=True)
        self.page = self.context.new_page()
        self.page.set_default_timeout(15000)
        self.me = fixture()
        self.authenticated = True
        self.requests = []
        self.page_errors = []
        self.page.on("pageerror", lambda error: self.page_errors.append(str(error)))
        self.context.route("**/api/**", self.api_route)
        self.context.route("https://line.me/**", self.external_line_route)

    def tearDown(self):
        self.context.close()
        self.assertEqual(self.page_errors, [], "Browser JavaScript errors")

    def respond(self, route, body, status=200):
        route.fulfill(status=status, content_type="application/json", body=json.dumps(body))

    def api_route(self, route):
        request = route.request
        path = urlparse(request.url).path
        self.requests.append((request.method, path))
        if path == "/api/me":
            return self.respond(route, self.me if self.authenticated else
                                {"error": "UNAUTHORIZED", "message": "กรุณาเข้าสู่ระบบ"},
                                200 if self.authenticated else 401)
        if path == "/api/login":
            self.authenticated = True
            return self.respond(route, {"ok": True})
        if path == "/api/logout":
            self.authenticated = False
            return self.respond(route, {"ok": True})
        if path == "/api/notices":
            return self.respond(route, {"photos": [], "checkin": None})
        if path == "/api/team":
            return self.respond(route, {
                "team": "D", "total": 2, "quizDone": 0, "squads": [],
                "members": [
                    {"name": "มะลิ", "isLeader": False, "isMe": True, "squad": None,
                     "quizDone": False, "lineJoined": self.me["line"]["joined"],
                     "avatarUrl": None, "avatarEmoji": "🌼"},
                    {"name": "ต้น", "isLeader": True, "isMe": False, "squad": None,
                     "quizDone": False, "lineJoined": True,
                     "avatarUrl": None, "avatarEmoji": "🌳"},
                ],
            })
        if path == "/api/photos":
            return self.respond(route, {"open": True, "isLeader": False, "leaderName": "ต้น",
                                        "team": "D", "missions": []})
        if path == "/api/hunt":
            return self.respond(route, {"open": True, "team": self.me["team"], "groupSize": 2,
                                        "spots": [], "found": 0, "earned": 0, "squad": None,
                                        "squads": [], "goal": self.me["goal"]})
        if path == "/api/line/join":
            self.assertEqual(request.method, "POST")
            self.assertEqual(request.post_data_json, {})
            self.me["line"] = fixture()["line"]
            return self.respond(route, {"url": LINE_URL, "already": False})
        # Any unexpected request is recorded and returns a fast, visible error.
        return self.respond(route, {"error": "UNEXPECTED_TEST_REQUEST", "message": path}, 400)

    def external_line_route(self, route):
        self.requests.append(("NAVIGATE", route.request.url))
        # Never contact LINE during this test.
        route.fulfill(content_type="text/html", body="<title>Mock LINE invitation</title>")

    def visit(self, suffix=""):
        self.page.goto(BASE_URL + "/" + suffix)
        expect(self.page.get_by_text("สวัสดี มะลิ", exact=True)).to_be_visible()

    def test_first_login_prompts_then_can_defer(self):
        self.authenticated = False
        self.me = fixture(joined=False)
        self.page.goto(BASE_URL)
        self.page.get_by_placeholder("ID ของคุณ").fill("TEST-PLAYER")
        self.page.get_by_role("button", name="เข้าสู่เกม", exact=True).click()
        dialog = self.page.get_by_role("dialog")
        expect(dialog).to_be_visible()
        expect(dialog.get_by_role("heading", name="เช็กอินเข้ากลุ่ม LINE D")).to_be_visible()
        expect(dialog.get_by_role("button", name="เชื่อมต่อ LINE กลุ่ม D")).to_be_focused()
        dialog.get_by_role("button", name="ไว้ทีหลัง").click()
        expect(dialog).to_have_count(0)
        self.page.evaluate("window.dispatchEvent(new Event('focus'))")
        expect(self.page.get_by_role("button", name="เชื่อมต่อกลุ่ม LINE", exact=True)).to_be_visible()
        expect(dialog).to_have_count(0)
        self.assertNotIn(("POST", "/api/line/join"), self.requests)

    def test_join_is_saved_before_redirect_to_assigned_line(self):
        self.me = fixture(joined=False)
        self.visit()
        self.page.get_by_role("dialog").get_by_role("button", name="เชื่อมต่อ LINE กลุ่ม D").click()
        self.page.wait_for_url(LINE_URL)
        self.assertLess(self.requests.index(("POST", "/api/line/join")),
                        self.requests.index(("NAVIGATE", LINE_URL)))
        self.assertTrue(self.me["line"]["joined"])

    def test_joined_player_sees_progress_reward_and_member_status(self):
        self.visit()
        expect(self.page.get_by_role("dialog")).to_have_count(0)
        expect(self.page.get_by_text("สมาชิกเข้า LINE แล้ว 2/2 คน", exact=True)).to_be_visible()
        expect(self.page.get_by_text(re.compile("สมาชิกเข้าครบแล้ว.*อันดับ 1.*20 Tokens"))).to_be_visible()
        self.page.get_by_text("ดูสถานะสมาชิกในกลุ่ม", exact=True).click()
        expect(self.page.get_by_text("✅ เข้า join LINE แล้ว", exact=True)).to_have_count(3)
        self.page.get_by_role("button", name=re.compile("สมาชิกในทีม")).click()
        expect(self.page.get_by_role("heading", name="👥 สมาชิกทีม D")).to_be_visible()
        expect(self.page.get_by_text("✅ เข้า join LINE แล้ว", exact=True).first).to_be_visible()

    def test_closed_line_has_no_prompt_and_disabled_gray_button(self):
        self.me = fixture(joined=False)
        self.me["line"]["open"] = False
        self.visit()
        button = self.page.get_by_role("button", name="ยังไม่เปิดให้เชื่อมต่อ LINE", exact=True)
        expect(button).to_be_disabled()
        expect(button).to_have_css("background-color", "rgb(226, 229, 233)")
        expect(self.page.get_by_role("dialog")).to_have_count(0)

    def test_unconfigured_line_has_no_prompt_and_disabled_button(self):
        self.me = fixture(joined=False)
        self.me["line"].update(configured=False, group=None, url=None)
        self.visit()
        expect(self.page.get_by_role("button", name="รอทีมงานกำหนดกลุ่ม LINE", exact=True)).to_be_disabled()
        expect(self.page.get_by_role("dialog")).to_have_count(0)

    def test_closed_home_menus_are_gray_and_native_click_cannot_open(self):
        self.visit()
        for name in ["เริ่มภารกิจ", "ตลาดของ"]:
            button = self.page.get_by_role("button", name=re.compile(name))
            expect(button).to_be_disabled()
            expect(button).to_have_css("background-color", "rgb(225, 228, 232)")
            button.evaluate("button => button.click()")
            expect(self.page.get_by_text("สวัสดี มะลิ", exact=True)).to_be_visible()
        self.page.screenshot(path=str(SCREENSHOTS / "food-camp-home.png"), full_page=True)

    def test_mission_buttons_respect_individual_flags_including_finished_quiz(self):
        self.me = fixture(menus={"photos": True})
        self.me["participant"]["status"] = "completed"
        self.me["result"] = {"correct": 5, "tokens": 50}
        self.visit()
        self.page.get_by_role("button", name=re.compile("เริ่มภารกิจ")).click()
        expect(self.page.get_by_role("button", name="ดูผลคะแนน", exact=True)).to_be_disabled()
        for heading in ["เกมย่อย", "ล่าสมบัติ"]:
            card = self.page.locator(".card").filter(has=self.page.get_by_role("heading", name=heading, exact=True))
            expect(card.get_by_role("button")).to_be_disabled()
        expect(self.page.get_by_role("button", name="เปิดภารกิจทีม", exact=True)).to_be_enabled()
        self.page.screenshot(path=str(SCREENSHOTS / "food-camp-missions.png"), full_page=True)

    def test_hunt_qr_cannot_bypass_closed_switch(self):
        self.visit("?spot=CLOSED-SPOT")
        expect(self.page.get_by_text("สวัสดี มะลิ", exact=True)).to_be_visible()
        self.assertNotIn(("GET", "/api/hunt"), self.requests)
        self.assertNotIn(("POST", "/api/hunt/claim"), self.requests)

    def test_pending_hunt_qr_does_not_render_hunt_inside_open_photos(self):
        self.me = fixture(menus={"photos": True})
        self.visit("?spot=CLOSED-SPOT")
        self.page.get_by_role("button", name=re.compile("เริ่มภารกิจ")).click()
        self.page.get_by_role("button", name="เปิดภารกิจทีม", exact=True).click()
        expect(self.page.get_by_role("heading", name="📸 ภารกิจทีม", exact=True)).to_be_visible()
        expect(self.page.get_by_role("button", name="🧭 ล่าสมบัติ 🔒", exact=True)).to_be_disabled()
        self.assertNotIn(("GET", "/api/hunt"), self.requests)
        self.assertNotIn(("POST", "/api/hunt/claim"), self.requests)
        self.assertIn(("GET", "/api/photos"), self.requests)

    def test_focus_refresh_closes_an_already_open_quiz_screen(self):
        self.me = fixture(menus={"quiz": True})
        self.visit()
        self.page.get_by_role("button", name=re.compile("เริ่มภารกิจ")).click()
        self.page.get_by_role("button", name="เริ่มเล่นควิซ", exact=True).click()
        expect(self.page.get_by_role("heading", name="พร้อมเริ่มควิซทายอาหารหรือยัง?", exact=True)).to_be_visible()
        self.me = fixture()
        with self.page.expect_response(re.compile(r"/api/me$")):
            self.page.evaluate("window.dispatchEvent(new Event('focus'))")
        expect(self.page.get_by_role("heading", name="🔒 เมนูนี้ยังไม่เปิดใช้งาน", exact=True)).to_be_visible()
        expect(self.page.get_by_role("button", name="เริ่มเล่นเลย", exact=True)).to_have_count(0)


if __name__ == "__main__":
    unittest.main(verbosity=2)
