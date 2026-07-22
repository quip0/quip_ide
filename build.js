const esbuild = require('esbuild');

esbuild.buildSync({
  entryPoints: ['src/renderer.js', 'src/treewin.js'],
  bundle: true,
  outdir: 'dist',
  format: 'iife',
  loader: { '.css': 'css', '.woff2': 'dataurl', '.woff': 'dataurl', '.ttf': 'dataurl' },
  logLevel: 'info'
});
