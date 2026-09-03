import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const verifyIdTokenMock = vi.fn();
const initializeAppMock = vi.fn(() => ({ name: 'universo-auth' }));
const getAppsMock = vi.fn(() => [] as any[]);

vi.mock('firebase-admin/app', () => ({
  cert: vi.fn((serviceAccount) => serviceAccount),
  getApps: getAppsMock,
  initializeApp: initializeAppMock,
}));

vi.mock('firebase-admin/auth', () => ({
  getAuth: vi.fn(() => ({ verifyIdToken: verifyIdTokenMock })),
}));

const { verifyGoogleIdToken, FirebaseAdminNotConfiguredError, resetFirebaseAdminForTests } = await import('../firebaseAdmin');

const ORIGINAL_ENV = process.env.FIREBASE_ADMIN_CREDENTIALS;

describe('firebaseAdmin — verificação do login com Google', () => {
  beforeEach(() => {
    resetFirebaseAdminForTests();
    verifyIdTokenMock.mockReset();
    initializeAppMock.mockClear();
    getAppsMock.mockReturnValue([]);
  });

  afterEach(() => {
    if (ORIGINAL_ENV === undefined) delete process.env.FIREBASE_ADMIN_CREDENTIALS;
    else process.env.FIREBASE_ADMIN_CREDENTIALS = ORIGINAL_ENV;
  });

  it('lança FirebaseAdminNotConfiguredError quando FIREBASE_ADMIN_CREDENTIALS não está definida — rollout sem quebra, mesmo padrão de tokenCrypto.ts', async () => {
    delete process.env.FIREBASE_ADMIN_CREDENTIALS;
    await expect(verifyGoogleIdToken('algum-token')).rejects.toBeInstanceOf(FirebaseAdminNotConfiguredError);
  });

  it('lança FirebaseAdminNotConfiguredError quando a credencial configurada não é um JSON válido', async () => {
    process.env.FIREBASE_ADMIN_CREDENTIALS = 'isso não é json';
    await expect(verifyGoogleIdToken('algum-token')).rejects.toBeInstanceOf(FirebaseAdminNotConfiguredError);
  });

  it('verifica o ID token e devolve email + emailVerified quando configurado corretamente', async () => {
    process.env.FIREBASE_ADMIN_CREDENTIALS = JSON.stringify({ project_id: 'demo', client_email: 'x@y.com', private_key: 'fake' });
    verifyIdTokenMock.mockResolvedValue({ email: 'operador@example.com', email_verified: true });

    const result = await verifyGoogleIdToken('token-valido');

    expect(result).toEqual({ email: 'operador@example.com', emailVerified: true });
    expect(verifyIdTokenMock).toHaveBeenCalledWith('token-valido');
  });

  it('devolve emailVerified: false quando o Firebase reporta o e-mail como não verificado', async () => {
    process.env.FIREBASE_ADMIN_CREDENTIALS = JSON.stringify({ project_id: 'demo' });
    verifyIdTokenMock.mockResolvedValue({ email: 'novo@example.com', email_verified: false });

    const result = await verifyGoogleIdToken('token-nao-verificado');

    expect(result.emailVerified).toBe(false);
  });

  it('propaga o erro original do SDK (token expirado/inválido/adulterado) sem mascarar como "não configurado"', async () => {
    process.env.FIREBASE_ADMIN_CREDENTIALS = JSON.stringify({ project_id: 'demo' });
    verifyIdTokenMock.mockRejectedValue(new Error('Firebase ID token has expired'));

    await expect(verifyGoogleIdToken('token-expirado')).rejects.toThrow('Firebase ID token has expired');
  });

  it('reutiliza o app já inicializado em chamadas subsequentes — não reinicializa o SDK a cada requisição', async () => {
    process.env.FIREBASE_ADMIN_CREDENTIALS = JSON.stringify({ project_id: 'demo' });
    verifyIdTokenMock.mockResolvedValue({ email: 'a@b.com', email_verified: true });

    await verifyGoogleIdToken('t1');
    await verifyGoogleIdToken('t2');

    expect(initializeAppMock).toHaveBeenCalledTimes(1);
  });
});
