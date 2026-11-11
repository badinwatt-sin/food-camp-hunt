import 'server-only';
import Anthropic from '@anthropic-ai/sdk';
import { z } from 'zod';
import { zodOutputFormat } from '@anthropic-ai/sdk/helpers/zod';
import { colorName } from './color';

/** What the model is asked to say about the picture. Everything else is decided in code. */
const Verdict = z.object({
  person_visible: z.boolean().describe('A real, live human face is clearly visible (a selfie), not a photo of a photo, a screen, a drawing or an empty wall'),
  people_count: z.number().int().describe('How many different people are visible in the picture'),
  is_screen_or_print: z.boolean().describe('The picture shows another photo, a screen, a poster or a printed picture instead of a live person in front of the camera'),
  background_match_percent: z.number().describe('Share (0-100) of the visible BACKGROUND (everything that is not a person) that is the requested colour, in the lighting of the photo'),
  background_description: z.string().describe('Short description of what the background actually is, in Thai'),
  problem_th: z.string().nullable().describe('If the photo should be rejected, one short friendly sentence in Thai telling the player what to fix; otherwise null'),
});
export type AiVerdict = z.infer<typeof Verdict>;

export const aiEnabled = () => !!process.env.ANTHROPIC_API_KEY;

/**
 * Asks Claude to look at the selfie: is there a real person, and how much of the background is the target colour?
 * Returns null when the key is not configured or the call fails — the caller then falls back to the pixel analysis only.
 */
export async function aiCheckSelfie(jpegBytes: Uint8Array, hex: string, percent: number): Promise<AiVerdict | null> {
  if (!aiEnabled()) return null;
  const client = new Anthropic();
  const name = colorName(hex);
  try {
    const res = await client.messages.parse({
      model: process.env.SELFIE_AI_MODEL || 'claude-haiku-5-5',   // small and cheap: ~0.5 satang per photo; override with SELFIE_AI_MODEL
      max_tokens: 1024,
      output_config: { effort: 'low', format: zodOutputFormat(Verdict) },
      messages: [{
        role: 'user',
        content: [
          { type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: Buffer.from(jpegBytes).toString('base64') } },
          { type: 'text', text:
            `This is a selfie for a team-building game. Rule: the player must take a selfie of themselves in front of a background that is ${name} (hex ${hex}); at least ${percent}% of the visible background must be that colour. Shades of the same colour under normal indoor/outdoor lighting count. The picture must show exactly ONE person (the player) live in front of the camera, not a picture of a screen or a print. You are NOT asked to identify anyone or say who they are: only count the people, say whether a person is visible, and measure the background colour. Judge the picture against this rule. Write problem_th in friendly Thai.` },
        ],
      }],
    });
    if (res.stop_reason === 'refusal' || !res.parsed_output) return null;
    return res.parsed_output;
  } catch (e) {
    console.error('[selfie ai]', (e as Error).message);
    return null;
  }
}
