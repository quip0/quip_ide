const esbuild = require('esbuild');

esbuild.buildSync({
  entryPoints: ['src/renderer.js'],
  bundle: true,
  outfile: 'dist/renderer.js',
  format: 'iife',
  loader: { '.css': 'css' },
  logLevel: 'info'
});
