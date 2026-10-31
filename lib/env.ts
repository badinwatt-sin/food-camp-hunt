import 'server-only';

export function env(name: string): string {
  const v = process.env[name]?.trim(); // a pasted value may carry a trailing newline/space
  if (!v) throw new Error(`Missing environment variable: ${name}`);
  return v;
}
