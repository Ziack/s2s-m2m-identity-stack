export interface PromptAnswers {
  serviceName: string;
  boundedContext: string;
  scopes: string[];
  containerPort: number;
  albPathPattern: string;
  environment: string;
  outboundAudiences: string[];
  generateSampleCedar: boolean;
}

export interface CliArgs {
  targetDir: string;
  nonInteractive: boolean;
  configPath?: string;
  existingApp: boolean;
  force: boolean;
  help: boolean;
  region?: string;
  flags: Partial<PromptAnswers>;
}

function takeValue(arg: string): string {
  const i = arg.indexOf('=');
  return i === -1 ? '' : arg.slice(i + 1);
}

export function parseArgs(argv: string[]): CliArgs {
  const out: CliArgs = {
    targetDir: '',
    nonInteractive: false,
    existingApp: false,
    force: false,
    help: false,
    flags: {},
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i] as string;
    if (a === '--help' || a === '-h') out.help = true;
    else if (a === '--non-interactive') out.nonInteractive = true;
    else if (a === '--force') out.force = true;
    else if (a === '--existing-app') {
      out.existingApp = true;
      const next = argv[i + 1];
      if (next && !next.startsWith('--')) { out.targetDir = next; i++; }
      else out.targetDir = '.';
    }
    else if (a.startsWith('--config=')) out.configPath = takeValue(a);
    else if (a.startsWith('--region=')) out.region = takeValue(a);
    else if (a.startsWith('--service-name=')) out.flags.serviceName = takeValue(a);
    else if (a.startsWith('--bounded-context=')) out.flags.boundedContext = takeValue(a);
    else if (a.startsWith('--scopes=')) out.flags.scopes = takeValue(a).split(',').filter(Boolean);
    else if (a.startsWith('--container-port=')) out.flags.containerPort = Number(takeValue(a));
    else if (a.startsWith('--alb-path=')) out.flags.albPathPattern = takeValue(a);
    else if (a.startsWith('--environment=')) out.flags.environment = takeValue(a);
    else if (a.startsWith('--outbound-audiences=')) out.flags.outboundAudiences = takeValue(a).split(',').filter(Boolean);
    else if (a.startsWith('--generate-sample-cedar=')) out.flags.generateSampleCedar = takeValue(a) === 'true';
    else if (!a.startsWith('-') && !out.targetDir) out.targetDir = a;
  }
  return out;
}
