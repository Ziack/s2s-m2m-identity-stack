export interface NextStepsInput {
  targetDir: string;
  serviceName: string;
  environment: string;
}

export function renderNextSteps(i: NextStepsInput): string {
  const lines: string[] = [];
  lines.push('');
  lines.push('Project scaffolded successfully. Next steps:');
  lines.push('');
  if (i.targetDir !== '.') lines.push(`  cd ${i.targetDir}`);
  lines.push('  npm install');
  lines.push('  npm test');
  lines.push('  npm run build');
  lines.push('');
  lines.push('Build + push your container image:');
  lines.push('  docker build -t local/' + i.serviceName + ':dev .');
  lines.push('  # tag + push to the ECR repo the module created');
  lines.push('');
  lines.push('Apply your service infrastructure:');
  lines.push('  cd terraform');
  lines.push('  terraform init');
  lines.push(`  terraform apply -var image_tag=dev -var environment=${i.environment}`);
  lines.push('');
  return lines.join('\n');
}
