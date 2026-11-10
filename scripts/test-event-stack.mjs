// Full local integration: Next.js -> Supabase JS -> PostgREST -> PostgreSQL.
// Uses disposable Docker containers, an isolated app copy, and dummy credentials.
// Requires Docker, installed project node_modules, Python Playwright and Chromium.
// Run: node scripts/test-event-stack.mjs
import assert from 'node:assert/strict';
import { spawn, execFileSync } from 'node:child_process';
import { readFile, mkdtemp, cp, symlink, rm } from 'node:fs/promises';
import { createHmac, randomUUID } from 'node:crypto';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const suffix = `${process.pid}-${randomUUID().slice(0, 6)}`;
const network = `food-camp-event-stack-${suffix}`;
const postgres = `${network}-pg`;
const rest = `${network}-rest`;
const localPassword = 'food-camp-local-tests-only-password';
const jwtSecret = 'food-camp-local-tests-only-postgrest-jwt-signing-key';
const adminPassword = 'food-camp-local-tests-only-admin-password';
const codePepper = 'food-camp-local-tests-only-code-pepper';
const sessionSecret = 'food-camp-local-tests-only-session-signing-key';
const appPort = Number(process.env.FOOD_CAMP_STACK_PORT || 3002);
const base = `http://127.0.0.1:${appPort}`;
const createdContainers = [];
let appDir, dev, proxy, networkCreated = false, passed = 0, devLog = '';
let injectedFinishFailures = 0;

function check(label, actual, expected = true) {
  assert.deepEqual(actual, expected, label);
  passed++;
  console.log(`PASS ${label}`);
}
function command(binary, args, { input = '', env = process.env } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(binary, args, { env, stdio: ['pipe', 'pipe', 'pipe'] });
    let stdout = '', stderr = '';
    child.stdout.on('data', (chunk) => { stdout += chunk; });
    child.stderr.on('data', (chunk) => { stderr += chunk; });
    child.on('error', reject);
    child.on('close', (code) => code === 0 ? resolve(stdout.trim()) : reject(new Error(`${binary}: ${stderr || stdout || `exit ${code}`}`)));
    child.stdin.end(input);
  });
}
const dockerEnv = { ...process.env };
for (const key of ['DOCKER_HOST','DOCKER_CONTEXT','DOCKER_TLS','DOCKER_TLS_VERIFY','DOCKER_CERT_PATH']) delete dockerEnv[key];
const dockerArgs = (args) => ['--host=unix:///var/run/docker.sock', ...args];
const docker = (args, input = '') => command('docker', dockerArgs(args), { input, env: dockerEnv });
const sql = (query) => docker(['exec', '-i', postgres, 'psql', '-U', 'postgres', '-d', 'foodcamp', '-X', '-q', '-t', '-A', '-v', 'ON_ERROR_STOP=1'], query);
async function ready(label, probe) {
  for (let attempt = 0; ; attempt++) {
    try { await probe(); return; }
    catch (error) {
      if (attempt >= 100) throw new Error(`${label} did not become ready: ${error.message}`);
      await new Promise((resolve) => setTimeout(resolve, 300));
    }
  }
}
function jwt() {
  const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');
  const payload = Buffer.from(JSON.stringify({ role: 'service_role', iss: 'supabase', iat: Math.floor(Date.now() / 1000), exp: Math.floor(Date.now() / 1000) + 3600 })).toString('base64url');
  const body = `${header}.${payload}`;
  return `${body}.${createHmac('sha256', jwtSecret).update(body).digest('base64url')}`;
}
class Client {
  cookies = new Map();
  async call(route, body) {
    const response = await fetch(base + route, {
      method: body === undefined ? 'GET' : 'POST',
      headers: { ...(body === undefined ? {} : { 'content-type': 'application/json' }), origin: base, cookie: [...this.cookies].map(([key, value]) => `${key}=${value}`).join('; ') },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(90000),
    });
    for (const cookie of response.headers.getSetCookie()) {
      const [pair] = cookie.split(';');
      const equals = pair.indexOf('=');
      this.cookies.set(pair.slice(0, equals), pair.slice(equals + 1));
    }
    const data = await response.json();
    return { status: response.status, data };
  }
  async ok(route, body) {
    const result = await this.call(route, body);
    assert.equal(result.status, 200, `${route}: ${JSON.stringify(result.data)}`);
    return result.data;
  }
}

async function browser(stage, adminCookie = '', teamId = '') {
  const code = `
import os,json
from playwright.sync_api import sync_playwright, expect
with sync_playwright() as p:
    browser=p.chromium.launch(executable_path='/usr/bin/chromium',headless=True,args=['--no-sandbox'])
    context=browser.new_context(viewport={'width':390,'height':844})
    page=context.new_page()
    page.set_default_timeout(20000)
    page.set_default_navigation_timeout(60000)
    errors=[]
    page.on('pageerror',lambda error:errors.append(str(error)))
    context.route('https://line.me/**',lambda route:route.fulfill(status=200,body='Local test LINE destination',content_type='text/html'))
    page.goto(os.environ['FC_STACK_BASE'],wait_until='domcontentloaded')
    page.get_by_placeholder('ID ของคุณ').fill('OBSERVER01' if os.environ['FC_STACK_STAGE']=='observer' else 'LEADER01')
    page.get_by_role('button',name='เข้าสู่เกม',exact=True).click()
    if os.environ['FC_STACK_STAGE']=='initial':
        popup=page.get_by_role('dialog',name='เข้ากลุ่ม LINE ของทีม')
        expect(popup).to_be_visible(timeout=60000)
        expect(popup).to_contain_text('20')
        expect(popup).to_contain_text('15')
        expect(popup).to_contain_text('10')
        expect(popup).to_contain_text('5')
        expect(popup).to_contain_text('ครั้งเดียว')
        expect(popup).to_contain_text('ไม่ใช่คะแนนรายคน')
        expect(popup.locator('img[src="/line-logo.svg"]')).to_be_visible()
        page.screenshot(path='/workspace/scratch/food-camp-event-line-invite.png',full_page=True)
        popup.get_by_role('button',name='เชื่อมต่อ LINE กลุ่ม เพื่อนร่วมค่าย',exact=True).click()
        page.wait_for_url('https://line.me/**',timeout=30000)
    elif os.environ['FC_STACK_STAGE']=='leader':
        expect(page.get_by_role('dialog')).to_have_count(0)
        page.get_by_role('button',name='สมาชิกในทีม',exact=False).click()
        expect(page.get_by_role('heading',name='สมาชิกทีม STACK Event D',exact=True)).to_be_visible(timeout=60000)
        expect(page.get_by_role('progressbar',name='สมาชิกที่เข้ากลุ่ม LINE แล้ว')).to_have_attribute('aria-valuenow','2')
        expect(page.get_by_text('✓ สมาชิกเข้ากลุ่ม LINE ครบแล้ว 100%',exact=True)).to_be_visible()
        squadName=page.get_by_label('ชื่อ Squad ใหม่',exact=True)
        squadName.fill('Browser Squad')
        page.get_by_role('button',name='สร้าง Squad',exact=True).click()
        select=page.get_by_role('combobox',name='Squad ของ Member Two',exact=True)
        expect(select.locator('option').filter(has_text='Browser Squad')).to_have_count(1)
        select.select_option(label='Browser Squad')
        expect(select).not_to_have_value('')
        page.screenshot(path='/workspace/scratch/food-camp-event-team-leader.png',full_page=True)
        # Keep user on the team screen while Admin changes the invitation.
        response=page.request.post(os.environ['FC_STACK_BASE']+'/api/admin/line.group.save',headers={'Cookie':os.environ['FC_STACK_ADMIN_COOKIE'],'Origin':os.environ['FC_STACK_BASE']},data={'team_id':os.environ['FC_STACK_TEAM_ID'],'group':'D','name':'เพื่อนร่วมค่าย','url':'https://line.me/ti/g/event-D-updated'})
        assert response.status==200,response.text()
        page.evaluate("window.dispatchEvent(new Event('focus'))")
        popup=page.get_by_role('dialog',name='ทีมงานอัปเดตลิงก์ LINE',exact=True)
        expect(popup).to_be_visible(timeout=30000)
        expect(popup).to_contain_text('ไม่ให้คะแนนซ้ำ')
        popup.get_by_role('button',name='ไว้ทีหลัง',exact=True).click()
        expect(page.get_by_role('heading',name='สมาชิกทีม STACK Event D',exact=True)).to_be_visible()
        assert page.locator('.line-entry .progress,.line-entry details').count()==0
    else:
        popup=page.get_by_role('dialog',name='ทีมงานอัปเดตลิงก์ LINE',exact=True)
        expect(popup).to_be_visible(timeout=60000)
        expect(popup).to_contain_text('คณะทำงาน')
        popup.get_by_role('button',name='ไว้ทีหลัง',exact=True).click()
        expect(page.get_by_text('👁 คณะทำงาน',exact=True)).to_be_visible()
        page.get_by_role('button',name='สมาชิกในทีม',exact=False).click()
        expect(page.get_by_role('heading',name='สมาชิกทีม STACK Event D',exact=True)).to_be_visible(timeout=60000)
        expect(page.get_by_label('ชื่อ Squad ใหม่',exact=True)).to_have_count(0)
        expect(page.get_by_role('combobox',name='Squad ของ Member Two',exact=True)).to_have_count(0)
        expect(page.get_by_role('heading',name='คณะทำงาน',exact=False)).to_be_visible()
        page.locator('main').get_by_role('button',name='กลับหน้าหลัก',exact=True).click()
        page.get_by_role('button',name='เริ่มภารกิจ',exact=False).click()
        page.get_by_role('button',name='ภารกิจประจำสัปดาห์',exact=False).click()
        expect(page.get_by_role('heading',name='ภารกิจประจำสัปดาห์',exact=False)).to_be_visible()
        readonly=page.get_by_role('button',name='คณะทำงาน · ดูได้อย่างเดียว',exact=True)
        expect(readonly).to_have_count(3)
        for button in readonly.all():
            assert button.is_disabled()
        page.screenshot(path='/workspace/scratch/food-camp-event-observer-weekly.png',full_page=True)
    assert not errors,json.dumps(errors,ensure_ascii=False)
    browser.close()
print('Browser '+os.environ['FC_STACK_STAGE']+' event flow passed with no page errors')
`;
  const output = await command('python',['-c',code],{env:{...process.env,FC_STACK_BASE:base,FC_STACK_STAGE:stage,FC_STACK_ADMIN_COOKIE:adminCookie,FC_STACK_TEAM_ID:teamId}});
  check(output,true);
}

try {
  console.log('Starting isolated event PostgreSQL + PostgREST + Next.js stack…');
  await docker(['network','create',network]); networkCreated=true;
  await docker(['run','--detach','--rm','--network',network,'--name',postgres,'-e',`POSTGRES_PASSWORD=${localPassword}`,'-e','POSTGRES_DB=foodcamp','postgres:16']); createdContainers.push(postgres);
  await ready('PostgreSQL',()=>docker(['exec',postgres,'pg_isready','-h','127.0.0.1','-U','postgres','-d','foodcamp']));
  await sql('create role anon;create role authenticated;create role service_role bypassrls;create schema storage;create table storage.buckets(id text primary key,name text,public boolean);');
  await sql(await readFile(path.join(root,'supabase/schema.sql'),'utf8'));
  await sql(`insert into questions(position,prompt,options,correct_index) values(1,'Event question',array['A','B','C','D'],0);
    insert into hunt_spots(title,hint,secret,tokens) values('Event hunt','test','EVENTSPOT',5);
    insert into photo_missions(title,description,tokens) values('Event photo','test',5);`);
  await docker(['run','--detach','--rm','--network',network,'--name',rest,'-p','127.0.0.1::3000','-e',`PGRST_DB_URI=postgres://postgres:${localPassword}@${postgres}:5432/foodcamp`,'-e','PGRST_DB_SCHEMAS=public','-e','PGRST_DB_ANON_ROLE=anon','-e',`PGRST_JWT_SECRET=${jwtSecret}`,'postgrest/postgrest:v12.2.12']);createdContainers.push(rest);
  const restPort=Number((await docker(['port',rest,'3000/tcp'])).split(':').at(-1));const serviceKey=jwt();
  await ready('PostgREST',async()=>{const response=await fetch(`http://127.0.0.1:${restPort}/game_settings?select=id`,{headers:{Authorization:`Bearer ${serviceKey}`},signal:AbortSignal.timeout(5000)});assert.equal(response.status,200,await response.text());});
  proxy=createServer(async(req,res)=>{try{const target=`http://127.0.0.1:${restPort}${req.url.replace(/^\/rest\/v1(?=\/|$)/,'')||'/'}`;const chunks=[];for await(const chunk of req)chunks.push(chunk);const headers={...req.headers};delete headers.host;if(target.endsWith('/rpc/mg_finish')&&injectedFinishFailures>0){injectedFinishFailures--;res.writeHead(503,{'content-type':'application/json'});res.end(JSON.stringify({code:'TEST_TRANSIENT',message:'Local test interrupted finish RPC'}));return;}const upstream=await fetch(target,{method:req.method,headers,body:chunks.length?Buffer.concat(chunks):undefined});res.writeHead(upstream.status,Object.fromEntries(upstream.headers));res.end(Buffer.from(await upstream.arrayBuffer()));}catch(error){res.writeHead(502);res.end(JSON.stringify({message:error.message}));}});
  await new Promise(resolve=>proxy.listen(0,'127.0.0.1',resolve));const proxyPort=proxy.address().port;
  appDir=await mkdtemp(path.join(tmpdir(),'food-camp-event-stack-'));
  await cp(root,appDir,{recursive:true,filter:source=>{const name=path.basename(source);return !['node_modules','.git','.next'].includes(name)&&(!name.startsWith('.env')||name==='.env.example');}});
  await symlink(path.join(root,'node_modules'),path.join(appDir,'node_modules'),'dir');
  dev=spawn(process.execPath,[path.join(appDir,'node_modules/next/dist/bin/next'),'dev','--hostname','127.0.0.1','--port',String(appPort)],{cwd:appDir,detached:true,env:{...process.env,SUPABASE_URL:`http://127.0.0.1:${proxyPort}`,SUPABASE_SERVICE_ROLE_KEY:serviceKey,CODE_PEPPER:codePepper,SESSION_SECRET:sessionSecret,ADMIN_PASSWORD:adminPassword,STAFF_PASSWORD:'food-camp-local-tests-only-staff',NEXT_TELEMETRY_DISABLED:'1'},stdio:['ignore','pipe','pipe']});
  const log=chunk=>{devLog=(devLog+chunk).slice(-18000);};dev.stdout.on('data',log);dev.stderr.on('data',log);
  await ready('Next.js',async()=>{assert.ok(dev.exitCode==null,`Next exited ${dev.exitCode}`);const response=await fetch(`${base}/api/admin/session`,{signal:AbortSignal.timeout(15000)});assert.equal(response.status,200);});
  check('real isolated event app starts against PostgREST/PostgreSQL',true);
  const admin=new Client(),leader=new Client(),member=new Client(),observer=new Client(),guest=new Client();
  await admin.ok('/api/admin/login',{password:adminPassword});
  await admin.ok('/api/admin/team.save',{name:'STACK Event D'});await admin.ok('/api/admin/team.save',{name:'STACK Other team'});
  const teams=(await admin.ok('/api/admin/teams')).teams;
  const team=teams.find(t=>t.name==='STACK Event D'),otherTeam=teams.find(t=>t.name==='STACK Other team');
  await admin.ok('/api/admin/line.group.save',{team_id:team.team_id,group:'D',name:'เพื่อนร่วมค่าย',url:'https://line.me/ti/g/event-D-original'});
  await admin.ok('/api/admin/participant.save',{name:'Leader One',nick_name:'Leader One',team_id:team.team_id,login_id:'LEADER01',is_leader:true,is_observer:false});
  await admin.ok('/api/admin/participant.save',{name:'Member Two',nick_name:'Member Two',team_id:team.team_id,login_id:'MEMBER02',is_leader:false,is_observer:false});
  await admin.ok('/api/admin/participant.save',{name:'Observer Staff',nick_name:'Observer Staff',team_id:team.team_id,login_id:'OBSERVER01',is_observer:true});
  await admin.ok('/api/admin/participant.save',{name:'Other Member',team_id:otherTeam.team_id,login_id:'OTHER01'});
  const people=(await admin.ok('/api/admin/participants')).participants;
  const pLeader=people.find(p=>p.name==='Leader One'),pMember=people.find(p=>p.name==='Member Two'),pObserver=people.find(p=>p.name==='Observer Staff'),pOther=people.find(p=>p.name==='Other Member');
  assert.ok(pObserver.is_observer);
  const forgedLeader=await admin.call('/api/admin/participant.save',{id:pObserver.id,name:pObserver.name,team_id:team.team_id,is_observer:true,is_leader:true});
  check('admin cannot create an observer leader',[forgedLeader.status,forgedLeader.data.error],[403,'OBSERVER_READ_ONLY']);
  const omittedRole=await admin.call('/api/admin/participant.save',{id:pObserver.id,name:pObserver.name,team_id:team.team_id,is_leader:true});
  check('omitting observer role cannot promote staff or demote the current leader',[omittedRole.status,omittedRole.data.error],[403,'OBSERVER_READ_ONLY']);
  check('rejected observer promotion leaves the actual team leader unchanged',(await admin.ok('/api/admin/participants')).participants.find(p=>p.id===pLeader.id).is_leader,true);
  const compoundRole=await admin.call('/api/admin/participant.save',{id:pObserver.id,name:pObserver.name,team_id:team.team_id,is_observer:false,is_leader:true});
  check('compound role conversion and leader promotion is rejected before demoting the existing leader',[compoundRole.status,compoundRole.data.error],[409,'ROLE_AND_LEADER_CHANGE']);
  check('compound rejection also retains the actual team leader',(await admin.ok('/api/admin/participants')).participants.find(p=>p.id===pLeader.id).is_leader,true);
  await admin.ok('/api/admin/participant.save',{id:pObserver.id,name:pObserver.name,team_id:team.team_id,login_id:'OBSERVER01'});
  check('editing login ID without role field preserves observer classification',(await admin.ok('/api/admin/participants')).participants.find(p=>p.id===pObserver.id).is_observer,true);
  check('non-boolean observer classification is rejected',(await admin.call('/api/admin/participant.save',{id:pObserver.id,name:pObserver.name,team_id:team.team_id,is_observer:'false'})).status,400);
  await admin.ok('/api/admin/game.set',{line_open:true,is_open:true,hunt_open:true,puzzle_open:true,mg_spot_open:true,mg_memory_open:true,mg_mystery_open:true,mg_spot_tokens:17,mg_memory_tokens:23,mg_mystery_tokens:31});
  const weekly=(await admin.ok('/api/admin/minigames')).games;
  check('admin per-game fixed Tokens are returned by actual settings API',[weekly.spot.rewardTokens,weekly.memory.rewardTokens,weekly.mystery.rewardTokens],[17,23,31]);
  check('guest cannot create a squad',(await guest.call('/api/team/squads',{action:'create',name:'Forbidden'})).status,401);
  await leader.ok('/api/login',{id:'LEADER01'});await member.ok('/api/login',{id:'MEMBER02'});await observer.ok('/api/login',{id:'OBSERVER01'});
  let me=await observer.ok('/api/me');
  check('observer gets assigned team screen with observer flag and no leader rights',[me.isObserver,me.isLeader,me.team.name,me.line.total],[true,false,'STACK Event D',2]);
  let roster=await leader.ok('/api/team');
  check('team progress denominator omits observer staff',[roster.total,roster.observerTotal,roster.line.joined,roster.line.missing,roster.line.missingPct],[2,1,0,2,100]);
  check('leader has member IDs and squad management rights',[roster.canManageSquads,!!roster.members.find(p=>p.id===pMember.id),roster.squadOptions.length],[true,true,0]);
  check('observer sees same roster but cannot manage squads',(await observer.ok('/api/team')).canManageSquads,false);
  for(const route of ['/api/start','/api/answer','/api/complete','/api/hunt/claim','/api/redeem','/api/checkin','/api/minigames/spot']){
    const result=await observer.call(route,{action:'start',code:'EVENTSPOT',questionId:'forged',selected:0});
    check(`observer gameplay is rejected by real API ${route}`,[result.status,result.data.error],[403,'OBSERVER_READ_ONLY']);
  }
  check('observer photo submission is rejected before file upload',(await observer.call('/api/photos/submit',{})).status,403);
  check('ordinary member cannot create squads',(await member.call('/api/team/squads',{action:'create',name:'Forbidden'})).status,403);
  check('squad names cannot contain a newline',(await leader.call('/api/team/squads',{action:'create',name:'bad\nname'})).status,400);
  await leader.ok('/api/team/squads',{action:'create',name:'Kitchen A'});
  roster=await leader.ok('/api/team');const squad=roster.squadOptions.find(s=>s.name==='Kitchen A');assert.ok(squad);
  await leader.ok('/api/team/squads',{action:'assign',participantId:pMember.id,squadId:squad.id});
  check('leader assignment is persisted and visible in the team roster',(await leader.ok('/api/team')).members.find(p=>p.id===pMember.id).squadId,squad.id);
  check('cross-team member assignment is refused',(await leader.call('/api/team/squads',{action:'assign',participantId:pOther.id,squadId:squad.id})).status>=400);
  check('leader cannot assign observer staff into a contribution squad',(await leader.call('/api/team/squads',{action:'assign',participantId:pObserver.id,squadId:squad.id})).status>=400);
  await browser('initial');
  roster=await leader.ok('/api/team');
  check('first user button records a real join before LINE navigation',[roster.line.joined,roster.line.total,roster.line.missingPct],[1,2,50]);
  await observer.ok('/api/line/join',{});
  check('observer opening invitation does not change team progress',(await leader.ok('/api/team')).line.joined,1);
  const finalJoin=await member.ok('/api/line/join',{});
  check('last eligible member completes team and earns20 once',[finalJoin.complete,finalJoin.tokens,finalJoin.balance],[true,20,20]);
  const beforeRevision=await leader.ok('/api/me');
  const adminCookie=[...admin.cookies].map(([k,v])=>`${k}=${v}`).join('; ');
  await browser('leader',adminCookie,team.team_id);
  me=await leader.ok('/api/me');
  check('link change increments revision and re-notifies an already joined player',[me.line.revision,me.line.joined,me.line.rejoinRequired],[beforeRevision.line.revision+1,false,true]);
  check('revised LINE group retains prior wallet and rank',[me.team.balance,me.line.tokens,me.line.rank],[20,20,1]);
  roster=await leader.ok('/api/team');
  check('revised link resets eligible join progress only',[roster.line.joined,roster.line.missing,roster.line.missingPct],[0,2,100]);
  await leader.ok('/api/line/join',{});await member.ok('/api/line/join',{});
  check('everyone rejoining updated LINE link does not create a second bonus',(await leader.ok('/api/me')).team.balance,20);
  await browser('observer');

  const partial=await leader.ok('/api/minigames/spot',{action:'start'});
  const failed=await leader.ok('/api/minigames/spot',{action:'finish',attemptId:partial.attemptId,tokens:999999,success:true});
  check('actual game completion API refuses client-provided reward on partial game',[failed.tokens,failed.awarded],[0,0]);
  const full=await leader.ok('/api/minigames/spot',{action:'start'});
  await sql(`update minigame_attempts set state=jsonb_set(state,'{found}','[0,1,2,3,4]'::jsonb),started_at=now() where id='${full.attemptId}';`);
  const reward=await leader.ok('/api/minigames/spot',{action:'finish',attemptId:full.attemptId,tokens:999999});
  check('actual successful mission earns the configured fixed reward',[reward.tokens,reward.awarded],[17,17]);
  const ledgerRows=await sql(`select count(*) from token_ledger where participant_id='${pLeader.id}' and kind='minigame';`);
  check('successful weekly mission credits exactly one ledger row',ledgerRows,'1');
  const replay=JSON.parse(await sql(`select mg_finish('${full.attemptId}',999999,'{}');`));
  check('duplicate finish RPC cannot add a second reward',replay.awarded,0);
  check('observer has no gameplay attempts or awarded ledger rows',await sql(`select (select count(*) from minigame_attempts where participant_id='${pObserver.id}')+(select count(*) from token_ledger where participant_id='${pObserver.id}');`),'0');
  await admin.ok('/api/admin/participant.save',{name:'Recovery Member',team_id:otherTeam.team_id,login_id:'RECOVER01'});
  const recover=new Client();await recover.ok('/api/login',{id:'RECOVER01'});
  const memoryStart=await recover.ok('/api/minigames/memory',{action:'start'});
  await sql(`update minigame_attempts set state=state||'{"matched":[0,1,2,3,4,5,6,7,8,9,10,11],"moves":6,"open":null}'::jsonb where id='${memoryStart.attemptId}';`);
  injectedFinishFailures=1;
  check('interrupted memory finish produces a transient failure without resetting progress',(await recover.call('/api/minigames/memory',{action:'start'})).status,500);
  check('memory completion state survives the failed reward RPC',await sql(`select finished_at is null and jsonb_array_length(state->'matched')=12 from minigame_attempts where id='${memoryStart.attemptId}';`),'t');
  const recoveredMemory=await recover.ok('/api/minigames/memory',{action:'start'});
  check('resuming completed memory retries the finish and awards exactly once',[recoveredMemory.done,recoveredMemory.awarded],[true,23]);
  check('new attempts cannot repeat a successfully awarded memory mission',(await recover.call('/api/minigames/memory',{action:'start'})).status,409);
  const mysteryStart=await recover.ok('/api/minigames/mystery',{action:'start'});
  await sql(`update minigame_attempts set state=state||'{"idx":5,"right":5,"got":[10,10,10,10,10],"shownAt":null}'::jsonb where id='${mysteryStart.attemptId}';`);
  injectedFinishFailures=1;
  check('interrupted mystery finish returns a transient error instead of invalid next-round state',(await recover.call('/api/minigames/mystery',{action:'round',attemptId:mysteryStart.attemptId})).status,500);
  const recoveredMystery=await recover.ok('/api/minigames/mystery',{action:'round',attemptId:mysteryStart.attemptId});
  check('mystery next-round recovery finalizes a completed mission safely',[recoveredMystery.done,recoveredMystery.awarded],[true,31]);
  check('recovery only credits one reward for each completed mission',await sql(`select count(*) from token_ledger l join participants p on p.id=l.participant_id where p.name='Recovery Member' and l.kind='minigame';`),'2');
  const summary=(await admin.ok('/api/admin/teams')).teams.find(t=>t.team_id===team.team_id);
  check('admin summary also excludes observer from participant count',summary.participants,2);
  const adminLine=(await admin.ok('/api/admin/line.groups')).teams.find(t=>t.id===team.team_id);
  check('admin LINE progress excludes observer staff',[adminLine.total,adminLine.joinedCount],[2,2]);

  // Exercise the two real Admin reset flows against a database that reproduces
  // the hosted safe-update error. These fixtures never use the event database.
  const resetItem = randomUUID();
  await sql(`insert into market_items(id,name,price,stock) values('${resetItem}','Reset fixture item',2,5);`);
  await leader.ok('/api/start',{});
  const resetQuiz = await leader.ok('/api/me');
  await leader.ok('/api/answer',{questionId:resetQuiz.current.id,selected:0});
  await leader.ok('/api/complete',{});
  await leader.ok('/api/hunt/claim',{code:'EVENTSPOT'});
  await sql(`select redeem_item('${team.team_id}','${resetItem}',1,'reset-fixture-purchase','test');
    select submit_photo('${pLeader.id}',(select id from photo_missions limit 1),'https://example.test/reset-photo.jpg');`);
  const preservedQuery = `select jsonb_build_object('teams',(select count(*) from teams),'people',(select count(*) from participants),'squads',(select count(*) from squads),'questions',(select count(*) from questions),'spots',(select count(*) from hunt_spots),'missions',(select count(*) from photo_missions),'items',(select count(*) from market_items));`;
  const preserved = await sql(preservedQuery);
  const historyQuery = `select (select count(*) from answers)+(select count(*) from minigame_attempts)+(select count(*) from hunt_claims)+(select count(*) from hunt_scans)+(select count(*) from photo_submissions)+(select count(*) from puzzle_attempts)+(select count(*) from puzzle_solves)+(select count(*) from token_ledger)+(select count(*) from redemptions);`;
  check('reset fixture contains real scored and redeemed history',Number(await sql(historyQuery))>0);
  const wrongConfirm=await admin.call('/api/admin/bulk.delete',{target:'playdata',confirm:'wrong'});
  check('bulk reset still requires the existing explicit confirmation word',wrongConfirm.status,400);
  check('a guest cannot invoke the reset endpoint',(await guest.call('/api/admin/bulk.delete',{target:'teams',confirm:'ลบทั้งหมด'})).status,401);
  check('rejected reset requests leave existing records unchanged',await sql(preservedQuery),preserved);
  const brokenReset = `create or replace function public.reset_line_checkin() returns jsonb language plpgsql security definer set search_path=public as $$ begin raise exception 'UPDATE requires a WHERE clause'; end $$;`;
  await sql(brokenReset);
  const resetPlay=await admin.ok('/api/admin/bulk.delete',{target:'playdata',confirm:'ลบทั้งหมด'});
  check('play-data reset succeeds with the hosted safe-update error',resetPlay.target,'playdata');
  check('play-data reset preserves teams, members, Squads and configured content',await sql(preservedQuery),preserved);
  check('play-data reset clears every gameplay record and wallet entry',await sql(historyQuery),'0');
  check('play-data reset clears LINE ranks and joins',await sql(`select (select count(*) from teams where line_finish_rank is not null or line_reward_tokens<>0)+(select count(*) from participants where line_joined_at is not null);`),'0');
  check('play-data reset restarts profiles without changing observer or leader roles',await sql(`select count(*) from participants where status<>'not_started' or correct_count<>0 or tokens_earned<>0;`),'0');
  check('observer and team leader survive a play-data reset',await sql(`select (select is_observer from participants where id='${pObserver.id}') and (select is_leader from participants where id='${pLeader.id}');`),'t');
  check('all game switches are closed before a reset completes',await sql(`select not(is_open or hunt_open or puzzle_open or market_open or checkin_open or line_open or mg_spot_open or mg_memory_open or mg_mystery_open) from game_settings where id=1;`),'t');
  const schemaForReset=await readFile(path.join(root,'supabase/schema.sql'),'utf8');
  const fixedReset=schemaForReset.match(/create or replace function public\.reset_line_checkin\(\)[\s\S]*?end \$\$;/);
  assert.ok(fixedReset,'stored reset function exists in fresh schema');
  await sql(fixedReset[0]);
  check('qualified stored reset works with the current observer/roster guards',JSON.parse(await sql('select reset_line_checkin();')).ok,true);
  await admin.ok('/api/admin/game.set',{line_open:true,mg_spot_open:true});
  await leader.ok('/api/line/join',{});await member.ok('/api/line/join',{});
  await leader.ok('/api/minigames/spot',{action:'start'});
  await sql(`select redeem_item('${team.team_id}','${resetItem}',1,'reset-fixture-purchase-again','test');`);
  check('fixtures are populated again before deleting teams',Number(await sql(historyQuery))>0);
  await sql(brokenReset);
  const resetTeams=await admin.ok('/api/admin/bulk.delete',{target:'teams',confirm:'ลบทั้งหมด'});
  check('delete-all-teams succeeds with the same hosted safe-update error',resetTeams.target,'teams');
  check('team reset deletes members, observers and Squads in foreign-key order',await sql('select (select count(*) from teams)+(select count(*) from participants)+(select count(*) from squads);'),'0');
  check('team reset deletes all associated activity and redemption history',await sql(historyQuery),'0');
  check('team reset keeps reusable quiz and market content',await sql(`select (select count(*) from questions)>0 and (select count(*) from market_items)>0 and (select count(*) from hunt_spots)>0 and (select count(*) from photo_missions)>0;`),'t');
  const resetAgain=await admin.ok('/api/admin/bulk.delete',{target:'teams',confirm:'ลบทั้งหมด'});
  check('retrying team reset on an empty database is safe',resetAgain.counts.teams,0);

  console.log(`\n${passed} real event-stack checks passed.`);
}catch(error){
  console.error('Event stack failed:',error.message);if(devLog)console.error('Isolated Next logs:\n'+devLog);throw error;
}finally{
  if(dev?.pid){try{process.kill(-dev.pid,'SIGTERM');}catch{}await new Promise(resolve=>{if(dev.exitCode!=null)resolve();else{dev.once('exit',resolve);setTimeout(resolve,3000).unref();}});}
  if(proxy)await new Promise(resolve=>proxy.close(resolve));
  for(const name of createdContainers.reverse()){try{execFileSync('docker',dockerArgs(['rm','-f',name]),{env:dockerEnv,stdio:'ignore'});}catch{}}
  if(networkCreated){try{execFileSync('docker',dockerArgs(['network','rm',network]),{env:dockerEnv,stdio:'ignore'});}catch{}}
  if(appDir)await rm(appDir,{recursive:true,force:true});
}
