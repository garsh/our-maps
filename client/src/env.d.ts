/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_STADIA_API_KEY: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
