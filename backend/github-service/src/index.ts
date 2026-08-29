import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import githubRoutes from './routes/github.routes';

dotenv.config();

const app = express();
const PORT = process.env.PORT || 8002;

app.use(cors());
app.use(express.json());

// Health check
app.get('/health', (req, res) => {
    res.status(200).json({ status: 'ok', service: 'github-service' });
});

app.use('/api', githubRoutes);

app.listen(PORT, () => {
    console.log(`GitHub Service listening on port ${PORT}`);
});
