import { GoogleGenAI } from '@google/genai';
import type { ServerConfig } from './config';

let aiClient: GoogleGenAI | null = null;

export function getGeminiClient(config: ServerConfig): GoogleGenAI | null {
  if (!config.geminiApiKey) return null;
  if (!aiClient) {
    aiClient = new GoogleGenAI({
      apiKey: config.geminiApiKey,
      httpOptions: {
        headers: {
          'User-Agent': 'aistudio-build',
        },
      },
    });
  }
  return aiClient;
}
