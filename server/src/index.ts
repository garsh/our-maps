import express from 'express';
import cors from 'cors';
import { getDb } from './db';
import mapsRouter from './routes/maps';

const app = express();
const port = process.env.PORT || 3001;

app.use(cors());
app.use(express.json());

// Routes
app.use('/api/maps', mapsRouter);

app.get('/api/hello', (req, res) => {
  res.json({ message: 'Hello from Our Maps Server!' });
});

// Initialize DB before starting server
getDb().then(() => {
  if (process.env.NODE_ENV !== 'test') {
    console.log('Database initialized');
  }
});

// Export app for testing
export { app };

// Only listen if not in test mode
if (process.env.NODE_ENV !== 'test') {
  app.listen(port, () => {
    console.log(`Server is running on http://localhost:${port}`);
  });
}
