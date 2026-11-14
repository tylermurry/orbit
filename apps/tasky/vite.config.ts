import react from '@vitejs/plugin-react';

// Plain object (not defineConfig): the monorepo hoists a second vite copy for vitest whose types
// would otherwise conflict with this workspace's vite.
export default {
  plugins: [react()],
  server: { port: 5174 },
};
