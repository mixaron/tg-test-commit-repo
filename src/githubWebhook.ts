import express, { Router } from "express";
import { prisma } from "./db";
import { bot } from "./bot";
import crypto from "crypto";

const router = Router();

router.post("/webhook", express.json(), async (req, res) => {
  const signature = req.headers["x-hub-signature-256"] as string;
  const payload = JSON.stringify(req.body);
  const hmac = crypto.createHmac("sha256", process.env.WEBHOOK_SECRET!);
  const digest = "sha256=" + hmac.update(payload).digest("hex");

  if (signature !== digest) return res.sendStatus(403);

  const { repository, commits, ref } = req.body;

  const repo = await prisma.repository.findFirst({
    where: { name: repository.name },
  });

  if (!repo) return res.sendStatus(404);

  const messages = commits.map((commit: any) => {
    const author = commit.author.name;
    const sha = commit.id.substring(0, 7);
    const message = commit.message;
    const url = commit.url;

    return `📦 *${repository.name}* \`(${ref})\`\n👤 [${author}]\n📝 [${sha}](${url}) — ${message}`;
  });

  for (const msg of messages) {
    await bot.api.sendMessage(Number(repo.chatId), msg, {
      parse_mode: "Markdown",
    });
  }

  res.sendStatus(200);
});

export default router;
