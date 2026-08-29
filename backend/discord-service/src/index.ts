import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import discordRoutes from './routes/discord.routes';

dotenv.config();

const app = express();
const port = process.env.PORT || 8003;

app.use(cors());
app.use(express.json());

app.use('/api', discordRoutes);

app.get('/health', (req, res) => {
  res.status(200).json({ status: 'ok', service: 'discord-service' });
});

app.listen(port, () => {
  console.log(`Discord service running on port ${port}`);
});
