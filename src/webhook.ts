import express from "express";
import { bot } from "./bot";
import { prisma } from "./db";
import crypto from "crypto";

const router = express.Router();

function isValidSignature(req: express.Request, secret: string): boolean {
  const signature = req.headers["x-hub-signature-256"] as string;
  const payload = JSON.stringify(req.body);
  const hmac = crypto.createHmac("sha256", secret);
  const digest = "sha256=" + hmac.update(payload).digest("hex");
  return signature === digest;
}

function escapeMarkdown(text: string): string {
  const escapeChars = ['_', '*', '[', ']', '(', ')', '~', '`', '>', '#', '+', '-', '=', '|', '{', '}', '.', '!'];
  return text
    .split('')
    .map(char => escapeChars.includes(char) ? `\\${char}` : char)
    .join('');
}

router.post("/", express.json(), async (req, res) => {
  try {
    if (!isValidSignature(req, process.env.WEBHOOK_SECRET || "")) {
      return res.status(403).send("Invalid signature");
    }

    const { repository, commits, ref, sender } = req.body;

    if (!repository?.name || !commits) {
      return res.status(400).send("Bad request");
    }

    const repo = await prisma.repository.findUnique({
      where: { fullName: repository.full_name },
    });

    if (!repo) {
      return res.status(400).send("Repository not registered via bot");
    }

    const binding = await prisma.chatBinding.findFirst({
      where: {
        repositoryId: repo.id,
      },
    });

    if (!binding) {
      return res.status(400).send("No chat binding found for this repository");
    }

    const user = await prisma.user.upsert({
      where: { githubLogin: sender.login },
      update: {
        telegramName: sender.login,
      },
      create: {
        githubLogin: sender.login,
        telegramName: sender.login,
        telegramId: 0, // должен быть установлен ботом
      },
    });

    const branch = ref?.split("/")?.pop() ?? "unknown";

    const commitPromises = commits.map((commit: any) =>
      prisma.commit.create({
        data: {
          sha: commit.id,
          message: commit.message,
          url: commit.url,
          branch,
          additions: commit.additions || 0,
          deletions: commit.deletions || 0,
          filesChanged: commit.modified?.length || 0,
          committedAt: new Date(commit.timestamp),
          authorId: user.id,
          repositoryId: repo.id,
        },
      })
    );

    await Promise.all(commitPromises);

    const messages = commits.map((commit: any) => {
      const sha = commit.id.substring(0, 7);
      const author = escapeMarkdown(commit.author?.name || sender.login);
      const message = escapeMarkdown(commit.message.split("\n")[0]);
      const url = commit.url;

      return (
        `*${escapeMarkdown(repository.name)}* \`(${escapeMarkdown(branch)})\`\n` +
        `👤 *${author}*\n` +
        `📌 [${sha}](${url}) \\— ${message}\n` +
        `📊 +${commit.additions || 0}/-${commit.deletions || 0} (${commit.modified?.length || 0} файлов)`
      );
    });

    for (const msg of messages) {
      try {
        console.log("📤 Sending to", binding.chatId, "thread:", binding.threadId);
        await bot.api.sendMessage(Number(binding.chatId), msg, {
          parse_mode: "MarkdownV2",
          message_thread_id: binding.threadId ? Number(binding.threadId) : undefined,
        });
      } catch (error) {
        console.error(`Ошибка отправки сообщения в чат ${binding.chatId}:`, error);
      }
    }

    res.status(200).send("OK");
  } catch (error) {
    console.error("Ошибка обработки вебхука:", error);
    res.status(500).send("Internal server error");
  }
});

export default router;
