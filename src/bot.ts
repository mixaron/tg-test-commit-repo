import { Bot, Keyboard, Context } from "grammy";
import { config } from "dotenv";
import { PrismaClient } from "@prisma/client";

config(); // Загрузка переменных окружения
export const bot = new Bot(process.env.BOT_TOKEN!);
const prisma = new PrismaClient(); // Инициализация клиента Prisma

// --- КОМАНДЫ ---
async function handleStartCommand(ctx: Context) {
  if (!ctx.from?.id) return ctx.reply("⚠️ Ошибка: не удалось определить ваш ID.");
  const userId = BigInt(ctx.from.id);
  const userName = ctx.from.username;

  try {
    await prisma.user.upsert({
      where: { telegramId: userId },
      update: { telegramName: userName || null },
      create: {
        telegramId: userId,
        telegramName: userName || null,
      },
    });
  } catch (e) {
    console.error("Ошибка регистрации:", e);
    return ctx.reply("⚠️ Ошибка при регистрации.");
  }

  const replyMarkup = {
    keyboard: [
      [{ text: "➕ Добавить репозиторий" }],
      [{ text: "📋 Мои репозитории" }],
      [{ text: "❓ Помощь" }],
    ],
    resize_keyboard: true,
  };

  await ctx.reply("👋 Привет! Я бот для уведомлений о GitHub коммитах.", {
    reply_markup: replyMarkup,
  });
}

async function handleHelpCommand(ctx: Context) {
  await ctx.reply("📚 Команды:\n/start — запуск\n/addrepo — добавить\n/myrepo — список репозиториев");
}

async function handleAddRepoCommand(ctx: Context) {
  await ctx.reply("✏️ Введите полное имя репозитория (пример: user/my-repo):");
}

async function handleMyRepoCommand(ctx: Context) {
  if (!ctx.from?.id) return ctx.reply("⚠️ Ошибка: не удалось определить ваш ID.");

  const telegramId = BigInt(ctx.from.id);
  try {
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
      .map((ru, i) => `🔹 ${i + 1}. [${ru.repository.fullName}](${ru.repository.githubUrl})`)
      .join("\n");

    await ctx.reply(`📦 Ваши репозитории:\n${text}`, {
      parse_mode: "Markdown",
    });
  } catch (e) {
    console.error("Ошибка при получении репозиториев:", e);
    await ctx.reply("⚠️ Не удалось получить список репозиториев.");
  }
}

bot.command("start", handleStartCommand);
bot.command("help", handleHelpCommand);
bot.command("addrepo", handleAddRepoCommand);
bot.command("myrepo", handleMyRepoCommand);



bot.on("message:text", async (ctx) => {
  const input = ctx.message.text?.trim();
  if (!input) return;

  if (input === "➕ Добавить репозиторий") return handleAddRepoCommand(ctx);
  if (input === "📋 Мои репозитории") return handleMyRepoCommand(ctx);
  if (input === "❓ Помощь") return handleHelpCommand(ctx);
  if (input.startsWith("/")) return;

  if (!ctx.from?.id || !ctx.chat?.id) {
    return ctx.reply("⚠️ Ошибка: не удалось определить ваш Telegram ID или чат.");
  }

  const telegramId = BigInt(ctx.from.id);
  const chatId = BigInt(ctx.chat.id);

  if (!input.match(/^[\w.-]+\/[\w.-]+$/)) {
    return ctx.reply("❌ Неверный формат. Используйте `user/repo-name`.", {
      parse_mode: "Markdown",
    });
  }

  const fullName = input;
  const githubUrl = `https://github.com/${fullName}`;
  const name = fullName.split("/").pop()!;

  try {
    // --- Создаем отдельный топик в форуме ---
    const topic = await bot.api.createForumTopic(Number(chatId), name);
    const threadId = topic.message_thread_id;

    // --- Репозиторий ---
    const repo = await prisma.repository.upsert({
      where: { fullName },
      update: {
        name,
        githubUrl,
        chatId,
        threadId,
      },
      create: {
        name,
        fullName,
        githubUrl,
        chatId,
        threadId,
      },
    });

    console.log(`✅ Repo: ${repo.fullName}, threadId: ${threadId}`);

    // --- Привязка чата ---
    await prisma.chatBinding.upsert({
      where: {
        repositoryId_chatId: {
          repositoryId: repo.id,
          chatId,
        },
      },
      update: {
        threadId,
      },
      create: {
        repositoryId: repo.id,
        chatId,
        threadId,
      },
    });

    // --- Привязка пользователя ---
    const user = await prisma.user.findUnique({ where: { telegramId } });
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

    await ctx.reply(`✅ Репозиторий *${fullName}* добавлен и создан топик форума!`, {
      parse_mode: "Markdown",
    });
  } catch (error) {
    console.error("Ошибка добавления:", error);
    const msg =
      error instanceof Error && error.message.includes("Unique constraint")
        ? "⚠️ Репозиторий уже добавлен в этот чат."
        : "⚠️ Не удалось добавить репозиторий.";
    await ctx.reply(msg);
  }
});

// --- ЗАПУСК БОТА ---
bot.start();
