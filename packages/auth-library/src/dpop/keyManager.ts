import { generateKeyPair, exportJWK, calculateJwkThumbprint, type KeyLike, type JWK } from 'jose';
import type { PublicJwk } from '../types.js';

interface ActiveKey {
  publicJwk: PublicJwk;
  privateKey: KeyLike;
  thumbprint: string;
  createdAtMs: number;
  retiredAtMs: number | null;
}

const OVERLAP_MS = 2 * 60 * 60 * 1000;
const LIFETIME_MS = 24 * 60 * 60 * 1000;

let _current: ActiveKey | null = null;
let _previous: ActiveKey | null = null;
let _nowFn: () => number = () => Date.now();

function now(): number { return _nowFn(); }

export function _setNowForTest(ms: number): void {
  _nowFn = () => ms;
}
export function _resetKeyManagerForTest(): void {
  _current = null;
  _previous = null;
  _nowFn = () => Date.now();
}

async function generate(): Promise<ActiveKey> {
  const { publicKey, privateKey } = await generateKeyPair('ES256', { extractable: true });
  const jwk = (await exportJWK(publicKey)) as JWK;
  const publicJwk: PublicJwk = {
    kty: 'EC',
    crv: 'P-256',
    x: jwk.x as string,
    y: jwk.y as string,
  };
  const thumbprint = await calculateJwkThumbprint(publicJwk, 'sha256');
  return {
    publicJwk,
    privateKey,
    thumbprint,
    createdAtMs: now(),
    retiredAtMs: null,
  };
}

export async function initKeyPair(): Promise<void> {
  _current = await generate();
  _previous = null;
}

export async function rotateKey(): Promise<void> {
  if (_current === null) throw new Error('keyManager not initialized');
  _previous = { ..._current, retiredAtMs: now() };
  _current = await generate();
}

export function getPublicJwk(): PublicJwk {
  if (_current === null) throw new Error('keyManager not initialized');
  return _current.publicJwk;
}

export function getJwkThumbprint(): string {
  if (_current === null) throw new Error('keyManager not initialized');
  return _current.thumbprint;
}

export function getActivePrivateKey(): KeyLike {
  if (_current === null) throw new Error('keyManager not initialized');
  return _current.privateKey;
}

export function getActiveKeys(): Array<{ thumbprint: string; publicJwk: PublicJwk }> {
  const out: Array<{ thumbprint: string; publicJwk: PublicJwk }> = [];
  if (_current !== null) out.push({ thumbprint: _current.thumbprint, publicJwk: _current.publicJwk });
  if (_previous !== null && _previous.retiredAtMs !== null && now() - _previous.retiredAtMs < OVERLAP_MS) {
    out.push({ thumbprint: _previous.thumbprint, publicJwk: _previous.publicJwk });
  } else {
    _previous = null;
  }
  return out;
}

export function shouldRotate(): boolean {
  if (_current === null) return false;
  return now() - _current.createdAtMs > LIFETIME_MS - 60 * 60 * 1000;
}
