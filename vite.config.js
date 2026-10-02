import { defineConfig } from 'vite';
import { viteStaticCopy } from 'vite-plugin-static-copy';

export default defineConfig({
  base: './',
  plugins: [
    viteStaticCopy({
      targets: [
        {
          src: 'node_modules/@babylonjs/havok/lib/esm/HavokPhysics.wasm',
          dest: 'assets'
        }
      ]
    })
  ],
  build: {
    outDir: 'dist',
    assetsDir: 'assets',
    rollupOptions: {
      output: {
        manualChunks: {
          babylon: ['@babylonjs/core', '@babylonjs/loaders'],
          havok: ['@babylonjs/havok']
        }
      }
    }
  },
  optimizeDeps: {
    exclude: ['@babylonjs/havok']
  },
  assetsInclude: ['**/*.wasm']
});
