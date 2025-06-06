import { Bot, InlineKeyboard, Keyboard, Context } from "grammy"; // Добавлен Context для типизации
import { config } from "dotenv";
import { PrismaClient } from "@prisma/client";

config(); // Загрузка переменных окружения
export const bot = new Bot(process.env.BOT_TOKEN!);
const prisma = new PrismaClient(); // Инициализация клиента Prisma

// --- ВЫНОСИМ ЛОГИКУ КОМАНД В ОТДЕЛЬНЫЕ ФУНКЦИИ ---

async function handleStartCommand(ctx: Context) {
  // Проверка на наличие ctx.from и его id
  if (!ctx.from?.id) {
    console.error("handleStartCommand: Не удалось получить ID пользователя.");
    return ctx.reply("⚠️ Произошла ошибка: не удалось определить ваш ID пользователя Telegram.");
  }

  const userId = BigInt(ctx.from.id);
  const userName = ctx.from.username;

  // Регистрируем пользователя или обновляем его, если он уже есть
  try {
    await prisma.user.upsert({
      where: { telegramId: userId },
      update: { telegramName: userName || null }, // Обновляем имя, если оно изменилось
      create: {
        telegramId: userId,
        telegramName: userName || null,
      },
    });
    console.log(`Пользователь ${userId} (${userName}) зарегистрирован/обновлен.`);
  } catch (error) {
    console.error("Ошибка при регистрации/обновлении пользователя:", error);
    await ctx.reply("⚠️ Произошла ошибка при регистрации вас в системе.");
    return; // Прекращаем выполнение, если не удалось зарегистрировать пользователя
  }

  // Создаем ReplyKeyboard с пользовательскими надписями и resize_keyboard
  const replyMarkup = {
    keyboard: [
      [{ text: "➕ Добавить репозиторий" }], // Дружелюбная надпись
      [{ text: "📋 Мои репозитории" }],      // Дружелюбная надпись
      [{ text: "❓ Помощь" }],                // Дружелюбная надпись
    ],
    resize_keyboard: true, // Делает кнопки менее "толстыми"
    one_time_keyboard: false, // Клавиатура остается на виду
  };

  await ctx.reply("👋 Привет! Я бот для уведомлений о GitHub коммитах. Выберите опцию:", {
    reply_markup: replyMarkup,
  });
}

async function handleHelpCommand(ctx: Context) {
  await ctx.reply("📚 Команды:\n/start — запустить\n➕ Добавить репозиторий — добавить репозиторий\n📋 Мои репозитории — список ваших репозиториев");
}

async function handleAddRepoCommand(ctx: Context) {
  await ctx.reply("✏️ Введите полное имя репозитория (пример: user/my-repo):");
}

async function handleMyRepoCommand(ctx: Context) {
  console.log("--- Начало выполнения handleMyRepoCommand ---");

  // Проверка на наличие ctx.from и его id
  if (!ctx.from?.id) {
    console.error("handleMyRepoCommand: Не удалось получить ID пользователя.");
    return ctx.reply("⚠️ Произошла внутренняя ошибка: не удалось определить ваш ID.");
  }

  const telegramId = BigInt(ctx.from.id);
  console.log(`Получен telegramId: ${telegramId}`);

  try {
    const user = await prisma.user.findUnique({
      where: { telegramId },
      include: {
        repositories: { // Убедитесь, что эта связь существует в вашей Prisma схеме
          include: { repository: true }, // И эта вложенная связь также существует
        },
      },
    });

    console.log("Результат запроса пользователя к Prisma:", user);

    // Проверка, есть ли пользователь и есть ли у него репозитории
    if (!user || user.repositories.length === 0) {
      console.log("Пользователь не найден или у него нет репозиториев. Отправляем сообщение.");
      return ctx.reply("📭 У вас пока нет репозиториев.");
    }

    // Формирование текста списка репозиториев
    const text = user.repositories
      .map((ru, i) => `🔹 ${i + 1}. [${ru.repository.fullName}](${ru.repository.githubUrl})`) // Добавлена ссылка на GitHub
      .join("\n");

    console.log("Сгенерированный текст репозиториев:\n", text);
    await ctx.reply(`📦 Ваши репозитории:\n${text}`, {
      parse_mode: "Markdown", // Чтобы ссылки отображались корректно
      // disable_web_page_preview: true, // Отключаем предпросмотр ссылок, чтобы не загромождать чат
    });
    console.log("--- Сообщение с репозиториями отправлено ---");

  } catch (error) {
    console.error("⚠️ Ошибка в handleMyRepoCommand:", error);
    await ctx.reply("⚠️ Произошла ошибка при получении списка репозиториев. Пожалуйста, попробуйте позже.");
  }
  console.log("--- Конец выполнения handleMyRepoCommand ---");
}

// --- РЕГИСТРАЦИЯ ОБРАБОТЧИКОВ КОМАНД ---
bot.command("start", handleStartCommand);
bot.command("help", handleHelpCommand);
bot.command("addrepo", handleAddRepoCommand);
bot.command("myrepo", handleMyRepoCommand);


// --- ОБРАБОТЧИК message:text (для ввода репозитория и нажатий кнопок) ---
bot.on("message:text", async (ctx) => {
  const input = ctx.message.text?.trim();

  // 1. Проверяем, является ли сообщение текстом одной из кнопок
  if (input === "➕ Добавить репозиторий") {
    return await handleAddRepoCommand(ctx);
  }
  if (input === "📋 Мои репозитории") {
    return await handleMyRepoCommand(ctx);
  }
  if (input === "❓ Помощь") {
    return await handleHelpCommand(ctx);
  }

  // 2. Если это не текст кнопки, проверяем, не является ли это стандартной командой (типа /addrepo, введенной вручную)
  if (input?.startsWith("/")) {
    console.log(`Получена команда ${input}, будет обработана bot.command()`);
    return; // Выходим, так как команды обрабатываются bot.command() хендлерами
  }

  // 3. Если это не кнопка и не команда, считаем, что это ввод имени репозитория
  console.log(`Получено текстовое сообщение (возможно, имя репозитория): ${input}`);

  // Проверка на наличие id пользователя и чата
  if (!ctx.from?.id || !ctx.chat?.id) {
    console.error("message:text: Не удалось получить ID пользователя или чата.");
    return ctx.reply("⚠️ Произошла ошибка: не удалось определить ваш ID пользователя или чата.");
  }

  const telegramId = BigInt(ctx.from.id);
  const chatId = BigInt(ctx.chat.id);

  // Валидация формата полного имени репозитория (user/repo-name)
  if (!input || !input.match(/^[a-zA-Z0-9_.-]+\/[a-zA-Z0-9_.-]+$/)) {
    return ctx.reply("❌ Неверное имя. Формат должен быть `пользователь/имя-репозитория` (пример: `octocat/Spoon-Knife`).", {
      parse_mode: "Markdown",
    });
  }

  const fullName = input;
  const githubUrl = `https://github.com/${fullName}`;
  const name = fullName.split("/").pop()!; // Имя репозитория без пользователя

  try {
    // Создаем или находим репозиторий в базе данных
    const repo = await prisma.repository.upsert({
      where: { fullName },
      update: {
        name,
        githubUrl,
        chatId, // Обновляем chatId, если репозиторий уже существует
      },
      create: {
        name,
        fullName,
        githubUrl,
        chatId,
        // threadId и webhookId пока не заполняем
      },
    });
    console.log(`Репозиторий ${fullName} upserted. ID: ${repo.id}`);

    // Привязка чата к репозиторию
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
    console.log(`Связка чата ${chatId} с репозиторием ${repo.id} upserted.`);

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
      console.log(`Связка пользователя ${user.id} с репозиторием ${repo.id} upserted.`);
    } else {
      console.warn(`Пользователь с telegramId ${telegramId} не найден для привязки к репозиторию.`);
      // Возможно, стоит зарегистрировать пользователя здесь, если он почему-то не был зарегистрирован ранее.
    }

    await ctx.reply(`✅ Репозиторий *${fullName}* добавлен и отслеживается!`, {
      parse_mode: "Markdown",
      // disable_web_page_preview: true, // Отключаем предпросмотр для чистоты
    });
    console.log(`Сообщение об успешном добавлении репозитория ${fullName} отправлено.`);
  } catch (error) {
    console.error("Ошибка при добавлении репозитория:", error);
    if (error instanceof Error && error.message.includes('Unique constraint failed')) {
        await ctx.reply("⚠️ Ошибка: Этот репозиторий уже отслеживается в этом чате или вы уже добавили его.");
    } else {
        await ctx.reply("⚠️ Произошла ошибка при добавлении репозитория. Пожалуйста, проверьте имя или попробуйте позже.");
    }
  }
});


// --- ОБРАБОТЧИКИ callbackQuery (Остаются для InlineKeyboard, если она где-то используется) ---
// В вашем текущем коде InlineKeyboard не используется. Если она вам не нужна, эти блоки можно удалить.

bot.callbackQuery("add_repo", async (ctx) => {
  await ctx.answerCallbackQuery(); // Обязательно ответить на callbackQuery
  await ctx.reply("✏️ Введите полное имя репозитория (пример: user/my-repo):");
});

bot.callbackQuery("my_repo", async (ctx) => {
  await ctx.answerCallbackQuery();

  if (!ctx.from?.id) {
    return ctx.reply("⚠️ Произошла внутренняя ошибка: не удалось определить ваш ID.");
  }

  const telegramId = BigInt(ctx.from.id);
  try {
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
      .map((ru, i) => `🔹 ${i + 1}. [${ru.repository.fullName}](${ru.repository.githubUrl})`)
      .join("\n");

    await ctx.reply(`📦 Ваши репозитории:\n${text}`, {
      parse_mode: "Markdown",
      // disable_web_page_preview: true,
    });
  } catch (error) {
    console.error("Ошибка в callbackQuery 'my_repo':", error);
    await ctx.reply("⚠️ Произошла ошибка при получении списка репозиториев (callback). Пожалуйста, попробуйте позже.");
  }
});

bot.callbackQuery("help", async (ctx) => {
  await ctx.answerCallbackQuery();
  await ctx.reply("📚 Команды:\n/start — запустить\n➕ Добавить репозиторий — добавить репозиторий\n📋 Мои репозитории — список ваших репозиториев");
});

// Запуск бота
bot.start();