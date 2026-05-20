import { App } from 'aws-cdk-lib';
import { BOUNDED_CONTEXTS } from '../lib/shared/bounded-contexts';

describe('CDK app bootstrap', () => {
  it('exposes the six bounded contexts in canonical order', () => {
    expect(BOUNDED_CONTEXTS).toEqual([
      'lending',
      'deposits',
      'payments',
      'fraud',
      'notifications',
      'accounts',
    ]);
  });

  it('instantiates an App without errors', () => {
    const app = new App();
    expect(app).toBeDefined();
  });
});
