export interface AcquireTokenRawInput {
  cognitoDomain: string;
  clientId: string;
  clientSecret: string;
  scopes: string[];
  fetchImpl?: typeof fetch;
}

export interface CognitoTokenResponse {
  access_token: string;
  expires_in: number;
  scope?: string;
  token_type?: string;
}

export class CognitoTokenError extends Error {
  public readonly status: number;
  public readonly body: string;
  constructor(status: number, body: string) {
    super(`Cognito token endpoint returned status ${status}`);
    this.name = 'CognitoTokenError';
    this.status = status;
    this.body = body;
  }
}

export async function acquireTokenRaw(input: AcquireTokenRawInput): Promise<CognitoTokenResponse> {
  const fetchImpl = input.fetchImpl ?? fetch;
  const url = `${input.cognitoDomain.replace(/\/$/, '')}/oauth2/token`;
  const basic = Buffer.from(`${input.clientId}:${input.clientSecret}`).toString('base64');
  const body = new URLSearchParams({
    grant_type: 'client_credentials',
    scope: input.scopes.join(' '),
  }).toString();
  const res = await fetchImpl(url, {
    method: 'POST',
    headers: {
      'authorization': `Basic ${basic}`,
      'content-type': 'application/x-www-form-urlencoded',
      'accept': 'application/json',
    },
    body,
  });
  if (res.status !== 200) {
    const text = await res.text().catch(() => '');
    throw new CognitoTokenError(res.status, text);
  }
  return (await res.json()) as CognitoTokenResponse;
}
