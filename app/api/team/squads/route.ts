import { db } from '@/lib/supabase';
import { requireMember } from '@/lib/player';
import { checkOrigin, handler, HttpError, ok, rateLimit, readJson } from '@/lib/http';

const uuid = (value: unknown): value is string => typeof value === 'string'
  && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);

/** Leaders can create squads and assign only eligible people in their own team. */
export const POST = handler(async (req: Request) => {
  checkOrigin(req);
  const p = await requireMember();
  if (!p.is_leader) throw new HttpError(403, 'NOT_LEADER');
  rateLimit(req, 'team-squads', 120, 10 * 60 * 1000, p.id);
  const body = await readJson<{ action?: string; name?: unknown; participantId?: unknown; squadId?: unknown }>(req);
  if (!body || (body.action !== 'create' && body.action !== 'assign')) throw new HttpError(400, 'BAD_INPUT');
  let name: string | null = null;
  let member: string | null = null;
  let squad: string | null = null;
  if (body.action === 'create') {
    name = typeof body.name === 'string' ? body.name.trim() : '';
    if (!name || Array.from(name).length > 60 || /[\u0000-\u001f\u007f]/.test(name)) throw new HttpError(400, 'BAD_INPUT');
  } else {
    if (!uuid(body.participantId) || !(body.squadId === null || uuid(body.squadId))) throw new HttpError(400, 'BAD_INPUT');
    member = body.participantId;
    squad = body.squadId;
  }
  const { data, error } = await db().rpc('leader_manage_squad', {
    p_actor: p.id, p_action: body.action, p_name: name, p_member: member, p_squad: squad,
  });
  if (error) throw error;
  return ok(data);
});
