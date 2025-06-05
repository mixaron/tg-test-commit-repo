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

router.post("/", express.json(), async (req, res) => {

  const { repository, commits, ref } = req.body;

  if (!repository?.name || !commits) return res.sendStatus(400);

  const repo = await prisma.repository.findFirst({
    where: { name: repository.name },
  });

  if (!repo) return res.sendStatus(404);

  const branch = ref?.split("/")?.pop() ?? "unknown";

  const messages = commits.map((commit: any) => {
    const sha = commit.id.substring(0, 7);
    const author = commit.author.name;
    const message = commit.message;
    const url = commit.url;

    return `📦 *${repository.name}* \`(${branch})\`\n👤 *${author}*\n🔗 [${sha}](${url}) — ${message}`;
  });

  for (const msg of messages) {
    await bot.api.sendMessage(Number(repo.chatId), msg, {
  parse_mode: "Markdown",
  disable_web_page_preview: true,
    } as any);

  }

  res.sendStatus(200);
});

export default router;
