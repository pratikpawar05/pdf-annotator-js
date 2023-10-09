import { defineConfig } from 'vite';
import dts from 'vite-plugin-dts';

export default defineConfig({
  plugins: [
    dts({ 
      insertTypesEntry: true,
      entryRoot: '.'
    })
  ],
  server: {
    open: '/test/index.html'
  },
  build: {
    sourcemap: true,
    lib: {
      entry: './src/index.ts',
      name: 'PDFAnnotator',
      formats: ['es', 'umd'],
      fileName: (format) => `pdf-annotator.${format}.js`
    },
    rollupOptions: {
      output: {
        assetFileNames: 'pdf-annotator.[ext]'
      }
    }
  }
});