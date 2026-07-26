import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  base: './',
  build: {
    rollupOptions: {
      output: {
        manualChunks(id) {
          // 神经网络权重（~1MB）单独成块：主包保持轻量，权重可独立缓存
          if (id.includes('src/ai/weights/')) return 'policy-weights';
        },
      },
    },
  },
});
