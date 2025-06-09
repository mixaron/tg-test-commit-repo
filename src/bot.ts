import { Bot, Keyboard, Context, InlineKeyboard, session, SessionFlavor } from "grammy";
import { config } from "dotenv";
import { PrismaClient } from "@prisma/client";
import { startWeeklyReportScheduler } from './weeklyReport'; // Ваш импорт

config();
startWeeklyReportScheduler();

// --- Интерфейс для данных сессии ---
interface SessionData {
  state?: 'awaiting_github_username' | 'awaiting_repo_name';
}

// --- Расширяем Context grammy для включения SessionFlavor ---
type MyContext = Context & SessionFlavor<SessionData>;

export const bot = new Bot<MyContext>(process.env.BOT_TOKEN!);
const prisma = new PrismaClient();

// --- Middleware для сессий ---
bot.use(
  session({
    initial: (): SessionData => ({}),
  })
);

// --- Вспомогательные функции (Хелперы) ---

/**
 * Получает пользователя по Telegram ID, включая его репозитории.
 * @param telegramId ID пользователя Telegram (BigInt).
 * @returns Объект User с включенными репозиториями или null.
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
 * @param ctx Контекст Grammys.
 * @returns Объект с userId и chatId (могут быть null, если отсутствуют).
 */
function checkContextIds(ctx: MyContext): { userId: bigint | null; chatId: bigint | null } {
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

/**
 * НОВАЯ ФУНКЦИЯ: Форматирует имя автора коммита, заменяя GitHub-никнейм на Telegram-никнейм, если привязан.
 * @param githubLogin GitHub-никнейм автора коммита.
 * @param authorName Полное имя автора (если доступно, для fallback).
 * @returns Отформатированная строка автора с ссылкой на Telegram или GitHub.
 */
export async function formatCommitAuthorLink(githubLogin: string, authorName: string = githubLogin): Promise<string> {
  try {
    const user = await prisma.user.findUnique({
      where: { githubLogin: githubLogin },
      select: { telegramName: true, telegramId: true } // Выбираем только необходимые поля
    });

    if (user && user.telegramName) {
      // Если найден пользователь с привязанным Telegram никнеймом
      // Создаем ссылку на Telegram аккаунт пользователя (например, t.me/username)
      // Внимание: telegramName может быть без "@" или не уникальным. 
      // Для прямой ссылки лучше использовать ctx.from.username, который мы не имеем здесь.
      // Поэтому пока просто выводим @telegramName.
      return `👤 @${user.telegramName} (GitHub: [${githubLogin}](https://github.com/${githubLogin}))`;
    } else {
      // Если Telegram никнейм не привязан, используем GitHub-никнейм и ссылку
      return `👤 [${authorName}](https://github.com/${githubLogin})`;
    }
  } catch (error) {
    console.error("Ошибка при форматировании автора коммита:", error);
    // В случае ошибки возвращаем стандартную ссылку на GitHub
    return `👤 [${authorName}](https://github.com/${githubLogin})`;
  }
}


// --- ФУНКЦИИ ОБРАБОТЧИКОВ КОМАНД ---

/**
 * Обрабатывает команду /start. Регистрирует или обновляет пользователя и выводит главное меню.
 * @param ctx Контекст Grammys.
 */
async function handleStartCommand(ctx: MyContext) {
  const { userId } = checkContextIds(ctx);
  if (userId === null) return;

  const userName = ctx.from?.username;

  try {
    await prisma.user.upsert({
      where: { telegramId: userId },
      update: { telegramName: userName || null },
      create: { telegramId: userId, telegramName: userName || null },
    });
    console.log(`Пользователь ${userId} (${userName || 'N/A'}) зарегистрирован/обновлен.`);
  } catch (e) {
    console.error("Ошибка при регистрации/обновлении пользователя:", e);
    return ctx.reply("⚠️ Произошла ошибка при регистрации вас в системе.");
  }

  const replyMarkup = {
    keyboard: [
      [{ text: "➕ Добавить репозиторий" }],
      [{ text: "📋 Мои репозитории" }],
      [{ text: "❓ Помощь" }],
      [{ text: "🔗 Привязать GitHub" }],
      [{ text: "🤡 Отвязать репозиторий" }],
    ],
    resize_keyboard: true,
    one_time_keyboard: false,
  };

  await ctx.reply("👋 Привет! Я бот для уведомлений о GitHub коммитах. Выберите опцию:", { reply_markup: replyMarkup });
}

/**
 * Обрабатывает команду /help. Выводит информацию о доступных командах.
 * @param ctx Контекст Grammys.
 */
async function handleHelpCommand(ctx: MyContext) {
  await ctx.reply(
    "📚 Команды:\n" +
    "/start — запуск бота и главное меню\n" +
    "/addrepo — добавить новый репозиторий для отслеживания\n" +
    "/myrepo — показать список всех отслеживаемых репозиториев\n" +
    "/delrepo — удалить отслеживаемый репозиторий\n" +
    "/linkgithub — привязать ваш GitHub никнейм"
  );
}

/**
 * Обрабатывает команду /addrepo. Запрашивает у пользователя имя репозитория.
 * Устанавливает состояние сессии.
 * @param ctx Контекст Grammys.
 */
async function handleAddRepoCommand(ctx: MyContext) {
  ctx.session.state = 'awaiting_repo_name';
  await ctx.reply("✏️ Введите полное имя репозитория (пример: `user/my-repo`):", { parse_mode: "Markdown" });
}

/**
 * Обрабатывает команду /myrepo. Выводит список отслеживаемых репозиториев пользователя (только текст, без кнопок).
 * @param ctx Контекст Grammys.
 */
async function handleMyRepoCommand(ctx: MyContext) {
  const { userId } = checkContextIds(ctx);
  if (userId === null) return;

  const user = await getUserWithRepos(userId);

  if (!user || user.repositories.length === 0) {
    return ctx.reply("📭 У вас пока нет отслеживаемых репозиториев.");
  }

  const text = user.repositories
    .map((ru, i) => `🔹 ${i + 1}. [${ru.repository.fullName}](${ru.repository.githubUrl})`)
    .join("\n");

  await ctx.reply(`📦 Ваши репозитории:\n${text}`, { parse_mode: "Markdown" });
}

/**
 * Обрабатывает команду /delrepo (или кнопку "Отвязать репозиторий").
 * Выводит список репозиториев с Inline-кнопками для выбора.
 * @param ctx Контекст Grammys.
 */
async function handleDelRepoCommand(ctx: MyContext) {
  const { userId, chatId } = checkContextIds(ctx);
  if (userId === null || chatId === null) return;

  const user = await getUserWithRepos(userId);

  if (!user || user.repositories.length === 0) {
    return ctx.reply("📭 У вас пока нет репозиториев для удаления.");
  }

  const currentThreadId = ctx.message?.message_thread_id || null;

  const filteredRepos = [];
  for (const ru of user.repositories) {
    const chatBinding = await prisma.chatBinding.findUnique({
      where: { repositoryId_chatId: { repositoryId: ru.repository.id, chatId: chatId } }
    });

    if (chatBinding) {
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

/**
 * Обрабатывает команду /linkgithub.
 * Устанавливает состояние сессии для ожидания GitHub-никнейма.
 * @param ctx Контекст Grammys.
 */
async function handleLinkGithubCommand(ctx: MyContext) {
  ctx.session.state = 'awaiting_github_username';
  await ctx.reply("🔗 Пожалуйста, введите ваш никнейм на GitHub:");
}

// --- РЕГИСТРАЦИЯ ОБРАБОТЧИКОВ КОМАНД ---
bot.command("start", handleStartCommand);
bot.command("help", handleHelpCommand);
bot.command("addrepo", handleAddRepoCommand);
bot.command("myrepo", handleMyRepoCommand);
bot.command("delrepo", handleDelRepoCommand);
bot.command("linkgithub", handleLinkGithubCommand);


// --- ОБРАБОТКА ТЕКСТОВЫХ СООБЩЕНИЙ ---
// Этот обработчик теперь использует ctx.session.state для управления потоком диалога
bot.on("message:text", async (ctx) => {
  const input = ctx.message.text?.trim();
  if (!input) return;

  // --- Обработка нажатий на кнопки ReplyKeyboard (главное меню) ---
  if (input === "➕ Добавить репозиторий") {
    return handleAddRepoCommand(ctx);
  }
  if (input === "📋 Мои репозитории") {
    return handleMyRepoCommand(ctx);
  }
  if (input === "❓ Помощь") {
    return handleHelpCommand(ctx);
  }
  if (input === "🔗 Привязать GitHub") {
    return handleLinkGithubCommand(ctx);
  }
  if (input === "🤡 Отвязать репозиторий") {
    return handleDelRepoCommand(ctx);
  }

  // Если сообщение начинается со слеша, это команда, которую уже обработает bot.command()
  if (input.startsWith("/")) return;

  const { userId, chatId } = checkContextIds(ctx);
  if (userId === null || chatId === null) return;

  // --- ЛОГИКА: Обработка ввода в зависимости от состояния сессии ---
  if (ctx.session.state === 'awaiting_github_username') {
    const githubLogin = input;
    // Валидация никнейма GitHub (можно улучшить)
    if (!githubLogin.match(/^[a-zA-Z0-9]+(?:-[a-zA-Z0-9]+)*$/)) {
      return ctx.reply("❌ Неверный формат никнейма GitHub. Используйте только буквы, цифры и дефисы (не в начале/конце).");
    }

    try {
      await prisma.user.update({
        where: { telegramId: userId },
        data: { githubLogin: githubLogin },
      });
      ctx.session.state = undefined; // Сбрасываем состояние после успешной обработки
      return ctx.reply(`✅ Ваш GitHub никнейм *${githubLogin}* успешно привязан!`, { parse_mode: "Markdown" });
    } catch (e: any) {
      console.error("Ошибка привязки GitHub никнейма:", e);
      if (e.message?.includes("Unique constraint failed")) {
          return ctx.reply("⚠️ Этот никнейм GitHub уже привязан к другому аккаунту.");
      }
      return ctx.reply("⚠️ Произошла ошибка при привязке GitHub никнейма. Пожалуйста, попробуйте позже.");
    }
  }

  if (ctx.session.state === 'awaiting_repo_name') {
    ctx.session.state = undefined; // Сбрасываем состояние после обработки ввода репозитория
    if (!input.match(/^[\w.-]+\/[\w.-]+$/)) {
      return ctx.reply(
        "❌ Неверный формат имени репозитория. Используйте `пользователь/имя-репозитория` (пример: `octocat/Spoon-Knife`).",
        { parse_mode: "Markdown" }
      );
    }

    const fullName = input;
    const githubUrl = `https://github.com/${fullName}`;
    const name = fullName.split("/").pop()!;

    try {
      let finalThreadId: number | null = null;

      if (ctx.chat.type === "group" || ctx.chat.type === "supergroup") {
          if (ctx.message?.message_thread_id) {
              finalThreadId = ctx.message.message_thread_id;
          } else {
              const existingChatBinding = await prisma.chatBinding.findFirst({
                  where: {
                      chatId: chatId,
                      repository: { fullName: fullName }
                  }
              });

              if (existingChatBinding !== null && existingChatBinding.threadId !== null) {
                  finalThreadId = existingChatBinding.threadId;
                  await ctx.reply(`Этот репозиторий уже отслеживается в топике: [${name}](https://t.me/c/${chatId.toString().substring(4)}/${finalThreadId})`, {
                      parse_mode: "Markdown",
                      reply_to_message_id: ctx.message?.message_id
                  });
              } else {
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

      const user = await getUserWithRepos(userId);
      if (user) { 
          await prisma.repositoryUser.upsert({
              where: { userId_repositoryId: { userId: user.id, repositoryId: repo.id } },
              update: {},
              create: { userId: user.id, repositoryId: repo.id },
          });
      }

      await ctx.reply(`✅ Репозиторий *${fullName}* добавлен и отслеживается!`, { parse_mode: "Markdown" });
    } catch (error: any) {
      console.error("Ошибка добавления репозитория:", error);
      await ctx.reply(error.message?.includes("Unique constraint failed") ? "⚠️ Репозиторий уже добавлен в этот чат." : "⚠️ Не удалось добавить репозиторий. Пожалуйста, попробуйте позже.");
    }
  } else {
      // Если ни одно из ожидаемых состояний не активно и это не команда/кнопка
      await ctx.reply("Неизвестная команда или ввод. Используйте кнопки меню или команды.");
  }
});


// --- ОБРАБОТЧИКИ CALLBACK QUERY ---

bot.callbackQuery(/^select_to_delete_repo_(\d+)$/, async (ctx) => {
  await ctx.answerCallbackQuery();
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
        where: {
            userId_repositoryId: {
                userId: user.id,
                repositoryId: repoId
            }
        },
        include: {
            repository: true
        }
    });

    if (!repositoryUser) {
        return ctx.reply("Этот репозиторий не связан с вашим аккаунтом.");
    }

    const repoFullName = repositoryUser.repository.fullName;

    await prisma.repositoryUser.delete({
        where: {
            userId_repositoryId: {
                userId: user.id,
                repositoryId: repoId
            }
        }
    });

    const messageThreadId = Number(ctx.callbackQuery.message?.message_thread_id || 0);
    const currentThreadId = messageThreadId > 0 ? messageThreadId : null;

    await prisma.chatBinding.deleteMany({
        where: {
            repositoryId: repoId,
            chatId: chatId,
            threadId: currentThreadId,
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

// Ваша функция generateWeeklyReport (если она используется в weeklyReport.ts)
function generateWeeklyReport() {
  throw new Error("Function not implemented."); // Placeholder
}
