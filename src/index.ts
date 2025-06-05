import { Bot, GrammyError, HttpError } from "grammy";
import express from "express";
import dotenv from "dotenv";

dotenv.config();

const BOT_TOKEN = process.env.BOT_TOKEN;
const PORT = process.env.PORT || 3000;
const WEBHOOK_SECRET = process.env.WEBHOOK_SECRET;

if (!BOT_TOKEN) {
  console.error(
    "⛔️ Ошибка: Переменная окружения BOT_TOKEN не установлена в .env файле!"
  );
  process.exit(1);
}

const bot = new Bot(BOT_TOKEN);

bot.command("start", async (ctx) => {
  console.log(
    `🤖 Получена команда /start от пользователя ${
      ctx.from?.username || ctx.from?.first_name
    } (ID: ${ctx.from?.id})`
  );
  await ctx.reply(
    "🚀 Привет! Я ваш бот для уведомлений из GitHub. Чтобы начать, привяжите репозиторий с помощью команды /bindrepo."
  );
});

bot.on("message", async (ctx) => {
  console.log(
    `💬 Получено сообщение от пользователя ${
      ctx.from?.username || ctx.from?.first_name
    } (ID: ${ctx.from?.id}): "${ctx.message?.text}"`
  );
});

bot.catch((err) => {
  const ctx = err.ctx;
  console.error(`🚨 Ошибка при обработке обновления ${ctx.update.update_id}:`);
  const e = err.error;
  if (e instanceof GrammyError) {
    console.error("Telegram API ошибка:", e.description);
  } else if (e instanceof HttpError) {
    console.error("Ошибка HTTP-запроса к Telegram:", e.message);
  } else {
    console.error("Неизвестная ошибка:", e);
  }
});

const app = express();
app.use(express.json());

app.get("/", (req, res) => {
  res.status(200).send("🚀 GitHub Notifications Bot API запущен!");
});

app.post("/webhook", (req, res) => {
  console.log("🔗 Получен запрос на /webhook от GitHub.");
  res.status(200).send("Webhook получен!");
});

bot.start({
  onStart: () => {
    console.log("✅ Telegram-бот запущен в режиме polling...");
  },
});

app.listen(PORT, () => {
  console.log(`🌐 HTTP-сервер запущен на порту ${PORT}`);
  console.log("-----------------------------------------");
  console.log(
    "Бот готов к приему команд в Telegram и вебхуков GitHub (пока только placeholder)."
  );
});
