#!/usr/bin/env node
import { main } from '../dist/index.js';

main({ cwd: process.cwd(), argv: process.argv.slice(2) })
  .then((code) => process.exit(code))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
