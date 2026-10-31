export class ApiError extends Error {
  constructor(public status: number, message: string) { super(message); }
}

/** fetch with automatic retry on network errors / 5xx. Safe because the server is idempotent. */
export async function api<T = any>(path: string, body?: unknown, tries = 3): Promise<T> {
  for (let i = 0; i < tries; i++) {
    try {
      const res = await fetch(path, {
        method: body === undefined ? 'GET' : 'POST',
        headers: body === undefined ? undefined : { 'Content-Type': 'application/json' },
        body: body === undefined ? undefined : JSON.stringify(body),
        cache: 'no-store',
        signal: AbortSignal.timeout(20000),   // never spin forever if the network hangs
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok) return data as T;
      if (res.status >= 500 && i < tries - 1) { await new Promise((r) => setTimeout(r, 600 * (i + 1))); continue; }
      throw new ApiError(res.status, data.message ?? 'เกิดข้อผิดพลาด');
    } catch (e) {
      if (e instanceof ApiError) throw e;
      await new Promise((r) => setTimeout(r, 600 * (i + 1)));
    }
  }
  throw new ApiError(0, 'เชื่อมต่อไม่ได้ กรุณาตรวจสอบอินเทอร์เน็ตแล้วลองใหม่ (ข้อมูลของคุณไม่หาย)');
}
