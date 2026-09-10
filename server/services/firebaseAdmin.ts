/**
 * Login com Google, lado servidor — o botão "Autenticar com Conta do Google"
 * já existia no painel (LoginModal.tsx) desde antes, mas só provava posse do
 * e-mail via Firebase client-side: nunca emitia um JWT de backend, então
 * nenhuma rota protegida realmente abria (ficavam corretamente bloqueadas
 * com 401). Este módulo fecha essa lacuna verificando o ID token do Google
 * com uma credencial de conta de serviço do Firebase Admin.
 *
 * Rollout sem quebra, mesmo padrão de tokenCrypto.ts: FIREBASE_ADMIN_CREDENTIALS
 * é opcional. Sem ela, o login com Google fica indisponível (503) mas o
 * resto do sistema — login por senha incluso — continua funcionando normal.
 */
import { cert, getApps, initializeApp, type App } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';

const APP_NAME = 'universo-auth';

export class FirebaseAdminNotConfiguredError extends Error {
  constructor() {
    super('FIREBASE_ADMIN_CREDENTIALS não configurada — login com Google indisponível neste servidor.');
    this.name = 'FirebaseAdminNotConfiguredError';
  }
}

let cachedApp: App | null | undefined;

function getFirebaseAdminApp(): App {
  if (cachedApp) return cachedApp;
  if (cachedApp === null) throw new FirebaseAdminNotConfiguredError();

  const raw = process.env.FIREBASE_ADMIN_CREDENTIALS;
  if (!raw) {
    cachedApp = null;
    throw new FirebaseAdminNotConfiguredError();
  }

  try {
    const serviceAccount = JSON.parse(raw);
    const existing = getApps().find((app) => app.name === APP_NAME);
    cachedApp = existing || initializeApp({ credential: cert(serviceAccount) }, APP_NAME);
    return cachedApp;
  } catch (err) {
    cachedApp = null;
    throw new FirebaseAdminNotConfiguredError();
  }
}

export interface VerifiedGoogleUser {
  email: string;
  emailVerified: boolean;
}

/**
 * Verifica o ID token do Google (obtido no frontend via `user.getIdToken()`
 * depois do `signInWithPopup`) contra a API do Firebase — prova que o
 * requisitante é dono de fato daquele e-mail. Lança `FirebaseAdminNotConfiguredError`
 * quando a credencial não está configurada; lança o erro original do SDK
 * (token expirado/inválido/adulterado) em qualquer outro caso.
 */
export async function verifyGoogleIdToken(idToken: string): Promise<VerifiedGoogleUser> {
  const app = getFirebaseAdminApp();
  const decoded = await getAuth(app).verifyIdToken(idToken);
  return { email: decoded.email || '', emailVerified: !!decoded.email_verified };
}

export function resetFirebaseAdminForTests(): void {
  cachedApp = undefined;
}
