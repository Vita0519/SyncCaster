import { defineConfig } from 'vite';
import vue from '@vitejs/plugin-vue';
import UnoCSS from 'unocss/vite';
import { resolve } from 'path';

export default defineConfig({
  plugins: [
    vue(),
    UnoCSS(),
  ],
  
  resolve: {
    alias: {
      '@': resolve(__dirname, 'src'),
      '@synccaster/core': resolve(__dirname, '../../packages/core/src'),
      '@synccaster/adapters': resolve(__dirname, '../../packages/adapters/src'),
      '@synccaster/utils': resolve(__dirname, '../../packages/utils/src'),
    },
  },

  build: {
    outDir: 'dist',
    rollupOptions: {
      input: {
        popup: resolve(__dirname, 'src/ui/popup/index.html'),
        options: resolve(__dirname, 'src/ui/options/index.html'),
        sidepanel: resolve(__dirname, 'src/ui/sidepanel/index.html'),
      },
    },
  },

  server: {
    port: 5173,
    strictPort: true,
    hmr: {
      port: 5173,
    },
  },
});
