import cors from 'cors';
import express from 'express';
import helmet from 'helmet';
import { requireAuth } from './auth.js';
import { config } from './config.js';
import { pool } from './db.js';
import { HttpError, errorHandler } from './errors.js';
import { adminRouter } from './routes/admin.js';
import { attachmentsRouter } from './routes/attachments.js';
import { authRouter } from './routes/auth.js';
import { budgetRouter } from './routes/budget.js';
import { commentsRouter } from './routes/comments.js';
import { inventoryRouter } from './routes/inventory.js';
import { issuesRouter } from './routes/issues.js';
import { masterRouter } from './routes/master.js';
import { reportsRouter } from './routes/reports.js';
import { requestsRouter } from './routes/requests.js';
import { usersRouter } from './routes/users.js';

export function createApp() {
  const app = express();

  // Behind nginx or IIS on the college server, req.ip must be the client's
  // address — not the proxy's — or every user shares one sign-in rate limit.
  app.set('trust proxy', 'loopback');

  app.use(helmet());
  app.use(cors({
    origin: config.corsOrigins,
    allowedHeaders: ['Authorization', 'Content-Type'],
    exposedHeaders: ['Location', 'Content-Disposition'],
  }));
  app.use(express.json({ limit: '100kb' }));

  // Reports whether the API can reach the database. Unauthenticated, so it
  // says nothing about versions or configuration.
  app.get('/health', async (_req, res) => {
    try {
      await pool.query('SELECT 1');
      res.json({ status: 'ok' });
    } catch {
      res.status(503).json({ status: 'unavailable' });
    }
  });

  app.use('/api/auth', authRouter);

  // Everything below requires a signed-in user.
  const api = express.Router();
  api.use(requireAuth);
  api.use('/admin', adminRouter);
  api.use('/requests/:id/comments', commentsRouter);
  api.use('/requests', requestsRouter);
  api.use('/issues', issuesRouter);
  api.use(budgetRouter);
  api.use(masterRouter);
  api.use(attachmentsRouter);
  api.use(inventoryRouter);
  api.use(reportsRouter);
  api.use(usersRouter);
  app.use('/api', api);

  app.use((req, _res, next) => next(new HttpError(404, `No route for ${req.method} ${req.path}`)));
  app.use(errorHandler);

  return app;
}
