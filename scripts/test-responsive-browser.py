#!/usr/bin/env python3
"""Player responsive and original Admin navigation checks using API fixtures.

Start Next.js locally, then run python scripts/test-responsive-browser.py.
MODE=baseline records findings without failing on layout issues. BASE_URL,
WIDTHS (comma separated) and SCREENSHOT_DIR may override local defaults.
No real accounts, LINE service, or production database are contacted.
"""
import copy
import json
import os
import re
import tempfile
from pathlib import Path
from urllib.parse import unquote, urlparse
from playwright.sync_api import sync_playwright, expect

BASE = os.environ.get('BASE_URL', 'http://127.0.0.1:3000')
WIDTHS = [int(w) for w in os.environ.get('WIDTHS', '320,360,390,430,768,1024,1366,1440,1920').split(',')]
MODE = os.environ.get('MODE', 'verify')
OUT = Path(os.environ.get('SCREENSHOT_DIR', str(Path(tempfile.gettempdir()) / 'food-camp-responsive')))
OUT.mkdir(parents=True, exist_ok=True)
expect.set_options(timeout=20000)
NAME = 'มะลิผู้ดูแลความร่วมมือและกิจกรรมของสมาชิกในค่าย'
TEAM = 'ทีมครัวสร้างสรรค์อาหารและความร่วมมือประจำค่ายฤดูหนาว'
GROUP = 'เพื่อนร่วมค่ายครัวสร้างสรรค์และการเรียนรู้ด้วยกัน'
LINE_URL = 'https://line.me/ti/g/responsive-fixture-only'
P1, P2, OBS, SQ = '11111111-1111-4111-8111-111111111111', '22222222-2222-4222-8222-222222222222', '33333333-3333-4333-8333-333333333333', '44444444-4444-4444-8444-444444444444'
ITEMS = [dict(id='item1', name='วัตถุดิบพิเศษสำหรับปรุงอาหารของสมาชิกทุกคนในกลุ่ม', category='ingredient', price=5, stock=12, requires_goal=False, image_url=None, active=True), dict(id='item2', name='อุปกรณ์ตกแต่งโต๊ะอาหารในกิจกรรมสร้างสรรค์ประจำค่าย', category='decoration', price=8, stock=20, requires_goal=False, image_url=None, active=True)]
QUESTION = dict(id='question1', position=1, prompt='อาหารชนิดใดเหมาะสำหรับกิจกรรมทำอาหารร่วมกันในทีมมากที่สุด?', image_url=None, options=['อาหารที่ทำร่วมกันและแบ่งหน้าที่ให้สมาชิกครบทุกคน', 'อาหารที่สามารถเตรียมได้โดยไม่ต้องร่วมมือกับเพื่อน', 'อาหารสำเร็จรูปที่ใช้ระยะเวลาปรุงน้อยที่สุดเท่านั้น', 'อาหารที่ไม่มีวัตถุดิบตามฤดูกาลในพื้นที่จัดกิจกรรม'])


def me_fixture():
    return dict(participant=dict(name=NAME, fullName=NAME+' ทดสอบระบบ', status='not_started'), team=dict(name=TEAM, balance=160), squad='ครัวสร้างสรรค์กลุ่มที่หนึ่ง', goal=dict(goalPct=80, completed=18, participants=28, met=False, need=5), avatar=dict(url=None, emoji='🌻'), checkin=dict(open=True, done=True, at='2026-11-10T09:00:00Z'), isLeader=True, isObserver=False, leaderName=NAME, marketOpen=True, menus=dict(quiz=True,hunt=True,photos=True,games=True,market=True,missions=True,checkin=True), line=dict(open=True,configured=True,group='D',groupName=GROUP,url=LINE_URL,joined=True,joinedAt='2026-11-10T09:00:00Z',total=28,joinedCount=19,complete=False,rank=None,tokens=0,revision=1,rejoinRequired=False,isObserver=False,rewardPreviouslyEarned=False,nextRewardTokens=20,members=[]), inventory=[dict(item=ITEMS[0]['name'], image_url=None,qty=3,handed=1,pending=2,spent=15)], game=dict(open=True,tokensPerCorrect=10),total=1,answered=0,current=None,result=None,history=[],market=copy.deepcopy(ITEMS))


def member(mid,name,leader=False,observer=False,squad=None):
    return dict(id=mid,name=name,isLeader=leader,isMe=mid==P1,isObserver=observer,squad=squad,squadId=SQ if squad else None,lineJoined=mid!=P2,quizDone=False,avatarUrl=None,avatarEmoji='🌻')


class Fixture:
    def __init__(self,page,admin=False):
        self.page=page; self.admin=admin; self.me=me_fixture(); self.posts=[]; self.requests=[]; self.errors=[]; self.unexpected=[]
        self.team=dict(team=TEAM,total=28,quizDone=18,squads=['ครัวสร้างสรรค์กลุ่มที่หนึ่ง'],squadOptions=[dict(id=SQ,name='ครัวสร้างสรรค์กลุ่มที่หนึ่ง')],canManageSquads=True,line=dict(joined=19,total=28,missing=9,missingPct=32.2),members=[member(P1,NAME,True),member(P2,'สมาชิกผู้รับผิดชอบเตรียมวัตถุดิบและอุปกรณ์ของทีม',squad='ครัวสร้างสรรค์กลุ่มที่หนึ่ง'),member(OBS,'คณะทำงานผู้ดูแลกิจกรรมของกลุ่ม',observer=True)])
        self.admin_teams=[dict(id='team'+c,name=TEAM+' '+c,line_group_code=c,line_group_name=GROUP+' '+c,line_group_url=LINE_URL+'-'+c,line_completed_at=None,line_finish_rank=None,line_reward_tokens=0,line_revision=1,total=28,joinedCount=19,members=[dict(id=P1,name=NAME,fullName=NAME,joinedAt='2026-11-10T09:00:00Z',isObserver=False)]) for c in 'DCAO']
        self.settings=dict(is_open=True,hunt_open=True,puzzle_open=True,market_open=True,line_open=True,checkin_open=True,tokens_per_correct=10,team_goal_pct=80,mg_spot_open=True,mg_memory_open=True,mg_mystery_open=True,mg_spot_tokens=20,mg_memory_tokens=25,mg_mystery_tokens=30)
        self.games={g:dict(open=True,used=0,max=3,inProgress=False,best=0,scores=[],maxTokens=20,rewardTokens=20,successRule='ทำภารกิจตามเงื่อนไขให้ครบ รับโทเคนเข้ากระเป๋าทีมหนึ่งครั้ง',claimed=False,top=[]) for g in ['spot','memory','mystery']}
        page.on('pageerror',lambda e:self.errors.append(str(e)))
        page.route('**/api/**',self.route)
        page.route('https://line.me/**',self.line_route)
        # Remote images are deliberately unnecessary for these layout fixtures.
    def response(self,route,data,status=200):
        route.fulfill(status=status,content_type='application/json',body=json.dumps(data,ensure_ascii=False))
    def line_route(self,route):
        self.requests.append(('NAVIGATE',route.request.url));route.fulfill(content_type='text/html',body='<title>Mock LINE invitation</title>')
    def summaries(self):
        return [dict(team_id=t['id'],id=t['id'],name=t['name'],participants=28,completed=18,in_progress=5,balance=160,spent=40,leader=NAME,line_group_code=t['line_group_code'],line_group_name=t['line_group_name'],line_completed_at=None) for t in self.admin_teams]
    def people(self):
        return [dict(id=P1,name=NAME+' ชื่อจริง',nick_name=NAME,team_id='teamD',team_name=TEAM,squad_id=SQ,squad_name='ครัวสร้างสรรค์กลุ่มที่หนึ่ง',status='not_started',has_code=True,correct_count=0,tokens_earned=0,completed_at=None,is_leader=True,is_observer=False,has_avatar=False,avatar_url=None,avatar_emoji=None,line_group_code='D',line_group_name=GROUP,line_joined_at='2026-11-10T09:00:00Z',line_completed_at=None)]
    def route(self,route):
        req=route.request;path=unquote(urlparse(req.url).path); self.requests.append((req.method,path))
        body=req.post_data_json if req.method=='POST' and 'application/json' in req.headers.get('content-type','') else None
        if req.method=='POST': self.posts.append((path,body))
        if path.startswith('/api/admin/'):
            action=path[len('/api/admin/'):]
            if req.method=='POST':
                if action=='game.set':
                    self.settings.update(body)
                    for g in self.games:
                        self.games[g]['rewardTokens']=self.settings.get('mg_'+g+'_tokens',20)
                if action=='line.group.save':
                    t=next(t for t in self.admin_teams if t['id']==body['team_id']);t.update(line_group_name=body.get('name') or t['line_group_name'],line_group_url=body['url'],line_group_code=body['group'])
                if action=='participant.save': pass
                return self.response(route,dict(ok=True,changed=action=='line.group.save',revision=2))
            if action=='session': return self.response(route,dict(role='admin'))
            if action=='badges': return self.response(route,dict(pendingPhotos=3))
            if action=='overview': return self.response(route,dict(settings=self.settings,teams=self.summaries(),pendingPickup=7,pendingPhotos=3,checkedIn=20))
            if action=='line.groups': return self.response(route,dict(open=True,teams=self.admin_teams))
            if action=='teams': return self.response(route,dict(teams=self.summaries()))
            if action=='participants': return self.response(route,dict(participants=self.people()))
            if action=='squads': return self.response(route,dict(squads=[dict(id=SQ,name='ครัวสร้างสรรค์กลุ่มที่หนึ่ง',team_id='teamD')]))
            if action=='minigames': return self.response(route,dict(games={g:dict(open=True,rewardTokens=self.settings['mg_'+g+'_tokens'],players=28,attempts=40,finished=30,tokens=500,top=[dict(name=NAME,team=TEAM,tokens=20)]) for g in self.games}))
            if action=='market': return self.response(route,dict(items=ITEMS))
            if action=='inventory': return self.response(route,dict(items=[],teams=[],redemptions=[]))
            if action=='questions': return self.response(route,dict(questions=[dict(**QUESTION,correct_index=0,active=True)]))
            if action=='hunt': return self.response(route,dict(spots=[dict(id='spot1',title='จุดปรุงอาหารและพบเพื่อนร่วมทีมประจำค่าย',position=1,hint='ค้นหาโต๊ะส่วนกลาง',tokens=10,active=True,min_players=3,window_sec=180,found=1)],claims=[]))
            if action=='redemptions': return self.response(route,dict(redemptions=[]))
            if action=='ledger': return self.response(route,dict(ledger=[],audit=[]))
            if action=='missions': return self.response(route,dict(missions=[dict(id='photo1',title='ถ่ายภาพร่วมกันในกิจกรรมปรุงอาหารของสมาชิกทุกคน',description='ทุกคนร่วมถ่ายภาพในกิจกรรม',category='food',tokens=20,position=1,active=True,done=0,pending=1)],submissions=[],pending=0))
            if action=='checkin': return self.response(route,dict(open=True,code='FIXTURE',announcedAt=None,people=[dict(id=P1,name=NAME,nick_name=NAME,team_id='teamD',team=TEAM,squad='ครัวสร้างสรรค์กลุ่มที่หนึ่ง',checked_in_at=None,checked_in_by=None)]))
            if action=='live': return self.response(route,dict(open=True,huntOpen=True,puzzleOpen=True,totalSpots=5,goalPct=80,teams=[dict(**t,huntFound=4,quizTokens=100,huntTokens=50,puzzleTokens=25,goalNeed=5,goalMet=False) for t in self.summaries()],feed=[dict(at='2026-11-10T09:00:00Z',kind='hunt',team=TEAM,text='พบจุดภารกิจและร่วมกิจกรรมกับสมาชิกในกลุ่มแล้ว')]))
        if path=='/api/me': return self.response(route,self.me)
        if path=='/api/notices': return self.response(route,dict(photos=[],checkin=None))
        if path=='/api/team': return self.response(route,self.team)
        if path=='/api/team/squads':
            if body['action']=='create':
                self.team['squadOptions'].append(dict(id='55555555-5555-4555-8555-555555555555',name=body['name']));self.team['squads'].append(body['name'])
            else:
                m=next(m for m in self.team['members'] if m['id']==body['participantId']); m['squadId']=body['squadId'];m['squad']=next((s['name'] for s in self.team['squadOptions'] if s['id']==body['squadId']),None)
            return self.response(route,dict(ok=True))
        if path=='/api/start': self.me['participant']['status']='in_progress';self.me['current']=QUESTION;return self.response(route,dict(ok=True))
        if path=='/api/answer': return self.response(route,dict(selected=body['selected'],correctIndex=0,isCorrect=body['selected']==0,answered=1,total=1))
        if path=='/api/complete': self.me['participant']['status']='completed';self.me['current']=None;self.me['answered']=1;self.me['result']=dict(correct=1,tokens=10);return self.response(route,dict(correct=1,tokens=10,teamBalance=170))
        if path=='/api/line/join': self.me['line'].update(joined=True,rejoinRequired=False);return self.response(route,dict(url=LINE_URL,already=False))
        if path=='/api/redeem': return self.response(route,dict(already=False,totalCost=5,balance=155))
        if path=='/api/hunt': return self.response(route,dict(open=True,team=self.me['team'],groupSize=5,spots=[dict(id='spot1',title='ค้นหาอุปกรณ์ประกอบอาหารประจำครัวและจุดนัดพบสมาชิก',tokens=10,hint='มองหาโต๊ะส่วนกลางที่ทีมงานจัดเตรียมไว้ให้',found=False,foundBy=None,coop=dict(need=3,windowSec=180,have=1,iScanned=False))],found=0,earned=0,squad=self.me['squad'],squads=[dict(id=SQ,name=self.me['squad'],mine=True,found=0)],goal=self.me['goal']))
        if path=='/api/photos': return self.response(route,dict(open=True,isLeader=True,leaderName=NAME,team=TEAM,missions=[dict(id='photo1',title='ถ่ายภาพร่วมกันในกิจกรรมปรุงอาหารของสมาชิกทุกคน',description='สมาชิกทุกคนอยู่ในภาพพร้อมอาหารที่ปรุงร่วมกันและส่งภาพให้ทีมงานตรวจสอบ',category='food',refImageUrl=None,tokens=20,submission=None)]))
        if path=='/api/minigames': return self.response(route,dict(games=self.games,isObserver=False))
        if path=='/api/minigames/memory':
            if body['action']=='start': return self.response(route,dict(attemptId='attempt1',n=1,moves=0,matched=[],open=None))
            return self.response(route,dict(phase='first',card=dict(id='rice',emoji='🍚',name='ข้าวสาร'),moves=0))
        if path in ['/api/logout','/api/login']: return self.response(route,dict(ok=True))
        self.unexpected.append((req.method,path));return self.response(route,dict(message='Unexpected fixture route: '+path),400)


class Audit:
    def __init__(self): self.findings=[];self.screens=0;self.player_screens=0;self.admin_screens=0
    def snapshot(self,page,label,width,shot=False,check_layout=True):
        page.wait_for_timeout(90)
        metrics=page.evaluate('''() => {
          const viewport=document.documentElement.clientWidth;
          const rect=el=>{const r=el.getBoundingClientRect();return {x:r.x,right:r.right,width:r.width,height:r.height}};
          const visible=el=>el.getClientRects().length && getComputedStyle(el).visibility!=='hidden';
          const overflow=[...document.querySelectorAll('body *')].filter(visible).map(el=>({el,r:rect(el)})).filter(({el,r})=>r.right>viewport+1 && !el.closest('.table-wrap,table,.admin-nav,.tabs')).slice(0,6).map(({el,r})=>({tag:el.tagName,cls:el.className,text:(el.textContent||'').slice(0,55),...r}));
          const touch=[...document.querySelectorAll('.btn,.tile,.home-btn,.admin-nav button,.tabs button,.opt,.squad-member-control select')].filter(visible).map(el=>({el,r:rect(el)})).filter(({r})=>r.height<43.5||r.width<43.5).map(({el,r})=>({text:(el.textContent||el.getAttribute('aria-label')||'').trim().slice(0,60),...r}));
          const fonts=[...document.querySelectorAll('input:not([type=checkbox]):not([type=radio]):not([type=file]):not([type=hidden]),select,textarea')].filter(visible).filter(el=>parseFloat(getComputedStyle(el).fontSize)<16).map(el=>({name:el.getAttribute('aria-label')||el.placeholder||el.id,font:getComputedStyle(el).fontSize}));
          return {viewport,doc:Math.max(document.documentElement.scrollWidth,document.body.scrollWidth),overflow,touch,fonts};
        }''')
        self.screens+=1
        if check_layout:self.player_screens+=1
        else:self.admin_screens+=1
        if check_layout and metrics['doc']>metrics['viewport']+1: self.findings.append(dict(screen=label,width=width,type='document_overflow',details=metrics))
        if check_layout and width<=430:
            if metrics['touch']: self.findings.append(dict(screen=label,width=width,type='touch_targets',details=metrics['touch']))
            if metrics['fonts']: self.findings.append(dict(screen=label,width=width,type='input_font',details=metrics['fonts']))
        if shot: page.screenshot(path=str(OUT/f'responsive-{MODE}-{label}-{width}.png'),full_page=True)
    def check_errors(self,f,label,width):
        if f.errors:self.findings.append(dict(screen=label,width=width,type='javascript_error',details=f.errors))
        if f.unexpected:self.findings.append(dict(screen=label,width=width,type='unexpected_api',details=f.unexpected))


def click(page,name,exact=False): page.get_by_role('button',name=name,exact=exact).click()
def home(page):
    buttons=page.get_by_role('button',name='กลับหน้าหลัก',exact=True)
    if buttons.count(): buttons.last.click()
    else: page.get_by_role('button',name='กลับหน้าหลัก').first.click()
    expect(page.get_by_role('heading',name=NAME,exact=True)).to_be_visible()
    assert page.evaluate('window.scrollY') <= 1, 'Opening home must reset its scroll position'


def player_flow(browser,audit,width):
    ctx=browser.new_context(viewport=dict(width=width,height=900),is_mobile=width<=430,has_touch=width<=430)
    page=ctx.new_page();page.set_default_timeout(20000);page.set_default_navigation_timeout(60000);f=Fixture(page)
    page.goto(BASE);expect(page.get_by_role('heading',name=NAME,exact=True)).to_be_visible()
    audit.snapshot(page,'user-home',width,shot=width in [320,390,1440])
    click(page,'สมาชิกในทีม');expect(page.get_by_role('heading',name='สมาชิกทีม '+TEAM,exact=True)).to_be_visible()
    audit.snapshot(page,'user-team',width,shot=width in [320,390])
    if width in [390,1440]:
        field=page.get_by_label('ชื่อ Squad ใหม่',exact=True);field.fill('กลุ่มครัวสีเขียว')
        click(page,'สร้าง Squad',True);expect(page.get_by_role('combobox',name='Squad ของ '+f.team['members'][1]['name'],exact=True).locator('option').filter(has_text='กลุ่มครัวสีเขียว')).to_have_count(1)
        select=page.get_by_role('combobox',name='Squad ของ '+f.team['members'][1]['name'],exact=True);select.select_option(label='กลุ่มครัวสีเขียว')
        assert any(p=='/api/team/squads' and b.get('action')=='assign' and b.get('participantId')==P2 for p,b in f.posts)
    if width in [320,390,1440]:
        page.evaluate('window.scrollTo(0, document.body.scrollHeight)')
        page.get_by_role('button',name='กลับหน้าหลัก',exact=True).first.dispatch_event('click')
        expect(page.get_by_role('heading',name=NAME,exact=True)).to_be_visible()
        assert page.evaluate('window.scrollY') <= 1, 'Navigating from a long team screen must open home at the top'
    else: home(page)
    click(page,'เริ่มภารกิจ');expect(page.get_by_role('button',name=re.compile('เริ่มเล่นควิซ'))).to_be_visible();audit.snapshot(page,'user-missions',width)
    click(page,'เริ่มเล่นควิซ');click(page,'เริ่มเล่นเลย');expect(page.get_by_text(QUESTION['prompt'],exact=True)).to_be_visible();audit.snapshot(page,'user-quiz',width,shot=width in [320,390])
    page.locator('.opt').first.click()
    buttons=page.get_by_role('button',name=re.compile('ยืนยันคำตอบ|ส่งคำตอบ'))
    if buttons.count(): buttons.first.click()
    else: raise AssertionError('Quiz submit action could not be located')
    audit.snapshot(page,'user-quiz-feedback',width)
    assert any(path=='/api/answer' and body.get('selected')==0 for path,body in f.posts)
    click(page,'ดูคะแนนของฉัน',True);expect(page.get_by_role('heading',name=re.compile('เล่นจบแล้ว เก่งมาก'))).to_be_visible();audit.snapshot(page,'user-quiz-complete',width)
    assert any(path=='/api/complete' and body=={} for path,body in f.posts)
    home(page);click(page,'ตลาดของ');expect(page.get_by_role('button',name=re.compile('แลกสินค้านี้')).first).to_be_visible();audit.snapshot(page,'user-market',width)
    page.get_by_role('button',name=re.compile('แลกสินค้านี้')).first.click();expect(page.get_by_role('dialog',name='ยืนยันการแลก',exact=True)).to_be_visible();audit.snapshot(page,'user-redeem-dialog',width,shot=width in [320,390])
    click(page,'ยกเลิก',True);click(page,'ของของทีม',True);expect(page.get_by_text('รวม 3 ชิ้น · ใช้โทเคนไปแล้ว 15',exact=True)).to_be_visible();audit.snapshot(page,'user-inventory',width)
    home(page);click(page,'เริ่มภารกิจ');click(page,re.compile('ไปล่าสมบัติ'));expect(page.get_by_text('มองหาโต๊ะส่วนกลางที่ทีมงานจัดเตรียมไว้ให้',exact=True)).to_be_visible();audit.snapshot(page,'user-hunt',width)
    click(page,re.compile('ภารกิจทีม'));expect(page.get_by_text('ถ่ายภาพร่วมกันในกิจกรรมปรุงอาหารของสมาชิกทุกคน',exact=True)).to_be_visible();audit.snapshot(page,'user-photos',width)
    home(page);click(page,'เริ่มภารกิจ');click(page,re.compile('ภารกิจประจำสัปดาห์'));expect(page.get_by_role('heading',name=re.compile('ภารกิจประจำสัปดาห์'))).to_be_visible();audit.snapshot(page,'user-weekly',width)
    if width in [320,390,1440]:
        cards=page.locator('.card').filter(has=page.get_by_role('heading',name='Camp Memory Flip',exact=True));cards.get_by_role('button',name='เริ่มภารกิจ',exact=True).click()
        expect(page.get_by_role('button',name=re.compile('เริ่มเล่น'))).to_be_visible()
        assert page.evaluate('window.scrollY')<=1, 'Opening a mission from the long weekly hub must reset its scroll position'
        click(page,re.compile('เริ่มเล่น'));audit.snapshot(page,'user-memory',width)
    audit.check_errors(f,'user-flow',width);ctx.close()


def admin_flow(browser,audit,width):
    ctx=browser.new_context(viewport=dict(width=width,height=1000),is_mobile=width<=430,has_touch=width<=430)
    page=ctx.new_page();page.set_default_timeout(20000);page.set_default_navigation_timeout(60000);f=Fixture(page,True)
    # Admin intentionally uses its original layout; phone navigation must expose every menu.
    def admin_snapshot(page,label,width,shot=False):
        audit.snapshot(page,label,width,shot=shot,check_layout=False)
    page.goto(BASE+'/admin');expect(page.get_by_role('navigation',name='เมนูผู้จัด')).to_be_visible();admin_snapshot(page,'admin-overview',width,shot=width in [320,390,1366,1440])
    nav=page.get_by_role('navigation',name='เมนูผู้จัด')
    expect(nav.get_by_role('button')).to_have_count(11)
    layout=nav.evaluate('''nav => {
      const r=nav.getBoundingClientRect();
      return {wrap:getComputedStyle(nav).flexWrap, direction:getComputedStyle(nav).flexDirection,
        maxWidth:getComputedStyle(nav.closest('.admin-layout')).maxWidth,
        clipped:[...nav.querySelectorAll('button')].filter(b=>{const x=b.getBoundingClientRect();return x.left<r.left-1||x.right>r.right+1||x.top<r.top-1||x.bottom>r.bottom+1}).length};
    }''')
    assert layout['maxWidth']=='1280px' and not layout['clipped'], layout
    if width<=900:assert layout['wrap']=='wrap' and layout['direction']=='row', layout
    else:assert layout['direction']=='column', layout
    for label in ['ภาพรวม','เช็กอินวันงาน','กลุ่ม LINE','ตลาดสินค้า','ทีมและผู้เล่น','คำถามควิซ','ภารกิจประจำสัปดาห์','ล่าสมบัติ','ภารกิจทีม','ประวัติ','ส่งออก CSV']:
        expect(nav.get_by_role('button',name=re.compile(re.escape(label)))).to_be_visible()
    nav.get_by_role('button',name=re.compile('กลุ่ม LINE')).click();expect(page.get_by_role('button',name='อัปเดตกลุ่ม LINE').first).to_be_visible();admin_snapshot(page,'admin-line',width,shot=width in [320,390,1366])
    if width in [390,1440]:
        name=page.get_by_label('ชื่อกลุ่ม LINE ที่แสดง',exact=True).first;name.fill('ครัวแคมป์ที่ปรับชื่อใหม่')
        page.get_by_label('ลิงก์เชิญเข้ากลุ่ม LINE',exact=True).first.fill(LINE_URL+'-updated')
        page.get_by_role('button',name='อัปเดตกลุ่ม LINE',exact=True).first.click()
        page.wait_for_timeout(100)
        assert any(path=='/api/admin/line.group.save' and body.get('name')=='ครัวแคมป์ที่ปรับชื่อใหม่' and body.get('team_id')=='teamD' and body.get('group')=='D' and body.get('url')==LINE_URL+'-updated' for path,body in f.posts)
    nav.get_by_role('button',name=re.compile('ทีมและผู้เล่น')).click();expect(page.get_by_label('ประเภทผู้ใช้',exact=True)).to_be_visible();admin_snapshot(page,'admin-people',width,shot=width in [320,390,1440])
    nav.get_by_role('button',name=re.compile('ภารกิจประจำสัปดาห์')).click();expect(page.get_by_label('Tokens เมื่อทำสำเร็จ',exact=True).first).to_be_visible();admin_snapshot(page,'admin-weekly',width)
    if width in [390,1440]:
        page.get_by_label('Tokens เมื่อทำสำเร็จ',exact=True).first.fill('47');page.get_by_role('button',name='บันทึก Tokens',exact=True).first.click();page.wait_for_timeout(100)
        assert any(path=='/api/admin/game.set' and body.get('mg_spot_tokens')==47 for path,body in f.posts)
    nav.get_by_role('button',name=re.compile('ตลาดสินค้า')).click();expect(page.get_by_text(ITEMS[0]['name'],exact=True).first).to_be_visible();admin_snapshot(page,'admin-market',width)
    nav.get_by_role('button',name='ภารกิจทีม',exact=False).click();expect(page.get_by_text('ถ่ายภาพร่วมกันในกิจกรรมปรุงอาหารของสมาชิกทุกคน',exact=True)).to_be_visible();admin_snapshot(page,'admin-photos',width)
    # Opening and canceling the existing confirmation dialog must not submit a reset.
    nav.get_by_role('button',name=re.compile('ภาพรวม')).click();danger=page.get_by_role('button',name=re.compile('รีเซ็ตผลการเล่นทั้งหมด'))
    if danger.count():
        danger.first.click();admin_snapshot(page,'admin-reset-dialog',width);page.get_by_role('dialog',name='ยืนยันการลบ').get_by_role('button',name='ยกเลิก',exact=True).click()
        assert not any(path=='/api/admin/bulk.delete' for path,_ in f.posts)
    if width in [320,390,1366,1440]:
        for target in ['เช็กอินวันงาน','คำถามควิซ','ล่าสมบัติ','ประวัติ','ส่งออก CSV']:
            nav.get_by_role('button',name=re.compile(re.escape(target))).click();page.wait_for_timeout(150);admin_snapshot(page,'admin-'+target,width)
        if width==1366:page.set_viewport_size(dict(width=1366,height=768))
        page.goto(BASE+'/admin/live');expect(page.get_by_role('heading',name='Food Camp Hunt',exact=True)).to_be_visible();admin_snapshot(page,'admin-live',width,shot=width in [390,1366])
    audit.check_errors(f,'admin-flow',width);ctx.close()


def invitation_flow(browser,audit,width):
    # A short phone viewport stresses safe-area spacing and a scrollable dialog.
    for revised in [False,True]:
        ctx=browser.new_context(viewport=dict(width=width,height=640),is_mobile=True,has_touch=True);page=ctx.new_page();page.set_default_timeout(20000);page.set_default_navigation_timeout(60000);f=Fixture(page)
        f.me['line'].update(joined=False,joinedAt=None,revision=2 if revised else 1,rejoinRequired=revised,rewardPreviouslyEarned=revised,tokens=20 if revised else 0,nextRewardTokens=0 if revised else 20)
        page.goto(BASE);dialog=page.get_by_role('dialog',name='ทีมงานอัปเดตลิงก์ LINE' if revised else 'เข้ากลุ่ม LINE ของทีม',exact=True);expect(dialog).to_be_visible();audit.snapshot(page,'user-line-rejoin' if revised else 'user-line-first',width,shot=True)
        if revised:
            button=dialog.get_by_role('button',name=re.compile('เชื่อมต่อ LINE'));button.click();page.wait_for_url(LINE_URL)
            assert f.requests.index(('POST','/api/line/join')) < f.requests.index(('NAVIGATE',LINE_URL))
        else:
            ranks=dialog.get_by_label('รางวัลตามลำดับทีมที่เข้าครบ')
            for reward in ['20','15','10','5']:expect(ranks.get_by_text(reward,exact=True)).to_be_visible()
            dialog.get_by_role('button',name='ไว้ทีหลัง',exact=True).click();expect(dialog).to_have_count(0)
            assert not f.posts, 'Deferring the LINE invitation must not record a join'
        audit.check_errors(f,'line-redirect',width);ctx.close()


def observer_flow(browser,audit,width):
    ctx=browser.new_context(viewport=dict(width=width,height=900),is_mobile=width<=430,has_touch=width<=430);page=ctx.new_page();f=Fixture(page)
    f.me.update(isLeader=False,isObserver=True);f.me['line']['isObserver']=True;f.team['canManageSquads']=False
    page.goto(BASE);expect(page.get_by_role('heading',name=NAME,exact=True)).to_be_visible();click(page,'สมาชิกในทีม');expect(page.get_by_role('heading',name='สมาชิกทีม '+TEAM,exact=True)).to_be_visible()
    assert not page.get_by_label('ชื่อ Squad ใหม่',exact=True).count()
    audit.snapshot(page,'observer-team',width)
    home(page);click(page,'ตลาดของ');expect(page.get_by_role('heading',name='ตลาด / แลกของ',exact=True)).to_be_visible();audit.snapshot(page,'observer-market',width)
    assert not page.get_by_role('button',name='แลกสินค้านี้',exact=True).count()
    assert not f.posts, 'Viewing as activity staff must not mutate scores or team settings'
    audit.check_errors(f,'observer-flow',width);ctx.close()


def main():
    audit=Audit();flow_errors=[]
    with sync_playwright() as p:
        browser=p.chromium.launch(executable_path=os.environ.get('CHROMIUM_PATH','/usr/bin/chromium'),headless=True,args=['--no-sandbox'])
        for width in WIDTHS:
            for name,flow in [('player',player_flow),('admin',admin_flow)]:
                try: flow(browser,audit,width);print('PASS flow',name,width,flush=True)
                except Exception as error: flow_errors.append(dict(flow=name,width=width,error=str(error)));print('FAIL flow',name,width,str(error),flush=True)
            if width in [320,390]:
                try: invitation_flow(browser,audit,width)
                except Exception as error: flow_errors.append(dict(flow='invitation',width=width,error=str(error)))
            if width in [390,1440]:
                try: observer_flow(browser,audit,width)
                except Exception as error: flow_errors.append(dict(flow='observer',width=width,error=str(error)))
        browser.close()
    report=dict(mode=MODE,screens=audit.screens,playerResponsiveScreens=audit.player_screens,adminLegacyScreens=audit.admin_screens,findings=audit.findings,flowErrors=flow_errors)
    path=OUT/f'responsive-{MODE}-report.json';path.write_text(json.dumps(report,ensure_ascii=False,indent=2))
    print(json.dumps(dict(screens=audit.screens,layoutFindings=len(audit.findings),flowErrors=len(flow_errors),report=str(path)),ensure_ascii=False),flush=True)
    if flow_errors or (MODE!='baseline' and audit.findings): raise SystemExit(1)

if __name__=='__main__':main()
