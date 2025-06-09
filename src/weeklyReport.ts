import { PrismaClient } from '@prisma/client';
import { bot } from './bot';
import { format, subWeeks, startOfWeek, endOfWeek } from 'date-fns';
import * as cron from 'node-cron';

const prisma = new PrismaClient();

// Функция для генерации отчёта
async function generateWeeklyReport() {
  const now = new Date();
  const weekStart = startOfWeek(subWeeks(now, 1));
  const weekEnd = endOfWeek(subWeeks(now, 1));

  // 1. Получаем все активные репозитории
  const repositories = await prisma.repository.findMany({
    include: {  
      chatBindings: true,
    },
  });

  for (const repo of repositories) {
    // 2. Получаем статистику по коммитам за неделю
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

    // 3. Группируем по авторам
    const stats = new Map<number, { count: number; user: any }>();
    
    commits.forEach(commit => {
      if (!commit.author) return;
      
      const current = stats.get(commit.author.id) || { count: 0, user: commit.author };
      stats.set(commit.author.id, {
        count: current.count + 1,
        user: current.user,
      });
    });

    // 4. Формируем сообщение
    let report = `📊 *Еженедельный отчёт для ${repo.name}* \n`;
    report += `*Период:* ${format(weekStart, 'dd.MM.yyyy')} - ${format(weekEnd, 'dd.MM.yyyy')}\n\n`;
    
    if (stats.size === 0) {
      report += 'На этой неделе коммитов не было\n';
    } else {
      report += '*Топ участников:*\n';
      
      // Сортируем по количеству коммитов
      const sortedStats = Array.from(stats.entries())
        .sort((a, b) => b[1].count - a[1].count);
      
      // Формируем таблицу
      report += '```\n';
      report += '№ | Коммиты | Участник\n';
      report += '--|---------|---------\n';
      
      sortedStats.forEach(([userId, data], index) => {
        const user = data.user;
        report += `${index + 1} | ${data.count.toString().padEnd(7)} | ${user.telegramName || 'N/A'} (${user.githubLogin || 'N/A'})\n`;
      });
      
      report += '```\n';
      report += `\nВсего коммитов: ${commits.length}`;
    }

    // 5. Отправляем в каждый привязанный чат
    for (const binding of repo.chatBindings) {
      try {
        await bot.api.sendMessage(
          Number(binding.chatId),
          report,
          {
            parse_mode: 'MarkdownV2',
            message_thread_id: binding.threadId ? Number(binding.threadId) : undefined,
          }
        );
      } catch (error) {
        console.error(`Ошибка отправки отчёта в чат ${binding.chatId}:`, error);
      }
    }

    // 6. Сохраняем отчёт в БД
    await prisma.weeklyReport.create({
      data: {
        repositoryId: repo.id,
        weekStart,
        weekEnd,
        stats: JSON.stringify(Object.fromEntries(stats)),
      },
    });
  }
}

// Запускаем каждую неделю в понедельник в 10:00 UTC
export function startWeeklyReportScheduler() {
  // Для тестирования можно использовать '*/5 * * * * *' (каждые 5 секунд) 0 10 * * 1
  cron.schedule('*/5 * * * * *', () => {
    console.log('Запуск генерации еженедельного отчёта...');
    generateWeeklyReport().catch(console.error);
  });
}