// server.js - Janitor-safe OpenAI proxy (stable + simple)

const express = require("express");
const cors = require("cors");
const axios = require("axios");

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json({ limit: "2mb" }));

const NIM_API_BASE =
  process.env.NIM_API_BASE || "https://integrate.api.nvidia.com/v1";

// 🔑 PUT YOUR KEY IN RENDER ENV: NIM_API_KEY
const NIM_API_KEY = process.env.NIM_API_KEY;

// ✅ Stable model
const ACTIVE_MODEL = "meta/llama-3.1-8b-instruct";

/* =========================
   HEALTH CHECK
========================= */
app.get("/", (_, res) => {
  res.json({ status: "ok" });
});

app.get("/ping", (_, res) => {
  res.json({ status: "alive", time: Date.now() });
});

/* =========================
   MODELS (required for Janitor)
========================= */
app.get("/v1/models", (_, res) => {
  res.json({
    object: "list",
    data: [
      {
        id: ACTIVE_MODEL,
        object: "model",
        created: Date.now(),
        owned_by: "nvidia"
      }
    ]
  });
});

/* =========================
   CHAT COMPLETIONS
========================= */
app.post("/v1/chat/completions", async (req, res) => {
  try {
    const messages = req.body.messages || [
      { role: "user", content: "hello" }
    ];

    // ✅ FIXED: safe max_tokens handling
    const max_tokens = req.body.max_tokens ?? 512;

    const nimRequest = {
      model: ACTIVE_MODEL,
      messages,
      max_tokens: Math.min(max_tokens, 1024),
      temperature: req.body.temperature ?? 0.7,
      stream: false
    };

    const response = await axios.post(
      `${NIM_API_BASE}/chat/completions`,
      nimRequest,
      {
        headers: {
          Authorization: `Bearer ${NIM_API_KEY}`,
          "Content-Type": "application/json"
        },
        timeout: 20000
      }
    );

    const text =
      response.data?.choices?.[0]?.message?.content ||
      "No response generated";

    return res.json({
      id: `chatcmpl-${Date.now()}`,
      object: "chat.completion",
      created: Math.floor(Date.now() / 1000),
      model: ACTIVE_MODEL,
      choices: [
        {
          index: 0,
          message: {
            role: "assistant",
            content: String(text)
          },
          finish_reason: "stop"
        }
      ]
    });

  } catch (err) {
    console.error("ERROR:", err.response?.data || err.message);

    // ⚡ SAFE FALLBACK (prevents Janitor "Network Error")
    return res.json({
      id: `chatcmpl-${Date.now()}`,
      object: "chat.completion",
      created: Math.floor(Date.now() / 1000),
      model: ACTIVE_MODEL,
      choices: [
        {
          index: 0,
          message: {
            role: "assistant",
            content:
              "⚡ Temporary issue. Please try again."
          },
          finish_reason: "stop"
        }
      ]
    });
  }
});

/* =========================
   START SERVER
========================= */
app.listen(PORT, () => {
  console.log(`🟢 Proxy running on port ${PORT}`);
  console.log(`🤖 Model: ${ACTIVE_MODEL}`);
});
