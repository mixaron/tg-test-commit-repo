import express from "express";
import { bot } from "./bot"; 
import { PrismaClient } from "@prisma/client";
import crypto from "crypto";

import { formatCommitAuthorLink } from './bot'; 

const router = express.Router();



const prisma = new PrismaClient(); 


function isValidSignature(req: express.Request, secret: string): boolean {
  const signature = req.headers["x-hub-signature-256"] as string;
  
  
  
  
  
  
  
  const payload = JSON.stringify(req.body); 
  const hmac = crypto.createHmac("sha256", secret);
  const digest = "sha256=" + hmac.update(payload).digest("hex");
  return signature === digest;
}


function escapeMarkdown(text: string): string {
  
  
  return text.replace(/([_`*\[\]()~>#+\-=|{}.!\\])/g, '\\$1');
}


router.post("/", express.json(), async (req, res) => {
  try {
    
    if (!isValidSignature(req, process.env.WEBHOOK_SECRET || "")) {
      return res.status(403).send("Invalid signature");
    }

    const { repository, commits, ref, sender } = req.body;

    
    if (!repository?.name || !commits || !Array.isArray(commits)) {
      return res.status(400).send("Bad request: Missing repository name or commits array.");
    }

    
    const repo = await prisma.repository.findUnique({
      where: { fullName: repository.full_name },
    });

    if (!repo) {
      return res.status(400).send("Repository not registered via bot.");
    }

    
    const binding = await prisma.chatBinding.findFirst({
      where: {
        repositoryId: repo.id,
      },
    });

    if (!binding) {
      return res.status(400).send("No chat binding found for this repository.");
    }

    
    
    
    const user = await prisma.user.upsert({
      where: { githubLogin: sender.login },
      update: {
        
        
        
      },
      create: {
        githubLogin: sender.login,
        telegramName: sender.login, 
        telegramId: 0, 
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
          
          
          additions: commit.added?.length || 0,
          deletions: commit.removed?.length || 0,
          filesChanged: (commit.added?.length || 0) + (commit.removed?.length || 0) + (commit.modified?.length || 0),
          committedAt: new Date(commit.timestamp),
          authorId: user.id, 
          repositoryId: repo.id, 
        },
      })
    );

    await Promise.all(commitPromises); 

    
    const messages = await Promise.all(commits.map(async (commit: any) => { 
      const sha = commit.id.substring(0, 7); 
      

      

      const additionsCount = commit.added?.length || 0;
      const deletionsCount = commit.removed?.length || 0;
      const modifiedCount = commit.modified?.length || 0;
      const totalFilesChanged = additionsCount + deletionsCount + modifiedCount;

      const additionsText = `+${additionsCount}`;
      const deletionsText = `-${deletionsCount}`;
      const filesChangedText = `${totalFilesChanged}`;

      const author = escapeMarkdown(commit.author?.name || sender.login);
      const message = escapeMarkdown(commit.message.split("\n")[0]);

      return (
        `*${escapeMarkdown(repository.name)}* \`(${escapeMarkdown(branch)})\`\n` +
        `👤 [${escapeMarkdown(author)}](https://github.com/${sender.login})\n` +
        `📌 [${sha}](${commit.url}) — ${escapeMarkdown(message)}\n` +
        `📊 ${escapeMarkdown(`${additionsText}/${deletionsText} (${filesChangedText} файл(ов))`)}`
      );
    }));

    
    for (const msg of messages) {
      try {
        console.log("📤 Отправка сообщения о коммите в чат:", binding.chatId, "в топик:", binding.threadId);
        await bot.api.sendMessage(Number(binding.chatId), msg, {
          parse_mode: "MarkdownV2", 
          
          message_thread_id: binding.threadId ? Number(binding.threadId) : undefined,
        });
      } catch (error) {
        console.error(`Ошибка отправки сообщения в чат ${binding.chatId} (репозиторий ${repo.fullName}):`, error);
      }
    }

    res.status(200).send("OK"); 
  } catch (error) {
    console.error("Ошибка обработки вебхука:", error);
    res.status(500).send("Internal server error");
  }
});

export default router;
