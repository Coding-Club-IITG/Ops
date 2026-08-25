module.exports = {
  apps: [
    {
      name: "ops-web",
      cwd: ".",
      script: "pnpm",
      args: "start",
      env: {
        NODE_ENV: "production",
        PORT: 3005,
      },
    },
    {
      name: "ops-worker",
      cwd: ".",
      script: "pnpm",
      args: "worker",
      env: {
        NODE_ENV: "production",
      },
    },
  ],
};
