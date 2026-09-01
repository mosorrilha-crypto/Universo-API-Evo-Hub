/// <reference types="vite/client" />

// TASK-0191 — declara as variáveis VITE_FIREBASE_* usadas em src/lib/firebase.ts
// (import.meta.env), já que este projeto não tinha nenhum uso de env var no
// frontend até agora e o tsconfig não referencia vite/client em nenhum lugar.
interface ImportMetaEnv {
  readonly VITE_FIREBASE_PROJECT_ID: string;
  readonly VITE_FIREBASE_APP_ID: string;
  readonly VITE_FIREBASE_API_KEY: string;
  readonly VITE_FIREBASE_AUTH_DOMAIN: string;
  readonly VITE_FIREBASE_STORAGE_BUCKET: string;
  readonly VITE_FIREBASE_MESSAGING_SENDER_ID: string;
  readonly VITE_FIREBASE_FIRESTORE_DATABASE_ID: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
