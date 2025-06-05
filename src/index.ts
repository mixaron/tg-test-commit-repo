import express from "express";

const app = express();
const port = 3000;

app.use(express.json());

app.post("/webhook", (req, res) => {
  const event = req.headers["x-github-event"];
  const payload = req.body;

  console.log(`📩 Event received: ${event}`);
  console.log("📦 Payload:", JSON.stringify(payload, null, 2));

  res.status(200).send("Webhook received");
});

app.listen(port, () => {
  console.log(`✅ Server is running on http://localhost:${port}`);
});
