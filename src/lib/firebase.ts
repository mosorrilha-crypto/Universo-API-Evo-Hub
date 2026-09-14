import { initializeApp, getApps, getApp, type FirebaseApp } from 'firebase/app';
import {
  getAuth,
  signInWithPopup,
  GoogleAuthProvider,
  type Auth
} from 'firebase/auth';
import {
  getFirestore,
  doc,
  setDoc,
  type Firestore
} from 'firebase/firestore';

// TASK-0191 — antes vinha de firebase-applet-config.json, comitado em texto
// puro no repositório (GitHub Secret Scanning sinalizou a apiKey como
// "Public leak" aberto há 22 dias). A apiKey do Firebase Web é pública por
// design (a segurança real é a regra de auth em firestore.rules, não o
// segredo desta chave) — mas comitar em texto puro no git ainda gera ruído
// de alerta de segurança sem necessidade nenhuma, daí a migração pra
// variáveis de ambiente (mesmo padrão de SUPABASE_URL/etc.), sem trocar o
// valor da chave em si.
const firebaseConfig = {
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
  appId: import.meta.env.VITE_FIREBASE_APP_ID,
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
};
const firestoreDatabaseId = import.meta.env.VITE_FIREBASE_FIRESTORE_DATABASE_ID;

if (!firebaseConfig.apiKey) {
  console.warn('[firebase] VITE_FIREBASE_API_KEY não configurada — login com Google/e-mail e Firestore ficam indisponíveis.');
}

// Achado real (TASK-0262, 04/09/2026, confirmado testando o app de verdade
// no navegador via agent-browser): `getAuth(app)` lança de forma SÍNCRONA,
// no carregamento do módulo, quando a apiKey está ausente/inválida
// (`FirebaseError: auth/invalid-api-key`) — isso quebrava o boot do app
// INTEIRO (tela branca total, `#root` nunca chegava a receber nada do
// React), não só "login com Google/e-mail e Firestore" como o aviso acima
// sugere. `createRoot(...).render(...)` (main.tsx) nem chegava a rodar,
// porque a exceção interrompia a avaliação da cadeia de imports antes
// disso. Inicialização agora é condicional: sem apiKey, `auth`/`db` ficam
// `undefined` e cada função exportada abaixo falha de forma controlada (erro
// claro, capturável pelo try/catch de quem chama — ex: LoginModal.tsx já
// tem um try/catch em volta de `loginWithGoogle()`), em vez de derrubar o
// app inteiro no import.
let app: FirebaseApp | undefined;
let auth: Auth | undefined;
let db: Firestore | undefined;

if (firebaseConfig.apiKey) {
  app = getApps().length > 0 ? getApp() : initializeApp(firebaseConfig);
  auth = getAuth(app);
  db = getFirestore(app, firestoreDatabaseId || undefined);
}

export { auth, db };

const googleProvider = new GoogleAuthProvider();

const FIREBASE_NOT_CONFIGURED_MESSAGE = 'Login com Google/e-mail indisponível — Firebase não configurado neste ambiente.';

function requireAuth(): Auth {
  if (!auth) throw new Error(FIREBASE_NOT_CONFIGURED_MESSAGE);
  return auth;
}

function requireDb(): Firestore {
  if (!db) throw new Error(FIREBASE_NOT_CONFIGURED_MESSAGE);
  return db;
}

/**
 * Login via Google Pop-up
 */
export const loginWithGoogle = async () => {
  const result = await signInWithPopup(requireAuth(), googleProvider);
  const user = result.user;

  // Registra/atualiza dados no Firestore com tratamento de erro
  try {
    await setDoc(doc(requireDb(), 'users', user.uid), {
      uid: user.uid,
      email: user.email,
      displayName: user.displayName || user.email?.split('@')[0],
      photoURL: user.photoURL,
      lastLogin: new Date().toISOString()
    }, { merge: true });
  } catch (err) {
    console.warn('Não foi possível salvar sessão no Firestore:', err);
  }

  return user;
};

