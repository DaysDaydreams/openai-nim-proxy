// server.js - NVIDIA NIM Proxy (Janitor AI + DeepSeek v3.2 optimized)

const express = require('express');
const cors = require('cors');
const axios = require('axios');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json({ limit: '1mb' }));

const NIM_API_BASE = process.env.NIM_API_BASE || 'https://integrate.api.nvidia.com/v1';
const NIM_API_KEY = process.env.NIM_API_KEY;

// 🚫 REQUIRED for Janitor AI
const ENABLE_THINKING_MODE = false;
const SHOW_REASONING = false;

// 🔒 LOCKED MODEL (Janitor name → NIM name)
const JANITOR_MODEL_ID = 'deepseek-v3_2';
const NIM_MODEL_ID = 'deepseek-ai/deepseek-v3.1';

// Root
app.get('/', (_, res) => {
  res.json({ status: 'ok' });
});

// Health
app.get('/health', (_, res) => {
  res.json({ status: 'ok' });
});

// Models (Janitor reads this)
app.get('/v1/models', (_, res) => {
  res.json({
    object: 'list',
    data: [
      {
        id: JANITOR_MODEL_ID,
        object: 'model',
        created: Date.now(),
        owned_by: 'deepseek'
      }
    ]
  });
});

// Chat completions (NO streaming)
app.post('/v1/chat/completions', async (req, res) => {
  try {
    const { messages, max_tokens, temperature } = req.body;

    const nimRequest = {
      model: NIM_MODEL_ID,
      messages,
      max_tokens: Math.min(max_tokens || 512, 1024),
      temperature: temperature ?? 0.7,
      stream: false
    };

    const response = await axios.post(
      `${NIM_API_BASE}/chat/completions`,
      nimRequest,
      {
        timeout: 20000, // Janitor-safe
        headers: {
          Authorization: `Bearer ${NIM_API_KEY}`,
          'Content-Type': 'application/json'
        }
      }
    );

    res.json({
      id: `chatcmpl-${Date.now()}`,
      object: 'chat.completion',
      created: Math.floor(Date.now() / 1000),
      model: JANITOR_MODEL_ID,
      choices: response.data.choices.map((c, i) => ({
        index: i,
        message: {
          role: 'assistant',
          content: c.message?.content || ''
        },
        finish_reason: c.finish_reason || 'stop'
      })),
      usage: response.data.usage || {
        prompt_tokens: 0,
        completion_tokens: 0,
        total_tokens: 0
      }
    });

  } catch (err) {
    console.error(err.message);
    res.status(500).json({
      error: {
        message: 'Upstream DeepSeek request failed',
        type: 'server_error'
      }
    });
  }
});

app.listen(PORT, () => {
  console.log(`🟢 Janitor AI DeepSeek v3.2 proxy running on port ${PORT}`);
});
