/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_API_KEY?: string;
  /** Optional absolute API origin (e.g. https://api.example.com). Leave unset to use same-origin `/v1` (Vite proxy in dev). */
  readonly VITE_API_BASE_URL?: string;
  /** Dev only: override proxy target for `/v1` (default http://127.0.0.1:4000). */
  readonly VITE_API_PROXY_TARGET?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
