'use client';

import { useCallback, useEffect, useState } from 'react';
import { MG_GAMES, MG_INFO, MG_SUCCESS_RULES, MG_DEFAULT_REWARD, type MgGame } from '@/lib/minigames/config';

type Mission = {
  open: boolean;
  rewardTokens?: number;
  players: number;
  attempts: number;
  finished: number;
  tokens: number;
  top: { name: string; team: string; tokens: number }[];
};
type Data = { games: Record<MgGame, Mission> };

async function call<T>(action: string, body?: unknown): Promise<T> {
  const response = await fetch(`/api/admin/${action}`, {
    method: body === undefined ? 'GET' : 'POST',
    headers: body === undefined ? undefined : { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
    cache: 'no-store', signal: AbortSignal.timeout(20000),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.message || 'บันทึกไม่สำเร็จ กรุณาลองอีกครั้ง');
  return data as T;
}

/** Each mission has a fixed reward; past credits remain unchanged when the setting changes. */
export default function WeeklyMissions({ setMsg }: { setMsg: (message: string) => void }) {
  const [data, setData] = useState<Data | null>(null);
  const [error, setError] = useState('');
  const load = useCallback(async () => {
    try { setData(await call<Data>('minigames')); setError(''); }
    catch (cause) { setError((cause as Error).message); }
  }, []);
  useEffect(() => {
    void load();
    const timer = setInterval(() => { if (document.visibilityState !== 'hidden') void load(); }, 20000);
    return () => clearInterval(timer);
  }, [load]);
  return (
    <>
      <div className="card stack">
        <h2 style={{ margin: 0 }}>🎮 ภารกิจประจำสัปดาห์</h2>
        <p style={{ margin: 0 }}>กำหนดโทเคนของแต่ละภารกิจ สมาชิกต้องทำตามเงื่อนไขสำเร็จจึงได้รับรางวัลเข้ากระเป๋าทีม <strong>ครั้งเดียวต่อคนต่อภารกิจ</strong> ลองได้ภารกิจละ 3 ครั้ง</p>
        <p className="muted" style={{ margin: 0 }}>การแก้จำนวนโทเคนใช้กับผู้ที่ยังไม่ได้รับรางวัล คะแนนที่ได้รับไปแล้วคงเดิม · คณะทำงานดูรายละเอียดได้ แต่ไม่เข้าร่วมเล่นหรือรับรางวัล</p>
        {error && <div className="error" role="alert">{error}<button className="btn small ghost" onClick={() => void load()}>ลองอีกครั้ง</button></div>}
      </div>
      {!data && !error && <div className="spinner" />}
      {data && MG_GAMES.map((game) => <MissionCard key={game} game={game} mission={data.games[game]} reload={load} setMsg={setMsg} />)}
    </>
  );
}

function MissionCard({ game, mission, reload, setMsg }: {
  game: MgGame; mission: Mission; reload: () => Promise<void>; setMsg: (message: string) => void;
}) {
  const reward = mission.rewardTokens ?? MG_DEFAULT_REWARD;
  const [tokens, setTokens] = useState(String(reward));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => { setTokens(String(reward)); }, [reward]);
  const number = Number(tokens);
  const valid = tokens.trim() !== '' && Number.isInteger(number) && number >= 0 && number <= 100000;
  async function save(patch: Record<string, boolean | number>, message: string) {
    setBusy(true); setError('');
    try { await call('game.set', patch); await reload(); setMsg(message); }
    catch (cause) { setError((cause as Error).message); }
    finally { setBusy(false); }
  }
  const info = MG_INFO[game];
  return (
    <section className="card stack" aria-label={`ตั้งค่าภารกิจ ${info.title}`}>
      <div className="row" style={{ justifyContent: 'space-between', gap: 12 }}>
        <div><h2 style={{ margin: 0 }}>{info.icon} {info.title}</h2><div className="muted">{MG_SUCCESS_RULES[game]}</div></div>
        <button className={`btn small ${mission.open ? 'green' : 'ghost'}`} disabled={busy}
          onClick={() => void save({ [`mg_${game}_open`]: !mission.open }, `${mission.open ? 'ปิด' : 'เปิด'}ภารกิจ ${info.title} แล้ว`)}>
          {mission.open ? '🟢 เปิดอยู่ (กดเพื่อปิด)' : '⚪ ปิดอยู่ (กดเพื่อเปิด)'}
        </button>
      </div>
      <form onSubmit={(event) => { event.preventDefault(); if (valid) void save({ [`mg_${game}_tokens`]: number }, `บันทึกรางวัล ${info.title} เป็น ${number} Tokens แล้ว`); }}>
        <div className="row">
          <div>
            <label className="lbl" htmlFor={`weekly-tokens-${game}`}>Tokens เมื่อทำสำเร็จ</label>
            <input id={`weekly-tokens-${game}`} className="field" type="number" inputMode="numeric" min={0} max={100000} step={1}
              value={tokens} disabled={busy} onChange={(event) => setTokens(event.target.value)} style={{ width: 170 }} />
          </div>
          <button className="btn small" type="submit" style={{ alignSelf: 'flex-end' }} disabled={busy || !valid || number === reward}>
            {busy ? 'กำลังบันทึก…' : 'บันทึก Tokens'}
          </button>
          <span className="muted" style={{ alignSelf: 'flex-end', paddingBottom: 8 }}>รับ {reward} Tokens ครั้งเดียวเมื่อสำเร็จ</span>
        </div>
      </form>
      {error && <div className="error" role="alert">{error}</div>}
      <div className="stats">
        <div className="stat"><b>{mission.players}</b><span>สมาชิกที่เข้าร่วม</span></div>
        <div className="stat"><b>{mission.finished}</b><span>รอบที่ทำจบ</span></div>
        <div className="stat"><b>{mission.tokens}</b><span>โทเคนสะสมจากภารกิจ</span></div>
      </div>
      {mission.top?.length > 0 && <details>
        <summary style={{ cursor: 'pointer', fontWeight: 600 }}>ผลงานสมาชิก</summary>
        <div className="table-wrap"><table><thead><tr><th>สมาชิก</th><th>ทีม</th><th>โทเคนที่ได้รับ</th></tr></thead>
          <tbody>{mission.top.map((entry, index) => <tr key={index}><td>{entry.name}</td><td>{entry.team}</td><td>{entry.tokens}</td></tr>)}</tbody>
        </table></div>
      </details>}
    </section>
  );
}
