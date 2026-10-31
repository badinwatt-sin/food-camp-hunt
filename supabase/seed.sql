-- =====================================================================
-- Food Camp: SAMPLE DATA ONLY (no real people).
-- Run AFTER schema.sql. Replace everything with real data from /admin.
-- =====================================================================

insert into public.teams (name) values
  ('ทีมใบเมเปิล (ตัวอย่าง)'),
  ('ทีมสนเขียว (ตัวอย่าง)'),
  ('ทีมแสงตะวัน (ตัวอย่าง)'),
  ('ทีมลำธาร (ตัวอย่าง)');

-- 8 fictional players, 2 per team. No access codes yet:
-- generate them in /admin > ทีมและผู้เล่น.
insert into public.participants (team_id, name)
select t.id, 'ผู้เล่นตัวอย่าง ' || t.n || '-' || g
from (select id, row_number() over (order by name) as n from public.teams) t
cross join generate_series(1, 2) as g;

-- 5 sample questions. Images are clearly labelled placeholders under /public/placeholders.
-- Replace them in /admin > คำถาม (paste a URL or upload your own image).
insert into public.questions (position, prompt, image_url, options, correct_index) values
 (1, 'ตัวอย่าง: วัตถุดิบหลักของ “ส้มตำ” คือข้อใด?', '/placeholders/q1.svg',
    array['มะละกอดิบ','แตงกวา','กะหล่ำปลี','แครอท'], 0),
 (2, 'ตัวอย่าง: สมุนไพรที่ใช้ใน “ผัดกะเพรา” คือข้อใด?', '/placeholders/q2.svg',
    array['โหระพา','กะเพรา','สะระแหน่','ผักชี'], 1),
 (3, 'ตัวอย่าง: “กะทิ” ทำมาจากอะไร?', '/placeholders/q3.svg',
    array['ถั่วเหลือง','ข้าวโพด','เนื้อมะพร้าว','อัลมอนด์'], 2),
 (4, 'ตัวอย่าง: พริกชนิดใดมักเผ็ดที่สุด?', '/placeholders/q4.svg',
    array['พริกหยวก','พริกชี้ฟ้า','พริกหวาน','พริกขี้หนู'], 3),
 (5, 'ตัวอย่าง: เครื่องเทศใดทำให้ “แกงเหลือง” มีสีเหลือง?', '/placeholders/q5.svg',
    array['ขมิ้น','ข่า','กระชาย','ตะไคร้'], 0);

insert into public.market_items (name, category, price, stock) values
 ('ซอสพิเศษประจำทีม', 'sauce', 20, 10),
 ('ชีสเพิ่ม', 'topping', 30, 8),
 ('ไข่ดาวเพิ่ม', 'topping', 20, 12),
 ('ผักสดเพิ่มชุดใหญ่', 'ingredient', 15, 15),
 ('เห็ดเพิ่ม', 'ingredient', 20, 10),
 ('ผลไม้ตกแต่งจาน', 'decoration', 25, 10),
 ('ธงตกแต่งร้าน', 'decoration', 10, 20),
 ('ดอกไม้ประดับโต๊ะ', 'decoration', 30, 6),
 ('ไฟประดับขนาดเล็ก', 'decoration', 40, 5);

-- 5 SAMPLE treasure-hunt spots. Secrets below are examples: in /admin > ล่าสมบัติ press
-- "สุ่มใหม่" for every spot (and reprint the QR) before the real event.
insert into public.hunt_spots (position, title, hint, secret, tokens) values
 (1, 'ครัวกลาง',        'กลิ่นหอมที่สุดของแคมป์ ไปหาหม้อใบใหญ่',        'HUNTKIT1', 10),
 (2, 'สวนผักสมุนไพร',    'ที่ที่โหระพากับกะเพราอยู่ใกล้กัน',            'HUNTHRB2', 10),
 (3, 'โต๊ะอาหารใหญ่',    'ทุกทีมมานั่งกินข้าวที่นี่',                    'HUNTTBL3', 15),
 (4, 'ลานกางเต็นท์',     'มองหาธงสีเขียวข้างเต็นท์หลังสุด',              'HUNTTNT4', 15),
 (5, 'ริมลำธาร',         'ได้ยินเสียงน้ำไหล แล้วหาป้ายไม้',              'HUNTCRK5', 20);

-- Sample "special" market items that stay locked until the team reaches the team goal
-- (set the goal % in /admin > ภาพรวม; 0 = goal off, so they are sold normally).
update public.market_items set requires_goal = true where name in ('ดอกไม้ประดับโต๊ะ', 'ไฟประดับขนาดเล็ก');

-- Co-op sample: this spot needs 3 squad members to scan it within 3 minutes.
update public.hunt_spots set min_players = 3, window_sec = 180 where secret = 'HUNTTBL3';

-- 2 SAMPLE team puzzles: each squad member sees only some of the clues; the squad must combine them.
insert into public.team_puzzles (position, prompt, clues, options, correct_index, tokens) values
 (1, 'เมนูลับของค่ายคืออะไร?',
    array['วัตถุดิบหลักคือมะละกอดิบ','รสชาติครบทั้งเปรี้ยว เผ็ด เค็ม หวาน','ต้องตำในครกให้เข้ากัน','มักกินคู่กับข้าวเหนียวและไก่ย่าง'],
    array['ส้มตำ','ต้มยำกุ้ง','แกงเขียวหวาน','ผัดไทย'], 0, 20),
 (2, 'สมุนไพรปริศนาคือข้อใด?',
    array['ใบมีกลิ่นฉุนหอมเฉพาะตัว','นิยมผัดกับหมูสับและพริก','มีทั้งพันธุ์ใบแดงและใบขาว','เมนูผัดจานดังขาดมันไม่ได้'],
    array['โหระพา','กะเพรา','สะระแหน่','ผักชี'], 1, 20);
