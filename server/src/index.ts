import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import { getDb } from './db';
import mapsRouter from './routes/maps';

const app = express();
const port = process.env.PORT || 3001;
app.use(express.json());

// Routes
app.use('/api/maps', mapsRouter);

app.get('/api/hello', (req, res) => {
  res.json({ message: 'Hello from Our Maps Server!' });
});

// Global error handler
app.use((err: any, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  console.error('[SERVER ERROR]', err);
  res.status(500).json({ error: 'Internal Server Error', message: err.message });
});

// Initialize DB before starting server
getDb().then(() => {
  if (process.env.NODE_ENV !== 'test') {
    console.log('Database initialized');
  }
}).catch(err => {
  console.error('Failed to initialize database:', err);
});

// Export app for testing
export { app };

// Only listen if not in test mode
if (process.env.NODE_ENV !== 'test') {
  app.listen(port as number, '127.0.0.1', () => {
    console.log(`Server is running on http://127.0.0.1:${port}`);
  });
}
