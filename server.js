// server.js - OpenAI-compatible NIM Proxy with streaming
const express = require('express');
const cors = require('cors');
const axios = require('axios');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json({ limit: '2mb' }));

const NIM_API_BASE = process.env.NIM_API_BASE || 'https://integrate.api.nvidia.com/v1';
const NIM_API_KEY = process.env.NIM_API_KEY;

// Model mapping (OpenAI/Janitor → NIM)
const MODEL_MAP = {
  'deepseek-v3_2': 'deepseek-ai/deepseek-v3.1',
  'gpt-4o-mini': 'deepseek-ai/deepseek-v3.1'
};

// Root / Health
app.get('/', (_, res) => res.json({ status: 'ok' }));
app.get('/health', (_, res) => res.json({ status: 'ok' }));

// Models endpoint
app.get('/v1/models', (_, res) => {
  const data = Object.keys(MODEL_MAP).map((id) => ({
    id,
    object: 'model',
    created: Date.now(),
    owned_by: 'deepseek'
  }));

  res.json({ object: 'list', data });
});

// Chat completions endpoint
app.post('/v1/chat/completions', async (req, res) => {
  const { model, messages, max_tokens, temperature, stream } = req.body;
  const nimModel = MODEL_MAP[model];

  if (!nimModel) return res.status(400).json({ error: { message: 'Model not supported' } });

  try {
    const nimRequest = {
      model: nimModel,
      messages,
      max_tokens: Math.min(max_tokens || 512, 1024),
      temperature: temperature ?? 0.7,
      stream: Boolean(stream)
    };

    // Streaming mode
    if (stream) {
      res.setHeader('Content-Type', 'text/event-stream');
      res.setHeader('Cache-Control', 'no-cache');
      res.setHeader('Connection', 'keep-alive');
      res.flushHeaders();

      const nimStream = await axios({
        method: 'post',
        url: `${NIM_API_BASE}/chat/completions`,
        data: nimRequest,
        headers: {
          Authorization: `Bearer ${NIM_API_KEY}`,
          'Content-Type': 'application/json'
        },
        responseType: 'stream',
        timeout: 0 // let streaming go as long as needed
      });

      nimStream.data.on('data', (chunk) => {
        // Forward each chunk to client
        const lines = chunk.toString().split('\n').filter(Boolean);
        for (const line of lines) {
          // NIM may or may not prefix with "data: ", normalize to SSE
          const payload = line.replace(/^data:\s*/, '');
          res.write(`data: ${payload}\n\n`);
        }
      });

      nimStream.data.on('end', () => {
        res.write('data: [DONE]\n\n');
        res.end();
      });

      nimStream.data.on('error', (err) => {
        console.error(err.message);
        res.write(`data: ${JSON.stringify({ error: 'Upstream NIM error' })}\n\n`);
        res.end();
      });

    } else {
      // Normal full response
      const response = await axios.post(`${NIM_API_BASE}/chat/completions`, nimRequest, {
        headers: { Authorization: `Bearer ${NIM_API_KEY}` },
        timeout: 20000
      });

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
        usage: response.data.usage || { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 }
      });
    }
  } catch (err) {
    console.error(err.message, err.response?.data);
    res.status(500).json({
      error: { message: 'Upstream DeepSeek/NIM request failed', type: 'server_error' }
    });
  }
});

app.listen(PORT, () => {
  console.log(`🟢 OpenAI-compatible NIM Proxy (streaming) running on port ${PORT}`);
});
