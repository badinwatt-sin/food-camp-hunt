import { NextResponse } from 'next/server';
import { db, audit } from '@/lib/supabase';
import {
  checkAdminPassword, clearAdminSession, getAdminRole, setAdminSession, type AdminRole,
} from '@/lib/auth';
import { goalStatus } from '@/lib/goal';
import crypto from 'crypto';
import { hashCode, normalizeCode, normalizeId } from '@/lib/codes';
import { removeAvatarFile, removePublicFile } from '@/lib/avatars';
import { BULK_CONFIRM, BULK_PLANS, type BulkTarget } from '@/lib/bulk';
import { isLineGroupUrl, LINE_GROUP_CODES } from '@/lib/line-types';
import { checkOrigin, handler, HttpError, ok, rateLimit, readJson } from '@/lib/http';

export const dynamic = 'force-dynamic';

type Ctx = { params: Promise<{ action: string }> };

async function requireRole(min: AdminRole): Promise<AdminRole> {
  const role = await getAdminRole();
  if (!role) throw new HttpError(401, 'UNAUTHORIZED');
  if (min === 'admin' && role !== 'admin') throw new HttpError(403, 'FORBIDDEN');
  return role;
}

/** 8-char code without look-alike letters, shown inside the staff check-in QR code. */
const newCheckinCode = () => Array.from({ length: 8 }, () => 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'[crypto.randomInt(31)]).join('');

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

  if (action === 'minigames') {
    await requireRole('staff');
    const [{ data: s }, { data: rows }, { data: credits }] = await Promise.all([
      sb.from('game_settings').select('*').eq('id', 1).single(),
      sb.from('minigame_attempts').select('game, tokens, finished_at, participant_id, participants(name, nick_name, is_observer, teams(name))'),
      sb.from('token_ledger').select('reason, amount, participant_id, participants(name, nick_name, is_observer, teams(name))').eq('kind', 'minigame'),
    ]);
    const out: Record<string, any> = {};
    for (const g of ['spot', 'memory', 'mystery']) {
      const r = ((rows ?? []) as any[]).filter((x) => x.game === g && !x.participants?.is_observer);
      const best = new Map<string, any>();
      for (const x of ((credits ?? []) as any[]).filter((entry) => entry.reason === g && !entry.participants?.is_observer)) {
        const current = best.get(x.participant_id);
        best.set(x.participant_id, { name: x.participants?.nick_name || x.participants?.name || '', team: x.participants?.teams?.name ?? '', tokens: (current?.tokens ?? 0) + x.amount });
      }
      out[g] = {
        rewardTokens: (s as any)?.[`mg_${g}_tokens`] ?? 10,
        open: !!(s as any)?.[`mg_${g}_open`], players: new Set(r.map((x) => x.participant_id)).size, attempts: r.length, finished: r.filter((x) => x.finished_at).length,
        tokens: [...best.values()].reduce((a, b) => a + b.tokens, 0), top: [...best.values()].sort((a, b) => b.tokens - a.tokens).slice(0, 10),
      };
    }
    return ok({ games: out });
  }

  if (action === 'overview') {
    await requireRole('staff');
    const [{ data: settings }, { data: teams }, { data: leaders }, { data: pend }, { count: pendingPhotos }, { count: checkedIn }] = await Promise.all([
      sb.from('game_settings').select('*').eq('id', 1).single(),
      sb.from('team_summary').select('*').order('name'),
      sb.from('participants').select('team_id, name, nick_name').eq('is_leader', true),
      sb.from('redemptions').select('quantity').is('fulfilled_at', null),
      sb.from('photo_submissions').select('id', { count: 'exact', head: true }).eq('status', 'pending'),
      sb.from('participants').select('id', { count: 'exact', head: true }).eq('is_observer', false).not('checked_in_at', 'is', null),
    ]);
    const leaderOf = new Map((leaders ?? []).map((l: any) => [l.team_id, l.nick_name || l.name]));
    return ok({
      settings,
      teams: (teams ?? []).map((t: any) => ({ ...t, leader: leaderOf.get(t.team_id) ?? null })),
      pendingPickup: (pend ?? []).reduce((n: number, r: any) => n + r.quantity, 0),
      pendingPhotos: pendingPhotos ?? 0,
      checkedIn: checkedIn ?? 0,
    });
  }

  if (action === 'teams') {
    await requireRole('staff');
    const [summary, line] = await Promise.all([
      sb.from('team_summary').select('*').order('name'),
      sb.from('teams').select('*'),
    ]);
    if (summary.error) throw summary.error;
    if (line.error) throw line.error;
    const lineOf = new Map((line.data ?? []).map((t) => [t.id, { line_group_code: t.line_group_code, line_group_name: t.line_group_name ?? null, line_completed_at: t.line_completed_at }]));
    return ok({ teams: (summary.data ?? []).map((t) => ({ ...t, ...lineOf.get(t.team_id) })) });
  }

  if (action === 'line.groups') {
    await requireRole('admin');
    const [settings, teams, people] = await Promise.all([
      sb.from('game_settings').select('line_open').eq('id', 1).single(),
      sb.from('teams').select('*').order('name'),
      sb.from('participants').select('*').order('name'),
    ]);
    if (settings.error) throw settings.error;
    if (teams.error) throw teams.error;
    if (people.error) throw people.error;
    return ok({
      open: !!settings.data?.line_open,
      teams: (teams.data ?? []).map((t) => {
        const members = (people.data ?? []).filter((p) => p.team_id === t.id).map((p) => ({
          id: p.id, name: p.nick_name || p.name, fullName: p.name, joinedAt: p.line_joined_at, isObserver: !!p.is_observer,
        }));
        return { id: t.id, name: t.name, line_group_code: t.line_group_code, line_group_name: t.line_group_name ?? null, line_group_url: t.line_group_url,
          line_completed_at: t.line_completed_at, line_finish_rank: t.line_finish_rank, line_reward_tokens: t.line_reward_tokens, line_revision: t.line_revision ?? 1,
          members, total: members.filter((p) => !p.isObserver).length, joinedCount: members.filter((p) => !p.isObserver && p.joinedAt).length };
      }),
    });
  }

  if (action === 'participants') {
    await requireRole('admin');
    const { data, error } = await sb
      .from('participants')
      .select('*, teams(*), squads(name)')
      .order('name');
    if (error) throw error;
    return ok({
      participants: (data ?? []).map((p: any) => ({
        id: p.id, name: p.name, nick_name: p.nick_name ?? '', is_observer: !!p.is_observer, is_leader: !!p.is_leader, has_avatar: !!p.avatar_url, avatar_url: p.avatar_url ?? null, avatar_emoji: p.avatar_emoji ?? null, team_id: p.team_id, team_name: p.teams?.name ?? '',
        squad_id: p.squad_id ?? null, squad_name: p.squads?.name ?? '',
        status: p.status, has_code: !!p.code_hash, correct_count: p.correct_count,
        tokens_earned: p.tokens_earned, completed_at: p.completed_at,
        line_group_code: p.teams?.line_group_code ?? null, line_group_name: p.teams?.line_group_name ?? null, line_joined_at: p.line_joined_at,
        line_completed_at: p.teams?.line_completed_at ?? null,
      })),
    });
  }

  if (action === 'checkin') {
    // Door staff need this: the QR code to show, who is in and who is still missing.
    await requireRole('staff');
    const [{ data: st }, { data: people }] = await Promise.all([
      sb.from('game_settings').select('checkin_open, checkin_code, checkin_announced_at').eq('id', 1).single(),
      sb.from('participants').select('id, name, nick_name, status, checked_in_at, checked_in_by, team_id, teams(name), squads(name)').eq('is_observer', false).order('name'),
    ]);
    return ok({
      open: !!st?.checkin_open, code: st?.checkin_code ?? null, announcedAt: st?.checkin_announced_at ?? null,
      people: (people ?? []).map((p: any) => ({
        id: p.id, name: p.name, nick_name: p.nick_name ?? '', team_id: p.team_id, team: p.teams?.name ?? '', squad: p.squads?.name ?? '',
        checked_in_at: p.checked_in_at, checked_in_by: p.checked_in_by,
      })),
    });
  }

  if (action === 'badges') {
    // small poll for the side menu: how many team photos are waiting for review
    await requireRole('staff');
    const { count } = await sb.from('photo_submissions').select('id', { count: 'exact', head: true }).eq('status', 'pending');
    return ok({ pendingPhotos: count ?? 0 });
  }

  if (action === 'missions') {
    await requireRole('staff');
    const [{ data: missions }, { data: subs }] = await Promise.all([
      sb.from('photo_missions').select('*').order('position').order('id'),
      sb.from('photo_submissions').select('id, mission_id, image_url, status, tokens, rejected_reason, created_at, reviewed_at, reviewed_by, teams(name), participants(name, nick_name)').order('created_at', { ascending: false }).limit(400),
    ]);
    return ok({
      missions: (missions ?? []).map((m: any) => ({
        ...m,
        done: (subs ?? []).filter((x: any) => x.mission_id === m.id && x.status === 'approved').length,
        pending: (subs ?? []).filter((x: any) => x.mission_id === m.id && x.status === 'pending').length,
      })),
      submissions: (subs ?? []).map((x: any) => ({
        id: x.id, mission_id: x.mission_id, image_url: x.image_url, status: x.status, tokens: x.tokens, reason: x.rejected_reason,
        at: x.created_at, reviewedAt: x.reviewed_at, reviewedBy: x.reviewed_by, team: x.teams?.name ?? '', by: x.participants?.nick_name || x.participants?.name || '',
      })),
      pending: (subs ?? []).filter((x: any) => x.status === 'pending').length,
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
        sb.from('token_ledger').select('team_id, kind, amount').in('kind', ['quiz', 'hunt', 'puzzle', 'minigame']),
        sb.from('redemptions').select('item_name, quantity, created_at, teams(name)').order('created_at', { ascending: false }).limit(10),
        sb.from('participants').select('completed_at, teams(name)').eq('is_observer', false).eq('status', 'completed').order('completed_at', { ascending: false }).limit(10),
        sb.from('photo_submissions').select('reviewed_at, teams(name), photo_missions(title)').eq('status', 'approved').order('reviewed_at', { ascending: false }).limit(10),
      ]);
    const earned = new Map<string, { quiz: number; hunt: number; puzzle: number; minigame: number }>();
    for (const l of (ledger ?? []) as any[]) {
      const e = earned.get(l.team_id) ?? { quiz: 0, hunt: 0, puzzle: 0, minigame: 0 };
      e[l.kind as 'quiz' | 'hunt' | 'puzzle' | 'minigame'] += l.amount;
      earned.set(l.team_id, e);
    }
    const found = new Map<string, number>();
    for (const c of (claims ?? []) as any[]) found.set(c.team_id, (found.get(c.team_id) ?? 0) + 1);
    const feed = [
      ...((claims ?? []) as any[]).slice(0, 10).map((c) => ({ at: c.claimed_at, kind: 'hunt', team: c.teams?.name ?? '', text: `${c.squads?.name ? `(${c.squads.name}) ` : ''}เจอจุด “${c.hunt_spots?.title ?? ''}”` })),
      ...((psolves ?? []) as any[]).map((x) => ({ at: x.reviewed_at, kind: 'puzzle', team: x.teams?.name ?? '', text: `ภารกิจถ่ายภาพผ่าน “${String(x.photo_missions?.title ?? '').slice(0, 40)}”` })),
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
        puzzleTokens: earned.get(t.team_id)?.puzzle ?? 0, miniTokens: earned.get(t.team_id)?.minigame ?? 0,
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
      .select('id, item_id, item_name, quantity, total_cost, confirmed_by, created_at, fulfilled_at, fulfilled_by, teams(name)')
      .order('created_at', { ascending: false }).limit(500);
    return ok({ redemptions: (data ?? []).map((r: any) => ({ ...r, team_name: r.teams?.name ?? '' })) });
  }

  if (action === 'inventory') {
    // What teams have bought and what is still to be handed over, per item and per team.
    await requireRole('staff');
    const { data } = await sb
      .from('redemptions')
      .select('id, item_id, item_name, quantity, fulfilled_at, created_at, team_id, teams(name)')
      .order('created_at', { ascending: true });
    const byItem = new Map<string, any>();
    const byTeam = new Map<string, any>();
    for (const r of (data ?? []) as any[]) {
      const done = !!r.fulfilled_at;
      const it = byItem.get(r.item_name) ?? { item: r.item_name, ordered: 0, handed: 0, pending: 0, teamsPending: new Set<string>() };
      it.ordered += r.quantity; if (done) it.handed += r.quantity; else { it.pending += r.quantity; it.teamsPending.add(r.teams?.name ?? ''); }
      byItem.set(r.item_name, it);
      const tk = `${r.team_id}|${r.item_name}`;
      const tt = byTeam.get(tk) ?? { team: r.teams?.name ?? '', item: r.item_name, ordered: 0, handed: 0, pending: 0, pendingIds: [] as string[] };
      tt.ordered += r.quantity; if (done) tt.handed += r.quantity; else { tt.pending += r.quantity; tt.pendingIds.push(r.id); }
      byTeam.set(tk, tt);
    }
    return ok({
      items: Array.from(byItem.values()).map((i) => ({ ...i, teamsPending: Array.from(i.teamsPending) })).sort((a, b) => b.pending - a.pending),
      teams: Array.from(byTeam.values()).sort((a, b) => a.team.localeCompare(b.team) || a.item.localeCompare(b.item)),
    });
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
      const { data } = await sb.from('participants').select('name, nick_name, status, correct_count, tokens_earned, completed_at, teams(name), squads(name)').order('name');
      rows = [['Full name', 'Nick name', 'Team', 'Squad', 'Status', 'Correct', 'Tokens earned', 'Completed at'],
        ...(data ?? []).map((p: any) => [p.name, p.nick_name ?? '', p.teams?.name, p.squads?.name ?? '', p.status, p.correct_count, p.tokens_earned, p.completed_at])];
    } else if (type === 'redemptions') {
      const { data } = await sb.from('redemptions').select('item_name, unit_price, quantity, total_cost, confirmed_by, created_at, fulfilled_at, teams(name)').order('created_at');
      rows = [['Time', 'Team', 'Item', 'Unit price', 'Quantity', 'Total cost', 'Redeemed by', 'Handed over at'],
        ...(data ?? []).map((r: any) => [r.created_at, r.teams?.name, r.item_name, r.unit_price, r.quantity, r.total_cost, r.confirmed_by, r.fulfilled_at ?? ''])];
    } else if (type === 'adjustments') {
      const { data } = await sb.from('token_ledger').select('amount, reason, created_by, created_at, teams(name)').eq('kind', 'adjustment').order('created_at');
      rows = [['Time', 'Team', 'Amount', 'Reason', 'By'],
        ...(data ?? []).map((r: any) => [r.created_at, r.teams?.name, r.amount, r.reason, r.created_by])];
    } else if (type === 'hunt') {
      const { data } = await sb.from('hunt_claims').select('claimed_at, tokens, teams(name), squads(name), participants(name), hunt_spots(title)').order('claimed_at');
      rows = [['Time', 'Team', 'Squad', 'Spot', 'Found by', 'Tokens'],
        ...(data ?? []).map((r: any) => [r.claimed_at, r.teams?.name, r.squads?.name ?? '', r.hunt_spots?.title, r.participants?.name, r.tokens])];
    } else if (type === 'checkin') {
      const { data } = await sb.from('participants').select('name, nick_name, checked_in_at, checked_in_by, teams(name), squads(name)').eq('is_observer', false).order('name');
      rows = [['Full name', 'Nick name', 'Team', 'Squad', 'Checked in', 'Checked in at', 'How'],
        ...(data ?? []).map((p: any) => [p.name, p.nick_name ?? '', p.teams?.name, p.squads?.name ?? '', p.checked_in_at ? 'yes' : 'no', p.checked_in_at ?? '', p.checked_in_by ?? ''])];
    } else if (type === 'photos') {
      const { data } = await sb.from('photo_submissions').select('created_at, status, tokens, image_url, rejected_reason, reviewed_at, reviewed_by, teams(name), participants(name), photo_missions(title)').order('created_at');
      rows = [['Uploaded at', 'Team', 'Mission', 'Uploaded by (leader)', 'Status', 'Tokens', 'Reviewed at', 'Reviewed by', 'Photo URL', 'Reject reason'],
        ...(data ?? []).map((r: any) => [r.created_at, r.teams?.name, r.photo_missions?.title, r.participants?.name, r.status, r.status === 'approved' ? r.tokens : 0, r.reviewed_at ?? '', r.reviewed_by ?? '', r.image_url, r.rejected_reason ?? ''])];
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

  if (action === 'checkin.mark') {
    // Door staff check people in (or undo it) by hand, e.g. when a phone can't scan.
    const r3 = await requireRole('staff');
    const ids: string[] = (Array.isArray(body.ids) ? body.ids : [body.id]).filter(Boolean).map(String).slice(0, 300);
    if (ids.length === 0) throw new HttpError(400, 'BAD_INPUT');
    const done = body.done !== false;
    const q = done
      ? sb.from('participants').update({ checked_in_at: new Date().toISOString(), checked_in_by: `staff:${r3}` }).in('id', ids).is('checked_in_at', null)  // keep the first time
      : sb.from('participants').update({ checked_in_at: null, checked_in_by: null }).in('id', ids);
    const { error } = await q;
    if (error) throw error;
    await audit(r3, done ? 'checkin.mark' : 'checkin.unmark', { count: ids.length });
    return ok({ updated: ids.length });
  }

  if (action === 'photo.review') {
    // Staff/admin decide on a team photo: approve (tokens go to the team) or reject (no tokens, the leader can retry).
    // Taking back an earlier approval is admin-only.
    const r2 = await requireRole('staff');
    const id = need(str(body.id));
    const approve = body.approve === true;
    const { data: cur } = await sb.from('photo_submissions').select('status').eq('id', id).maybeSingle();
    if (!cur) throw new HttpError(404, 'NOT_FOUND');
    if (cur.status === 'approved' && !approve && r2 !== 'admin') throw new HttpError(403, 'FORBIDDEN');
    const { data, error } = await sb.rpc('review_photo', { p_submission: id, p_approve: approve, p_reason: str(body.reason, 200), p_actor: r2 });
    if (error) throw error;
    return ok(data);
  }

  if (action === 'redemption.fulfill') {
    // Staff (and admins) mark goods as handed over / take it back. Applies to the given redemption ids.
    const role2 = await requireRole('staff');
    const ids: string[] = (Array.isArray(body.ids) ? body.ids : [body.id]).filter(Boolean).map(String).slice(0, 200);
    if (ids.length === 0) throw new HttpError(400, 'BAD_INPUT');
    const done = body.fulfilled !== false;
    const { error } = await sb.from('redemptions')
      .update(done ? { fulfilled_at: new Date().toISOString(), fulfilled_by: role2 } : { fulfilled_at: null, fulfilled_by: null })
      .in('id', ids);
    if (error) throw error;
    await audit(role2, done ? 'redemption.fulfill' : 'redemption.unfulfill', { ids });
    return ok({ updated: ids.length });
  }

  // ---- everything below: administrators only ----
  const role = await requireRole('admin');

  switch (action) {
    case 'adjust': {
      // Clear, specific messages (the form shows them right next to the Save button).
      const amount = Number(body.amount);
      const reason = str(body.reason, 300);
      const fail = (message: string, status = 400) => NextResponse.json({ error: 'BAD_INPUT', message }, { status });
      if (!Number.isInteger(amount) || amount === 0) return fail('กรุณาใส่จำนวนโทเคนเป็นเลขจำนวนเต็ม ไม่เท่ากับ 0');
      if (Math.abs(amount) > 100000) return fail('จำนวนมากเกินไป (สูงสุด 100,000 ต่อครั้ง)');
      if (reason.length < 3) return fail('กรุณาใส่เหตุผลอย่างน้อย 3 ตัวอักษร');
      const key = str(body.key, 100);
      if (key.length < 8) return fail('คำขอไม่สมบูรณ์ กรุณาปิดหน้าต่างแล้วเปิดใหม่');
      const { data, error } = await sb.rpc('adjust_tokens', {
        p_team: need(str(body.team_id)), p_amount: amount, p_reason: reason, p_key: key, p_actor: role,
      });
      if (error) {
        if (String(error.message).includes('INSUFFICIENT_TOKENS')) return fail('หักไม่ได้: โทเคนของทีมมีไม่พอสำหรับจำนวนนี้', 409);
        throw error;
      }
      return ok(data);
    }

    case 'game.set': {
      const patch: Record<string, unknown> = {};
      if (typeof body.is_open === 'boolean') patch.is_open = body.is_open;
      if (typeof body.hunt_open === 'boolean') patch.hunt_open = body.hunt_open;
      if (typeof body.puzzle_open === 'boolean') patch.puzzle_open = body.puzzle_open;
      if (typeof body.market_open === 'boolean') patch.market_open = body.market_open;
      if (typeof body.line_open === 'boolean') patch.line_open = body.line_open;
      for (const k of ['mg_spot_open', 'mg_memory_open', 'mg_mystery_open'] as const) if (typeof body[k] === 'boolean') patch[k] = body[k];
      for (const key of ['mg_spot_tokens', 'mg_memory_tokens', 'mg_mystery_tokens'] as const) {
        if (body[key] === undefined) continue;
        const tokens = int(body[key]);
        if (tokens < 0 || tokens > 100000) throw new HttpError(400, 'BAD_INPUT');
        patch[key] = tokens;
      }
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

    case 'line.group.rename': {
      const teamId = need(str(body.team_id));
      const name = typeof body.name === 'string' ? body.name.trim() : '';
      if (!name || Array.from(name).length > 60 || /[\u0000-\u001f\u007f]/.test(name)) {
        throw new HttpError(400, 'BAD_LINE_GROUP_NAME');
      }
      // A display-name edit never changes the invitation, membership, or awarded score.
      const { data, error } = await sb.from('teams').update({ line_group_name: name }).eq('id', teamId).select('id, line_group_name').maybeSingle();
      if (error) {
        if (error.code === '42703' || error.code === 'PGRST204' || /line_group_name.*(column|schema cache)|(column|schema cache).*line_group_name/i.test(error.message ?? '')) {
          throw new HttpError(409, 'LINE_NAMES_NOT_READY');
        }
        throw error;
      }
      if (!data) throw new HttpError(404, 'NOT_FOUND');
      await audit(role, 'line.group.rename', { team_id: data.id, name: data.line_group_name });
      return ok({ ok: true, name: data.line_group_name });
    }

    case 'line.group.save': {
      const teamId = need(str(body.team_id));
      const group = str(body.group, 20).toUpperCase() || null;
      const url = typeof body.url === 'string' ? body.url.trim() : '';
      if (group && !LINE_GROUP_CODES.some((code) => code === group)) throw new HttpError(400, 'BAD_LINE_GROUP');
      if ((!group && url) || (group && !url)) throw new HttpError(400, 'BAD_LINE_GROUP');
      if (url && (url.length > 2000 || !isLineGroupUrl(url))) throw new HttpError(400, 'BAD_LINE_URL');
      const displayName = body.name === undefined || body.name === null ? null : typeof body.name === 'string' ? body.name.trim() : '';
      if (displayName !== null && (!displayName || Array.from(displayName).length > 60 || /[\u0000-\u001f\u007f]/.test(displayName))) throw new HttpError(400, 'BAD_LINE_GROUP_NAME');
      const { data, error } = body.name === undefined
        ? await sb.rpc('configure_line_group', { p_team: teamId, p_code: group, p_url: url || null })
        : await sb.rpc('configure_line_group_details', { p_team: teamId, p_code: group, p_url: url || null, p_name: displayName });
      if (error) throw error;
      await audit(role, 'line.group.save', { team_id: teamId, group });
      return ok(data);
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
      const nick_name = str(body.nick_name, 60) || null;
      const team_id = need(str(body.team_id));
      if (body.is_observer !== undefined && typeof body.is_observer !== 'boolean') throw new HttpError(400, 'BAD_INPUT');
      const current = body.id ? await sb.from('participants').select('team_id, is_observer').eq('id', body.id).maybeSingle() : { data: null, error: null };
      if (current.error) throw current.error;
      if (body.id && !current.data) throw new HttpError(404, 'NOT_FOUND');
      const isObserver = typeof body.is_observer === 'boolean' ? body.is_observer : !!current.data?.is_observer;
      if (isObserver && body.is_leader === true) throw new HttpError(403, 'OBSERVER_READ_ONLY');
      if (current.data && !!current.data.is_observer !== isObserver && body.is_leader === true) throw new HttpError(409, 'ROLE_AND_LEADER_CHANGE');
      const squad_id: string | null = isObserver ? null : str(body.squad_id) || null;
      if (squad_id) {
        const { data: sq } = await sb.from('squads').select('team_id').eq('id', squad_id).maybeSingle();
        if (!sq || sq.team_id !== team_id) {
          return NextResponse.json({ error: 'BAD_INPUT', message: 'สควอดนี้ไม่ได้อยู่ในทีมที่เลือก' }, { status: 400 });
        }
      }
      const row: Record<string, unknown> = { name, nick_name, team_id, squad_id };
      if (!body.id || typeof body.is_observer === 'boolean') row.is_observer = isObserver;
      if (isObserver) row.is_leader = false;
      if (body.id) {
        if (current.data && current.data.team_id !== team_id) row.is_leader = false; // a leader who changes team is no longer leader
      }
      // The player's login ID: required for a new player; optional when editing (blank = keep the current ID).
      const loginId = normalizeId(body.login_id);
      if (!body.id && !loginId) {
        return NextResponse.json({ error: 'BAD_INPUT', message: 'กรุณาใส่ ID สำหรับเข้าเกมของผู้เล่น' }, { status: 400 });
      }
      if (loginId) row.code_hash = hashCode(loginId);
      if (body.id && loginId) {
        const { data: cur } = await sb.from('participants').select('session_version').eq('id', body.id).single();
        row.session_version = (cur?.session_version ?? 1) + 1; // anyone logged in with the old ID is signed out
      }
      // Leader tick-box: at most one leader per team, so promoting someone demotes the current leader first.
      const wantLeader = body.is_leader === true && !isObserver;
      if (wantLeader) {
        const { error: de } = await sb.from('participants').update({ is_leader: false }).eq('team_id', team_id).eq('is_leader', true);
        if (de) throw de;
        row.is_leader = true;
      } else if (body.id && body.is_leader === false) row.is_leader = false;
      const q = body.id ? sb.from('participants').update(row).eq('id', body.id) : sb.from('participants').insert(row);
      const { data: saved, error } = await q.select('id').maybeSingle();
      void saved;
      if (error) {
        if (String(error.message).includes('duplicate key') && String(error.message).includes('one_leader')) throw new HttpError(409, 'BAD_INPUT');
        if (String(error.message).includes('duplicate')) throw new HttpError(409, 'DUPLICATE_ID');
        throw error;
      }
      await audit(role, 'participant.save', { id: body.id ?? null, idChanged: !!loginId, leader: wantLeader });
      return ok();
    }
    case 'bulk.delete': {
      // Danger zone for rehearsals: wipe a whole group of data in one go. Admin only, and the caller must send the confirm word.
      if (str(body.confirm) !== BULK_CONFIRM) {
        return NextResponse.json({ error: 'BAD_INPUT', message: `ต้องพิมพ์คำว่า “${BULK_CONFIRM}” เพื่อยืนยัน` }, { status: 400 });
      }
      const target = str(body.target) as BulkTarget;
      const plan = BULK_PLANS[target];
      if (!plan) throw new HttpError(400, 'BAD_INPUT');

      // Remember uploaded files first so they can be removed from storage afterwards (best effort).
      const files: { bucket: string; url: string }[] = [];
      if (['missions', 'teams', 'playdata'].includes(target)) {
        const { data } = await sb.from('photo_submissions').select('image_url');
        for (const r of data ?? []) files.push({ bucket: 'mission-photos', url: (r as any).image_url });
      }
      if (target === 'missions') {
        const { data } = await sb.from('photo_missions').select('ref_image_url');
        for (const r of data ?? []) if ((r as any).ref_image_url) files.push({ bucket: 'question-images', url: (r as any).ref_image_url });
      }
      if (target === 'teams') {
        const { data } = await sb.from('participants').select('avatar_url').not('avatar_url', 'is', null);
        for (const r of data ?? []) files.push({ bucket: 'avatars', url: (r as any).avatar_url });
      }

      const counts: Record<string, number> = {};
      if (plan.resetLine) {
        const { error } = await sb.rpc('reset_line_checkin');
        if (error) throw error;
      }
      for (const step of plan.steps) {
        const del = sb.from(step.table).delete({ count: 'exact' });
        const { error, count } = await (step.eq ? del.eq(step.eq[0], step.eq[1]) : del.not('id', 'is', null));
        if (error) throw error;
        counts[step.table] = count ?? 0;
      }
      if (plan.resetPlayers) {
        const { error } = await sb.from('participants')
          .update({ status: 'not_started', correct_count: 0, tokens_earned: 0, confirmed_at: null, completed_at: null, checked_in_at: null, checked_in_by: null }).not('id', 'is', null);
        if (error) throw error;
      }
      if (plan.switchesOff) {
        const { error } = await sb.from('game_settings').update({ is_open: false, hunt_open: false, puzzle_open: false, market_open: false, checkin_open: false, line_open: false, mg_spot_open: false, mg_memory_open: false, mg_mystery_open: false }).eq('id', 1);
        if (error) throw error;
      }
      for (const f of files) await removePublicFile(f.bucket, f.url);
      await audit(role, 'bulk.delete', { target, counts });
      return ok({ target, counts });
    }
    case 'checkin.set': {
      // Open/close event-day check-in, re-announce it to players, or make a new QR code (the old one stops working).
      const { data: cur } = await sb.from('game_settings').select('checkin_open, checkin_code').eq('id', 1).single();
      const patch: Record<string, unknown> = {};
      if (typeof body.open === 'boolean') {
        patch.checkin_open = body.open;
        if (body.open) patch.checkin_announced_at = new Date().toISOString(); // opening = first announcement
      }
      if (body.announce === true) patch.checkin_announced_at = new Date().toISOString();
      if (body.regenerate === true || (patch.checkin_open === true && !cur?.checkin_code)) patch.checkin_code = newCheckinCode();
      if (Object.keys(patch).length === 0) throw new HttpError(400, 'BAD_INPUT');
      const { error } = await sb.from('game_settings').update(patch).eq('id', 1);
      if (error) throw error;
      await audit(role, 'checkin.set', { open: patch.checkin_open ?? null, announce: body.announce === true, regenerate: body.regenerate === true });
      return ok();
    }
    case 'leader.set': {
      // Exactly one leader per team: demote the current one first, then promote the chosen player.
      const { data: p } = await sb.from('participants').select('team_id, name, is_observer').eq('id', body.id).maybeSingle();
      if (!p) throw new HttpError(404, 'NOT_FOUND');
      if (p.is_observer) throw new HttpError(403, 'OBSERVER_READ_ONLY');
      const { error: e1 } = await sb.from('participants').update({ is_leader: false }).eq('team_id', p.team_id).eq('is_leader', true);
      if (e1) throw e1;
      const { error: e2 } = await sb.from('participants').update({ is_leader: true }).eq('id', body.id);
      if (e2) throw e2;
      await audit(role, 'leader.set', { id: body.id, team_id: p.team_id });
      return ok();
    }
    case 'avatar.clear': {
      // Moderation: remove an uploaded profile photo (the player can upload another or pick an emoji).
      const { data: a } = await sb.from('participants').select('avatar_url').eq('id', body.id).maybeSingle();
      const { error } = await sb.from('participants').update({ avatar_url: null, avatar_emoji: null }).eq('id', body.id);
      if (error) throw error;
      await removeAvatarFile(a?.avatar_url);
      await audit(role, 'avatar.clear', { id: body.id });
      return ok();
    }
    case 'leader.clear': {
      const { error } = await sb.from('participants').update({ is_leader: false }).eq('id', body.id);
      if (error) throw error;
      await audit(role, 'leader.clear', { id: body.id });
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
      // Rows come from an Excel sheet: ID, Full name, Nick name, Team (+ optional Squad).
      // Matching is by ID: a known ID updates that person, a new ID adds one. Missing teams/squads are created.
      const input: any[] = Array.isArray(body.rows) ? body.rows : [];
      if (input.length === 0 || input.length > 600) throw new HttpError(400, 'BAD_INPUT');
      const problems: string[] = [];
      type Row = { n: number; id: string; name: string; nick: string | null; team: string; squad: string; leader: boolean };
      const rows: Row[] = [];
      const seen = new Map<string, number>();
      input.forEach((r, k) => {
        const n = k + 1;
        const id = normalizeId(r?.id);
        const name = str(r?.full_name, 100);
        const team = str(r?.team, 60);
        if (!id || !name || !team) { problems.push(`แถว ${n}: ต้องมี ID, Full name และ Team ครบ (${str(r?.full_name, 20)})`); return; }
        if (seen.has(id)) { problems.push(`แถว ${n}: ID ซ้ำกับแถว ${seen.get(id)} (${name})`); return; }
        seen.set(id, n);
        rows.push({ n, id, name, nick: str(r?.nick_name, 60) || null, team, squad: str(r?.squad, 60), leader: r?.leader === true });
      });
      if (problems.length) {
        return NextResponse.json({ error: 'BAD_INPUT', message: 'นำเข้าไม่ได้ กรุณาแก้ไฟล์ก่อน:\n' + problems.slice(0, 12).join('\n') }, { status: 400 });
      }

      const leaders = new Map<string, string>();
      for (const r of rows) if (r.leader) {
        const k = r.team.toLowerCase();
        if (leaders.has(k)) problems.push(`แถว ${r.n}: ทีม ${r.team} มีหัวหน้ามากกว่า 1 คน`); else leaders.set(k, r.name);
      }
      if (problems.length) {
        return NextResponse.json({ error: 'BAD_INPUT', message: 'นำเข้าไม่ได้ กรุณาแก้ไฟล์ก่อน:\n' + problems.slice(0, 12).join('\n') }, { status: 400 });
      }

      // teams (create the missing ones)
      const { data: teamRows } = await sb.from('teams').select('id, name');
      const teamIds = new Map((teamRows ?? []).map((t: any) => [t.name.trim().toLowerCase(), t.id as string]));
      let teamsCreated = 0;
      for (const r of rows) {
        const k = r.team.toLowerCase();
        if (!teamIds.has(k)) {
          const { data: made, error: te } = await sb.from('teams').insert({ name: r.team }).select('id').single();
          if (te) throw te;
          teamIds.set(k, made.id); teamsCreated++;
        }
      }
      // squads (optional column)
      const { data: sqs } = await sb.from('squads').select('id, team_id, name');
      const squadKey = (team_id: string, name: string) => `${team_id}|${name.trim().toLowerCase()}`;
      const squadIds = new Map((sqs ?? []).map((q: any) => [squadKey(q.team_id, q.name), q.id as string]));
      const squadOf = async (r: Row) => {
        if (!r.squad) return undefined;
        const team_id = teamIds.get(r.team.toLowerCase())!;
        const k = squadKey(team_id, r.squad);
        if (!squadIds.has(k)) {
          const { data: made, error: se } = await sb.from('squads').insert({ team_id, name: r.squad }).select('id').single();
          if (se) throw se;
          squadIds.set(k, made.id);
        }
        return squadIds.get(k)!;
      };

      // existing people with these IDs
      const hashes = rows.map((r) => hashCode(r.id));
      const existing = new Map<string, any>();
      for (let k = 0; k < hashes.length; k += 100) {
        const { data } = await sb.from('participants').select('id, team_id, status, code_hash, is_observer').in('code_hash', hashes.slice(k, k + 100));
        for (const e of data ?? []) existing.set(e.code_hash, e);
      }

      let inserted = 0, updated = 0;
      const toInsert: Record<string, unknown>[] = [];
      const skipped: string[] = [];
      for (const r of rows) {
        const h = hashCode(r.id);
        const team_id = teamIds.get(r.team.toLowerCase())!;
        const squad_id = await squadOf(r);
        const e = existing.get(h);
        if (!e) {
          toInsert.push({ name: r.name, nick_name: r.nick, team_id, squad_id: squad_id ?? null, code_hash: h });
          continue;
        }
        const patch: Record<string, unknown> = { name: r.name, nick_name: r.nick };
        if (e.team_id !== team_id) {
          if (e.status === 'not_started') { patch.team_id = team_id; patch.squad_id = squad_id ?? null; }
          else skipped.push(`แถว ${r.n}: ${r.name} เริ่มเล่นแล้ว ไม่ย้ายทีม`);
        } else if (squad_id !== undefined && !e.is_observer) patch.squad_id = squad_id;
        const { error } = await sb.from('participants').update(patch).eq('id', e.id);
        if (error) throw error;
        updated++;
      }
      for (let k = 0; k < toInsert.length; k += 100) {
        const { error } = await sb.from('participants').insert(toInsert.slice(k, k + 100));
        if (error) throw error;
        inserted += Math.min(100, toInsert.length - k);
      }
      // leaders flagged in the sheet (one per team): look people up by ID hash again and promote them
      let leadersSet = 0;
      for (const r of rows.filter((x) => x.leader)) {
        const { data: lp } = await sb.from('participants').select('id, team_id').eq('code_hash', hashCode(r.id)).maybeSingle();
        if (!lp || lp.team_id !== teamIds.get(r.team.toLowerCase())) { skipped.push(`แถว ${r.n}: ตั้ง ${r.name} เป็นหัวหน้าไม่ได้ (ไม่ได้อยู่ในทีมนี้)`); continue; }
        await sb.from('participants').update({ is_leader: false }).eq('team_id', lp.team_id).eq('is_leader', true);
        const { error: le } = await sb.from('participants').update({ is_leader: true }).eq('id', lp.id);
        if (le) throw le;
        leadersSet++;
      }
      await audit(role, 'participants.import', { inserted, updated, teamsCreated, leadersSet, skipped: skipped.length });
      return ok({ inserted, updated, teamsCreated, leadersSet, skipped });
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
      const { data: members, error: me } = await sb.from('participants').select('id, is_observer').eq('team_id', team_id);
      if (me) throw me;
      const ids = (members ?? []).filter((m: any) => !m.is_observer).map((m: any) => m.id as string);
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

    case 'mission.save': {
      const category = ['person', 'object', 'food', 'place', 'other'].includes(body.category) ? body.category : 'other';
      const ref = str(body.ref_image_url, 500);
      if (ref && !imageOk(ref)) throw new HttpError(400, 'BAD_INPUT');
      const tokens = int(body.tokens);
      if (tokens < 0 || tokens > 1000) throw new HttpError(400, 'BAD_INPUT');
      const row = {
        position: int(body.position), title: need(str(body.title, 100)), description: str(body.description, 600),
        category, ref_image_url: ref || null, tokens, active: body.active !== false,
      };
      const q = body.id ? sb.from('photo_missions').update(row).eq('id', body.id) : sb.from('photo_missions').insert(row);
      const { error } = await q;
      if (error) throw error;
      await audit(role, 'mission.save', { id: body.id ?? null, title: row.title });
      return ok();
    }
    case 'mission.delete': {
      const { count } = await sb.from('photo_submissions').select('id', { count: 'exact', head: true }).eq('mission_id', body.id);
      if ((count ?? 0) > 0) {
        await sb.from('photo_missions').update({ active: false }).eq('id', body.id);
        await audit(role, 'mission.deactivate', { id: body.id });
        return ok({ deactivated: true });
      }
      const { error } = await sb.from('photo_missions').delete().eq('id', body.id);
      if (error) throw error;
      await audit(role, 'mission.delete', { id: body.id });
      return ok();
    }

    case 'item.save': {
      const row = {
        name: need(str(body.name, 100)), category: body.category === 'decoration' ? 'decoration' : 'ingredient',
        price: int(body.price), stock: int(body.stock), active: body.active !== false,
        requires_goal: body.requires_goal === true,
        image_url: str(body.image_url, 500) || null,
      };
      if (row.image_url && !imageOk(row.image_url)) throw new HttpError(400, 'BAD_INPUT');
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
