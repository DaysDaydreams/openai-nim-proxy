// server.js - NVIDIA NIM Proxy (Janitor AI + Free Hosting Optimized)

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

// Keep models simple & fast
const MODEL_MAPPING = {
  'gpt-4': 'meta/llama-3.1-8b-instruct',
  'gpt-4o': 'meta/llama-3.1-8b-instruct',
  'gpt-3.5-turbo': 'meta/llama-3.1-8b-instruct'
};

// Root (used by uptime pingers)
app.get('/', (_, res) => {
  res.json({ status: 'ok' });
});

// Health
app.get('/health', (_, res) => {
  res.json({ status: 'ok' });
});

// Models
app.get('/v1/models', (_, res) => {
  res.json({
    object: 'list',
    data: Object.keys(MODEL_MAPPING).map(id => ({
      id,
      object: 'model',
      created: Date.now(),
      owned_by: 'nim'
    }))
  });
});

// Chat completions (NO streaming)
app.post('/v1/chat/completions', async (req, res) => {
  try {
    const { model, messages, max_tokens, temperature } = req.body;

    const nimModel = MODEL_MAPPING[model] || MODEL_MAPPING['gpt-4'];

    const nimRequest = {
      model: nimModel,
      messages,
      max_tokens: Math.min(max_tokens || 512, 1024),
      temperature: temperature ?? 0.7,
      stream: false
    };

    const response = await axios.post(
      `${NIM_API_BASE}/chat/completions`,
      nimRequest,
      {
        timeout: 20000, // shorter timeout helps Janitor retries
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
      model,
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
        message: 'Upstream request failed',
        type: 'server_error'
      }
    });
  }
});

app.listen(PORT, () => {
  console.log(`🟢 Janitor AI proxy running on port ${PORT}`);
});
