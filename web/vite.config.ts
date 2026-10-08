import { defineConfig } from 'vite';

export default defineConfig({
  server: {
    // En développement, l'extension lit les tuiles servies par ce serveur :
    // on autorise les origines d'extension (Chrome/Edge et Firefox) en plus de localhost.
    cors: {
      origin: [/^https?:\/\/(?:localhost|127\.0\.0\.1)(?::\d+)?$/, /^chrome-extension:\/\//, /^moz-extension:\/\//],
      exposedHeaders: ['Content-Range', 'Content-Length', 'ETag'],
    },
  },
});
