// Pre-bundle three and GLTFLoader together, so the browser never gets two copies of three
// (Vite would otherwise discover GLTFLoader at runtime and re-optimize mid-load).
import { defineConfig } from 'vite';

export default defineConfig({
  resolve: { dedupe: ['three'] },
  optimizeDeps: { include: ['three', 'three/examples/jsm/loaders/GLTFLoader.js'] },
});
