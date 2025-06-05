// index.ts
import express from 'express';
import { Bot } from 'grammy';
import crypto from 'crypto';
import dotenv from 'dotenv';
import fs from 'fs';
import path from 'path';
import bodyParser from 'body-parser';

dotenv.config();

const app = express();
app.use(bodyParser.json());

const PORT = process.env.PORT || 3000;
const BOT_TOKEN = process.env.BOT_TOKEN!;
const WEBHOOK_SECRET = process.env.WEBHOOK_SECRET!;

const bot = new Bot(BOT_TOKEN);

// === 1. Привязки репозитория к чату ===
// Симуляция БД
interface Binding {
  repo: string;
  chatId: number;
}

const getBindings = (): Binding[] => {
  const filePath = path.join(__dirname, 'bindings.json');
  const raw = fs.readFileSync(filePath, 'utf8');
  return JSON.parse(raw);
};

// === 2. Проверка подписи Webhook ===
function verifySignature(req: express.Request): boolean {
  const signature = req.headers['x-hub-signature-256'] as string;
  const payload = JSON.stringify(req.body);
  const hmac = crypto.createHmac('sha256', WEBHOOK_SECRET);
  const digest = 'sha256=' + hmac.update(payload).digest('hex');
  return crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(digest));
}

// === 3. Получение webhook от GitHub ===
app.post('/webhook', async (req, res) => {
  if (!verifySignature(req)) {
    console.log('❌ Invalid webhook signature');
    return res.status(403).send('Invalid signature');
  }

  const payload = req.body;

  // Определяем репозиторий
  const fullRepoName = payload.repository.full_name; // eg. "mixaron/test-repo"
  const bindings = getBindings();
  const binding = bindings.find((b) => b.repo === fullRepoName);

  if (!binding) {
    console.log(`ℹ️ Нет привязки для репозитория ${fullRepoName}`);
    return res.status(200).send('No binding');
  }

  const commits = payload.commits;
  const branch = payload.ref.split('/').pop(); // refs/heads/main → main

  for (const commit of commits) {
    const msg = `
📦 *${fullRepoName}* [${branch}]
👤 [${commit.author.name}](${commit.author.email})
📝 ${commit.message}
🔗 [View commit](${commit.url})
    `.trim();

    await bot.api.sendMessage(binding.chatId, msg, { parse_mode: 'Markdown' });
  }

  res.send('OK');
});

// === 4. Простой /ping endpoint ===
app.get('/ping', (_, res) => {
  res.send('pong');
});

// === 5. Запуск сервера ===
app.listen(PORT, () => {
  console.log(`🚀 Listening on http://localhost:${PORT}`);
});
