import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
export default defineConfig({base:'./', plugins:[react()], optimizeDeps:{entries:['index.html']},server:{port:5173,strictPort:true,watch:{ignored:['**/work/**','**/android/**','**/release/**','**/resources/**']}}, build:{target:'es2022'}});
