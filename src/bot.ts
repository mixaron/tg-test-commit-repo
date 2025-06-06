import { Bot, InlineKeyboard, Keyboard } from "grammy";
import { config } from "dotenv";
import { PrismaClient } from "@prisma/client";

config();
export const bot = new Bot(process.env.BOT_TOKEN!);
const prisma = new PrismaClient();

// /start
bot.command("start", async (ctx) => {
  const userId = BigInt(Number(ctx.from?.id));
  const userName = ctx.from?.username;

  // Регистрируем пользователя, если его нет
  await prisma.user.upsert({
    where: { telegramId: userId },
    update: {},
    create: {
      telegramId: userId,
      telegramName: userName || null,
    },
  });

const menuKeyboard = new Keyboard()
  .text("/addrepo")
  .text("/myrepo")
  .row()
  .text("/help");

  await ctx.reply("👋 Привет! Я бот для уведомлений о GitHub коммитах. Выберите опцию:", {
    reply_markup: menuKeyboard,
  });
});

// /help
bot.command("help", (ctx) =>
  ctx.reply("📚 Команды:\n/start — запустить\n/addrepo — добавить репозиторий\n/myrepo — список ваших репозиториев")
);

// /addrepo
bot.command("addrepo", (ctx) =>
  ctx.reply("✏️ Введите полное имя репозитория (пример: user/my-repo):")
);

// Обработка текста: предполагаем, что это имя репозитория
bot.on("message:text", async (ctx) => {
  const input = ctx.message.text.trim();
  const telegramId = BigInt(ctx.from?.id);
  const chatId = BigInt(ctx.chat?.id);

  // Пропускаем команды
  if (input.startsWith("/")) return;

  // Простой валидатор fullName
  if (!input.match(/^[a-zA-Z0-9_.-]+\/[a-zA-Z0-9_.-]+$/)) {
    return ctx.reply("❌ Неверное имя. Формат: `user/repo-name`", {
      parse_mode: "Markdown",
    });
  }

  const fullName = input;
  const githubUrl = `https://github.com/${fullName}`;
  const name = fullName.split("/").pop()!;

  try {
    // Создаем или находим репозиторий
    const repo = await prisma.repository.upsert({
      where: { fullName },
      update: {},
      create: {
        name,
        fullName,
        githubUrl,
        chatId,
        // threadId и webhookId пока не заполняем
      },
    });

    // Привязка чата
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

    // Привязка пользователя к репозиторию
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

    await ctx.reply(`✅ Репозиторий *${fullName}* добавлен!`, {
      parse_mode: "Markdown",
    });
  } catch (error) {
    console.error("Ошибка при добавлении репозитория:", error);
    await ctx.reply("⚠️ Ошибка при добавлении репозитория. Возможно, он уже есть.");
  }
});

// /myrepo — список репозиториев пользователя
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
    return ctx.reply("📭 У вас пока нет репозиториев.");
  }

  const text = user.repositories
    .map((ru, i) => `🔹 ${i + 1}. ${ru.repository.fullName}`)
    .join("\n");

  await ctx.reply(`📦 Ваши репозитории:\n${text}`);
});

// Кнопки
bot.callbackQuery("add_repo", async (ctx) => {
  await ctx.answerCallbackQuery();
  await ctx.reply("✏️ Введите полное имя репозитория (пример: user/my-repo):");
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
    return ctx.reply("📭 У вас пока нет репозиториев.");
  }

  const text = user.repositories
    .map((ru, i) => `🔹 ${i + 1}. ${ru.repository.fullName}`)
    .join("\n");

  await ctx.reply(`📦 Ваши репозитории:\n${text}`);
});

bot.callbackQuery("help", async (ctx) => {
  await ctx.answerCallbackQuery();
  await ctx.reply("📚 Команды:\n/start — запустить\n/addrepo — добавить репозиторий\n/myrepo — список ваших репозиториев");
});

bot.start();
