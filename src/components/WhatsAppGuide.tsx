import React, { useState } from 'react';
import { Code, Copy, Check, Terminal, ExternalLink, Zap, Server, Shield, ArrowRight, MessageSquare, Cpu } from 'lucide-react';

export const WhatsAppGuide: React.FC = () => {
  const [copiedSnippet, setCopiedSnippet] = useState<string | null>(null);

  const copyCode = (codeText: string, snippetId: string) => {
    navigator.clipboard.writeText(codeText);
    setCopiedSnippet(snippetId);
    setTimeout(() => setCopiedSnippet(null), 2000);
  };

  const nodeSnippet = `// express-whatsapp-transcriber.js
const express = require('express');
const axios = require('axios');
const { GoogleGenAI, Type } = require('@google/genai');

const app = express();
app.use(express.json());

// 1. Inicializa o cliente Gemini no servidor
const ai = new GoogleGenAI({
  apiKey: process.env.GEMINI_API_KEY,
  httpOptions: { headers: { 'User-Agent': 'aistudio-build' } }
});

// 2. Endpoint do Webhook para receber dados do WhatsApp (ex: Meta Cloud API / Evolution API)
app.post('/webhook/whatsapp', async (req, res) => {
  try {
    const { event, data } = req.body;
    
    // Verifica se a mensagem é do tipo 'audio'
    const isAudioMessage = data?.messageType === 'audio' || data?.message?.audioMessage;
    
    if (isAudioMessage) {
      const audioUrl = data.audioUrl || data.message.audioMessage.url;
      const leadPhone = data.from || data.key.remoteJid;
      const leadName = data.pushName || 'Lead do WhatsApp';

      console.log(\`Áudio recebido do lead \${leadName} (\${leadPhone})\`);

      // 3. Baixa o buffer do arquivo de áudio (.ogg / .opus / .mp3)
      const audioResponse = await axios.get(audioUrl, { responseType: 'arraybuffer' });
      const audioBase64 = Buffer.from(audioResponse.data).toString('base64');
      const mimeType = audioResponse.headers['content-type'] || 'audio/ogg';

      // 4. Envia o áudio em base64 diretamente para a API do Gemini 3.6 Flash
      const geminiResponse = await ai.models.generateContent({
        model: 'gemini-3.6-flash',
        contents: {
          parts: [
            {
              inlineData: { mimeType, data: audioBase64 }
            },
            {
              text: \`Transcreva este áudio do WhatsApp do lead \${leadName}.
              Retorne a transcrição em texto e uma resposta pronta amigável para o cliente.\`
            }
          ]
        },
        config: {
          responseMimeType: 'application/json',
          responseSchema: {
            type: Type.OBJECT,
            properties: {
              transcription: { type: Type.STRING },
              summary: { type: Type.STRING },
              intent: { type: Type.STRING },
              sentiment: { type: Type.STRING },
              suggestedReply: { type: Type.STRING }
            }
          }
        }
      });

      const result = JSON.parse(geminiResponse.text);
      console.log('Transcrição concluída:', result.transcription);

      // 5. OPCIONAL: Envia a resposta automática de volta para o cliente no WhatsApp
      await axios.post('https://sua-api-whatsapp.com/send-text', {
        number: leadPhone,
        text: result.suggestedReply
      });
    }

    return res.status(200).json({ status: 'success' });
  } catch (error) {
    console.error('Erro no Webhook:', error);
    return res.status(500).json({ error: error.message });
  }
});

app.listen(3000, () => console.log('Webhook do WhatsApp rodando na porta 3000'));`;

  const metaWebhookSnippet = `// Endpoint para validação do Webhook da Meta (WhatsApp Business Cloud API)
app.get('/webhook/whatsapp', (req, res) => {
  const VERIFY_TOKEN = process.env.WHATSAPP_VERIFY_TOKEN || 'meu_token_secreto';

  const mode = req.query['hub.mode'];
  const token = req.query['hub.verify_token'];
  const challenge = req.query['hub.challenge'];

  if (mode && token) {
    if (mode === 'subscribe' && token === VERIFY_TOKEN) {
      console.log('WEBHOOK_VERIFIED');
      res.status(200).send(challenge);
    } else {
      res.sendStatus(403);
    }
  }
});`;

  return (
    <div className="space-y-8 max-w-5xl mx-auto">
      {/* Header Banner */}
      <div className="bg-slate-900 border border-slate-800 rounded-2xl p-6 sm:p-8 shadow-xl">
        <div className="flex items-center space-x-3 mb-4">
          <div className="w-10 h-10 rounded-xl bg-emerald-500/20 border border-emerald-500/40 flex items-center justify-center text-emerald-400">
            <Code className="w-5 h-5" />
          </div>
          <div>
            <h2 className="text-xl font-bold text-white">Guia Passo a Passo: Transcrever Áudios do WhatsApp no seu Site</h2>
            <p className="text-xs text-slate-400">
              Aprenda a conectar a API do WhatsApp (Meta Cloud API, Evolution API, Z-API) à IA Gemini para transcrição automática de voz.
            </p>
          </div>
        </div>

        {/* Architecture Flow */}
        <div className="grid grid-cols-1 md:grid-cols-4 gap-3 mt-6 pt-6 border-t border-slate-800">
          <div className="p-3.5 bg-slate-950/80 rounded-xl border border-slate-800 text-center">
            <div className="w-8 h-8 rounded-lg bg-emerald-500/20 text-emerald-400 font-bold text-xs flex items-center justify-center mx-auto mb-2">1</div>
            <h4 className="text-xs font-bold text-white mb-1">Lead envia Áudio</h4>
            <p className="text-[11px] text-slate-400">Cliente grava nota de voz (.ogg/.opus) no WhatsApp</p>
          </div>

          <div className="p-3.5 bg-slate-950/80 rounded-xl border border-slate-800 text-center">
            <div className="w-8 h-8 rounded-lg bg-emerald-500/20 text-emerald-400 font-bold text-xs flex items-center justify-center mx-auto mb-2">2</div>
            <h4 className="text-xs font-bold text-white mb-1">Webhook Disparado</h4>
            <p className="text-[11px] text-slate-400">Sua API WhatsApp envia a URL do áudio para seu site</p>
          </div>

          <div className="p-3.5 bg-slate-950/80 rounded-xl border border-slate-800 text-center">
            <div className="w-8 h-8 rounded-lg bg-emerald-500/20 text-emerald-400 font-bold text-xs flex items-center justify-center mx-auto mb-2">3</div>
            <h4 className="text-xs font-bold text-white mb-1">Gemini 3.6 Flash</h4>
            <p className="text-[11px] text-slate-400">Recebe o buffer do áudio e faz a transcrição e resumo</p>
          </div>

          <div className="p-3.5 bg-slate-950/80 rounded-xl border border-slate-800 text-center">
            <div className="w-8 h-8 rounded-lg bg-emerald-500/20 text-emerald-400 font-bold text-xs flex items-center justify-center mx-auto mb-2">4</div>
            <h4 className="text-xs font-bold text-white mb-1">Resposta / CRM</h4>
            <p className="text-[11px] text-slate-400">Salva no CRM e gera a resposta automática no WhatsApp</p>
          </div>
        </div>
      </div>

      {/* Steps List */}
      <div className="space-y-6">
        
        {/* Step 1 */}
        <div className="bg-slate-900 border border-slate-800 rounded-2xl p-6 space-y-3">
          <div className="flex items-center space-x-2 text-emerald-400 font-bold text-sm">
            <Server className="w-4 h-4" />
            <span>Passo 1: Crie o Endpoint no seu Servidor Backend (Express/Node.js)</span>
          </div>
          <p className="text-xs text-slate-300">
            A requisição do Gemini <strong>deve ser feita exclusivamente no backend</strong> para manter sua chave de API segura. O código a seguir recebe o webhook da sua API de WhatsApp, faz o download do áudio e envia diretamente para o Gemini 3.6 Flash.
          </p>

          <div className="relative mt-3">
            <div className="flex items-center justify-between bg-slate-950 px-4 py-2 rounded-t-xl border border-slate-800 border-b-0 text-xs text-slate-400">
              <span className="font-mono flex items-center"><Terminal className="w-3.5 h-3.5 mr-1 text-emerald-400" /> express-whatsapp-transcriber.js</span>
              <button
                onClick={() => copyCode(nodeSnippet, 'node')}
                className="inline-flex items-center px-2.5 py-1 rounded bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-medium"
              >
                {copiedSnippet === 'node' ? (
                  <>
                    <Check className="w-3.5 h-3.5 mr-1 text-emerald-400" />
                    Copiado!
                  </>
                ) : (
                  <>
                    <Copy className="w-3.5 h-3.5 mr-1" />
                    Copiar Código
                  </>
                )}
              </button>
            </div>
            <pre className="p-4 bg-slate-950 rounded-b-xl border border-slate-800 text-xs text-emerald-300 font-mono overflow-x-auto max-h-96 scrollbar-thin">
              <code>{nodeSnippet}</code>
            </pre>
          </div>
        </div>

        {/* Step 2 */}
        <div className="bg-slate-900 border border-slate-800 rounded-2xl p-6 space-y-3">
          <div className="flex items-center space-x-2 text-emerald-400 font-bold text-sm">
            <Shield className="w-4 h-4" />
            <span>Passo 2: Verificação de Webhook para a Meta WhatsApp Business Cloud API</span>
          </div>
          <p className="text-xs text-slate-300">
            Caso você utilize a API oficial da Meta (WhatsApp Cloud API), você precisará adicionar o endpoint GET para responder ao desafio de verificação de token:
          </p>

          <div className="relative mt-3">
            <div className="flex items-center justify-between bg-slate-950 px-4 py-2 rounded-t-xl border border-slate-800 border-b-0 text-xs text-slate-400">
              <span className="font-mono flex items-center"><Terminal className="w-3.5 h-3.5 mr-1 text-emerald-400" /> meta-verify-webhook.js</span>
              <button
                onClick={() => copyCode(metaWebhookSnippet, 'meta')}
                className="inline-flex items-center px-2.5 py-1 rounded bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-medium"
              >
                {copiedSnippet === 'meta' ? (
                  <>
                    <Check className="w-3.5 h-3.5 mr-1 text-emerald-400" />
                    Copiado!
                  </>
                ) : (
                  <>
                    <Copy className="w-3.5 h-3.5 mr-1" />
                    Copiar Código
                  </>
                )}
              </button>
            </div>
            <pre className="p-4 bg-slate-950 rounded-b-xl border border-slate-800 text-xs text-emerald-300 font-mono overflow-x-auto scrollbar-thin">
              <code>{metaWebhookSnippet}</code>
            </pre>
          </div>
        </div>

        {/* Step 3: Compatible Providers & Hybrid Engine Cost Architecture */}
        <div className="bg-slate-900 border border-slate-800 rounded-2xl p-6 space-y-6">
          <div className="flex items-center space-x-2 text-emerald-400 font-bold text-sm">
            <Zap className="w-4 h-4" />
            <span>Estrutura de Custos & Provisionamento dos Motores (Evolution VPS vs. Z-API)</span>
          </div>

          <p className="text-xs text-slate-300 leading-relaxed">
            Abaixo esclarecemos o funcionamento prático da cobrança da Z-API, o modelo de provisionamento dos clientes e por que o Plano Enterprise continua extremamente vantajoso.
          </p>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {/* Box 1: Quando incide o custo da Z-API? */}
            <div className="p-4 bg-slate-950/90 rounded-xl border border-slate-800 space-y-2">
              <h4 className="text-xs font-bold text-sky-400 flex items-center gap-1.5">
                <Shield className="w-4 h-4" /> Quando incide o custo de R$ 99/mês da Z-API?
              </h4>
              <p className="text-[11px] text-slate-300 leading-relaxed">
                <strong className="text-white">O custo só existe quando uma instância é ativada para um cliente.</strong> Você não paga nada para manter a conta da Z-API aberta com 0 instâncias.
              </p>
              <ul className="text-[11px] text-slate-400 space-y-1 list-disc list-inside pt-1">
                <li><strong className="text-slate-200">0 clientes no Z-API:</strong> Custo mensal = R$ 0,00</li>
                <li><strong className="text-slate-200">1 cliente ativado no Z-API:</strong> Custo mensal = R$ 99,00/mês</li>
                <li><strong className="text-slate-200">Clientes no Evolution VPS:</strong> Custo fixo do servidor R$ 60/mês (independente de ter 5 ou 50 clientes).</li>
              </ul>
            </div>

            {/* Box 2: Por que o Add-on não anula o Enterprise? */}
            <div className="p-4 bg-slate-950/90 rounded-xl border border-slate-800 space-y-2">
              <h4 className="text-xs font-bold text-emerald-400 flex items-center gap-1.5">
                <Cpu className="w-4 h-4" /> Por que o Add-on Z-API não tira a vantagem do Enterprise?
              </h4>
              <p className="text-[11px] text-slate-300 leading-relaxed">
                O cliente Starter com Add-on pagará <strong className="text-white">R$ 197 + R$ 99 = R$ 296/mês</strong> mas continuará limitado a 1.000 leads.
              </p>
              <ul className="text-[11px] text-slate-400 space-y-1 list-disc list-inside pt-1">
                <li><strong className="text-slate-200">Plano Starter + Add-on (R$ 296/mês):</strong> 1.000 leads/mês, 1 operador, suporte padrão.</li>
                <li><strong className="text-slate-200">Plano Enterprise (R$ 690/mês):</strong> 20.000 leads/mês, múltiplos operadores, Z-API já inclusa (margem absorvida), suporte prioritário 24/7.</li>
              </ul>
            </div>
          </div>

          {/* How provisioning works */}
          <div className="p-4 bg-slate-950 rounded-xl border border-slate-800 space-y-3">
            <h4 className="text-xs font-bold text-white flex items-center gap-2">
              <ArrowRight className="w-4 h-4 text-emerald-400" />
              Como é feito o Provisionamento do Motor (Manual vs. Automático)?
            </h4>
            
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs text-slate-300">
              <div className="p-3 bg-slate-900/60 rounded-lg border border-slate-800">
                <h5 className="font-semibold text-emerald-300 mb-1">1. Provisionamento Automático (Via API)</h5>
                <p className="text-[11px] text-slate-400 leading-relaxed">
                  No seu painel Admin SaaS, ao clicar em "Criar Novo Tenant" e selecionar o motor (Evolution ou Z-API), o sistema dispara uma chamada HTTP para a API do provedor e cria a instância em 2 segundos, gerando o QR Code na hora na tela do cliente.
                </p>
              </div>

              <div className="p-3 bg-slate-900/60 rounded-lg border border-slate-800">
                <h5 className="font-semibold text-sky-300 mb-1">2. Onboarding Manual (Opção de Início)</h5>
                <p className="text-[11px] text-slate-400 leading-relaxed">
                  Caso prefira iniciar sem automação de API, você cria a instância manualmente no painel da Z-API ou Evolution (leva ~1 minuto) e cola o ID e Token no cadastro do cliente no seu SaaS Admin.
                </p>
              </div>
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 pt-2">
            <div className="p-3.5 bg-slate-950/80 rounded-xl border border-slate-800">
              <h4 className="text-xs font-bold text-white mb-1">Meta Cloud API (Oficial)</h4>
              <p className="text-[11px] text-slate-400">Eventos de webhook para <code className="text-emerald-400">messages</code> com tipo <code className="text-emerald-400">audio</code>.</p>
            </div>

            <div className="p-3.5 bg-slate-950/80 rounded-xl border border-slate-800">
              <h4 className="text-xs font-bold text-white mb-1">Evolution API (VPS Própria)</h4>
              <p className="text-[11px] text-slate-400">Custo fixo R$ 60/mês no servidor. Permite dezenas de conexões sem taxa por número.</p>
            </div>

            <div className="p-3.5 bg-slate-950/80 rounded-xl border border-slate-800">
              <h4 className="text-xs font-bold text-white mb-1">Z-API Gerenciada (Terceirizada)</h4>
              <p className="text-[11px] text-slate-400">R$ 99/mês apenas por número ativo. Recomendado para clientes Enterprise ou Add-on.</p>
            </div>
          </div>
        </div>

      </div>
    </div>
  );
};
