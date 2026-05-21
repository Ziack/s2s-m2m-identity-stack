import { resolve, dirname } from 'node:path';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { parseArgs, type PromptAnswers } from './cli-args.js';
import { runPrompts } from './prompts.js';
import { renderTemplate, assertEmptyDir, RenderError } from './render.js';
import { lookupBoundedContexts } from './ssm.js';
import { renderNextSteps } from './next-steps.js';
import { CLI_VERSION } from './version.js';
import {
  validateServiceName, validateBoundedContext, validateScope,
  validateContainerPort, validateAlbPathPattern, validateEnvironment,
} from './validators.js';

export interface CreateServiceOptions { cwd: string; argv: string[] }

function templateDir(): string {
  if (process.env.S2S_TEMPLATE_DIR) return process.env.S2S_TEMPLATE_DIR;
  const here = dirname(fileURLToPath(import.meta.url));
  return resolve(here, '..', 'templates', 'app-template');
}

function validateAll(a: PromptAnswers): string | null {
  const checks: Array<[string, { ok: boolean; message?: string }]> = [
    ['service-name', validateServiceName(a.serviceName)],
    ['bounded-context', validateBoundedContext(a.boundedContext)],
    ['container-port', validateContainerPort(a.containerPort)],
    ['alb-path', validateAlbPathPattern(a.albPathPattern)],
    ['environment', validateEnvironment(a.environment)],
  ];
  for (const [k, v] of checks) if (!v.ok) return `${k}: ${v.message}`;
  for (const s of a.scopes) {
    const v = validateScope(s);
    if (!v.ok) return `scopes: ${s}: ${v.message}`;
  }
  for (const o of a.outboundAudiences) {
    const v = validateBoundedContext(o);
    if (!v.ok) return `outbound-audiences: ${o}: ${v.message}`;
  }
  return null;
}

function helpText(): string {
  return [
    'Usage: npm create @s2s/service@latest [target-dir] [options]',
    '',
    'Options:',
    '  --non-interactive             Skip all prompts; use flags or --config',
    '  --config=<path>               JSON file with all answers',
    '  --existing-app [dir]          Scaffold only terraform/ + policies/ into existing app',
    '  --force                       Overwrite non-empty target directory',
    '  --service-name=<name>',
    '  --bounded-context=<ctx>',
    '  --scopes=<a,b,c>',
    '  --container-port=<n>',
    '  --alb-path=<pattern>',
    '  --environment=<dev|staging|prod>',
    '  --outbound-audiences=<a,b>',
    '  --generate-sample-cedar=<true|false>',
    '  --region=<aws-region>',
    '  --help',
  ].join('\n');
}

export async function main(opts: CreateServiceOptions): Promise<number> {
  const args = parseArgs(opts.argv);

  if (args.help) { process.stdout.write(helpText() + '\n'); return 0; }
  if (!args.targetDir) { process.stderr.write('Error: target directory required\n' + helpText() + '\n'); return 2; }

  const targetAbs = resolve(opts.cwd, args.targetDir);

  let answers: PromptAnswers;
  if (args.nonInteractive) {
    const fromConfig = args.configPath
      ? JSON.parse(await readFile(resolve(opts.cwd, args.configPath), 'utf8'))
      : {};
    const merged: Partial<PromptAnswers> = { ...fromConfig, ...args.flags };
    answers = {
      serviceName: String(merged.serviceName ?? ''),
      boundedContext: String(merged.boundedContext ?? ''),
      scopes: Array.isArray(merged.scopes) ? merged.scopes : [],
      containerPort: Number(merged.containerPort ?? 3000),
      albPathPattern: String(merged.albPathPattern ?? ''),
      environment: String(merged.environment ?? 'dev'),
      outboundAudiences: Array.isArray(merged.outboundAudiences) ? merged.outboundAudiences : [],
      generateSampleCedar: Boolean(merged.generateSampleCedar ?? true),
    };
  } else {
    const region = args.region ?? process.env.AWS_REGION ?? 'us-east-1';
    const envForLookup = args.flags.environment ?? 'dev';
    const contexts = await lookupBoundedContexts({ environment: envForLookup, region });
    answers = await runPrompts({
      defaultServiceName: args.targetDir.replace(/^.*[\\/]/, '') || 'my-service',
      boundedContextOptions: contexts,
    });
  }

  const err = validateAll(answers);
  if (err) { process.stderr.write(`Validation error: ${err}\n`); return 2; }

  try {
    await assertEmptyDir(targetAbs, args.force || args.existingApp);
  } catch (e) {
    if (e instanceof RenderError) { process.stderr.write(`${e.message}\n`); return 3; }
    throw e;
  }

  const data = {
    ...answers,
    sdkVersion: CLI_VERSION,
    hasOutbound: answers.outboundAudiences.length > 0,
  };

  await renderTemplate({ templateDir: templateDir(), targetDir: targetAbs, data, existingApp: args.existingApp });

  process.stdout.write(renderNextSteps({ targetDir: args.targetDir, serviceName: answers.serviceName, environment: answers.environment }));
  return 0;
}
