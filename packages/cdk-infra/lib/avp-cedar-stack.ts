import { CfnOutput, Stack, StackProps } from 'aws-cdk-lib';
import * as cognito from 'aws-cdk-lib/aws-cognito';
import * as avp from 'aws-cdk-lib/aws-verifiedpermissions';
import { Construct } from 'constructs';
import { BOUNDED_CONTEXTS, BoundedContext, pascal } from './shared/bounded-contexts';

export interface AvpCedarStackProps extends StackProps {
  readonly userPool: cognito.IUserPool;
}

export class AvpCedarStack extends Stack {
  public readonly policyStores: Record<BoundedContext, avp.CfnPolicyStore>;

  constructor(scope: Construct, id: string, props: AvpCedarStackProps) {
    super(scope, id, props);

    const schema = JSON.stringify({
      M2M: {
        entityTypes: {
          ServicePrincipal: { shape: { type: 'Record', attributes: {} } },
          ResourceGroup: { shape: { type: 'Record', attributes: { domain: { type: 'String' } } } },
        },
        actions: {
          read: { appliesTo: { principalTypes: ['ServicePrincipal'], resourceTypes: ['ResourceGroup'] } },
          write: { appliesTo: { principalTypes: ['ServicePrincipal'], resourceTypes: ['ResourceGroup'] } },
        },
      },
    });

    const stores = {} as Record<BoundedContext, avp.CfnPolicyStore>;

    for (const ctx of BOUNDED_CONTEXTS) {
      const store = new avp.CfnPolicyStore(this, `${pascal(ctx)}PolicyStore`, {
        validationSettings: { mode: 'STRICT' },
        description: `${ctx} M2M authorization policies`,
        schema: { cedarJson: schema },
      });

      new avp.CfnIdentitySource(this, `${pascal(ctx)}IdentitySource`, {
        policyStoreId: store.attrPolicyStoreId,
        principalEntityType: 'ServicePrincipal',
        configuration: {
          cognitoUserPoolConfiguration: {
            userPoolArn: props.userPool.userPoolArn,
          },
        },
      });

      const seedPolicy = `permit (\n  principal,\n  action == M2M::Action::"read",\n  resource\n) when {\n  context has dpop_confirmed && context.dpop_confirmed == true &&\n  context has scopes && context.scopes.contains("${ctx}/read")\n};`;

      new avp.CfnPolicy(this, `${pascal(ctx)}SeedPolicy`, {
        policyStoreId: store.attrPolicyStoreId,
        definition: { static: { description: `${ctx} seed read policy`, statement: seedPolicy } },
      });

      new CfnOutput(this, `${pascal(ctx)}PolicyStoreId`, {
        value: store.attrPolicyStoreId,
        exportName: `${this.stackName}-${pascal(ctx)}PolicyStoreId`,
      });

      stores[ctx] = store;
    }
    this.policyStores = stores;
  }
}
