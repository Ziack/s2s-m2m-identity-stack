import prompts from 'prompts';
import type { PromptAnswers } from './cli-args.js';
import {
  validateServiceName, validateBoundedContext, validateScope,
  validateContainerPort, validateAlbPathPattern, validateEnvironment,
} from './validators.js';

export interface PromptOptions {
  defaultServiceName?: string;
  boundedContextOptions?: string[] | null;
}

export async function runPrompts(opts: PromptOptions): Promise<PromptAnswers> {
  const bcChoices = opts.boundedContextOptions ?? null;

  const answers = await prompts([
    {
      type: 'text',
      name: 'serviceName',
      message: 'Service name (DNS-safe, lowercase)',
      initial: opts.defaultServiceName ?? 'my-service',
      validate: (v: string) => validateServiceName(v).ok || (validateServiceName(v).message ?? 'invalid'),
    },
    bcChoices && bcChoices.length > 0
      ? {
          type: 'select',
          name: 'boundedContext',
          message: 'Bounded context',
          choices: bcChoices.map((c) => ({ title: c, value: c })),
        }
      : {
          type: 'text',
          name: 'boundedContext',
          message: 'Bounded context (free text — AWS creds not detected)',
          initial: 'lending',
          validate: (v: string) => validateBoundedContext(v).ok || 'invalid bounded context',
        },
    {
      type: 'list',
      name: 'scopes',
      message: 'Scopes (comma-separated, <context>/<action>)',
      initial: '',
      separator: ',',
      validate: (v: string) => {
        const items = v.split(',').map((s) => s.trim()).filter(Boolean);
        const bad = items.find((s) => !validateScope(s).ok);
        return bad ? `invalid scope: ${bad}` : true;
      },
    },
    {
      type: 'confirm',
      name: 'makesOutbound',
      message: 'Does this service make outbound exchange calls?',
      initial: false,
    },
    {
      type: (prev: boolean) => (prev ? 'list' : null),
      name: 'outboundAudiences',
      message: 'Outbound audiences (comma-separated bounded contexts)',
      initial: '',
      separator: ',',
    },
    {
      type: 'number',
      name: 'containerPort',
      message: 'Container port',
      initial: 3000,
      validate: (v: number) => validateContainerPort(v).ok || 'must be 1..65535',
    },
    {
      type: 'text',
      name: 'albPathPattern',
      message: 'ALB path pattern',
      initial: opts.defaultServiceName ? `/api/${opts.defaultServiceName}/*` : '/api/my-service/*',
      validate: (v: string) => validateAlbPathPattern(v).ok || 'must start / and end /*',
    },
    {
      type: 'text',
      name: 'environment',
      message: 'Environment',
      initial: 'dev',
      validate: (v: string) => validateEnvironment(v).ok || 'dev|staging|prod',
    },
    {
      type: 'confirm',
      name: 'generateSampleCedar',
      message: 'Generate sample Cedar policy?',
      initial: true,
    },
  ]);

  return {
    serviceName: String(answers.serviceName),
    boundedContext: String(answers.boundedContext),
    scopes: Array.isArray(answers.scopes) ? answers.scopes.map(String) : [],
    containerPort: Number(answers.containerPort ?? 3000),
    albPathPattern: String(answers.albPathPattern),
    environment: String(answers.environment),
    outboundAudiences: Array.isArray(answers.outboundAudiences) ? answers.outboundAudiences.map(String) : [],
    generateSampleCedar: Boolean(answers.generateSampleCedar),
  };
}
