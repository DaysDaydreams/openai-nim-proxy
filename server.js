// server.js - Janitor AI → DeepSeek v3.2 proxy
// Handles unlimited tokens, streaming, and proper error handling

const express = require("express");
const fetch = require("node-fetch");
const cors = require("cors");

const app = express();
const PORT = process.env.PORT || 3000;

// DeepSeek model token limit (v3.2)
const MAX_TOKENS = 8192;

app.use(cors());
app.use(express.json());

app.post("/chat/completions", async (req, res) => {
  try {
    let body = req.body;

    // --- Handle unlimited tokens ---
    if (!body.max_tokens || body.max_tokens > MAX_TOKENS) {
      body.max_tokens = MAX_TOKENS - 50; // slight buffer to avoid edge errors
    }

    // --- Optional: logging for debugging ---
    console.log("Proxy request body:", JSON.stringify(body, null, 2));

    // --- Forward to DeepSeek / NIM ---
    const response = await fetch("https://api.nvidia.com/v1/deepseek/completions", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${process.env.NIM_KEY}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify(body)
    });

    // --- Handle streaming ---
    if (body.stream) {
      res.setHeader("Content-Type", "text/event-stream");
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        res.write(decoder.decode(value));
      }
      res.end();
      return;
    }

    // --- Normal response ---
    const data = await response.json();
    res.json(data);

  } catch (err) {
    console.error("Proxy Error:", err);
    res.status(500).json({
      error: {
        message: "Upstream DeepSeek/NIM request failed",
        details: err.message
      }
    });
  }
});

// --- Health check endpoint ---
app.get("/", (req, res) => res.send("Janitor AI → DeepSeek proxy is running."));

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
