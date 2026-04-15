// server.js - OpenAI-compatible NIM Proxy (LLAMA 3.1 FIXED)

const express = require('express');
const cors = require('cors');
const axios = require('axios');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json({ limit: '2mb' }));

const NIM_API_BASE =
  process.env.NIM_API_BASE || 'https://integrate.api.nvidia.com/v1';

const NIM_API_KEY = process.env.NIM_API_KEY;

// ✅ Stable working model from your NVIDIA list
const ACTIVE_MODEL = "meta/llama-3.1-8b-instruct";

// Health
app.get('/', (_, res) => res.json({ status: 'ok' }));
app.get('/health', (_, res) => res.json({ status: 'ok' }));

// Models endpoint (OpenAI-style)
app.get('/v1/models', (_, res) => {
  res.json({
    object: 'list',
    data: [
      {
        id: ACTIVE_MODEL,
        object: 'model',
        created: Date.now(),
        owned_by: 'meta'
      }
    ]
  });
});

// Chat Completions
app.post('/v1/chat/completions', async (req, res) => {
  const { messages, max_tokens, temperature } = req.body;

  try {
    const nimRequest = {
      model: ACTIVE_MODEL,
      messages: messages || [{ role: 'user', content: 'hello' }],
      max_tokens: max_tokens || 256,
      temperature: temperature ?? 0.7,
      stream: false
    };

    const response = await axios.post(
      `${NIM_API_BASE}/chat/completions`,
      nimRequest,
      {
        headers: {
          Authorization: `Bearer ${NIM_API_KEY}`,
          'Content-Type': 'application/json'
        },
        timeout: 30000
      }
    );

    res.json({
      id: `chatcmpl-${Date.now()}`,
      object: 'chat.completion',
      created: Math.floor(Date.now() / 1000),
      model: ACTIVE_MODEL,
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
    console.error('NIM ERROR:', err.response?.data || err.message);

    res.status(500).json({
      error: {
        message: 'Upstream NIM request failed',
        type: 'server_error'
      }
    });
  }
});

app.listen(PORT, () => {
  console.log(`🟢 Proxy running on port ${PORT}`);
  console.log(`🤖 Model: ${ACTIVE_MODEL}`);
});
