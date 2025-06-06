import { Bot, InlineKeyboard, Keyboard } from "grammy";

import { config } from "dotenv";
import { PrismaClient } from "@prisma/client";

config();
export const bot = new Bot(process.env.BOT_TOKEN!);
const prisma = new PrismaClient();

bot.command("start", async (ctx) => {
  const userId = BigInt(Number(ctx.from?.id));
  const userName = ctx.from?.username;

  await prisma.user.upsert({
    where: { telegramId: userId },
    update: {},
    create: {
      telegramId: userId,
      telegramName: userName || null,
    },
  });

  const replyMarkup = {
    keyboard: [
      [{ text: "/addrepo" }],
      [{ text: "/myrepo" }],
      [{ text: "/help" }],                           
    ],
    resize_keyboard: true,
    one_time_keyboard: false,

  };


  await ctx.reply("👋 Привет! Я бот для уведомлений о GitHub коммитах. Выберите опцию:", {
    reply_markup: replyMarkup,
  });
});

bot.command("help", (ctx) =>
  ctx.reply("Команды:\n/start — запустить\n/addrepo — добавить репозиторий\n/myrepo — список ваших репозиториев")
);

bot.command("addrepo", (ctx) =>
  ctx.reply("Введите полное имя репозитория (пример: user/my-repo):")
);

bot.on("message:text", async (ctx) => {
  const input = ctx.message.text.trim();
  const telegramId = BigInt(ctx.from?.id);
  const chatId = BigInt(ctx.chat?.id);

  if (input.startsWith("/")) return;

  if (!input.match(/^[a-zA-Z0-9_.-]+\/[a-zA-Z0-9_.-]+$/)) {
    return ctx.reply("Неверное имя. Формат: `user/repo-name`", {
      parse_mode: "Markdown",
    });
  }

  const fullName = input;
  const githubUrl = `https://github.com/${fullName}`;
  const name = fullName.split("/").pop()!;

  try {
    const repo = await prisma.repository.upsert({
      where: { fullName },
      update: {},
      create: {
        name,
        fullName,
        githubUrl,
        chatId,
      },
    });

    await prisma.chatBinding.upsert({
      where: {
        repositoryId_chatId: {
          repositoryId: repo.id,
          chatId: chatId,
        },
      },
      update: {},
      create: {
        repositoryId: repo.id,
        chatId: chatId,
      },
    });

    const user = await prisma.user.findUnique({
      where: { telegramId },
    });

    if (user) {
      await prisma.repositoryUser.upsert({
        where: {
          userId_repositoryId: {
            userId: user.id,
            repositoryId: repo.id,
          },
        },
        update: {},
        create: {
          userId: user.id,
          repositoryId: repo.id,
        },
      });
    }

    await ctx.reply(`Репозиторий *${fullName}* добавлен!`, {
      parse_mode: "Markdown",
    });
  } catch (error) {
    console.error("Ошибка при добавлении репозитория:", error);
    await ctx.reply("Ошибка при добавлении репозитория. Возможно, он уже есть.");
  }
});

bot.command("myrepo", async (ctx) => {
  const telegramId = BigInt(Number(ctx.from?.id));

  const user = await prisma.user.findUnique({
    where: { telegramId },
    include: {
      repositories: {
        include: { repository: true },
      },
    },
  });

  if (!user || user.repositories.length === 0) {
    return ctx.reply("У вас пока нет репозиториев.");
  }

  const text = user.repositories
    .map((ru, i) => `🔹 ${i + 1}. ${ru.repository.fullName}`)
    .join("\n");

  await ctx.reply(`Ваши репозитории:\n${text}`);
});

bot.callbackQuery("add_repo", async (ctx) => {
  await ctx.answerCallbackQuery();
  await ctx.reply("Введите полное имя репозитория (пример: user/my-repo):");
});

bot.callbackQuery("my_repo", async (ctx) => {
  await ctx.answerCallbackQuery();

  const telegramId = BigInt(ctx.from?.id);
  const user = await prisma.user.findUnique({
    where: { telegramId },
    include: {
      repositories: { include: { repository: true } },
    },
  });

  if (!user || user.repositories.length === 0) {
    return ctx.reply("У вас пока нет репозиториев.");
  }

  const text = user.repositories
    .map((ru, i) => `🔹 ${i + 1}. ${ru.repository.fullName}`)
    .join("\n");

  await ctx.reply(`Ваши репозитории:\n${text}`);
});

bot.callbackQuery("help", async (ctx) => {
  await ctx.answerCallbackQuery();
  await ctx.reply("Команды:\n/start — запустить\n/addrepo — добавить репозиторий\n/myrepo — список ваших репозиториев");
});

bot.start();
