// server.js - NVIDIA NIM Proxy fully OpenAI-compatible
const express = require('express');
const cors = require('cors');
const axios = require('axios');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json({ limit: '2mb' }));

const NIM_API_BASE = process.env.NIM_API_BASE || 'https://integrate.api.nvidia.com/v1';
const NIM_API_KEY = process.env.NIM_API_KEY;

// Locked model mapping (Janitor/OpenAI → NIM)
const MODEL_MAP = {
  'deepseek-v3_2': 'deepseek-ai/deepseek-v3.1', // your NIM model
  'gpt-4o-mini': 'deepseek-ai/deepseek-v3.1'    // optional OpenAI alias
};

// Health & root endpoints
app.get('/', (_, res) => res.json({ status: 'ok' }));
app.get('/health', (_, res) => res.json({ status: 'ok' }));

// Models endpoint (OpenAI-compatible)
app.get('/v1/models', (_, res) => {
  const data = Object.keys(MODEL_MAP).map((id) => ({
    id,
    object: 'model',
    created: Date.now(),
    owned_by: 'deepseek'
  }));

  res.json({
    object: 'list',
    data
  });
});

// Chat completions endpoint
app.post('/v1/chat/completions', async (req, res) => {
  try {
    const { model, messages, max_tokens, temperature } = req.body;

    // Map OpenAI/Janitor model to NIM model
    const nimModel = MODEL_MAP[model];
    if (!nimModel) return res.status(400).json({ error: { message: 'Model not supported' } });

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
        timeout: 20000,
        headers: {
          Authorization: `Bearer ${NIM_API_KEY}`,
          'Content-Type': 'application/json'
        }
      }
    );

    // Map NIM response to OpenAI response format
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
    console.error(err.message, err.response?.data);
    res.status(500).json({
      error: {
        message: 'Upstream DeepSeek/NIM request failed',
        type: 'server_error'
      }
    });
  }
});

app.listen(PORT, () => {
  console.log(`🟢 OpenAI-compatible NIM Proxy running on port ${PORT}`);
});
