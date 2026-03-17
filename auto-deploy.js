// Auto-deploy script for floating-widget
// Watches for changes and runs `shopify app deploy` automatically

const chokidar = require('chokidar');
const { exec } = require('child_process');

const WATCH_PATH = './floating-widget';

console.log('Watching for changes in', WATCH_PATH);

chokidar.watch(WATCH_PATH, { ignoreInitial: true }).on('all', (event, path) => {
  console.log(`[${new Date().toLocaleTimeString()}] Detected ${event} in ${path}. Deploying...`);
  exec('shopify app deploy', (err, stdout, stderr) => {
    if (err) {
      console.error('Deployment failed:', stderr);
    } else {
      console.log('Deployment complete:', stdout);
    }
  });
});
