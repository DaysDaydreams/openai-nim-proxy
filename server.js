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

// 🔹 MODELS
const PRIMARY_MODEL = "deepseek-ai/deepseek-v3.2";
const FALLBACK_MODEL = "meta/llama-3.1-8b-instruct";

/* =========================
   HEALTH
========================= */
app.get("/", (_, res) => res.json({ status: "ok" }));

app.get("/v1/models", (_, res) => {
  res.json({
    object: "list",
    data: [
      {
        id: PRIMARY_MODEL,
        object: "model",
        created: Date.now(),
        owned_by: "nvidia"
      },
      {
        id: FALLBACK_MODEL,
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
  const {
    messages,
    temperature,
    stream
  } = req.body;

  const max_tokens = Math.min(req.body.max_tokens || 1024, 2048);

  const baseRequest = {
    messages: messages || [{ role: "user", content: "hello" }],
    temperature: temperature ?? 0.7,
    max_tokens
  };

  // ========================
  // 🔥 STREAMING MODE
  // ========================
  if (stream) {
    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache");
    res.setHeader("Connection", "keep-alive");
    res.flushHeaders();

    let usedModel = PRIMARY_MODEL;

    try {
      let upstream;

      try {
        // 🔹 PRIMARY STREAM
        upstream = await axios({
          method: "post",
          url: `${NIM_API_BASE}/chat/completions`,
          data: {
            ...baseRequest,
            model: PRIMARY_MODEL,
            stream: true
          },
          headers: {
            Authorization: `Bearer ${NIM_API_KEY}`,
            "Content-Type": "application/json"
          },
          responseType: "stream",
          timeout: 0
        });
      } catch (err) {
        console.log("⚠️ Primary stream failed, using fallback...");
        usedModel = FALLBACK_MODEL;

        // 🔹 FALLBACK STREAM
        upstream = await axios({
          method: "post",
          url: `${NIM_API_BASE}/chat/completions`,
          data: {
            ...baseRequest,
            model: FALLBACK_MODEL,
            stream: true
          },
          headers: {
            Authorization: `Bearer ${NIM_API_KEY}`,
            "Content-Type": "application/json"
          },
          responseType: "stream",
          timeout: 0
        });
      }

      upstream.data.on("data", (chunk) => {
        const lines = chunk.toString().split("\n").filter(Boolean);

        for (const line of lines) {
          const payload = line.replace(/^data:\s*/, "");
          res.write(`data: ${payload}\n\n`);
        }
      });

      upstream.data.on("end", () => {
        res.write("data: [DONE]\n\n");
        res.end();
      });

      upstream.data.on("error", (err) => {
        console.error("STREAM ERROR:", err.message);
        res.write(
          `data: ${JSON.stringify({ error: "stream failed" })}\n\n`
        );
        res.end();
      });

    } catch (err) {
      console.error("TOTAL STREAM FAILURE:", err.message);

      res.write(
        `data: ${JSON.stringify({
          choices: [
            {
              delta: { content: "⚡ Stream failed. Try again." }
            }
          ]
        })}\n\n`
      );
      res.write("data: [DONE]\n\n");
      res.end();
    }

    return;
  }

  // ========================
  // 📦 NORMAL MODE
  // ========================
  try {
    let response;
    let usedModel = PRIMARY_MODEL;

    try {
      response = await axios.post(
        `${NIM_API_BASE}/chat/completions`,
        {
          ...baseRequest,
          model: PRIMARY_MODEL,
          stream: false
        },
        {
          headers: {
            Authorization: `Bearer ${NIM_API_KEY}`,
            "Content-Type": "application/json"
          },
          timeout: 20000
        }
      );
    } catch (err) {
      console.log("⚠️ Primary failed, using fallback...");
      usedModel = FALLBACK_MODEL;

      response = await axios.post(
        `${NIM_API_BASE}/chat/completions`,
        {
          ...baseRequest,
          model: FALLBACK_MODEL,
          stream: false
        },
        {
          headers: {
            Authorization: `Bearer ${NIM_API_KEY}`,
            "Content-Type": "application/json"
          },
          timeout: 20000
        }
      );
    }

    const text =
      response.data?.choices?.[0]?.message?.content || "No response";

    return res.json({
      id: `chatcmpl-${Date.now()}`,
      object: "chat.completion",
      created: Math.floor(Date.now() / 1000),
      model: usedModel,
      choices: [
        {
          index: 0,
          message: {
            role: "assistant",
            content: text
          },
          finish_reason: "stop"
        }
      ]
    });

  } catch (err) {
    console.error("TOTAL FAILURE:", err.response?.data || err.message);

    return res.json({
      id: `chatcmpl-${Date.now()}`,
      object: "chat.completion",
      created: Math.floor(Date.now() / 1000),
      model: "error",
      choices: [
        {
          index: 0,
          message: {
            role: "assistant",
            content:
              "⚡ Both models failed. Try again in a moment."
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
  console.log(`🤖 Primary: ${PRIMARY_MODEL}`);
  console.log(`🔁 Fallback: ${FALLBACK_MODEL}`);
});
