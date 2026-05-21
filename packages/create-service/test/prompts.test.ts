import { describe, it, expect, vi } from 'vitest';
import { runPrompts } from '../src/prompts.js';
import type { PromptAnswers } from '../src/cli-args.js';

vi.mock('prompts', () => ({
  default: vi.fn(async (questions: unknown) => {
    const qs = Array.isArray(questions) ? questions : [questions];
    const out: Record<string, unknown> = {};
    for (const q of qs as Array<{ name: string; initial?: unknown }>) {
      out[q.name] = q.initial;
    }
    return out;
  }),
}));

describe('runPrompts', () => {
  it('returns answers with defaults using positional service name', async () => {
    const a = await runPrompts({
      defaultServiceName: 'my-loan',
      boundedContextOptions: ['lending', 'deposits'],
    }) as PromptAnswers;
    expect(a.serviceName).toBe('my-loan');
    expect(a.containerPort).toBe(3000);
    expect(a.albPathPattern).toBe('/api/my-loan/*');
    expect(a.environment).toBe('dev');
  });
});
