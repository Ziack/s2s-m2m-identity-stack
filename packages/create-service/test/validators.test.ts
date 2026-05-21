import { describe, it, expect } from 'vitest';
import {
  validateServiceName,
  validateBoundedContext,
  validateScope,
  validateContainerPort,
  validateAlbPathPattern,
  validateEnvironment,
} from '../src/validators.js';

describe('validateServiceName', () => {
  it.each([
    ['loan-origination', true],
    ['svc', true],
    ['a1b2', true],
    ['UPPER', false],
    ['-leading', false],
    ['trailing-', false],
    ['has_underscore', false],
    ['', false],
    ['a'.repeat(64), false],
  ])('%s -> %s', (input, ok) => {
    expect(validateServiceName(input).ok).toBe(ok);
  });
});

describe('validateBoundedContext', () => {
  it('accepts lower-kebab', () => {
    expect(validateBoundedContext('lending').ok).toBe(true);
  });
  it('rejects upper', () => {
    expect(validateBoundedContext('Lending').ok).toBe(false);
  });
});

describe('validateScope', () => {
  it.each([
    ['lending/read', true],
    ['lending/write', true],
    ['lending/loan-write', true],
    ['lending', false],
    ['/write', false],
    ['lending/', false],
    ['Lending/read', false],
    ['lending/read/extra', false],
  ])('%s -> %s', (input, ok) => {
    expect(validateScope(input).ok).toBe(ok);
  });
});

describe('validateContainerPort', () => {
  it.each([
    [3000, true],
    [80, true],
    [1, true],
    [65535, true],
    [0, false],
    [65536, false],
    [-1, false],
    [3.5, false],
  ])('%s -> %s', (input, ok) => {
    expect(validateContainerPort(input).ok).toBe(ok);
  });
});

describe('validateAlbPathPattern', () => {
  it.each([
    ['/api/loans/*', true],
    ['/*', true],
    ['/api/loans/', false],
    ['api/loans/*', false],
    ['/api/loans', false],
  ])('%s -> %s', (input, ok) => {
    expect(validateAlbPathPattern(input).ok).toBe(ok);
  });
});

describe('validateEnvironment', () => {
  it.each([
    ['dev', true],
    ['staging', true],
    ['prod', true],
    ['Dev', false],
    ['', false],
  ])('%s -> %s', (input, ok) => {
    expect(validateEnvironment(input).ok).toBe(ok);
  });
});
