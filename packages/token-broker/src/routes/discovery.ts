import { Router } from 'express';
import type { TokenBrokerConfig } from '../config.js';

export function discoveryRouter(config: TokenBrokerConfig): Router {
  const router = Router();
  router.get('/.well-known/openid-configuration', (_req, res) => {
    res.setHeader('cache-control', 'public, max-age=300');
    res.status(200).json({
      issuer: config.brokerIssuerUrl,
      jwks_uri: `${config.brokerIssuerUrl}/.well-known/jwks.json`,
      token_endpoint: `${config.brokerIssuerUrl}/oauth2/token`,
      grant_types_supported: ['urn:ietf:params:oauth:grant-type:token-exchange'],
      token_endpoint_auth_methods_supported: ['client_secret_basic'],
      subject_token_types_supported: [
        'urn:ietf:params:oauth:token-type:access_token',
        'urn:ietf:params:oauth:token-type:jwt',
      ],
      id_token_signing_alg_values_supported: ['RS256'],
    });
  });
  return router;
}
