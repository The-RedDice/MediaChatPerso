module.exports = {
  apps: [
    {
      name: 'bordel-server',
      script: 'server.js',
      cwd: './server',
      env: {
        NODE_ENV: 'production',
      },
    },
    {
      name: 'bordel-bot',
      script: 'index.js',
      cwd: './discord-bot',
      env: {
        NODE_ENV: 'production',
      },
    },
  ],
};
