/// <reference types="vite/client" />
/// <reference types="vite-plugin-pwa/client" />

declare module '*.png?inline' {
  const src: string;
  export default src;
}

interface ImportMetaEnv {
  readonly VITE_APP_BUILD_TIME: string;
  readonly MODE?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}

interface BackgroundFetchUIOptions {
  icons?: Array<{ src: string; sizes?: string; type?: string }>;
  title?: string;
}

interface BackgroundFetchOptions extends BackgroundFetchUIOptions {
  downloadTotal?: number;
}

interface BackgroundFetchRegistration extends EventTarget {
  readonly id: string;
  readonly uploadTotal: number;
  readonly uploaded: number;
  readonly downloadTotal: number;
  readonly downloaded: number;
  readonly result: '' | 'success' | 'failure';
  readonly failureReason: '' | 'error' | 'abort';
  readonly recordsAvailable: boolean;
  abort(): Promise<boolean>;
  match(request: RequestInfo, options?: any): Promise<BackgroundFetchRecord | undefined>;
  matchAll(request?: RequestInfo, options?: any): Promise<BackgroundFetchRecord[]>;
  updateUI(options: BackgroundFetchUIOptions): Promise<void>;
}

interface BackgroundFetchRecord {
  readonly request: Request;
  readonly responseReady: Promise<Response>;
}

interface BackgroundFetchManager {
  fetch(id: string, requests: RequestInfo | RequestInfo[], options?: BackgroundFetchOptions): Promise<BackgroundFetchRegistration>;
  get(id: string): Promise<BackgroundFetchRegistration | undefined>;
  getIds(): Promise<string[]>;
}

interface ServiceWorkerRegistration {
  readonly backgroundFetch?: BackgroundFetchManager;
}

interface Window {
  BackgroundFetchManager?: {
    prototype: BackgroundFetchManager;
    new(): BackgroundFetchManager;
  };
}
