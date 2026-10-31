# Food Camp Hunt (Guess & Collect + Treasure Hunt)

A mobile web app for **Agency Team Building 2026**. About 100 people in 4 teams play a 5-question,
image-based food quiz in Thai. Each correct answer earns 10 tokens for the team's shared wallet.
Teams later spend tokens at the **Food Camp Market** for optional extras (sauces, toppings, decorations).
The organiser runs everything from a password-protected `/admin` page.

## 0. New: Treasure Hunt mode

Besides the 5-question quiz, teams can **hunt for secret spots around the camp**. Each spot has a code printed as a QR
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
- **Team puzzles (🧩 ภารกิจทีม):** **Admin → ภารกิจทีม**: a question + 2–8 clues + 4 options. Each squad member sees only *their share* of the clues (spread evenly, stable per person), so the
  squad has to meet and combine them. Anyone can submit the squad's answer; attempts are shared by the squad (default 2) and enforced by the database; the correct answer is never sent to phones.
  Tokens go to the team wallet once per squad. Puzzles have **their own open/close switch** in **Admin → ภาพรวม** (separate from the quiz and the hunt; default closed).
  Tip: write at least as many clues as there are people in a squad (4–5) so everyone has something to share.
- **Players can browse the market any time** (button 🛒 on the confirm, quiz and result screens): picture, price in tokens, and stock status (✅ in stock / ⚠️ low (≤3) / ⛔ sold out, shown dimmed at the bottom); special items show 🔒 until the team goal is met. Stock refreshes every 15 s.
- **Market pictures:** in **Admin → ตลาด / แลกของ → แก้ไข/เพิ่มสินค้า** choose an image file (PNG/JPG/WebP; a phone photo is fine — it is shrunk in the browser before upload). Players see it as a thumbnail in **ของที่แลกได้** (tap to enlarge). Images are stored in the public `question-images` storage bucket.
- **Existing database?** run, in order, `supabase/hunt.sql`, `supabase/squads.sql`, `supabase/coop.sql`, `supabase/ids.sql`, `supabase/items.sql` (all safe to re-run).
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
