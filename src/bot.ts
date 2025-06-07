import { Bot, Keyboard, Context, InlineKeyboard } from "grammy";
import { config } from "dotenv";
import { PrismaClient } from "@prisma/client";

config(); // Загрузка переменных окружения из .env файла
export const bot = new Bot(process.env.BOT_TOKEN!); // Инициализация бота
const prisma = new PrismaClient(); // Инициализация клиента Prisma

// --- Вспомогательные функции (Хелперы) ---

/**
 * Получает пользователя по Telegram ID, включая его репозитории.
 */
async function getUserWithRepos(telegramId: bigint) {
  return prisma.user.findUnique({
    where: { telegramId },
    include: {
      repositories: {
        include: { repository: true },
      },
    },
  });
}

/**
 * Проверяет наличие ID пользователя и чата в контексте.
 * Отправляет сообщение об ошибке, если ID отсутствуют.
 */
function checkContextIds(ctx: Context): { userId: bigint | null; chatId: bigint | null } {
  const userId = ctx.from?.id ? BigInt(ctx.from.id) : null;
  const chatId = ctx.chat?.id ? BigInt(ctx.chat.id) : null;

  if (userId === null) {
    ctx.reply("⚠️ Ошибка: не удалось определить ваш ID пользователя Telegram.");
  }
  if (chatId === null) {
    ctx.reply("⚠️ Ошибка: не удалось определить ID чата.");
  }
  return { userId, chatId };
}

// --- ФУНКЦИИ ОБРАБОТЧИКОВ КОМАНД ---

async function handleStartCommand(ctx: Context) {
  const { userId } = checkContextIds(ctx);
  if (userId === null) return; // Выход, если ID пользователя нет

  const userName = ctx.from?.username; // ctx.from гарантированно есть, если userId не null

  try {
    await prisma.user.upsert({
      where: { telegramId: userId },
      update: { telegramName: userName || null },
      create: { telegramId: userId, telegramName: userName || null },
    });
  } catch (e) {
    console.error("Ошибка при регистрации/обновлении пользователя:", e);
    return ctx.reply("⚠️ Произошла ошибка при регистрации вас в системе.");
  }

  const replyMarkup = {
    keyboard: [
      [{ text: "➕ Добавить репозиторий" }],
      [{ text: "📋 Мои репозитории" }],
      [{ text: "❓ Помощь" }],
    ],
    resize_keyboard: true, 
    one_time_keyboard: false, 
  };

  await ctx.reply("👋 Привет! Я бот для уведомлений о GitHub коммитах. Выберите опцию:", { reply_markup: replyMarkup });
}

async function handleHelpCommand(ctx: Context) {
  await ctx.reply(
    "📚 Команды:\n" +
    "/start — запуск бота и главное меню\n" +
    "/addrepo — добавить новый репозиторий для отслеживания\n" +
    "/myrepo — показать список всех отслеживаемых репозиториев\n" +
    "/delrepo — удалить отслеживаемый репозиторий"
  );
}

async function handleAddRepoCommand(ctx: Context) {
  await ctx.reply("✏️ Введите полное имя репозитория (пример: `user/my-repo`):", { parse_mode: "Markdown" });
}

async function handleMyRepoCommand(ctx: Context) {
  const { userId } = checkContextIds(ctx);
  if (userId === null) return;

  const user = await getUserWithRepos(userId);

  if (!user || user.repositories.length === 0) {
    return ctx.reply("📭 У вас пока нет отслеживаемых репозиториев.");
  }

  const text = user.repositories
    .map((ru, i) => `🔹 ${i + 1}. [${ru.repository.fullName}](${ru.repository.githubUrl})`)
    .join("\n");

  await ctx.reply(`📦 Ваши репозитории:\n${text}`, { parse_mode: "Markdown" }); // Удалено disable_web_page_preview
}

async function handleDelRepoCommand(ctx: Context) {
  const { userId, chatId } = checkContextIds(ctx);
  if (userId === null || chatId === null) return;

  const user = await getUserWithRepos(userId);

  if (!user || user.repositories.length === 0) {
    return ctx.reply("📭 У вас пока нет репозиториев для удаления.");
  }

  const currentThreadId = ctx.message?.message_thread_id || null; // null для общего чата

  // --- ИСПРАВЛЕНО: Правильное асинхронное фильтрование ---
  const filteredRepos = [];
  for (const ru of user.repositories) {
    const chatBinding = await prisma.chatBinding.findUnique({
      where: { repositoryId_chatId: { repositoryId: ru.repository.id, chatId: chatId } }
    });

    if (chatBinding) {
      // Логика сравнения threadId:
      // - Если текущий чат не является топиком (currentThreadId === null),
      //   то привязка должна быть также без threadId (chatBinding.threadId === null).
      // - Если текущий чат является топиком (currentThreadId !== null),
      //   то привязка должна быть к этому же топику (chatBinding.threadId === currentThreadId).
      const isMatchingThread = (currentThreadId === null && chatBinding.threadId === null) ||
                               (currentThreadId !== null && chatBinding.threadId === currentThreadId);
      
      if (isMatchingThread) {
        filteredRepos.push(ru.repository);
      }
    }
  }

  if (filteredRepos.length === 0) {
    return ctx.reply("📭 В этом чате/теме у вас нет привязанных репозиториев для удаления.");
  }

  const inlineKeyboard = new InlineKeyboard();
  for (const repo of filteredRepos) {
    const button = { text: repo.fullName, callback_data: `select_to_delete_repo_${repo.id}` };
    inlineKeyboard.row(button);

  }

  await ctx.reply("Выберите репозиторий для удаления:", { reply_markup: inlineKeyboard });
}

// --- РЕГИСТРАЦИЯ КОМАНД ---
bot.command("start", handleStartCommand);
bot.command("help", handleHelpCommand);
bot.command("addrepo", handleAddRepoCommand);
bot.command("myrepo", handleMyRepoCommand);
bot.command("delrepo", handleDelRepoCommand);

// --- ОБРАБОТКА ТЕКСТОВЫХ СООБЩЕНИЙ ---
bot.on("message:text", async (ctx) => {
  const input = ctx.message.text?.trim();
  if (!input || input.startsWith("/")) return;

  if (input === "➕ Добавить репозиторий") return handleAddRepoCommand(ctx);
  if (input === "📋 Мои репозитории") return handleMyRepoCommand(ctx);
  if (input === "❓ Помощь") return handleHelpCommand(ctx);

  const { userId, chatId } = checkContextIds(ctx);
  if (userId === null || chatId === null) return;

  if (!input.match(/^[\w.-]+\/[\w.-]+$/)) {
    return ctx.reply("❌ Неверный формат. Используйте `user/repo-name`.", { parse_mode: "Markdown" });
  }

  const fullName = input;
  const githubUrl = `https://github.com/${fullName}`;
  const name = fullName.split("/").pop()!;

  try {
    let finalThreadId: number | null = null; // По умолчанию null

    if (ctx.chat.type === "group" || ctx.chat.type === "supergroup") {
        // Если сообщение пришло из топика, используем его threadId
        if (ctx.message?.message_thread_id) {
            finalThreadId = ctx.message.message_thread_id;
        } else {
            // Иначе, пытаемся создать новый топик, если его еще нет
            const existingChatBinding = await prisma.chatBinding.findFirst({
                where: {
                    chatId: chatId,
                    repository: { fullName: fullName }
                }
            });

 if (existingChatBinding !== null && existingChatBinding.threadId !== null) {
            // Если уже есть привязка к топику в этом чате для этого репо
            finalThreadId = existingChatBinding.threadId; // Теперь TypeScript знает, что existingChatBinding не null
            await ctx.reply(`Этот репозиторий уже отслеживается в топике: [${name}](https://t.me/c/${chatId.toString().substring(4)}/${finalThreadId})`, {
                parse_mode: "Markdown",
                reply_to_message_id: ctx.message?.message_id
            });
        } else { // Если existingChatBinding null или threadId null, то создаем новый топик
            try {
                const topic = await bot.api.createForumTopic(Number(chatId), name);
                finalThreadId = topic.message_thread_id;
                await ctx.reply(`📊 Создан топик для репозитория: [${name}](https://t.me/c/${chatId.toString().substring(4)}/${finalThreadId})`, {
                    parse_mode: "Markdown",
                    reply_to_message_id: ctx.message?.message_id
                });
            } catch (topicError: any) {
                console.warn("Не удалось создать топик форума:", topicError.message);
                await ctx.reply("⚠️ Не удалось создать отдельный топик форума для репозитория. Отслеживание будет вестись в текущем чате.");
                finalThreadId = null;
            }
        }
    }
}
    // Для приватных чатов finalThreadId останется null

    const repo = await prisma.repository.upsert({
      where: { fullName },
      update: { name, githubUrl, chatId, threadId: finalThreadId },
      create: { name, fullName, githubUrl, chatId, threadId: finalThreadId },
    });

    await prisma.chatBinding.upsert({
      where: { repositoryId_chatId: { repositoryId: repo.id, chatId } },
      update: { threadId: finalThreadId },
      create: { repositoryId: repo.id, chatId, threadId: finalThreadId },
    });

    await prisma.repositoryUser.upsert({
      where: { userId_repositoryId: { userId: user!.id, repositoryId: repo.id } }, // user! т.к. userId уже проверен
      update: {},
      create: { userId: user!.id, repositoryId: repo.id },
    });

    await ctx.reply(`✅ Репозиторий *${fullName}* добавлен и отслеживается!`, { parse_mode: "Markdown" }); // Удалено disable_web_page_preview
  } catch (error: any) {
    console.error("Ошибка добавления:", error);
    await ctx.reply(error.message?.includes("Unique constraint") ? "⚠️ Репозиторий уже добавлен в этот чат." : "⚠️ Не удалось добавить репозиторий.");
  }
});

// --- ОБРАБОТЧИКИ CALLBACK QUERY ---

bot.callbackQuery(/^select_to_delete_repo_(\d+)$/, async (ctx) => {
  await ctx.answerCallbackQuery(); // Обязательно ответить на callbackQuery
  const repoId = parseInt(ctx.match![1]);

  if (isNaN(repoId)) return ctx.reply("⚠️ Ошибка: неверный ID репозитория.");

  try {
    const repoToDelete = await prisma.repository.findUnique({ where: { id: repoId } });
    if (!repoToDelete) return ctx.reply("Репозиторий не найден.");

    const confirmationKeyboard = new InlineKeyboard()
      .text("✅ Да, удалить", `confirm_delete_${repoId}`)
      .text("❌ Нет, отмена", `cancel_delete_${repoId}`);

    await ctx.editMessageText(`Вы уверены, что хотите удалить репозиторий *${repoToDelete.fullName}*?`, {
      reply_markup: confirmationKeyboard, parse_mode: "Markdown",
    });
  } catch (e) {
    console.error("Ошибка при подготовке к удалению:", e);
    await ctx.reply("⚠️ Произошла ошибка при подготовке к удалению.");
  }
});

bot.callbackQuery(/^confirm_delete_(\d+)$/, async (ctx) => {
  await ctx.answerCallbackQuery("Удаляем репозиторий...");
  const repoId = parseInt(ctx.match![1]);

  const { userId, chatId } = checkContextIds(ctx);
  if (isNaN(repoId) || userId === null || chatId === null) return;

  try {
    const user = await prisma.user.findUnique({ where: { telegramId: userId } });
    if (!user) return ctx.reply("Пользователь не найден в системе.");

    const repositoryUser = await prisma.repositoryUser.findUnique({
      where: { userId_repositoryId: { userId: user.id, repositoryId: repoId } },
      include: { repository: true }
    });
    if (!repositoryUser) return ctx.reply("Этот репозиторий не связан с вашим аккаунтом.");

    const repoFullName = repositoryUser.repository.fullName;

    // Получаем threadId из сообщения, на которое был дан ответ (т.е. из сообщения с подтверждением)
    const messageThreadId = ctx.callbackQuery.message?.message_thread_id || null; 

    // 1. Удаляем привязку пользователя к репозиторию
    await prisma.repositoryUser.delete({
      where: { userId_repositoryId: { userId: user.id, repositoryId: repoId } }
    });

    // 2. Удаляем связку чата с этим репозиторием
    await prisma.chatBinding.deleteMany({
      where: {
        repositoryId: repoId,
        chatId: chatId,
        threadId: messageThreadId, // Удаляем только привязку для текущей темы (или общего чата, если null)
      }
    });

    await ctx.editMessageText(`✅ Репозиторий *${repoFullName}* удален из вашего списка.`, { parse_mode: "Markdown" });
  } catch (e) {
    console.error("Ошибка при удалении репозитория:", e);
    await ctx.reply("⚠️ Не удалось удалить репозиторий. Пожалуйста, попробуйте позже.");
  }
});

bot.callbackQuery(/^cancel_delete_(\d+)$/, async (ctx) => {
  await ctx.answerCallbackQuery("Удаление отменено.");
  const repoId = parseInt(ctx.match![1]);

  try {
    const repoInfo = await prisma.repository.findUnique({ where: { id: repoId }, select: { fullName: true } });
    const repoFullName = repoInfo ? repoInfo.fullName : "репозиторий";
    await ctx.editMessageText(`❌ Удаление *${repoFullName}* отменено.`, { parse_mode: "Markdown" });
  } catch (e) {
    console.error("Ошибка при отмене удаления:", e);
    await ctx.reply("⚠️ Ошибка при отмене.");
  }
});

// --- ЗАПУСК БОТА ---
bot.start();
