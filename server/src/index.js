import { createApp } from './app.js';
import { config } from './config.js';
import { assertRlsEnforced, pool } from './db.js';
import { verifySmtp } from './mailer.js';

// Checked before accepting a single request: connecting as a role that
// bypasses Row-Level Security would make every policy silently meaningless.
const role = await assertRlsEnforced();

// Best-effort SMTP check — a failure here is logged but does not prevent
// the API from starting (emails will be retried on each send).
await verifySmtp();

const server = createApp().listen(config.port, () => {
  console.log(`API listening on http://localhost:${config.port} (database role: ${role})`);
});

async function shutdown(signal) {
  console.log(`${signal} received, closing`);
  server.close(async () => {
    await pool.end();
    process.exit(0);
  });
  // A stuck connection must not keep the process alive forever.
  setTimeout(() => process.exit(1), 10_000).unref();
}

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
