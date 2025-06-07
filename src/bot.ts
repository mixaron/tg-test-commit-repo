import { Bot, Keyboard, Context, InlineKeyboard } from "grammy"; // Убедитесь, что InlineKeyboard импортирован
import { config } from "dotenv";
import { PrismaClient } from "@prisma/client";

config(); // Загрузка переменных окружения из .env файла
export const bot = new Bot(process.env.BOT_TOKEN!); // Инициализация бота
const prisma = new PrismaClient(); // Инициализация клиента Prisma

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
      repositories: { // Загружаем промежуточную таблицу RepositoryUser
        include: { repository: true }, // И связанные с ними Repository
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

/**
 * Обрабатывает команду /start. Регистрирует или обновляет пользователя и выводит главное меню.
 * @param ctx Контекст Grammys.
 */
async function handleStartCommand(ctx: Context) {
  const { userId } = checkContextIds(ctx);
  if (userId === null) return; // Выход, если ID пользователя нет

  const userName = ctx.from?.username;

  try {
    // Регистрируем пользователя в базе данных или обновляем его имя
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

  // Создаем ReplyKeyboard (постоянная клавиатура над полем ввода)
  const replyMarkup = {
    keyboard: [
      [{ text: "➕ Добавить репозиторий" }],
      [{ text: "📋 Мои репозитории" }],
      [{ text: "❓ Помощь" }],
    ],
    resize_keyboard: true, // Делает кнопки компактнее
    one_time_keyboard: false, // Клавиатура остается видимой
  };

  await ctx.reply("👋 Привет! Я бот для уведомлений о GitHub коммитах. Выберите опцию:", { reply_markup: replyMarkup });
}

/**
 * Обрабатывает команду /help. Выводит информацию о доступных командах.
 * @param ctx Контекст Grammys.
 */
async function handleHelpCommand(ctx: Context) {
  await ctx.reply(
    "📚 Команды:\n" +
    "/start — запуск бота и главное меню\n" +
    "/addrepo — добавить новый репозиторий для отслеживания\n" +
    "/myrepo — показать список всех отслеживаемых репозиториев\n" +
    "/delrepo — удалить отслеживаемый репозиторий" // Обновленный текст помощи
  );
}

/**
 * Обрабатывает команду /addrepo. Запрашивает у пользователя имя репозитория.
 * @param ctx Контекст Grammys.
 */
async function handleAddRepoCommand(ctx: Context) {
  await ctx.reply("✏️ Введите полное имя репозитория (пример: `user/my-repo`):", { parse_mode: "Markdown" });
}

/**
 * Обрабатывает команду /myrepo. Выводит список отслеживаемых репозиториев пользователя (только текст, без кнопок).
 * @param ctx Контекст Grammys.
 */
async function handleMyRepoCommand(ctx: Context) {
  const { userId } = checkContextIds(ctx);
  if (userId === null) return;

  const user = await getUserWithRepos(userId);

  if (!user || user.repositories.length === 0) {
    return ctx.reply("📭 У вас пока нет отслеживаемых репозиториев.");
  }

  // Формируем текстовый список репозиториев
  const text = user.repositories
    .map((ru, i) => `🔹 ${i + 1}. [${ru.repository.fullName}](${ru.repository.githubUrl})`)
    .join("\n");

  await ctx.reply(`📦 Ваши репозитории:\n${text}`, { parse_mode: "Markdown" });
}

/**
 * Обрабатывает команду /delrepo. Выводит список репозиториев с Inline-кнопками для выбора.
 * @param ctx Контекст Grammys.
 */
async function handleDelRepoCommand(ctx: Context) {
  const { userId, chatId } = checkContextIds(ctx);
  if (userId === null || chatId === null) return;

  const user = await getUserWithRepos(userId);

  if (!user || user.repositories.length === 0) {
    return ctx.reply("📭 У вас пока нет репозиториев для удаления.");
  }

  const currentThreadId = ctx.message?.message_thread_id || null; // null для общего чата

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
    // Исправление: Создаем кнопку и затем добавляем ее в ряд
    const button = { text: repo.fullName, callback_data: `select_to_delete_repo_${repo.id}` };
    inlineKeyboard.row(button);
  }

  await ctx.reply("Выберите репозиторий для удаления:", { reply_markup: inlineKeyboard });
}

// --- РЕГИСТРАЦИЯ ОБРАБОТЧИКОВ КОМАНД ---
bot.command("start", handleStartCommand);
bot.command("help", handleHelpCommand);
bot.command("addrepo", handleAddRepoCommand);
bot.command("myrepo", handleMyRepoCommand);
bot.command("delrepo", handleDelRepoCommand); // Регистрация команды /delrepo

// --- ОБРАБОТКА ТЕКСТОВЫХ СООБЩЕНИЙ ---
bot.on("message:text", async (ctx) => {
  const input = ctx.message.text?.trim();
  if (!input || input.startsWith("/")) return; // Игнорируем пустые или команды

  // Обработка нажатий на кнопки ReplyKeyboard (главное меню)
  if (input === "➕ Добавить репозиторий") return handleAddRepoCommand(ctx);
  if (input === "📋 Мои репозитории") return handleMyRepoCommand(ctx);
  if (input === "❓ Помощь") return handleHelpCommand(ctx);

  const { userId, chatId } = checkContextIds(ctx);
  if (userId === null || chatId === null) return;

  // Исправление: Получаем объект user здесь, так как он нужен для prisma.repositoryUser.upsert
  const user = await prisma.user.findUnique({ where: { telegramId: userId } });
  if (!user) {
      console.error(`Пользователь с ID ${userId} не найден в БД при добавлении репозитория.`);
      return ctx.reply("⚠️ Ошибка: ваш пользовательский аккаунт не найден. Пожалуйста, отправьте /start.");
  }

  // Валидация формата полного имени репозитория (user/repo-name)
  if (!input.match(/^[\w.-]+\/[\w.-]+$/)) { // _.\- позволяет использовать буквы, цифры, _, ., -
    return ctx.reply(
      "❌ Неверный формат имени репозитория. Используйте `пользователь/имя-репозитория` (пример: `octocat/Spoon-Knife`).",
      { parse_mode: "Markdown" }
    );
  }

  const fullName = input;
  const githubUrl = `https://github.com/${fullName}`;
  const name = fullName.split("/").pop()!; // Извлекаем короткое имя репозитория

  try {
    let finalThreadId: number | null = null; // Итоговый threadId для сохранения

    // Логика создания/получения threadId для групп
    if (ctx.chat.type === "group" || ctx.chat.type === "supergroup") {
        if (ctx.message?.message_thread_id) { // Если сообщение пришло из топика, используем его threadId
            finalThreadId = ctx.message.message_thread_id;
        } else {
            // Иначе, пытаемся найти существующую привязку к топику для этого репозитория в этом чате
            const existingChatBinding = await prisma.chatBinding.findFirst({
                where: {
                    chatId: chatId,
                    repository: { fullName: fullName }
                }
            });

            // Исправление: Явная проверка existingChatBinding !== null
            if (existingChatBinding !== null && existingChatBinding.threadId !== null) {
                finalThreadId = existingChatBinding.threadId;
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
                    finalThreadId = null; // Отсутствие threadId
                }
            }
        }
    }
    // Для приватных чатов finalThreadId останется null

    // --- Сохраняем/обновляем Репозиторий ---
    const repo = await prisma.repository.upsert({
      where: { fullName },
      update: { name, githubUrl, chatId, threadId: finalThreadId },
      create: { name, fullName, githubUrl, chatId, threadId: finalThreadId },
    });

    console.log(`✅ Репозиторий ${repo.fullName} (ID: ${repo.id}), threadId: ${repo.threadId} upserted.`);

    // --- Привязка чата к репозиторию ---
    await prisma.chatBinding.upsert({
      where: { repositoryId_chatId: { repositoryId: repo.id, chatId } },
      update: { threadId: finalThreadId },
      create: { repositoryId: repo.id, chatId, threadId: finalThreadId },
    });
    console.log(`Связка чата ${chatId} с репозиторием ${repo.id} (threadId: ${finalThreadId}) upserted.`);

    // Теперь user гарантированно существует и его id используется
    await prisma.repositoryUser.upsert({
      where: { userId_repositoryId: { userId: user.id, repositoryId: repo.id } },
      update: {},
      create: { userId: user.id, repositoryId: repo.id },
    });
    console.log(`Связка пользователя ${user.id} с репозиторием ${repo.id} upserted.`);

    await ctx.reply(`✅ Репозиторий *${fullName}* добавлен и отслеживается!`, { parse_mode: "Markdown" });
  } catch (error: any) {
    console.error("Ошибка добавления репозитория:", error);
    await ctx.reply(error.message?.includes("Unique constraint failed") ? "⚠️ Репозиторий уже добавлен в этот чат." : "⚠️ Не удалось добавить репозиторий. Пожалуйста, попробуйте позже.");
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
