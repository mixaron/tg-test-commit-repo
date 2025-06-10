import { PrismaClient } from '@prisma/client';
import { bot } from './bot';
import { format, subWeeks, startOfWeek, endOfWeek } from 'date-fns';
import * as cron from 'node-cron';


function escapeMarkdown(text: string): string {
    return text
        .replace(/\\/g, '\\\\')
        .replace(/_/g, '\\_')
        .replace(/\*/g, '\\*')
        .replace(/\[/g, '\\[')
        .replace(/\]/g, '\\]')
        .replace(/\(/g, '\\(')
        .replace(/\)/g, '\\)')
        .replace(/~/g, '\\~')
        .replace(/`/g, '\\`')
        .replace(/>/g, '\\>')
        .replace(/#/g, '\\#')
        .replace(/\+/g, '\\+')
        .replace(/-/g, '\\-')
        .replace(/=/g, '\\=')
        .replace(/\|/g, '\\|')
        .replace(/\{/g, '\\{')
        .replace(/\}/g, '\\}')
        .replace(/\./g, '\\.')
        .replace(/!/g, '\\!');
}

const prisma = new PrismaClient();

async function generateWeeklyReport() {
    const now = new Date();

    const weekStart = startOfWeek(subWeeks(now, 1), { weekStartsOn: 1 });
    const weekEnd = endOfWeek(subWeeks(now, 1), { weekStartsOn: 1 });

    const repositories = await prisma.repository.findMany({
        include: { chatBindings: true },
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

        let report = `📊 *${escapeMarkdown('Еженедельный отчет для')}* ${escapeMarkdown(repo.name)}\n`;
        report += `*${escapeMarkdown('Период')}*: ${escapeMarkdown(format(weekStart, 'dd.MM.yyyy'))} \\- ${escapeMarkdown(format(weekEnd, 'dd.MM.yyyy'))}\n\n`;

        if (stats.size === 0) {
            report += `${escapeMarkdown('На этой неделе коммитов не было.')}`;
        } else {
            report += `*${escapeMarkdown('Топ участников:')}*\n`;
            report += `${escapeMarkdown('----------------------------------')}\n`;

            const sorted = [...stats.values()]
                .sort((a, b) => b.count - a.count);

            sorted.forEach((entry, i) => {
                const displayName = entry.user.telegramName || entry.user.githubLogin || 'N/A';
                const githubLoginDisplay = entry.user.githubLogin || 'N/A';

                let participantLine = `${i + 1}\\. `;

                if (entry.user.telegramName) {
                    participantLine += `${escapeMarkdown(displayName)} \\(GitHub\\: ${escapeMarkdown(githubLoginDisplay)}\\)`;
                } else {
                    participantLine += `${escapeMarkdown(displayName)}`;
                }

                participantLine += ` — *${escapeMarkdown(entry.count.toString())}* ${escapeMarkdown('коммит(ов)')}\n`;
                report += participantLine;
            });

            report += `${escapeMarkdown('----------------------------------')}\n`;
            report += `\n*${escapeMarkdown('Всего коммитов')}*: ${escapeMarkdown(commits.length.toString())}`;
        }

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
                console.error(`Ошибка отправки еженедельного отчета в чат ${binding.chatId} (репозиторий ${repo.name}):`, error);
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
                sentAt: now,
            },
        });
    }
}

export function startWeeklyReportScheduler() {
    cron.schedule('0 8 * * 1', () => {
        console.log('🚀 Запуск генерации еженедельного отчета...');
        generateWeeklyReport().catch(console.error);
    }, {
      timezone: "Europe/Moscow"
    });
}
