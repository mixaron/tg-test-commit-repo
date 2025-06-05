// src/server.ts
import express from "express";

const app = express();
const port = 3000;

// Парсить JSON-пэйлоады от GitHub
app.use(express.json());

// Обработка POST-запроса от GitHub по пути /webhook
app.post("/webhook", (req, res) => {
  const event = req.headers["x-github-event"];
  const payload = req.body;

  console.log(`📩 Event received: ${event}`);
  console.log("📦 Payload:", JSON.stringify(payload, null, 2));

  // Ответ GitHub
  res.status(200).send("Webhook received");
});

// Запуск сервера
app.listen(port, () => {
  console.log(`✅ Server is running on http://localhost:${port}`);
});
