import { Bot, GrammyError, HttpError } from "grammy";
import express from "express";
import dotenv from "dotenv";
import { createHmac } from "crypto";

dotenv.config();

// Интерфейс для хранения привязок репозиториев
interface RepoBinding {
  chatId: number;
  repoUrl: string;
  threadId?: number;
}

// Временное хранилище (в продакшене используйте БД)
const repoBindings: RepoBinding[] = [];

// Проверка переменных окружения
const BOT_TOKEN = process.env.BOT_TOKEN;
const PORT = process.env.PORT || 3000;
const WEBHOOK_SECRET = process.env.WEBHOOK_SECRET;

if (!BOT_TOKEN) {
  console.error("⛔️ Ошибка: BOT_TOKEN не указан в .env файле!");
  process.exit(1);
}

const bot = new Bot(BOT_TOKEN);

// ======================
// Команды бота
// ======================

// Стартовая команда
bot.command("start", async (ctx) => {
  await ctx.reply(
    `🚀 Привет! Я бот для уведомлений из GitHub.\n\n` +
    `Доступные команды:\n` +
    `/bindrepo <url> - привязать репозиторий\n` +
    `/listrepos - список привязанных репозиториев\n` +
    `/help - помощь`
  );
});

// Привязка репозитория
bot.command("bindrepo", async (ctx) => {
  const repoUrl = ctx.match.trim();

  if (!repoUrl) {
    await ctx.reply("❌ Укажите URL репозитория: /bindrepo https://github.com/user/repo");
    return;
  }

  // Проверка формата URL
  if (!/^https:\/\/github\.com\/[^/]+\/[^/]+$/.test(repoUrl)) {
    await ctx.reply("❌ Неверный формат URL. Пример: https://github.com/username/repository");
    return;
  }

  const chatId = ctx.chat?.id;
  if (!chatId) {
    await ctx.reply("❌ Ошибка: не удалось определить чат");
    return;
  }

  // Проверка на существующую привязку
  const exists = repoBindings.some(b => b.chatId === chatId && b.repoUrl === repoUrl);
  if (exists) {
    await ctx.reply("⚠️ Этот репозиторий уже привязан");
    return;
  }

  // Сохраняем привязку
  repoBindings.push({
    chatId,
    repoUrl,
    threadId: ctx.msg?.message_thread_id
  });

  await ctx.reply(`✅ Репозиторий ${repoUrl} успешно привязан!`);
  console.log("Новая привязка:", { chatId, repoUrl });
});

// Список привязанных репозиториев
bot.command("listrepos", async (ctx) => {
  const chatId = ctx.chat?.id;
  if (!chatId) return;

  const bindings = repoBindings.filter(b => b.chatId === chatId);
  if (bindings.length === 0) {
    await ctx.reply("ℹ️ Нет привязанных репозиториев");
    return;
  }

  const list = bindings.map((b, i) => `${i + 1}. ${b.repoUrl}`).join("\n");
  await ctx.reply(`📌 Ваши репозитории:\n${list}`);
});

// Обработка обычных сообщений
bot.on("message", async (ctx) => {
  await ctx.reply("Используйте команды /start или /help");
});

// Обработка ошибок
bot.catch((err) => {
  const ctx = err.ctx;
  console.error(`Ошибка в обновлении ${ctx.update.update_id}:`);
  const e = err.error;
  if (e instanceof GrammyError) {
    console.error("Ошибка Telegram API:", e.description);
  } else if (e instanceof HttpError) {
    console.error("Ошибка HTTP:", e);
  } else {
    console.error("Неизвестная ошибка:", e);
  }
});

// ======================
// HTTP Сервер для вебхуков
// ======================
const app = express();
app.use(express.json());

// Проверка работоспособности
app.get("/", (req, res) => {
  res.send("GitHub Notifier Bot работает!");
});

// Обработка вебхуков от GitHub
app.post("/webhook", async (req, res) => {
  // Проверка подписи (если указан секрет)
  if (WEBHOOK_SECRET) {
    const signature = req.headers["x-hub-signature-256"] as string;
    const payload = JSON.stringify(req.body);
    const expectedSignature = "sha256=" + 
      createHmac("sha256", WEBHOOK_SECRET)
        .update(payload)
        .digest("hex");

    if (signature !== expectedSignature) {
      console.error("⚠️ Неверная подпись вебхука");
      return res.status(403).send("Invalid signature");
    }
  }

  const event = req.headers["x-github-event"];
  const payload = req.body;

  console.log(`Получен вебхук: ${event}`);

  // Обработка push-ивентов
  if (event === "push") {
    const repoUrl = payload.repository.html_url;
    const commits = payload.commits;

    if (commits && commits.length > 0) {
      const bindings = repoBindings.filter(b => b.repoUrl === repoUrl);
      
      for (const commit of commits) {
        const message = `🔔 Новый коммит в ${repoUrl}\n` +
                       `Автор: ${commit.author.name}\n` +
                       `Сообщение: ${commit.message}\n` +
                       `Ссылка: ${commit.url}`;

        // Отправка в привязанные чаты
        for (const binding of bindings) {
          try {
            await bot.api.sendMessage(binding.chatId, message, {
              message_thread_id: binding.threadId
            });
          } catch (error) {
            console.error(`Ошибка отправки в чат ${binding.chatId}:`, error);
          }
        }
      }
    }
  }

  res.status(200).send("OK");
});

// ======================
// Запуск
// ======================
if (process.env.NODE_ENV === "production") {
  // Режим вебхука для продакшена
  app.listen(PORT, () => {
    console.log(`🌐 Сервер запущен на порту ${PORT}`);
    console.log(`🤖 Бот работает в режиме вебхука`);
  });
} else {
  // Режим polling для разработки
  bot.start({
    onStart: () => console.log(`🤖 Бот запущен в режиме polling...`)
  });
  app.listen(PORT, () => console.log(`🌐 Сервер запущен на порту ${PORT}`));
}