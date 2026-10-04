import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'

// Content-Security-Policy is injected for production builds only; the dev server
// needs inline scripts / eval-style HMR that a strict policy would block.
function csp(apiUrl: string) {
  const ws = apiUrl.replace(/^http/, 'ws')
  const policy = [
    "default-src 'self'",
    "script-src 'self'",
    "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
    "font-src 'self' https://fonts.gstatic.com",
    "img-src 'self' data: blob:",
    `connect-src 'self' ${apiUrl} ${ws}`,
    "worker-src 'self' blob:",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
  ].join('; ')
  return {
    name: 'inject-csp',
    apply: 'build' as const,
    transformIndexHtml: () => [
      { tag: 'meta', attrs: { 'http-equiv': 'Content-Security-Policy', content: policy }, injectTo: 'head-prepend' as const },
      { tag: 'meta', attrs: { name: 'referrer', content: 'no-referrer' }, injectTo: 'head-prepend' as const },
    ],
  }
}

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '')
  const apiUrl = env.VITE_API_URL || 'http://127.0.0.1:8000'
  return {
    plugins: [react(), csp(apiUrl)],
    server: { host: '127.0.0.1', port: 5173, strictPort: true },
    build: { target: 'es2022', sourcemap: false },
    test: { environment: 'node', include: ['tests/**/*.test.ts'] },
  } as any
})
