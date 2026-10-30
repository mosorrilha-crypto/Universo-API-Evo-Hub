import { test, expect } from '@playwright/test';

/**
 * TASK-0381 — prova de conceito do Playwright neste projeto: login real +
 * abrir a primeira conversa da lista, no navegador de verdade (não uma
 * simulação em jsdom como os testes de componente do Vitest). Cobre
 * exatamente a lacuna apontada pelo dono do produto — vários bugs visuais
 * recentes (caixa de mensagem estreita, aviso de 24h quebrando palavra por
 * palavra, botões sumindo em certa largura de tela) só foram descobertos
 * porque alguém mandou print depois do deploy; um teste como este roda
 * antes disso.
 *
 * Precisa de um operador real já cadastrado no Supabase (E2E_OPERATOR_EMAIL/
 * E2E_OPERATOR_PASSWORD) e do `npm run dev` com as mesmas variáveis de
 * ambiente reais (SUPABASE_URL/SUPABASE_KEY etc., ver .env.example) — sem
 * isso o teste pula em vez de falhar, pra não travar quem rodar
 * `npx playwright test` sem essas credenciais configuradas. Nunca usar uma
 * conta do tenant real de produção (a beauty studio pagante) aqui — crie um
 * operador dedicado a testes (`npm run create:operator`) num tenant de
 * teste, do jeito que os scripts create-tenant.ts/create-operator.ts já
 * pedem pra outros fluxos que tocam dados reais.
 */
const OPERATOR_EMAIL = process.env.E2E_OPERATOR_EMAIL;
const OPERATOR_PASSWORD = process.env.E2E_OPERATOR_PASSWORD;

test.skip(!OPERATOR_EMAIL || !OPERATOR_PASSWORD, 'E2E_OPERATOR_EMAIL/E2E_OPERATOR_PASSWORD não configuradas — pulando teste que precisa de login real.');

test('login com operador real e abrir a primeira conversa da lista', async ({ page }) => {
  await page.goto('/');

  await page.locator('input[type="email"]').fill(OPERATOR_EMAIL!);
  await page.locator('input[type="password"]').fill(OPERATOR_PASSWORD!);
  // "Validar senha e acessar painel" (pt) / "Validar contraseña e ingresar al panel" (es) — mesmo prefixo nos dois idiomas.
  await page.getByRole('button', { name: /^validar/i }).click();

  // Sessão autenticada — o modal de login some e o cabeçalho do painel aparece.
  await expect(page.locator('input[type="password"]')).toBeHidden({ timeout: 15_000 });

  const firstConversation = page.getByTestId('conversation-row').first();
  await expect(firstConversation).toBeVisible({ timeout: 15_000 });
  await firstConversation.click();

  // Conversa aberta — a caixa de digitar resposta aparece (mesmo elemento
  // usado hoje, independente do idioma do painel).
  await expect(page.getByTestId('message-composer')).toBeVisible({ timeout: 10_000 });
});
