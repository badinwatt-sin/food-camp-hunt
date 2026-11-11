# Food Camp Hunt (Guess & Collect + Treasure Hunt)

A mobile web app for **Agency Team Building 2026**. About 100 people in 4 teams play a 5-question,
image-based food quiz in Thai. Each correct answer earns 10 tokens for the team's shared wallet.
Teams later spend tokens at the **Food Camp Market** for optional extras (sauces, toppings, decorations).
The organiser runs everything from a password-protected `/admin` page.

## Event workflow update

Existing projects apply **`supabase/event-upgrade.sql` once before deploying**. New projects use `schema.sql`, which includes the upgrade. This migration preserves recorded Tokens, invitation names, team assignments and activity history.

- LINE uses its application logo. The compact home shortcut remains below the main menus; its first invitation clearly states that the **team** gets 20/15/10/5 Tokens by completion order. An updated invitation has its own revision and appears again on any player screen without discarding an active game. Earlier LINE rewards are retained and never duplicated.
- **Admin → กลุ่ม LINE:** edit the name or link and press **อัปเดตกลุ่ม LINE**. A link change atomically resets current join status and notifies members. A name-only edit does not reset attendance.
- **สมาชิกในทีม:** the summary shows eligible members who joined LINE, remaining people and remaining percentage. Leaders can create Squads and assign members within their own team. Reassignment is blocked after relevant hunt/puzzle activity to prevent repeated rewards from moving between Squads.
- **Admin → ภารกิจประจำสัปดาห์:** set Tokens for each successful game independently. Each participant can claim each game once. All 5 differences, all 6 memory pairs, or 5/5 timely ingredient answers are required; unsuccessful attempts receive no Tokens.
- **Admin → ทีมและผู้เล่น → ประเภทผู้ใช้:** select **คณะทำงาน** and assign a team to create a read-only observer account. It sees the same team screens, may open LINE and edit its own profile, but cannot play for Tokens, submit team activities, redeem items, lead a team or join a Squad. Observers are excluded from LINE percentages, quiz goals, co-op requirements and contribution statistics. Existing participants with activity history cannot be converted into observers.

Validation: `npm test`, `npm run build`, `node scripts/test-event-upgrade.mjs` (disposable PostgreSQL 16), and `node scripts/test-event-stack.mjs` (isolated Next.js/PostgREST/PostgreSQL plus browser checks). The new scripts never use the live event database.

## LINE group check-in and closed menus

- **Existing database:** run `supabase/line-groups.sql` in Supabase SQL Editor before deploying this version. New projects use `supabase/schema.sql`, which includes the same migration. No invitation URLs or team assignments are guessed or seeded.
- **Admin → กลุ่ม LINE:** map your four teams to **D / C / A / O**, enter each real HTTPS group invitation (`line.me` or `lin.ee`), then open LINE check-in. Assign each participant by selecting their team under **ทีมและผู้เล่น**; that team determines their LINE invitation. Finish the roster before opening the activity.
- On the first visit while LINE check-in is open, members who have not pressed their invitation see a welcome popup. Pressing the button saves the click before redirecting to LINE. The home screen keeps a compact LINE button below the main menus, with a brief joined status. Group progress, rankings and detailed member lists remain in Admin; team-member screens retain individual joined status. Visible screens refresh every 15 seconds and when returning to the app.
- **Editable group names:** Admin → กลุ่ม LINE has a separate **ชื่อกลุ่ม LINE** field. It changes the display name independently from the D/C/A/O group identity, invitation link, membership and scores, and remains editable after members join or the team earns its reward. Existing databases that already ran the original LINE migration only need `supabase/line-group-names.sql` once. Reads fall back to the group code until that migration is applied.
- All participants assigned to the team count, including members who have not yet received a login ID. Once everyone has clicked, the team wallet receives **20 / 15 / 10 / 5 Tokens** for first through fourth place. Database transaction locks and a unique ledger key prevent duplicate rewards and duplicate ranks under concurrent clicks.
- The status records **opening the invitation**, not verified membership inside LINE. The member must finish joining in LINE. Automatic verification of actual group membership needs a separate LINE integration.
- To keep everyone on the same invitation, the group identity cannot change after its first click; its display name and invitation link remain editable. Updating a link resets current LINE attendance and notifies members to join again, while keeping earlier ranks and Tokens without another award. Once a team earns its reward, its competing-member roster is locked; observer staff can still be assigned or moved. Existing confirmed **ล้างข้อมูลการเล่น** / **ลบทีมทั้งหมด** tools reset all LINE progress and ranked awards together and close LINE check-in; use them only for rehearsals.
- Closed activity and market menus stay visible as **gray, disabled buttons**. The missions menu is disabled when every activity is closed. Individual quiz, hunt, photo and mini-game switches remain independent; a closed quiz also blocks its results screen. QR links cannot bypass a closed activity. Closed hunt/photo/mini-game APIs return 403, and `/api/me` excludes closed quiz content and market listings.

Validation for this change:

```sh
npm ci
npm run typecheck
npm run build
npm test                 # Node 24: access, API, session, and LINE URL checks
npm run test:line-db      # Docker: disposable local PostgreSQL 16, never the event database
npm run test:line-stack   # Docker + Playwright: isolated Next.js → PostgREST → PostgreSQL
npm run dev              # In another terminal, for browser checks below
python scripts/test-player-browser.py
python scripts/test-admin-line-browser.py
python scripts/test-responsive-browser.py  # Player responsive UI + original Admin menus at 320–1920px
python scripts/test-live-browser.py        # DCAO1–4 only; no medals at zero, shared ranks and fourth-place icon
```

Browser checks require Python Playwright and Chromium (`/usr/bin/chromium` by default). Browser-only scripts use API fixtures. The responsive suite accepts `BASE_URL`, `WIDTHS` and `SCREENSHOT_DIR`; it checks player overflow, mobile controls, navigation and dialogs, plus all 11 original Admin menus and unchanged request payloads. Admin deliberately retains its previous layout and icons; responsive overrides are scoped to the player screen. The database test runs actual SQL, upgrades and concurrent requests on a disposable database. The full-stack test starts its own isolated Next.js server (port 3001 by default), PostgREST and PostgreSQL with dummy credentials, then checks real login/configuration/join/wallet/menu responses and browser rendering. These checks do not modify the live Supabase project or publish a deployment.

The Live competition screen includes only teams DCAO1–4 in its cards, totals and activity feed. Other teams remain available in Admin. Zero balances have a neutral camp icon and no assigned place; positive balances show current ranks, tied scores share a place, and fourth place uses a ribbon icon. These are current standings, not final prize announcements.

## 0. New: Treasure Hunt mode

Besides the 5-question quiz, teams can take **team photo missions** and **hunt for secret spots around the camp**. Each spot has a code printed as a QR
card. A player scans it with the phone camera (opens `/?spot=CODE`, asks for login if needed) or types the code under
**🧭 ล่าสมบัติ**. The **team** earns that spot's tokens **once** (first teammate to find it); other teammates see it as found.
Other teams can find the same spot too. Tokens go into the same team wallet and are spent at the Market.

- **Admin → ล่าสมบัติ:** add/edit spots (title, hint, secret code, tokens), "สุ่มใหม่" for a random code, **พิมพ์ QR ทุกจุด** for print cards, live progress table.
- **Admin → ภาพรวม:** separate **เปิด/ปิดล่าสมบัติ** and **เปิด/ปิดภารกิจทีม** switches (independent of each other and of the quiz switch).
- **Safety:** the DB function `claim_spot` locks the team row; a unique rule (team, spot) plus a unique ledger key make double scoring impossible
  (tested with 12 parallel claims → 1 credit). Secrets are never sent to players; wrong codes are rate-limited.
- **Existing database?** Run `supabase/hunt.sql` once in the SQL editor. **New database:** `schema.sql` already includes it; `seed.sql` has 5 *sample* spots —
  press "สุ่มใหม่" on each before the real event (the sample codes are public in this repo).
- **Big screen:** `/admin/live` (button "📺 หน้าจอใหญ่" in admin) shows a team ranking, quiz/hunt progress and a live activity feed for a projector. It refreshes every 5 s, needs an admin/staff login on that browser, and shows team names only (no player names).
- **Squads (for teams of ~20):** in **Admin → ทีมและผู้เล่น → สควอด** press **สุ่มแบ่งสควอดอัตโนมัติ** (default 5 people each, sizes differ by at most 1), or create squads and
  assign people by hand / by a 3rd column in the bulk import (`ชื่อ, ทีม, สควอด`). In the hunt, **each squad can find each spot once** (so 4 squads = up to 4 finds per spot);
  tokens still go to the shared team wallet. People without a squad count as one group for the whole team, exactly like before. Players see their squad's progress and a friendly
  in-team squad scoreboard. **Tip:** with N squads per team, a spot is worth N× tokens to the team — lower the tokens per spot accordingly.
  You can't re-split a team after its squads have found spots.
- **Team goal ("everyone plays"):** in **Admin → ภาพรวม** set e.g. 80 → when 80% of a team's members have finished the quiz, market items flagged **🎯 สินค้าพิเศษ** (edit item) unlock for that team.
  Before that they show 🔒 to players and the database refuses the redemption. 0 = goal off. Progress is shown to players (wallet / result / hunt screens) and on `/admin/live`.
- **Co-op hunt spots:** in **Admin → ล่าสมบัติ** set "จุดร่วมมือ: ต้องสแกนกี่คน" (e.g. 3) and a time window (e.g. 180 s) on a spot. The squad only gets the tokens when that many
  *different* members scan it inside the window. Players see "สแกนแล้ว! รอเพื่อนอีก N คน" and a live counter. A squad smaller than the requirement is only asked for as many people as it has.
- **Player app layout (camp theme):** after login the home screen shows who you are (nick name, team, squad, **⭐ หัวหน้าทีม** badge for the leader) and only three big buttons: **เริ่มภารกิจ** (quiz / treasure hunt / team puzzles), **สมาชิกในทีม** (everyone in the team with their role, squad and quiz progress — nick names only) and **ตลาดของ**. Every other page has a 🏠 home button at the top-left of the header. The quiz no longer has a separate "is this you?" step: the identity card on the home screen replaces it (**ไม่ใช่คุณ? ออกจากระบบ**).
- **Look & feel:** daytime “Agency Camp · Food” theme — forest green, navy blue, white and earth tones (sand, terracotta, wood), sky/hills/tent header with a 🏠 home button.
- **Admin look & feel:** same daytime camp theme as the player app. **ภาพรวม** now has stat tiles, four on/off switch cards (quiz / hunt / team puzzles / leader market), the team goal, and a card per team (balance, ⭐ leader, quiz progress). Messages appear as a toast at the bottom of the screen (so they are never off-screen). **± ปรับโทเคนด้วยมือ** opens a pop-up with ＋/－ buttons, quick amounts, reason suggestions, a balance preview and inline error messages (it fixes "can't save": the old form sat at the bottom of the page and its errors showed at the top). `/admin/live` uses the daytime theme too.
- **Profile pictures:** tap the circle on the home card to take/choose a photo (centre-cropped and shrunk to a small square in the browser, stored in the public `avatars` bucket, max 1.5 MB, real image bytes only) or pick one of 36 emoji. Teammates see it on the team page; admins can remove a photo (**ลบรูปโปรไฟล์**). Photos are visible to teammates and staff — tell players to use appropriate pictures. Run `supabase/avatars.sql` on an existing database.
- **Team leaders redeem for the team:** in **Admin → ทีมและผู้เล่น** mark one player per team as leader (⭐ button, tick-box in the add/edit form, or a `Leader` column in the Excel import: 1/yes/หัวหน้า).
  When **Admin → ภาพรวม → ตลาด: หัวหน้าทีมแลกเอง** is switched on (default off), the leader sees a **แลกสินค้านี้** button per item (quantity + confirmation) and spends the team's tokens; other players can only browse.
  Redemptions are all-or-nothing in the database (balance, stock, team goal checked; a retry is never charged twice) and are logged as `leader:<nick name>`. Staff can still redeem on a team's behalf in **ตลาด / แลกของ**.
- **Team inventory:** players open 🛒 ตลาด → **🎒 ของของทีม** to see everything the team owns (picture, quantity, ⏳ waiting / ✅ handed over); the market list also shows “ทีมเรามีแล้ว ×N”.
- **Preparing and handing over goods (Admin → ตลาด / แลกของ → 📦 เตรียมของ / เบิกของ):** totals per item (redeemed / handed over / still to prepare, and which teams are waiting) plus a per-team table with **จ่ายแล้ว** buttons (staff or admin). History and the redemptions CSV show the hand-over time.
- **Players can browse the market any time** (button 🛒 on the confirm, quiz and result screens): picture, price in tokens, and stock status (✅ in stock / ⚠️ low (≤3) / ⛔ sold out, shown dimmed at the bottom); special items show 🔒 until the team goal is met. Stock refreshes every 15 s.
- **Market pictures:** in **Admin → ตลาด / แลกของ → แก้ไข/เพิ่มสินค้า** choose an image file (PNG/JPG/WebP; a phone photo is fine — it is shrunk in the browser before upload). Players see it as a thumbnail in **ของที่แลกได้** (tap to enlarge). Images are stored in the public `question-images` storage bucket.
- **Hosted database reset compatibility:** team deletion and full play-data reset close the activity switches before cleanup. Older databases whose LINE reset function is blocked by safe-update protection use explicitly filtered server writes. No additional SQL run is required for this compatibility fix.
- **Clear test data in one go (admin only):** at the bottom of each admin tab a dashed **⚠️ โซนอันตราย** card has a button that wipes a whole group — **ภาพรวม** → reset all play results (answers, tokens, history; players are reset to “not started”, switches off; teams/players/IDs/content stay), **ตลาดสินค้า** → all items + redemption history (spent tokens are refunded), **ทีมและผู้เล่น** → all teams with players, squads, tokens and uploaded pictures, **คำถามควิซ** → all questions + answers, **ล่าสมบัติ** → all spots + scans, **ภารกิจทีม** → all photo missions + submitted photos.
  You must type the confirm word `ลบทั้งหมด`; it cannot be undone and is not meant for the live event. The deletion order respects the database links (verified on a fully populated database) and a run can simply be repeated if interrupted. Tokens already earned stay unless you use the play-results reset.
- **Event-day check-in (📍 เช็กอินวันงาน):** **Admin → เช็กอินวันงาน** (also visible to Staff, so door staff can use it): admin presses **▶ เปิดการลงทะเบียนวันงาน** — every player gets a pop-up “ถึงสถานที่จัดงานแล้วใช่ไหม?” and a banner on the home screen (**📣 แจ้งเตือนอีกครั้ง** repeats it for people not yet checked in).
  The page shows a **QR code** (full-screen or printable) for the staff desk. The player presses **เช็กอิน** and the app opens the **camera inside the page** (jsQR; needs HTTPS + camera permission) — scanning goes straight to the **“ยืนยันการเข้าร่วมงาน”** screen (the phone's own camera app works too: it opens `/?checkin=CODE`). The player sees an **“ยืนยันการเข้าร่วม”** screen and must press the confirm button — scanning alone does nothing. Players never type a code; if a phone's camera is unavailable, staff press **เช็กอินให้** (and can undo). The list shows who is still missing (filter + search), per-team progress, a CSV export, and a ✅ badge on the player's home card.
  **🔄 สร้าง QR ใหม่** replaces the code (the old QR stops working). Check-in does not block any activity. Run `supabase/checkin.sql` on an existing database. The play-results reset also clears check-ins.
- **Team photo missions (📸 ภารกิจทีม) with staff review:** **Admin → ภารกิจทีม**: define photo challenges (person / object / food / place / special) with instructions, an optional example picture and tokens.
  The **whole team** is in the photo with the subject and **only the team leader can upload it** (checked in the app, the API and the database). The upload is **pending — no tokens yet**; the team sees “⏳ รอทีมงานตรวจสอบและยืนยัน”.
  Staff or admin open **ตรวจภาพที่ทีมส่งมา** (a badge on the menu shows how many are waiting) and press **✅ ยืนยัน** (the team wallet is credited once) or **❌ ปฏิเสธ** with a reason (no tokens; the leader can upload a new photo).
  Everyone on the team gets a pop-up when the decision arrives (“🎉 ภารกิจผ่านแล้ว +20” or “ภาพยังไม่ผ่าน: เหตุผล”), within ~15 s. Only admin can take back an earlier confirmation (tokens are returned). The leader may swap a photo while it is still pending.
  Photos live in the public `mission-photos` bucket (random file names) — tell teams to take appropriate pictures and delete them after the event. Uses the on/off switch **ภารกิจทีม** (default closed). Run `supabase/photos.sql` on an existing database (it also upgrades the first version of this feature).
- **Weekly missions (🎮 ภารกิจประจำสัปดาห์):** Admin sets a fixed Token reward independently for each game. Members have up to 3 attempts and receive the configured reward once on success: find all 5 differences within the time limit, match all 6 pairs, or answer all 5 ingredient questions correctly and on time. Speed/accuracy bonuses and the old percentage multiplier no longer determine Tokens. Existing awarded Tokens are preserved and count as claimed; changing the reward does not pay existing winners again. Zero-Token successes also consume the once-per-game reward.

- **🤳 Selfie Wall (first team mission, “Agency in the Wonder Woods”):** **Admin → Selfie Wall** sets a time window (start/end), the background colour (colour picker + presets), the required share of the background (default 60 %), the colour tolerance, and the rank rewards (default 20 › 15 › 10 › 5 Tokens for the 1st–4th team whose competing members all have an accepted photo). Opening the mission (or **📣 แจ้งเตือนอีกครั้ง**) pops up the brief on every phone; the pop-up and the home banner show the team's progress (%) and the maximum Tokens still available, and the pop-up comes back whenever the team's progress changes. Players: **เริ่มภารกิจ → Selfie Wall** — the wall shows a grey portrait placeholder with each member's name, the in-app front camera with a live colour meter, and after the server accepts the photo the frame flips in with the name underneath. The server measures the background colour (ΔE in Lab, the band around the person) **and, when `ANTHROPIC_API_KEY` is set in Vercel, asks Claude whether a real person is in front of the right background**; a rejected photo is never stored and the player sees why (in Thai). Observers (คณะทำงาน) can hang their photo on the wall but never count. When the team completes: a celebration (confetti, 3D coin, token count-up), then the framed team picture (logo, team name, “Agency Outing & Team Building 2026”) with **แชร์ / โพสต์ Facebook** (Web Share) and **บันทึกภาพ**. Admin sees every team's wall, can zoom/remove a photo, and the danger zone **ล้าง Selfie Wall ทั้งหมด** resets photos, ranks and paid rewards. Run `supabase/selfie.sql` once on an existing database (it also creates the public `selfies` bucket). Without the API key the check is pixel-only (no face check) — the admin page says so.
- **Market categories:** items are either **🥬 วัตถุดิบ (Ingredient)** or **🎀 ของตกแต่ง (Decoration)**; players and admins get category tabs (with counts) above the item list, and admin picks the category from a dropdown. Run `supabase/market-cats.sql` once on an existing database to fold old categories (sauce/topping) into ingredient.
- **Existing database?** run, in order, `supabase/hunt.sql`, `supabase/squads.sql`, `supabase/coop.sql`, `supabase/ids.sql`, `supabase/items.sql`, `supabase/leader.sql`, `supabase/avatars.sql`, `supabase/photos.sql`, `supabase/checkin.sql`, `supabase/market-cats.sql`, `supabase/minigames.sql`, `supabase/selfie.sql` (all safe to re-run).
- Hunt and puzzle history can be exported (**ส่งออก CSV → ล่าสมบัติ / ภารกิจทีม**).

> **Status — please read.** The code was written and reviewed carefully, but in the environment where it
> was produced the package registry was blocked, so **the original quiz code had not been run.** The Hunt additions were type-checked, built with `next build`, and their SQL
> (schema, seed, migration, claim rules, concurrent claims) was run on a local PostgreSQL 16 — but not on Supabase itself or on real phones. Treat it as an untested first version. Follow the
> [testing checklist](#6-testing-checklist) on a *test* Supabase project before the event.
> Do not call any deployment production-ready until those checks pass.

---

## 1. What you get

| Part | What it is |
|---|---|
| Players (`/`) | Enter your **ID** → confirm name/team → 5 questions → score + team balance → team wallet |
| Organiser (`/admin`) | Overview & open/close game · Market & confirm redemptions · Teams/players/IDs (Excel import) · Questions · History · CSV export |
| Database (Supabase / Postgres) | Tables, safety rules and "all-or-nothing" functions in `supabase/schema.sql` |
| Sample data | `supabase/seed.sql` — 4 sample teams, 8 fictional players, 5 sample questions, 9 market items |

**Stack:** Next.js 15 (TypeScript) + Supabase (Postgres + image storage). Players' phones never talk to
Supabase directly; they only talk to this app's server routes. All data tables are locked (row-level
security on, no public policies), so the public Supabase key can read or change nothing.

## 2. Default choices (change if you disagree)

- **Player IDs** are chosen by the organiser and imported from Excel (columns `ID, Full name, Nick name, Team`, optional `Squad`).
  A player types their ID to log in (case, spaces and dashes are ignored: `ab-0012` = `AB 0012`). The database stores only a keyed hash of each ID,
  so the organiser keeps the Excel sheet as the record of who has which ID; the admin screen only shows "has an ID". Nick names are what teammates see in the game.
- **Roles:** `ADMIN_PASSWORD` can do everything. An optional `STAFF_PASSWORD` can only view the overview/market and
  **confirm redemptions**; it cannot adjust tokens, edit data or export. Manual token adjustments are admin-only and need a reason.
- The quiz uses **all active questions, in order** (default 5). Max tokens = questions × tokens-per-correct (default 10 → 50).
- A participant may finish once. Re-entering the same ID resumes at the next unanswered question.
  If the game is **closed**, nobody can start or answer new questions; people who finished can still see their wallet.
- Participant names appear only to that participant and in the admin screens. Players see only their own team's balance/history.
- Questions answered cannot be changed by players. **Don't edit questions after opening the game.**
- Login attempts are rate-limited per server instance (best effort — see Limits).

## 3. Set-up (about 30–45 minutes, no coding)

You need: a computer, a free **GitHub** account, a free **Supabase** account, and a free **Vercel** account
(or another host for Next.js). Check each service's current pricing and limits before the event (section 8).

### Step A — Create the database
1. Go to supabase.com → **New project**. Pick a region near Thailand (e.g. Singapore). Save the database password somewhere safe.
2. Open **SQL Editor → New query**, paste the whole of `supabase/schema.sql`, press **Run**.
3. New query again, paste `supabase/seed.sql`, **Run** (this loads *sample* data only).
4. **Project Settings → API**: copy the **Project URL** and the **service_role** key. The service_role key is a secret — never post it in chat or commit it.

### Step B — Configure secrets
Copy `.env.example` to `.env.local` and fill it in:

| Name | What to put |
|---|---|
| `SUPABASE_URL` | Project URL |
| `SUPABASE_SERVICE_ROLE_KEY` | the service_role key |
| `SESSION_SECRET` | any long random text (32+ chars) |
| `CODE_PEPPER` | another long random text. **Don't change it after IDs are imported** — all IDs would stop working (re-import the sheet to fix) |
| `ADMIN_PASSWORD` | a strong password for the organiser |
| `STAFF_PASSWORD` | optional, for a helper who only confirms redemptions |

Random text: run `openssl rand -base64 32`, or use a password manager's generator. `.env.local` is git-ignored; real values never go in the repository.

### Step C — Try it on your computer (optional but recommended)
Install Node.js 20+, then in this folder:
```
npm install
npm run dev
```
Open http://localhost:3000 (players) and http://localhost:3000/admin.

### Step D — Put real people in (securely)
1. `/admin` → **ทีมและผู้เล่น**. Rename the 4 sample teams (แก้ชื่อ).
2. Click **ลบผู้เล่นที่ยังไม่เริ่มเล่นทั้งหมด** to clear the sample players.
3. In **นำเข้าผู้เล่นจาก Excel** choose your `.xlsx` / `.csv` file (or copy the cells including the header row and paste them). Columns: **ID, Full name, Nick name, Team** (+ optional **Squad**).
   Check the preview, then press **นำเข้า**. Missing teams/squads are created. Importing the same sheet again is safe: a known ID updates that person instead of adding a duplicate
   (a player who already started is not moved to another team). In Excel set the ID column to **Text** so leading zeros survive.
4. Hand out the IDs the way you already planned (they come from your sheet). **Pick IDs that are not easy to guess** (e.g. not 1, 2, 3…): anyone who knows someone's ID can log in as them.
   Wrong IDs are limited per network address (best effort), and an ID can be changed (**เปลี่ยน ID**) or revoked (**ยกเลิก ID**) at any time.
5. Only collect/enter data you're allowed to use; delete the sheet and the participants after the event.

### Step E — Questions and market
- **คำถาม:** edit the 5 samples. Paste an image link (`https://…`) or upload PNG/JPG/WebP ≤ 2 MB. Use only photos you own or are licensed to use.
  The bundled `/placeholders/q1.svg … q5.svg` are labelled placeholders — replace them.
- **ตลาด / แลกของ:** edit items, price (tokens) and quantity. Items that already have redemptions are deactivated instead of deleted.
- To change tokens-per-correct, the number is a database setting (`game_settings.tokens_per_correct`, default 10); the admin screen shows it. Update with SQL: `update game_settings set tokens_per_correct = 5;`

## 4. Running the event

1. Before the day: finish questions, codes, market; run the tests below; set `is_open` to closed.
2. Share the link or a QR code of your deployed address (any QR generator works).
3. **Overview → เปิดเกม** to let people start. **ปิดเกม** to stop new answers.
4. Redeeming: the team representative tells you the item and quantity → **ตลาด / แลกของ** → choose team + item + quantity →
   **ยืนยันการแลก**. Tokens and stock change together or not at all. If your Wi-Fi drops and you're unsure it saved, just press the button again:
   the same click is recognised and **never charged twice** (change team/item/quantity and it becomes a new request).
5. Corrections: use **ปรับโทเคนด้วยมือ** (admin only, reason required). Everything is listed in **ประวัติ** and the audit log.
6. **ส่งออก CSV** for team summary, per-player results, redemptions and adjustments (participant CSV has no IDs).

## 5. How safety works

- **Exactly-once scoring:** the database has a unique rule "one quiz credit per participant". Refreshing, double-tapping or retrying cannot add tokens twice.
- **Resume:** progress is stored per participant, not in the browser. Same code → continue. Network errors are retried automatically; if all retries fail the player sees a message and can press the same button again.
- **Redemptions:** one database function locks the team row and the item row, checks balance and stock, then writes the redemption, stock change, token deduction and audit record in one transaction. Ten simultaneous clicks cannot overspend or oversell.
- **Permissions:** players can only call their own game endpoints (signed, HTTP-only cookie). Admin endpoints check the role on the server for every request. The browser never holds the service key. Database tables have row-level security with no public policies.
- **Correct answers** are not sent to the phone until after that question is submitted.
- **CSV export** neutralises spreadsheet formula injection.

## 6. Testing checklist

Use a **separate test Supabase project** (free) with the same schema + seed. Never run the automated test against the live event database
(it briefly opens the game and creates/deletes its own test rows).

**Automated database test** (duplicate scoring, concurrent redemption, overspend, oversell, adjustments, anonymous access, **and** hunt once-per-team/squad, co-op spots + time window, team goal locks, team puzzles + separate switch + shared attempts, anon lock-out of the new tables; 9 sections):
```
# .env.local with the TEST project values; optionally add SUPABASE_ANON_KEY=<anon key> to test public lockout
node --env-file=.env.local scripts/test-db.mjs
```
Expect every line `PASS` and `0 failed`. A `FAIL` means: do not use that database.

**Manual checks** (do all on a real iPhone and a real Android phone, on mobile data and Wi-Fi):

| Check | How | Expected |
|---|---|---|
| Player flow | Admin: import a sample sheet with an ID for a test player, open game. On phone enter the ID, confirm, answer all 5 | Each answer shows right/wrong + reveals correct one; final screen shows score (×10) and team balance |
| Wrong ID | Enter a made-up ID | "ไม่พบ ID นี้", no details leaked |
| Reconnection | Answer 2 questions, close the browser tab, reopen, enter same code | Resumes at question 3; tokens unchanged |
| Reconnect mid-feedback | Answer, turn on airplane mode, press next, turn it back on and retry | Message shown; works after retry; no double answer |
| Duplicate scoring | Finish the quiz, refresh several times, log out/in, open on a second phone | Team balance rose once only |
| Revoked ID | Admin revokes the ID while player is logged in | Next action returns to login screen |
| Closed game | Close game, try starting with a new code | "เกมยังไม่เปิด" |
| Concurrent redemption | On two devices logged in as admin, press confirm on the last item at the same moment | One succeeds; the other says out of stock/insufficient; Overview balance and stock are consistent |
| Admin permissions | Log in with `STAFF_PASSWORD`; try opening `/api/admin/participants`, adjusting tokens, exporting | Staff sees only overview/market/redemption; others return "ไม่มีสิทธิ์" (403). Without login: 401 |
| Players can't cheat | In browser dev tools call `/api/admin/overview` as a player | 401 |
| Mobile layout | Phone portrait + landscape, small screen (iPhone SE size), large text setting | No horizontal scroll; buttons ≥ 56px tall; text readable |
| CSV | Export all four files, open in Excel/Sheets | Thai text readable; numbers match Overview |

## 6b. Rehearsal load test (about 100 players)

`node scripts/loadtest.mjs --url https://your-app.vercel.app --ids ids.txt --users 100 --seconds 60 --ramp 5` simulates 100 phones logging in within 5 s and then using the app
(ids.txt = one TEST player ID per line; run it against a test project, not right before the event). It prints requests/s, errors by status and latency percentiles.
Signed-in limits (redeem, hunt scans, profile, photo uploads) are counted **per player**, not per network address, so a venue where everybody shares one Wi-Fi IP is not throttled;
only wrong login IDs are limited per address (250 per 10 minutes).

## 7. Deployment (simple path: Vercel + Supabase)

1. Put this folder in a **private** GitHub repository (the `.gitignore` already excludes `.env*`). Double-check no real keys were committed.
2. vercel.com → **Add New → Project** → import the repo. Framework is detected as Next.js.
3. In **Settings → Environment Variables**, add the six variables from Step B (Production). Deploy.
4. Open the deployed address, run the manual checks above **on that deployed URL** (HTTPS is required for secure cookies).
5. Create a QR code for the URL.
6. After the event: close the game, export CSVs you need, then delete the participant data (or the whole Supabase project) and rotate/delete the keys.

Any host that runs Next.js 15 on Node 20+ works (set the same env vars).

`vercel.json` pins the serverless functions to Singapore (`sin1`) to sit next to a Singapore Supabase project; change `regions` if your Supabase project is elsewhere.

## 8. Services, accounts, costs and limits to check

- **Accounts:** GitHub, Supabase, Vercel (or alternative host). Check the **current** free-tier limits and terms on each provider's pricing page — including whether Vercel's free tier permits your use (its non-commercial terms may require a paid plan for company events) and Supabase free projects pausing after inactivity (open the project a few days before the event; consider a paid plan for the event week).
- **Load:** ~100 phones is small, but a "everyone starts at once" burst is the likely peak. Test with several phones at once; check Supabase connection/egress limits.
- **Rate limiting** is held in server memory per instance; on serverless hosting it is best-effort and resets. Only wrong IDs count towards the limit (so a whole venue on one Wi-Fi can log in together); the main defence is using IDs that are hard to guess. For stronger protection add Vercel Firewall / Cloudflare rate limits.
- **Fonts** load from Google Fonts; if blocked, the page falls back to the phone's Thai system font.
- **Images** from external links may be blocked, slow or removed — uploading to the built-in storage is more reliable. Storage bucket `question-images` is public-read by design (question pictures only).
- **Privacy:** the database holds participant names and results. Get approval from the appropriate owner (HR/PDPA), limit admin access, don't publish lists, and delete data after the event.
- **Backups:** export the CSVs at the end of the event; free Supabase plans may not include automatic backups.
- **Time zone:** timestamps are stored in UTC and shown in the viewer's locale.

## 9. Changing content later

- **Questions/market/teams/people:** all in `/admin`.
- **Bulk edit via SQL** (Supabase → SQL Editor): see the `insert` statements in `supabase/seed.sql` for the exact columns.
- **Reset after rehearsal** (⚠ deletes all play data; run only on a test or pre-event database):
  ```sql
  delete from token_ledger; delete from redemptions; delete from answers; delete from audit_log;
  update participants set status='not_started', correct_count=0, tokens_earned=0, confirmed_at=null, completed_at=null;
  update market_items set stock = stock;  -- restock manually in /admin
  update game_settings set is_open=false;
  ```

## 10. Project layout

```
supabase/schema.sql      tables, rules, atomic functions, lock-down
supabase/seed.sql        sample data only
app/page.tsx             player app (Thai)
app/admin/page.tsx       organiser dashboard
app/api/*                server routes (player + admin)
lib/                     auth (signed cookies), code hashing, helpers
scripts/test-db.mjs      automated database safety tests
public/placeholders/     labelled placeholder question images
.env.example             names of required settings (no real values)
```

## 11. Out of scope on purpose

No leaderboards, social sharing, extra mini-games, payments or email. The first version only does this one game.
