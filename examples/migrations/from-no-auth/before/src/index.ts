import express from 'express';
import { internalRouter } from './routes.js';

const app = express();
app.use(express.json());
app.use(internalRouter);

const port = Number(process.env.PORT ?? 3000);

/* c8 ignore start */
if (process.env.NODE_ENV !== 'test') {
  app.listen(port, () => console.log(`listening on ${port}`));
}
/* c8 ignore stop */

export { app };
