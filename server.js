// server.js - Janitor-safe OpenAI proxy (stable + fast fallback)

const express = require("express");
const cors = require("cors");
const axios = require("axios");

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json({ limit: "2mb" }));

const NIM_API_BASE =
  process.env.NIM_API_BASE || "https://integrate.api.nvidia.com/v1";

const NIM_API_KEY = process.env.NIM_API_KEY;

// ⚡ SINGLE STABLE MODEL
const ACTIVE_MODEL = "meta/llama-3.1-8b-instruct";

/* =========================
   ⚡ FAST WARM MIDDLEWARE
========================= */
app.use((req, res, next) => {
  res.setTimeout(20000, () => {
    if (!res.headersSent) {
      return res.status(504).json({
        error: {
          message: "Timeout - upstream slow",
          type: "timeout_error"
        }
      });
    }
  });
  next();
});

/* =========================
   HEALTH
========================= */
app.get("/", (_, res) => res.json({ status: "ok" }));

app.get("/ping", (_, res) =>
  res.json({ status: "ok", time: Date.now() })
);

/* =========================
   MODELS (Janitor requires this)
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
  const messages = req.body.messages || [
    { role: "user", content: "hello" }
  ];

  const nimRequest = {
    model: ACTIVE_MODEL,
    messages,
    max_tokens: Math.min(req.body.max_tokens || 256, 256),
    temperature: req.body.temperature ?? 0.7,
    stream: false
  };

  try {
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
            content: text
          },
          finish_reason: "stop"
        }
      ],
      usage: response.data.usage || {
        prompt_tokens: 0,
        completion_tokens: 0,
        total_tokens: 0
      }
    });
  } catch (err) {
    console.error("NIM ERROR:", err.response?.data || err.message);

    // ⚡ FAST FALLBACK (prevents Janitor "Network Error")
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
              "⚡ Server is warming up. Please try again in a moment."
          },
          finish_reason: "stop"
        }
      ],
      usage: {
        prompt_tokens: 0,
        completion_tokens: 0,
        total_tokens: 0
      }
    });
  }
});

/* =========================
   START SERVER
========================= */
app.listen(PORT, () => {
  console.log(`🟢 Janitor-safe proxy running on port ${PORT}`);
  console.log(`🤖 Model: ${ACTIVE_MODEL}`);
});
