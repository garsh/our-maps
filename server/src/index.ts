import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import path from 'path';
import { getDb } from './db';
import mapsRouter from './routes/maps';

const app = express();
const port = process.env.PORT || 3001;

app.use(cors());
app.use(express.json());

// API Routes
app.use('/api/maps', mapsRouter);

app.get('/api/hello', (req, res) => {
  res.json({ message: 'Hello from Our Maps Server!' });
});

// Serve static files from the React app production build
const clientBuildPath = path.join(__dirname, '../../../../client/dist');
app.use(express.static(clientBuildPath));

// The "catchall" handler: for any request that doesn't
// match one above, send back React's index.html file.
app.get('*', (req, res) => {
  if (!req.url.startsWith('/api')) {
    res.sendFile(path.join(clientBuildPath, 'index.html'));
  } else {
    res.status(404).json({ error: 'Not Found' });
  }
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
  app.listen(port as number, '0.0.0.0', () => {
    console.log(`Server is running on http://0.0.0.0:${port}`);
    console.log(`Access locally at http://localhost:${port}`);
  });
}
