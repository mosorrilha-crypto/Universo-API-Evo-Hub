import { initializeApp, getApps, getApp } from 'firebase/app';
import {
  getAuth,
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
  signInWithPopup,
  GoogleAuthProvider,
  signOut,
  sendPasswordResetEmail,
  onAuthStateChanged,
  User
} from 'firebase/auth';
import {
  getFirestore,
  doc,
  setDoc,
  getDoc,
  collection,
  query,
  where,
  getDocs
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

// Inicializa o Firebase App
const app = getApps().length > 0 ? getApp() : initializeApp(firebaseConfig);

export const auth = getAuth(app);
export const db = getFirestore(app, firestoreDatabaseId || undefined);

const googleProvider = new GoogleAuthProvider();

/**
 * Login com E-mail e Senha via Firebase Auth
 */
export const loginWithEmailPassword = async (email: string, pass: string) => {
  const credential = await signInWithEmailAndPassword(auth, email, pass);
  return credential.user;
};

/**
 * Cadastro de novo usuário com E-mail e Senha no Firebase Auth
 */
export const registerWithEmailPassword = async (email: string, pass: string, name?: string) => {
  const credential = await createUserWithEmailAndPassword(auth, email, pass);
  const user = credential.user;

  // Salva o perfil do usuário na coleção 'users' do Firestore com tratamento de erro
  try {
    await setDoc(doc(db, 'users', user.uid), {
      uid: user.uid,
      email: user.email,
      displayName: name || user.displayName || email.split('@')[0],
      createdAt: new Date().toISOString(),
      role: 'operator'
    }, { merge: true });
  } catch (err) {
    console.warn('Não foi possível salvar perfil no Firestore:', err);
  }

  return user;
};

/**
 * Login via Google Pop-up
 */
export const loginWithGoogle = async () => {
  const result = await signInWithPopup(auth, googleProvider);
  const user = result.user;

  // Registra/atualiza dados no Firestore com tratamento de erro
  try {
    await setDoc(doc(db, 'users', user.uid), {
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

/**
 * Envio de e-mail de redefinição/recuperação de senha
 */
export const resetUserPassword = async (email: string) => {
  await sendPasswordResetEmail(auth, email);
};

/**
 * Logout
 */
export const logoutFirebase = async () => {
  await signOut(auth);
};

/**
 * Listener de estado da autenticação
 */
export const onAuthUpdate = (callback: (user: User | null) => void) => {
  return onAuthStateChanged(auth, callback);
};
