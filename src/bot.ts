import { Bot } from "grammy";
import { prisma } from "./db";
import dotenv from "dotenv";
dotenv.config();

export const bot = new Bot(process.env.BOT_TOKEN!);

// Команда: /addrepo repo-name
bot.command("addrepo", async (ctx) => {
  const args = ctx.message?.text?.split(" ").slice(1);
  if (!args || args.length < 1) {
    return ctx.reply("Использование: /addrepo <repo_name>");
  }

  const [name] = args;

  await prisma.repository.create({
    data: {
      name,
      userId: String(ctx.from?.id),
    },
  });

  await ctx.reply(`✅ Репозиторий ${name} добавлен. Теперь бот будет слать тебе коммиты.`);
});
