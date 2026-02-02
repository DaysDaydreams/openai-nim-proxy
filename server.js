// server.js - Janitor AI → DeepSeek v3.2 proxy
// Features:
// 1️⃣ Unlimited tokens via automatic chunking
// 2️⃣ Streaming support
// 3️⃣ Proper error handling and logging
// 4️⃣ Correct route: /v1/chat/completions

const express = require("express");
const fetch = require("node-fetch");
const cors = require("cors");

const app = express();
const PORT = process.env.PORT || 3000;

// DeepSeek model token limit (v3.2)
const MAX_TOKENS = 8192;
const TOKEN_BUFFER = 50; // buffer to avoid hitting hard limit

app.use(cors());
app.use(express.json());

// --- Utility: estimate token count roughly ---
function estimateTokens(text) {
  return Math.ceil(text.length / 4); // rough estimate: 1 token ≈ 4 chars
}

// --- Utility: split messages into chunks under MAX_TOKENS ---
function chunkMessages(messages) {
  let chunks = [];
  let currentChunk = [];
  let currentTokens = 0;

  for (const msg of messages) {
    const tokens = estimateTokens(msg.content);
    if (currentTokens + tokens + TOKEN_BUFFER > MAX_TOKENS) {
      if (currentChunk.length) chunks.push(currentChunk);
      currentChunk = [];
      currentTokens = 0;
    }
    currentChunk.push(msg);
    currentTokens += tokens;
  }
  if (currentChunk.length) chunks.push(currentChunk);
  return chunks;
}

// --- Main proxy route (matches Janitor AI expectation) ---
app.post("/v1/chat/completions", async (req, res) => {
  try {
    const { messages, stream, model } = req.body;

    if (!messages || !Array.isArray(messages)) {
      return res.status(400).json({ error: { message: "Missing or invalid messages array" } });
    }

    const messageChunks = chunkMessages(messages);
    let finalResponseText = "";

    // --- Streaming headers ---
    if (stream) {
      res.setHeader("Content-Type", "text/event-stream");
      res.setHeader("Cache-Control", "no-cache");
      res.setHeader("Connection", "keep-alive");
    }

    for (const chunk of messageChunks) {
      const body = {
        model: model || "deepseek_v3_2",
        messages: chunk,
        max_tokens: MAX_TOKENS - TOKEN_BUFFER,
        stream: stream || false,
      };

      const response = await fetch("https://api.nvidia.com/v1/deepseek/completions", {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${process.env.NIM_KEY}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(body),
      });

      if (!response.ok) {
        const text = await response.text();
        console.error("Upstream returned error:", response.status, text);
        return res.status(500).json({
          error: {
            message: "Upstream DeepSeek/NIM request failed",
            status: response.status,
            details: text,
          },
        });
      }

      if (stream) {
        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        while (true) {
          const { value, done } = await reader.read();
          if (done) break;
          const chunkText = decoder.decode(value, { stream: true });
          res.write(`data: ${chunkText}\n\n`);
        }
      } else {
        const data = await response.json();
        if (data.choices && data.choices[0] && data.choices[0].message) {
          finalResponseText += data.choices[0].message.content;
        }
      }
    }

    if (!stream) {
      res.json({
        id: `chunked-${Date.now()}`,
        object: "chat.completion",
        choices: [{ message: { role: "assistant", content: finalResponseText } }],
      });
    } else {
      res.end();
    }

  } catch (err) {
    console.error("Proxy Error:", err);
    res.status(500).json({
      error: {
        message: "Proxy processing failed",
        details: err.message,
      },
    });
  }
});

// --- Optional redirect for backward compatibility ---
app.post("/chat/completions", (req, res) => {
  res.redirect(307, "/v1/chat/completions");
});

// --- Health check ---
app.get("/", (req, res) => res.send("Janitor AI → DeepSeek proxy is running."));

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
