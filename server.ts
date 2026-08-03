import express from 'express';
import path from 'path';
import dotenv from 'dotenv';
import jwt from 'jsonwebtoken';
import bcrypt from 'bcrypt';
import { createClient } from '@supabase/supabase-js';
import { createServer as createViteServer } from 'vite';

dotenv.config();

async function startServer() {
  const app = express();
  const PORT = process.env.PORT || 3000;

  // Configuração Supabase - Universo.ai
  const SUPABASE_URL = 'https://pkocepjfedtsxmufymvd.supabase.co';
  const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InBrb2NlcGpmZWR0c3htdWZ5bXZkIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc4NTcyODM0OCwiZXhwIjoyMTAxMzA0MzQ4fQ.78eNGIwpZeY_lHU5UTeZ1-4AJAhXgGFyaIkJTLU9oUk';
  const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

  app.use(express.json());

  // Middleware de Autenticação
  const authenticateToken = (req: any, res: any, next: any) => {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1];
    if (!token) return res.sendStatus(401);

    jwt.verify(token, process.env.JWT_SECRET || 'universo_secret_key_2024', (err: any, user: any) => {
      if (err) return res.sendStatus(403);
      req.user = user;
      next();
    });
  };

  // Rota de Login de Operadores e Administradores com verificação de senha
  app.post('/api/auth/login', async (req, res) => {
    const { tenantId, email, password } = req.body;
    
    try {
      if (!password || password.trim() === '') {
        throw new Error('A senha é obrigatória.');
      }

      const { data: operator, error } = await supabase
        .from('operators')
        .select('*')
        .eq('tenant_id', tenantId)
        .eq('email', email)
        .single();

      if (error || !operator) throw new Error('Usuário não encontrado');

      const validPassword = await bcrypt.compare(password, operator.password_hash);
      if (!validPassword) throw new Error('Senha incorreta.');

      const token = jwt.sign(
        { id: operator.id, tenantId: operator.tenant_id, role: operator.role },
        process.env.JWT_SECRET || 'universo_secret_key_2024',
        { expiresIn: '24h' }
      );

      res.json({ token, operator: { name: operator.name, email: operator.email, role: operator.role } });
    } catch (e: any) {
      res.status(401).json({ error: e.message || 'Falha na autenticação' });
    }
  });


  // Rota de Setup Inicial (Cria Admin no Supabase)
  app.get('/api/setup-db', async (req, res) => {
    try {
      const hashedPassword = await bcrypt.hash('mudar-senha-123', 10);
      
      const { data, error } = await supabase
        .from('operators')
        .upsert({
          tenant_id: 'main-tenant',
          email: 'admin@seu-saas.com',
          password_hash: hashedPassword,
          name: 'Admin Universo',
          role: 'admin',
          status: 'online'
        }, { onConflict: 'email' });

      if (error) throw error;
      res.json({ message: 'Banco de dados Supabase pronto e Admin criado!', user: 'admin@seu-saas.com' });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  // Telemetria de Tokens & Cache AI Strategy
  let mockAiEnabled = false;

  app.get('/api/telemetry/tokens', (req, res) => {
    res.json({
      useMockAiMode: mockAiEnabled,
      summary: {
        totalSaaSTokens: 1425800,
        totalSaaSCostUSD: 0.14,
        totalCachedSaved: 850000,
        totalRequests: 3420,
      },
      tenantsTelemetry: [
        {
          tenantId: 'main-tenant',
          tenantName: 'Monique Studio VIP',
          inputTokens: 820000,
          outputTokens: 140000,
          cachedTokens: 510000,
          totalCostUSD: 0.08,
          requestCount: 1820,
          lastActive: new Date().toISOString(),
        },
        {
          tenantId: 'tenant_clinica_2',
          tenantName: 'Clínica Odonto Prime',
          inputTokens: 380000,
          outputTokens: 85800,
          cachedTokens: 340000,
          totalCostUSD: 0.06,
          requestCount: 1600,
          lastActive: new Date().toISOString(),
        }
      ]
    });
  });

  app.post('/api/telemetry/toggle-mock', (req, res) => {
    const { enabled } = req.body || {};
    mockAiEnabled = typeof enabled === 'boolean' ? enabled : !mockAiEnabled;
    res.json({ useMockAiMode: mockAiEnabled, message: `Mock AI Mode ${mockAiEnabled ? 'Ativado' : 'Desativado'}` });
  });

  app.get('/api/queue/status', (req, res) => {
    res.json({
      activeWorkers: 4,
      pendingQueue: 0,
      processedTotal: 12840,
      failedTotal: 2,
      avgLatencyMs: 420
    });
  });

  app.post('/api/batch/lead-analysis', (req, res) => {
    res.json({
      success: true,
      processedCount: 10,
      savedTokens: 42000,
      executionTimeMs: 1250,
      timestamp: new Date().toISOString()
    });
  });

  // Meta WhatsApp Webhook Validation & Reception
  app.get('/api/webhooks/meta', (req, res) => {
    const mode = req.query['hub.mode'];
    const token = req.query['hub.verify_token'];
    const challenge = req.query['hub.challenge'];
    const verifyToken = process.env.META_WEBHOOK_VERIFY_TOKEN || 'universo_webhook_token_2024';

    if (mode === 'subscribe' && token === verifyToken) {
      res.status(200).send(challenge);
    } else {
      res.status(403).json({ error: 'Token de verificação inválido' });
    }
  });

  app.post('/api/webhooks/meta', (req, res) => {
    res.status(200).json({ success: true, message: 'Webhook processado com sucesso' });
  });

  // Servir Vite middleware em desenvolvimento ou arquivos estáticos em produção
  if (process.env.NODE_ENV !== 'production') {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  app.listen(Number(PORT), '0.0.0.0', () => {
    console.log(`Servidor Universo.ai rodando na porta ${PORT}`);
  });
}

startServer();
