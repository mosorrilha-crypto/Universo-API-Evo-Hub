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

import firebaseConfig from '../../firebase-applet-config.json';

// Inicializa o Firebase App
const app = getApps().length > 0 ? getApp() : initializeApp(firebaseConfig);

export const auth = getAuth(app);
export const db = getFirestore(app, firebaseConfig.firestoreDatabaseId || undefined);

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
