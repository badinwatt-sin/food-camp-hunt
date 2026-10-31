import { clearPlayerSession } from '@/lib/auth';
import { checkOrigin, handler, ok } from '@/lib/http';

export const POST = handler(async (req: Request) => {
  checkOrigin(req);
  await clearPlayerSession();
  return ok();
});
