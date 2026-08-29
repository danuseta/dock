import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import jiraRoutes from './routes/jira.routes';

dotenv.config();

const app = express();
const port = process.env.PORT || 8001;

app.use(cors());
app.use(express.json());

app.use('/api', jiraRoutes);

app.get('/health', (req, res) => {
  res.status(200).json({ status: 'ok', service: 'jira-service' });
});

app.listen(port, () => {
  console.log(`Jira Service listening at http://localhost:${port}`);
});
