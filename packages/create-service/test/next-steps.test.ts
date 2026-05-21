import { describe, it, expect } from 'vitest';
import { renderNextSteps } from '../src/next-steps.js';

describe('renderNextSteps', () => {
  it('includes cd, install, build, docker, terraform', () => {
    const out = renderNextSteps({ targetDir: 'my-svc', serviceName: 'my-svc', environment: 'dev' });
    expect(out).toMatch(/cd my-svc/);
    expect(out).toMatch(/npm install/);
    expect(out).toMatch(/npm test/);
    expect(out).toMatch(/docker build/);
    expect(out).toMatch(/terraform init/);
    expect(out).toMatch(/terraform apply/);
  });

  it('omits cd for "."', () => {
    const out = renderNextSteps({ targetDir: '.', serviceName: 'my-svc', environment: 'dev' });
    expect(out).not.toMatch(/^cd \.$/m);
  });
});
