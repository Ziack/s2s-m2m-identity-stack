# S2S onboarding inventory checklist

Fill this out per app before starting Phase 2. The platform team reviews this before approving onboarding.

## App metadata

| Question | Answer |
| --- | --- |
| App name | _______ |
| Owning team | _______ |
| Repo URL | _______ |
| Primary on-call | _______ |
| Target bounded context | _______ |

## Inbound auth

- [ ] Bearer JWT
- [ ] Cookie session
- [ ] mTLS
- [ ] IP allowlist
- [ ] No auth
- [ ] Custom header (free-text): _______

| Question | Answer |
| --- | --- |
| IdP details (issuer, JWKS URI, audience) | _______ |

## Outbound calls

| Target service | Current auth method | On S2S yet? (Y/N) | Bounded context if yes |
| --- | --- | --- | --- |
| _______ | _______ | _______ | _______ |

One row per downstream. If empty, this app has no outbound calls.

## Container shape

- [ ] Base image: _______
- [ ] Runs as root (Y/N): _______
- [ ] Root FS writable (Y/N): _______
- [ ] Env-vars-only secrets (Y/N): _______
- [ ] `/health` endpoint (Y/N): _______
- [ ] `/metrics` endpoint (Y/N): _______
- [ ] SIGTERM handling (Y/N): _______
- [ ] Logging driver: stdout JSON | text | other (_______)

## Authorisation

- [ ] Hardcoded role strings
- [ ] Casbin
- [ ] Permit.io
- [ ] OPA/Rego
- [ ] Custom in-code
- [ ] None

| Question | Answer |
| --- | --- |
| Highest-stakes decision the code makes today and how it's authorised | _______ |

## State

- [ ] Stateless
- [ ] Sticky sessions
- [ ] Local cache
- [ ] On-disk state

| Question | Answer |
| --- | --- |
| If non-stateless, can it be refactored before onboarding? If no, this is a Bespoke profile per §11.7. | _______ |

## Bounded context fit

| Question | Answer |
| --- | --- |
| Which platform-declared bounded context does this service belong to? If none fits, propose a new one and link to the platform RFC PR. | _______ |
