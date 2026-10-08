/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_TILES_BASE_URL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
