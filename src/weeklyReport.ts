import { PrismaClient } from '@prisma/client';
import { bot } from './bot';
import { format, subWeeks, startOfWeek, endOfWeek } from 'date-fns';
import * as cron from 'node-cron';

function escapeMarkdown(text: string): string {
  return text.replace(/[_*[\]()~`>#+=|{}.!\\-]/g, '\\$&');
}

const prisma = new PrismaClient();

async function generateWeeklyReport() {
  const now = new Date();
  const weekStart = startOfWeek(subWeeks(now, 1));
  const weekEnd = endOfWeek(subWeeks(now, 1));

  const repositories = await prisma.repository.findMany({
    include: {
      chatBindings: true,
    },
  });

  for (const repo of repositories) {
    const commits = await prisma.commit.findMany({
      where: {
        repositoryId: repo.id,
        committedAt: {
          gte: weekStart,
          lte: weekEnd,
        },
      },
      include: {
        author: true,
      },
    });

    const stats = new Map<number, { count: number; user: any }>();

    for (const commit of commits) {
      if (!commit.author) continue;
      const key = Number(commit.author.id);

      const existing = stats.get(key);
      stats.set(key, {
        count: existing ? existing.count + 1 : 1,
        user: commit.author,
      });
    }

    let report = `📊 *${escapeMarkdown('Еженедельный отчет для')} ${escapeMarkdown(repo.name)}*\n`;
    report += `*${escapeMarkdown('Период')}*: ${escapeMarkdown(format(weekStart, 'dd.MM.yyyy'))} - ${escapeMarkdown(format(weekEnd, 'dd.MM.yyyy'))}\n\n`;

    if (stats.size === 0) {
      report += `${escapeMarkdown('На этой неделе коммитов не было.')}`;
    } else {
        report += `*${escapeMarkdown('Топ участников:')}*\n`;

        const sorted = [...stats.values()]
        .sort((a, b) => b.count - a.count);

        sorted.forEach((entry, i) => {
        const name = `${entry.user.telegramName || 'N/A'} (${entry.user.githubLogin || 'N/A'})`;
        const line = `${i + 1}\\. ${escapeMarkdown(name)} — *${entry.count}* коммит(ов)\n`;
        report += line;
        });

        report += `\n${escapeMarkdown('Всего коммитов:')} ${commits.length}`;
    }

    for (const binding of repo.chatBindings) {
      try {
        await bot.api.sendMessage(
          Number(binding.chatId),
          escapeMarkdown(report),
          {
            parse_mode: 'MarkdownV2',
            message_thread_id: binding.threadId ? Number(binding.threadId) : undefined,
          }
        );
      } catch (error) {
        console.error(`Ошибка отправки отчета в чат ${binding.chatId}:`, error);
      }
    }

    await prisma.weeklyReport.create({
      data: {
        repositoryId: repo.id,
        weekStart,
        weekEnd,
        stats: JSON.stringify(
          Object.fromEntries(
            [...stats.entries()].map(([id, value]) => [id.toString(), {
              count: value.count,
              userId: value.user.id.toString(),
              githubLogin: value.user.githubLogin,
              telegramName: value.user.telegramName,
            }])
          )
        ),
      },
    });
  }
}

// Запуск каждую неделю в понедельник в 10:00 UTC
export function startWeeklyReportScheduler() {
  // Для тестирования можно использовать '*/5 * * * * *' (каждые 5 секунд) 0 10 * * 1
  cron.schedule('*/60 * * * * *', () => {
    console.log('🚀 Запуск генерации еженедельного отчета...');
    generateWeeklyReport().catch(console.error);
  });
}
