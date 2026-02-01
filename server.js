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
  const data = Ob
