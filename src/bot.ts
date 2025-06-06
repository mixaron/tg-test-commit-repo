import { Bot, InlineKeyboard } from "grammy";
import { config } from "dotenv";
import { PrismaClient } from "@prisma/client";

config();
export const bot = new Bot(process.env.BOT_TOKEN!);
const prisma = new PrismaClient();

bot.command("start", async (ctx) => {
  await ctx.reply("👋 Привет! Я бот для уведомлений о GitHub коммитах.", {
    reply_markup: new InlineKeyboard()
      .text("Добавить репозиторий", "add_repo")
      .row()
      .text("Мои репозитории", "my_repo")
      .row()
      .text("Помощь", "help"),
  });
});

bot.command("help", (ctx) =>
  ctx.reply("📚 Команды:\n/start — запустить\n/addrepo — добавить репозиторий\n/myrepo — список ваших репозиториев")
);

bot.command("addrepo", (ctx) =>
  ctx.reply("✏️ Введите имя репозитория (пример: my-repo):")
);

bot.on("message:text", async (ctx) => {
  const repoName = ctx.message.text.trim();
  const chatId = BigInt(ctx.chat.id);

  if (!repoName.match(/^[a-zA-Z0-9-_]+$/)) {
    return ctx.reply("Неверное имя репозитория.");
  }

  await prisma.repository.create({
    data: {
      name: repoName,
      chatId: chatId,
    },
  });

  await ctx.reply(`Репозиторий *${repoName}* добавлен!`, {
    parse_mode: "Markdown",
  });
});

bot.command("myrepo", async (ctx) => {
  const repos = await prisma.repository.findMany({
    where: { chatId: BigInt(ctx.chat.id) },
  });

  if (repos.length === 0) {
    return ctx.reply("📭 У вас пока нет репозиториев.");
  }

  const text = repos.map((r, i) => `🔹 ${i + 1}. ${r.name}`).join("\n");
  await ctx.reply(`Ваши репозитории:\n${text}`);
});

bot.callbackQuery("add_repo", async (ctx) => {
  await ctx.answerCallbackQuery();
  await ctx.reply("Введите имя репозитория:");
});

bot.callbackQuery("my_repo", async (ctx) => {
  await ctx.answerCallbackQuery();

  const chatId = ctx.callbackQuery.message?.chat.id;
  if (!chatId) {
    return ctx.reply("Не удалось определить чат.");
  }

  const repos = await prisma.repository.findMany({
    where: { chatId: BigInt(chatId) },
  });

  if (repos.length === 0) {
    return ctx.reply("📭 У вас пока нет репозиториев.");
  }

  const text = repos.map((r, i) => `🔹 ${i + 1}. ${r.name}`).join("\n");
  await ctx.reply(`Ваши репозитории:\n${text}`);
});


bot.callbackQuery("help", async (ctx) => {
  await ctx.answerCallbackQuery();
  await ctx.reply("Команды:\n/start — запустить\n/addrepo — добавить репозиторий\n/myrepo — список ваших репозиториев");
});

bot.start();
