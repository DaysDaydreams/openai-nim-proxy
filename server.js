// server.js - OpenAI-compatible NIM Proxy (DeepSeek v3.2 only)

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

const ACTIVE_MODEL = "deepseek-v3_2";

// Health
app.get('/', (_, res) => res.json({ status: 'ok' }));
app.get('/health', (_, res) => res.json({ status: 'ok' }));

// Models
app.get('/v1/models', (_, res) => {
  res.json({
    object: 'list',
    data: [
      {
        id: ACTIVE_MODEL,
        object: 'model',
        created: Date.now(),
        owned_by: 'deepseek-ai'
      }
    ]
  });
});

// Chat completions
app.post('/v1/chat/completions', async (req, res) => {
  const { messages, max_tokens, temperature, stream } = req.body;

  try {
    const nimRequest = {
      model: ACTIVE_MODEL,
      messages: messages || [{ role: 'user', content: 'hello' }],
      max_tokens: Math.min(max_tokens || 256, 256),
      temperature: temperature ?? 0.7,
      stream: Boolean(stream)
    };

    // STREAMING
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
          'Content-Type': 'application/json',
          Accept: 'application/json'
        },
        responseType: 'stream',
        timeout: 0
      });

      nimStream.data.on('data', (chunk) => {
        const lines = chunk.toString().split('\n').filter(Boolean);

        for (const line of lines) {
          const payload = line.replace(/^data:\s*/, '');
          res.write(`data: ${payload}\n\n`);
        }
      });

      nimStream.data.on('end', () => {
        res.write('data: [DONE]\n\n');
        res.end();
      });

      nimStream.data.on('error', (err) => {
        console.error('STREAM ERROR:', err.message);
        res.write(
          `data: ${JSON.stringify({ error: 'stream failed' })}\n\n`
        );
        res.end();
      });
    } else {
      // NORMAL REQUEST
      const response = await axios.post(
        `${NIM_API_BASE}/chat/completions`,
        nimRequest,
        {
          headers: {
            Authorization: `Bearer ${NIM_API_KEY}`,
            'Content-Type': 'application/json',
            Accept: 'application/json'
          },
          timeout: 20000
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
    }
  } catch (err) {
    console.error('NIM ERROR:', {
      status: err.response?.status,
      data: err.response?.data || err.message
    });

    res.status(500).json({
      error: {
        message: 'Upstream DeepSeek/NIM request failed',
        type: 'server_error'
      }
    });
  }
});

app.listen(PORT, () => {
  console.log(`🟢 NIM Proxy running on port ${PORT}`);
  console.log(`🤖 Using model: ${ACTIVE_MODEL}`);
});
