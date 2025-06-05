import express from "express";
import webhookRouter from "./githubWebhook";
import { bot } from "./bot";
import dotenv from "dotenv";
dotenv.config();

const app = express();
const PORT = process.env.PORT || 3000;

app.use("/github", webhookRouter);

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
console.log("zv")
bot.start();