import express from "express";
import webhookRouter from "./webhook";

const app = express();
const PORT = Number(process.env.PORT || 3000);

app.use("/webhook", webhookRouter);

app.listen(PORT, () => {
  console.log(`Webhook server listening on http://localhost:${PORT}/webhook`);
});
