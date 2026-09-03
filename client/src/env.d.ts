/// <reference types="vite/client" />
/// <reference types="vite-plugin-pwa/client" />

declare module '*.png?inline' {
  const src: string;
  export default src;
}

interface ImportMetaEnv {
  readonly VITE_APP_BUILD_TIME: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
