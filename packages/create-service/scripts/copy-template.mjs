#!/usr/bin/env node
import { cp, rm, mkdir } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const pkgRoot = resolve(here, '..');
const src = resolve(pkgRoot, '..', '..', 'app-template');
const dst = resolve(pkgRoot, 'templates', 'app-template');

await rm(dst, { recursive: true, force: true });
await mkdir(dirname(dst), { recursive: true });
await cp(src, dst, { recursive: true });
console.log(`copied ${src} -> ${dst}`);
