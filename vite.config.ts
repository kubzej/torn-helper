import { defineConfig } from 'vite';

export default defineConfig({
  root: '.',
  publicDir: 'public',
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    rollupOptions: {
      input: {
        main: './index.html',
        app: './app.html',
        analyzer: './analyzer.html',
      },
    },
  },
  server: {
    open: true,
    port: 3000,
  },
  resolve: {
    alias: {
      '@': '/src',
    },
  },
});
