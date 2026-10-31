import { NextResponse } from 'next/server';
import { db, audit } from '@/lib/supabase';
import {
  checkAdminPassword, clearAdminSession, getAdminRole, setAdminSession, type AdminRole,
} from '@/lib/auth';
import { goalStatus } from '@/lib/goal';
import { formatCode, generateCode, hashCode, normalizeCode } from '@/lib/codes';
import { checkOrigin, handler, HttpError, ok, rateLimit, readJson } from '@/lib/http';

export const dynamic = 'force-dynamic';

type Ctx = { params: Promise<{ action: string }> };

async function requireRole(min: AdminRole): Promise<AdminRole> {
  const role = await getAdminRole();
  if (!role) throw new HttpError(401, 'UNAUTHORIZED');
  if (min === 'admin' && role !== 'admin') throw new HttpError(403, 'FORBIDDEN');
  return role;
}

const str = (v: unknown, max = 200) => String(v ?? '').trim().slice(0, max);
const int = (v: unknown) => {
  const n = Number(v);
  if (!Number.isInteger(n)) throw new HttpError(400, 'BAD_INPUT');
  return n;
};
const need = (v: string) => {
  if (!v) throw new HttpError(400, 'BAD_INPUT');
  return v;
};
const imageOk = (u: string) => u === '' || u.startsWith('/') || /^https:\/\//i.test(u);

function csv(rows: (string | number | null)[][]) {
  const esc = (c: string | number | null) => {
    let s = String(c ?? '');
    if (/^[=+\-@]/.test(s)) s = "'" + s; // neutralise spreadsheet formulas
    return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return '﻿' + rows.map((r) => r.map(esc).join(',')).join('\r\n');
}

// ----------------------------------------------------------------- GET
export const GET = handler(async (req: Request, ctx: Ctx) => {
  const { action } = await ctx.params;
  const sb = db();
  const url = new URL(req.url);

  if (action === 'session') {
    const role = await getAdminRole();
    return ok({ role });
  }

  if (action === 'overview') {
    await requireRole('staff');
    const [{ data: settings }, { data: teams }] = await Promise.all([
      sb.from('game_settings').select('*').eq('id', 1).single(),
      sb.from('team_summary').select('*').order('name'),
    ]);
    return ok({ settings, teams: teams ?? [] });
  }

  if (action === 'teams') {
    await requireRole('staff');
    const { data } = await sb.from('team_summary').select('*').order('name');
    return ok({ teams: data ?? [] });
  }

  if (action === 'participants') {
    await requireRole('admin');
    const { data, error } = await sb
      .from('participants')
      .select('id, name, team_id, squad_id, status, code_hash, correct_count, tokens_earned, completed_at, teams(name), squads(name)')
      .order('name');
    if (error) throw error;
    return ok({
      participants: (data ?? []).map((p: any) => ({
        id: p.id, name: p.name, team_id: p.team_id, team_name: p.teams?.name ?? '',
        squad_id: p.squad_id ?? null, squad_name: p.squads?.name ?? '',
        status: p.status, has_code: !!p.code_hash, correct_count: p.correct_count,
        tokens_earned: p.tokens_earned, completed_at: p.completed_at,
      })),
    });
  }

  if (action === 'puzzles') {
    await requireRole('admin');
    const [{ data: puzzles }, { data: solves }, { data: attempts }] = await Promise.all([
      sb.from('team_puzzles').select('*').order('position').order('id'),
      sb.from('puzzle_solves').select('puzzle_id, tokens, solved_at, teams(name), squads(name), participants(name)').order('solved_at', { ascending: false }).limit(300),
      sb.from('puzzle_attempts').select('puzzle_id, is_correct'),
    ]);
    return ok({
      puzzles: (puzzles ?? []).map((z: any) => ({
        ...z,
        solves: (solves ?? []).filter((x: any) => x.puzzle_id === z.id).length,
        attempts: (attempts ?? []).filter((a: any) => a.puzzle_id === z.id).length,
      })),
      solves: (solves ?? []).map((x: any) => ({ puzzle_id: x.puzzle_id, at: x.solved_at, team: x.teams?.name ?? '', squad: x.squads?.name ?? '', by: x.participants?.name ?? '', tokens: x.tokens })),
    });
  }

  if (action === 'squads') {
    await requireRole('admin');
    const { data } = await sb.from('squads').select('id, team_id, name').order('name');
    return ok({ squads: data ?? [] });
  }

  if (action === 'questions') {
    await requireRole('admin');
    const { data } = await sb.from('questions').select('*').order('position').order('id');
    return ok({ questions: data ?? [] });
  }

  if (action === 'live') {
    // Aggregated, name-free summary for the big screen (staff or admin).
    await requireRole('staff');
    const [{ data: settings }, { data: teams }, { data: spots }, { data: claims }, { data: ledger }, { data: reds }, { data: done }, { data: psolves }] =
      await Promise.all([
        sb.from('game_settings').select('is_open, hunt_open, puzzle_open, team_goal_pct').eq('id', 1).single(),
        sb.from('team_summary').select('*').order('name'),
        sb.from('hunt_spots').select('id').eq('active', true),
        sb.from('hunt_claims').select('team_id, squad_id, claimed_at, hunt_spots(title), teams(name), squads(name)').order('claimed_at', { ascending: false }),
        sb.from('token_ledger').select('team_id, kind, amount').in('kind', ['quiz', 'hunt', 'puzzle']),
        sb.from('redemptions').select('item_name, quantity, created_at, teams(name)').order('created_at', { ascending: false }).limit(10),
        sb.from('participants').select('completed_at, teams(name)').eq('status', 'completed').order('completed_at', { ascending: false }).limit(10),
        sb.from('puzzle_solves').select('solved_at, teams(name), squads(name), team_puzzles(prompt)').order('solved_at', { ascending: false }).limit(10),
      ]);
    const earned = new Map<string, { quiz: number; hunt: number; puzzle: number }>();
    for (const l of (ledger ?? []) as any[]) {
      const e = earned.get(l.team_id) ?? { quiz: 0, hunt: 0, puzzle: 0 };
      e[l.kind as 'quiz' | 'hunt' | 'puzzle'] += l.amount;
      earned.set(l.team_id, e);
    }
    const found = new Map<string, number>();
    for (const c of (claims ?? []) as any[]) found.set(c.team_id, (found.get(c.team_id) ?? 0) + 1);
    const feed = [
      ...((claims ?? []) as any[]).slice(0, 10).map((c) => ({ at: c.claimed_at, kind: 'hunt', team: c.teams?.name ?? '', text: `${c.squads?.name ? `(${c.squads.name}) ` : ''}เจอจุด “${c.hunt_spots?.title ?? ''}”` })),
      ...((psolves ?? []) as any[]).map((x) => ({ at: x.solved_at, kind: 'puzzle', team: x.teams?.name ?? '', text: `${x.squads?.name ? `(${x.squads.name}) ` : ''}ไขภารกิจทีมสำเร็จ “${String(x.team_puzzles?.prompt ?? '').slice(0, 40)}”` })),
      ...((reds ?? []) as any[]).map((r) => ({ at: r.created_at, kind: 'redeem', team: r.teams?.name ?? '', text: `แลก ${r.item_name} ×${r.quantity}` })),
      ...((done ?? []) as any[]).map((p) => ({ at: p.completed_at, kind: 'quiz', team: p.teams?.name ?? '', text: 'สมาชิกเล่นควิซจบ' })),
    ].sort((a, b) => +new Date(b.at) - +new Date(a.at)).slice(0, 12);
    return ok({
      open: !!settings?.is_open, huntOpen: !!settings?.hunt_open, puzzleOpen: !!settings?.puzzle_open, totalSpots: (spots ?? []).length,
      goalPct: settings?.team_goal_pct ?? 0,
      teams: (teams ?? []).map((t: any) => ({
        id: t.team_id, name: t.name, balance: t.balance, spent: t.spent,
        participants: t.participants, completed: t.completed, inProgress: t.in_progress,
        huntFound: found.get(t.team_id) ?? 0, // spot finds by squads (a spot can count once per squad)
        goalNeed: goalStatus(settings?.team_goal_pct ?? 0, t.completed, t.participants).need,
        goalMet: goalStatus(settings?.team_goal_pct ?? 0, t.completed, t.participants).met,
        quizTokens: earned.get(t.team_id)?.quiz ?? 0, huntTokens: earned.get(t.team_id)?.hunt ?? 0,
        puzzleTokens: earned.get(t.team_id)?.puzzle ?? 0,
      })),
      feed,
    });
  }

  if (action === 'hunt') {
    await requireRole('admin');
    const [{ data: spots }, { data: claims }] = await Promise.all([
      sb.from('hunt_spots').select('*').order('position').order('id'),
      sb.from('hunt_claims').select('spot_id, claimed_at, teams(name), squads(name), participants(name)').order('claimed_at', { ascending: false }).limit(300),
    ]);
    return ok({
      spots: spots ?? [],
      claims: (claims ?? []).map((c: any) => ({ spot_id: c.spot_id, at: c.claimed_at, team: c.teams?.name ?? '', squad: c.squads?.name ?? '', by: c.participants?.name ?? '' })),
    });
  }

  if (action === 'market') {
    await requireRole('staff');
    const { data } = await sb.from('market_items').select('*').order('category').order('price');
    return ok({ items: data ?? [] });
  }

  if (action === 'redemptions') {
    await requireRole('staff');
    const { data } = await sb
      .from('redemptions')
      .select('id, item_name, quantity, total_cost, confirmed_by, created_at, teams(name)')
      .order('created_at', { ascending: false }).limit(300);
    return ok({ redemptions: (data ?? []).map((r: any) => ({ ...r, team_name: r.teams?.name ?? '' })) });
  }

  if (action === 'ledger') {
    await requireRole('admin');
    const { data } = await sb
      .from('token_ledger')
      .select('id, kind, amount, reason, created_by, created_at, teams(name)')
      .neq('kind', 'quiz')
      .order('created_at', { ascending: false }).limit(300);
    const { data: logs } = await sb.from('audit_log').select('*').order('created_at', { ascending: false }).limit(200);
    return ok({ ledger: (data ?? []).map((r: any) => ({ ...r, team_name: r.teams?.name ?? '' })), audit: logs ?? [] });
  }

  if (action === 'export') {
    await requireRole('admin');
    const type = url.searchParams.get('type') ?? 'summary';
    let rows: (string | number | null)[][] = [];
    let name = type;
    if (type === 'summary') {
      const { data } = await sb.from('team_summary').select('*').order('name');
      rows = [['Team', 'Participants', 'Completed', 'In progress', 'Tokens spent', 'Balance'],
        ...(data ?? []).map((t: any) => [t.name, t.participants, t.completed, t.in_progress, t.spent, t.balance])];
    } else if (type === 'participants') {
      const { data } = await sb.from('participants').select('name, status, correct_count, tokens_earned, completed_at, teams(name), squads(name)').order('name');
      rows = [['Name', 'Team', 'Squad', 'Status', 'Correct', 'Tokens earned', 'Completed at'],
        ...(data ?? []).map((p: any) => [p.name, p.teams?.name, p.squads?.name ?? '', p.status, p.correct_count, p.tokens_earned, p.completed_at])];
    } else if (type === 'redemptions') {
      const { data } = await sb.from('redemptions').select('item_name, unit_price, quantity, total_cost, confirmed_by, created_at, teams(name)').order('created_at');
      rows = [['Time', 'Team', 'Item', 'Unit price', 'Quantity', 'Total cost', 'Confirmed by'],
        ...(data ?? []).map((r: any) => [r.created_at, r.teams?.name, r.item_name, r.unit_price, r.quantity, r.total_cost, r.confirmed_by])];
    } else if (type === 'adjustments') {
      const { data } = await sb.from('token_ledger').select('amount, reason, created_by, created_at, teams(name)').eq('kind', 'adjustment').order('created_at');
      rows = [['Time', 'Team', 'Amount', 'Reason', 'By'],
        ...(data ?? []).map((r: any) => [r.created_at, r.teams?.name, r.amount, r.reason, r.created_by])];
    } else if (type === 'hunt') {
      const { data } = await sb.from('hunt_claims').select('claimed_at, tokens, teams(name), squads(name), participants(name), hunt_spots(title)').order('claimed_at');
      rows = [['Time', 'Team', 'Squad', 'Spot', 'Found by', 'Tokens'],
        ...(data ?? []).map((r: any) => [r.claimed_at, r.teams?.name, r.squads?.name ?? '', r.hunt_spots?.title, r.participants?.name, r.tokens])];
    } else if (type === 'puzzles') {
      const { data } = await sb.from('puzzle_attempts').select('created_at, is_correct, selected_index, teams(name), squads(name), participants(name), team_puzzles(prompt)').order('created_at');
      rows = [['Time', 'Team', 'Squad', 'Puzzle', 'Answered by', 'Option', 'Correct'],
        ...(data ?? []).map((r: any) => [r.created_at, r.teams?.name, r.squads?.name ?? '', r.team_puzzles?.prompt, r.participants?.name, r.selected_index + 1, r.is_correct ? 'yes' : 'no'])];
    } else throw new HttpError(400, 'BAD_INPUT');
    await audit('admin', 'export', { type });
    return new NextResponse(csv(rows), {
      headers: {
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': `attachment; filename="foodcamp-${name}.csv"`,
      },
    });
  }

  throw new HttpError(404, 'NOT_FOUND');
});

// ---------------------------------------------------------------- POST
export const POST = handler(async (req: Request, ctx: Ctx) => {
  checkOrigin(req);
  const { action } = await ctx.params;
  const sb = db();

  if (action === 'login') {
    rateLimit(req, 'admin-login', 8, 10 * 60 * 1000);
    const body = await readJson<{ password?: string }>(req);
    const role = checkAdminPassword(String(body.password ?? ''));
    if (!role) {
      return NextResponse.json({ error: 'BAD_PASSWORD', message: 'รหัสผ่านไม่ถูกต้อง' }, { status: 401 });
    }
    await setAdminSession(role);
    await audit(role, 'admin_login');
    return ok({ role });
  }
  if (action === 'logout') {
    await clearAdminSession();
    return ok();
  }

  // ---- upload (multipart) ----
  if (action === 'upload') {
    await requireRole('admin');
    const form = await req.formData();
    const file = form.get('file');
    if (!(file instanceof File)) throw new HttpError(400, 'BAD_INPUT');
    const types: Record<string, string> = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp' };
    const ext = types[file.type];
    if (!ext || file.size > 2 * 1024 * 1024) {
      return NextResponse.json({ error: 'BAD_INPUT', message: 'รองรับเฉพาะ PNG/JPG/WebP ขนาดไม่เกิน 2MB' }, { status: 400 });
    }
    const path = `${crypto.randomUUID()}.${ext}`;
    const { error } = await sb.storage.from('question-images').upload(path, await file.arrayBuffer(), { contentType: file.type });
    if (error) throw error;
    const { data } = sb.storage.from('question-images').getPublicUrl(path);
    return ok({ url: data.publicUrl });
  }

  const body = await readJson<any>(req);

  // ---- staff-level actions ----
  if (action === 'redeem') {
    const role = await requireRole('staff');
    const { data, error } = await sb.rpc('redeem_item', {
      p_team: need(str(body.team_id)), p_item: need(str(body.item_id)),
      p_qty: int(body.quantity), p_key: need(str(body.key, 100)), p_actor: role,
    });
    if (error) throw error;
    return ok(data);
  }

  // ---- everything below: administrators only ----
  const role = await requireRole('admin');

  switch (action) {
    case 'adjust': {
      const { data, error } = await sb.rpc('adjust_tokens', {
        p_team: need(str(body.team_id)), p_amount: int(body.amount),
        p_reason: str(body.reason, 300), p_key: need(str(body.key, 100)), p_actor: role,
      });
      if (error) throw error;
      return ok(data);
    }

    case 'game.set': {
      const patch: Record<string, unknown> = {};
      if (typeof body.is_open === 'boolean') patch.is_open = body.is_open;
      if (typeof body.hunt_open === 'boolean') patch.hunt_open = body.hunt_open;
      if (typeof body.puzzle_open === 'boolean') patch.puzzle_open = body.puzzle_open;
      if (body.team_goal_pct !== undefined) {
        const n = int(body.team_goal_pct);
        if (n < 0 || n > 100) throw new HttpError(400, 'BAD_INPUT');
        patch.team_goal_pct = n;
      }
      if (body.tokens_per_correct !== undefined) {
        const n = int(body.tokens_per_correct);
        if (n < 0 || n > 1000) throw new HttpError(400, 'BAD_INPUT');
        patch.tokens_per_correct = n;
      }
      const { error } = await sb.from('game_settings').update(patch).eq('id', 1);
      if (error) throw error;
      await audit(role, 'game.set', patch);
      return ok();
    }

    case 'team.save': {
      const name = need(str(body.name, 60));
      const q = body.id ? sb.from('teams').update({ name }).eq('id', body.id) : sb.from('teams').insert({ name });
      const { error } = await q;
      if (error) throw error;
      await audit(role, 'team.save', { id: body.id ?? null, name });
      return ok();
    }
    case 'team.delete': {
      const { count } = await sb.from('participants').select('id', { count: 'exact', head: true }).eq('team_id', body.id);
      const { count: led } = await sb.from('token_ledger').select('id', { count: 'exact', head: true }).eq('team_id', body.id);
      if ((count ?? 0) > 0 || (led ?? 0) > 0) {
        return NextResponse.json({ error: 'BAD_INPUT', message: 'ลบไม่ได้: ทีมนี้ยังมีผู้เล่นหรือประวัติโทเคน' }, { status: 409 });
      }
      await sb.from('squads').delete().eq('team_id', body.id);
      const { error } = await sb.from('teams').delete().eq('id', body.id);
      if (error) throw error;
      await audit(role, 'team.delete', { id: body.id });
      return ok();
    }

    case 'participant.save': {
      const name = need(str(body.name, 100));
      const team_id = need(str(body.team_id));
      let squad_id: string | null = str(body.squad_id) || null;
      if (squad_id) {
        const { data: sq } = await sb.from('squads').select('team_id').eq('id', squad_id).maybeSingle();
        if (!sq || sq.team_id !== team_id) {
          return NextResponse.json({ error: 'BAD_INPUT', message: 'สควอดนี้ไม่ได้อยู่ในทีมที่เลือก' }, { status: 400 });
        }
      }
      // Moving someone to another team clears the old squad automatically (squad_id is re-validated above).
      const q = body.id
        ? sb.from('participants').update({ name, team_id, squad_id }).eq('id', body.id)
        : sb.from('participants').insert({ name, team_id, squad_id });
      const { error } = await q;
      if (error) throw error;
      await audit(role, 'participant.save', { id: body.id ?? null });
      return ok();
    }
    case 'participant.delete': {
      const { data: p } = await sb.from('participants').select('status').eq('id', body.id).maybeSingle();
      if (!p || p.status !== 'not_started') {
        return NextResponse.json({ error: 'BAD_INPUT', message: 'ลบได้เฉพาะผู้เล่นที่ยังไม่เริ่มเล่น' }, { status: 409 });
      }
      const { error } = await sb.from('participants').delete().eq('id', body.id);
      if (error) throw error;
      await audit(role, 'participant.delete', { id: body.id });
      return ok();
    }
    case 'participants.deleteUnstarted': {
      const { data, error } = await sb.from('participants').delete().eq('status', 'not_started').select('id');
      if (error) throw error;
      await audit(role, 'participants.deleteUnstarted', { count: data?.length ?? 0 });
      return ok({ deleted: data?.length ?? 0 });
    }

    case 'participants.import': {
      // One person per line:  name, team name   (comma or tab separated)
      const { data: teams } = await sb.from('teams').select('id, name');
      const byName = new Map((teams ?? []).map((t: any) => [t.name.trim().toLowerCase(), t.id]));
      const { data: sqs } = await sb.from('squads').select('id, team_id, name');
      const squadKey = (team_id: string, name: string) => `${team_id}|${name.trim().toLowerCase()}`;
      const squadIds = new Map((sqs ?? []).map((q: any) => [squadKey(q.team_id, q.name), q.id as string]));
      const rows: { name: string; team_id: string; squad_id?: string | null; _squad?: string }[] = [];
      const problems: string[] = [];
      String(body.text ?? '').split(/\r?\n/).forEach((line, i) => {
        if (!line.trim()) return;
        const parts = line.split(/\t|,/).map((s) => s.trim());
        const name = parts[0];
        const team = (parts[1] ?? '').toLowerCase();
        if (!name || !byName.has(team)) problems.push(`บรรทัด ${i + 1}: ${line.slice(0, 40)}`);
        else rows.push({ name: name.slice(0, 100), team_id: byName.get(team)!, _squad: (parts[2] ?? '').slice(0, 60) });
      });
      if (problems.length) {
        return NextResponse.json({ error: 'BAD_INPUT', message: 'ไม่พบชื่อทีมในบรรทัดเหล่านี้:\n' + problems.slice(0, 10).join('\n') }, { status: 400 });
      }
      if (rows.length > 300) throw new HttpError(400, 'BAD_INPUT');
      // Third column = squad name; squads that don't exist yet are created for that team.
      for (const r of rows) {
        if (!r._squad) continue;
        const k = squadKey(r.team_id, r._squad);
        if (!squadIds.has(k)) {
          const { data: made, error: se } = await sb.from('squads').insert({ team_id: r.team_id, name: r._squad }).select('id').single();
          if (se) throw se;
          squadIds.set(k, made.id);
        }
        r.squad_id = squadIds.get(k)!;
      }
      const { error } = await sb.from('participants').insert(rows.map(({ _squad, ...r }) => r));
      if (error) throw error;
      await audit(role, 'participants.import', { count: rows.length });
      return ok({ imported: rows.length });
    }

    case 'squad.save': {
      const name = need(str(body.name, 60));
      const q = body.id
        ? sb.from('squads').update({ name }).eq('id', body.id)
        : sb.from('squads').insert({ name, team_id: need(str(body.team_id)) });
      const { error } = await q;
      if (error) throw error;
      await audit(role, 'squad.save', { id: body.id ?? null, name });
      return ok();
    }
    case 'squad.delete': {
      const { count } = await sb.from('hunt_claims').select('id', { count: 'exact', head: true }).eq('squad_id', body.id);
      if ((count ?? 0) > 0) {
        return NextResponse.json({ error: 'BAD_INPUT', message: 'ลบไม่ได้: สควอดนี้มีประวัติล่าสมบัติแล้ว' }, { status: 409 });
      }
      const { error } = await sb.from('squads').delete().eq('id', body.id); // members become "no squad"
      if (error) throw error;
      await audit(role, 'squad.delete', { id: body.id });
      return ok();
    }
    case 'squads.auto': {
      // Randomly split a team into balanced squads of about `size` people (default 5).
      const team_id = need(str(body.team_id));
      const size = Math.min(Math.max(int(body.size ?? 5), 2), 30);
      const { count: used } = await sb.from('hunt_claims').select('id', { count: 'exact', head: true }).eq('team_id', team_id).not('squad_id', 'is', null);
      if ((used ?? 0) > 0) {
        return NextResponse.json({ error: 'BAD_INPUT', message: 'แบ่งใหม่ไม่ได้: ทีมนี้มีประวัติล่าสมบัติของสควอดแล้ว' }, { status: 409 });
      }
      const { data: members, error: me } = await sb.from('participants').select('id').eq('team_id', team_id);
      if (me) throw me;
      const ids = (members ?? []).map((m: any) => m.id as string);
      if (ids.length === 0) throw new HttpError(400, 'BAD_INPUT');
      for (let i = ids.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [ids[i], ids[j]] = [ids[j], ids[i]]; }
      const k = Math.max(1, Math.round(ids.length / size));
      await sb.from('squads').delete().eq('team_id', team_id);
      const { data: made, error: ce } = await sb.from('squads')
        .insert(Array.from({ length: k }, (_, i) => ({ team_id, name: `สควอด ${i + 1}` }))).select('id, name');
      if (ce) throw ce;
      const sorted = (made ?? []).sort((a: any, b: any) => a.name.localeCompare(b.name, 'th', { numeric: true }));
      for (let g = 0; g < k; g++) {
        const chunk = ids.filter((_, i) => i % k === g); // round-robin = sizes differ by at most 1
        if (chunk.length) {
          const { error } = await sb.from('participants').update({ squad_id: sorted[g].id }).in('id', chunk);
          if (error) throw error;
        }
      }
      await audit(role, 'squads.auto', { team_id, squads: k, people: ids.length });
      return ok({ squads: k, people: ids.length });
    }

    case 'codes.generate': {
      // ids given → (re)generate for those people; otherwise everyone without a code who hasn't finished.
      let q = sb.from('participants').select('id, name, teams(name)');
      if (Array.isArray(body.ids) && body.ids.length) q = q.in('id', body.ids);
      else q = q.is('code_hash', null).neq('status', 'completed');
      const { data: people, error } = await q;
      if (error) throw error;
      const out: { name: string; team: string; code: string }[] = [];
      for (const p of (people ?? []) as any[]) {
        for (let attempt = 0; attempt < 5; attempt++) {
          const code = generateCode();
          const { data: cur } = await sb.from('participants').select('session_version').eq('id', p.id).single();
          const { error: e } = await sb.from('participants')
            .update({ code_hash: hashCode(code), session_version: (cur?.session_version ?? 1) + 1 })
            .eq('id', p.id);
          if (!e) { out.push({ name: p.name, team: p.teams?.name ?? '', code: formatCode(code) }); break; }
          if (!String(e.message).includes('duplicate')) throw e;
        }
      }
      await audit(role, 'codes.generate', { count: out.length });
      return ok({ codes: out });
    }
    case 'code.revoke': {
      const { data: cur } = await sb.from('participants').select('session_version').eq('id', body.id).single();
      const { error } = await sb.from('participants')
        .update({ code_hash: null, session_version: (cur?.session_version ?? 1) + 1 }).eq('id', body.id);
      if (error) throw error;
      await audit(role, 'code.revoke', { id: body.id });
      return ok();
    }

    case 'question.save': {
      const options = Array.isArray(body.options) ? body.options.map((o: unknown) => str(o, 120)) : [];
      const image_url = str(body.image_url, 500);
      const correct_index = int(body.correct_index);
      if (options.length !== 4 || options.some((o: string) => !o) || correct_index < 0 || correct_index > 3 || !imageOk(image_url)) {
        throw new HttpError(400, 'BAD_INPUT');
      }
      const row = {
        position: int(body.position), prompt: need(str(body.prompt, 300)),
        image_url: image_url || null, options, correct_index, active: body.active !== false,
      };
      const q = body.id ? sb.from('questions').update(row).eq('id', body.id) : sb.from('questions').insert(row);
      const { error } = await q;
      if (error) throw error;
      await audit(role, 'question.save', { id: body.id ?? null });
      return ok();
    }
    case 'question.delete': {
      const { count } = await sb.from('answers').select('id', { count: 'exact', head: true }).eq('question_id', body.id);
      if ((count ?? 0) > 0) {
        await sb.from('questions').update({ active: false }).eq('id', body.id);
        await audit(role, 'question.deactivate', { id: body.id });
        return ok({ deactivated: true });
      }
      const { error } = await sb.from('questions').delete().eq('id', body.id);
      if (error) throw error;
      await audit(role, 'question.delete', { id: body.id });
      return ok();
    }

    case 'spot.save': {
      const secret = normalizeCode(str(body.secret, 40));
      const tokens = int(body.tokens);
      if (secret.length < 4 || tokens < 0 || tokens > 1000) throw new HttpError(400, 'BAD_INPUT');
      const row = {
        position: int(body.position), title: need(str(body.title, 100)), hint: str(body.hint, 300),
        secret, tokens, active: body.active !== false,
        min_players: int(body.min_players ?? 1), window_sec: int(body.window_sec ?? 180),
      };
      if (row.min_players < 1 || row.min_players > 10 || row.window_sec < 30 || row.window_sec > 1800) throw new HttpError(400, 'BAD_INPUT');
      const q = body.id ? sb.from('hunt_spots').update(row).eq('id', body.id) : sb.from('hunt_spots').insert(row);
      const { error } = await q;
      if (error) {
        if (String(error.message).includes('duplicate')) {
          return NextResponse.json({ error: 'BAD_INPUT', message: 'รหัสจุดนี้ซ้ำกับจุดอื่น กรุณาเปลี่ยน' }, { status: 409 });
        }
        throw error;
      }
      await audit(role, 'spot.save', { id: body.id ?? null, title: row.title, tokens });
      return ok();
    }
    case 'spot.delete': {
      const { count } = await sb.from('hunt_claims').select('id', { count: 'exact', head: true }).eq('spot_id', body.id);
      if ((count ?? 0) > 0) {
        await sb.from('hunt_spots').update({ active: false }).eq('id', body.id);
        await audit(role, 'spot.deactivate', { id: body.id });
        return ok({ deactivated: true });
      }
      const { error } = await sb.from('hunt_spots').delete().eq('id', body.id);
      if (error) throw error;
      await audit(role, 'spot.delete', { id: body.id });
      return ok();
    }

    case 'puzzle.save': {
      const options = Array.isArray(body.options) ? body.options.map((o: unknown) => str(o, 120)) : [];
      const clues = (Array.isArray(body.clues) ? body.clues : []).map((c: unknown) => str(c, 300)).filter(Boolean);
      const correct_index = int(body.correct_index);
      const tokens = int(body.tokens);
      const max_attempts = int(body.max_attempts ?? 2);
      if (options.length !== 4 || options.some((o: string) => !o) || correct_index < 0 || correct_index > 3
          || clues.length < 2 || clues.length > 8 || tokens < 0 || tokens > 1000 || max_attempts < 1 || max_attempts > 4) {
        throw new HttpError(400, 'BAD_INPUT');
      }
      const row = { position: int(body.position), prompt: need(str(body.prompt, 300)), clues, options, correct_index, tokens, max_attempts, active: body.active !== false };
      const q = body.id ? sb.from('team_puzzles').update(row).eq('id', body.id) : sb.from('team_puzzles').insert(row);
      const { error } = await q;
      if (error) throw error;
      await audit(role, 'puzzle.save', { id: body.id ?? null });
      return ok();
    }
    case 'puzzle.delete': {
      const { count } = await sb.from('puzzle_attempts').select('id', { count: 'exact', head: true }).eq('puzzle_id', body.id);
      if ((count ?? 0) > 0) {
        await sb.from('team_puzzles').update({ active: false }).eq('id', body.id);
        await audit(role, 'puzzle.deactivate', { id: body.id });
        return ok({ deactivated: true });
      }
      const { error } = await sb.from('team_puzzles').delete().eq('id', body.id);
      if (error) throw error;
      await audit(role, 'puzzle.delete', { id: body.id });
      return ok();
    }

    case 'item.save': {
      const row = {
        name: need(str(body.name, 100)), category: str(body.category, 30) || 'ingredient',
        price: int(body.price), stock: int(body.stock), active: body.active !== false,
        requires_goal: body.requires_goal === true,
      };
      if (row.price < 1 || row.stock < 0) throw new HttpError(400, 'BAD_INPUT');
      const q = body.id ? sb.from('market_items').update(row).eq('id', body.id) : sb.from('market_items').insert(row);
      const { error } = await q;
      if (error) throw error;
      await audit(role, 'item.save', { id: body.id ?? null, ...row });
      return ok();
    }
    case 'item.delete': {
      const { count } = await sb.from('redemptions').select('id', { count: 'exact', head: true }).eq('item_id', body.id);
      if ((count ?? 0) > 0) {
        await sb.from('market_items').update({ active: false }).eq('id', body.id);
        return ok({ deactivated: true });
      }
      const { error } = await sb.from('market_items').delete().eq('id', body.id);
      if (error) throw error;
      await audit(role, 'item.delete', { id: body.id });
      return ok();
    }
  }

  throw new HttpError(404, 'NOT_FOUND');
});
