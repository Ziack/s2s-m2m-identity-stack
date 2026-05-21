import express from 'express';
import passport from 'passport';
import './auth.js';
import { ordersRouter } from './routes.js';

const app = express();
app.use(express.json());
app.use(passport.initialize());
app.use('/api', ordersRouter);

// NOTE: no /health, no /metrics, no SIGTERM handler — see Phase 4 of the migration guide.
const port = Number(process.env.PORT ?? 3000);

/* c8 ignore start */
if (process.env.NODE_ENV !== 'test') {
  app.listen(port, () => console.log(`listening on ${port}`));
}
/* c8 ignore stop */

export { app };
