// server.js - OpenAI-compatible NIM Proxy (stable + race-safe + fallback)
const express = require('express');
const cors = require('cors');
const axios = require('axios');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json({ limit: '2mb' }));

const NIM_API_BASE = process.env.NIM_API_BASE || 'https://integrate.api.nvidia.com/v1';
const NIM_API_KEY = process.env.NIM_API_KEY;

/**
 * Candidate models (newest → oldest)
 */
const MODEL_CANDIDATES = [
  'deepseek-ai/deepseek-v3.2',
  'deepseek-ai/deepseek-v3.1'
];

let ACTIVE_MODEL = null;
let MODEL_READY = false;

/**
 * Try models until one works
 */
async function resolveModel() {
  for (const model of MODEL_CANDIDATES) {
    try {
      await axios.post(
        `${NIM_API_BASE}/chat/completions`,
        {
          model,
          messages: [{ role: 'user', content: 'ping' }],
          max_tokens: 1,
          temperature: 0
        },
        {
          headers: {
            Authorization: `Bearer ${NIM_API_KEY}`,
            'Content-Type': 'application/json'
          },
          timeout: 8000
        }
      );

      console.log(`✅ Using model: ${model}`);
      return model;
    } catch (err) {
      console.log(`❌ Failed model: ${model}`);
    }
  }

  throw new Error('No working DeepSeek model found');
}

/**
 * Startup init (safe + tracked)
 */
const modelInitPromise = (async () => {
  try {
    ACTIVE_MODEL = await resolveModel();
    MODEL_READY = true;
    console.log('🟢 Model ready:', ACTIVE_MODEL);
  } catch (err) {
    MODEL_READY = false;
    console.error('❌ Model init failed:', err.message);
  }
})();

/**
 * Middleware: block chat until model is ready
 */
app.use(async (req, res, next) => {
  if (req.path.startsWith('/v1/chat/completions')) {
    await modelInitPromise;

    if (!MODEL_READY || !ACTIVE_MODEL) {
      return res.status(503).json({
        error: { message: 'Model not initialized or unavailable' }
      });
    }
  }
  next();
});

// Health
app.get('/', (_, res) => res.json({ status: 'ok' }));
app.get('/health', (_, res) => res.json({ status: 'ok' }));

// Models endpoint
app.get('/v1/models', (_, res) => {
  res.json({
    object: 'list',
    data: [
      {
        id: 'deepseek-v3',
        object: 'model',
        created: Date.now(),
        owned_by: 'deepseek',
        active: ACTIVE_MODEL
      }
    ]
  });
});

// Get model safely
async function getActiveModel() {
  if (ACTIVE_MODEL) return ACTIVE_MODEL;
  ACTIVE_MODEL = await resolveModel();
  MODEL_READY = true;
  return ACTIVE_MODEL;
}

// Chat completions endpoint
app.post('/v1/chat/completions', async (req, res) => {
  const { messages, max_tokens, temperature, stream } = req.body;

  try {
    const model = await getActiveModel();

    const nimRequest = {
      model,
      messages,
      max_tokens: Math.min(max_tokens || 512, 1024),
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
          'Content-Type': 'application/json'
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
        res.write(`data: ${JSON.stringify({ error: 'stream failed' })}\n\n`);
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
            'Content-Type': 'application/json'
          },
          timeout: 20000
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
});
