import { defineConfig, loadEnv } from 'vite'
import vue from '@vitejs/plugin-vue'

// 开发环境：前端 5173、后端 3000，浏览器只访问 5173，
// 由 Vite 把 /api 开头的请求转发给后端 —— 这样就没有跨域问题。
// 生产环境：前端打包后由同一个 Express 进程托管，页面与数据同源，天然无跨域。
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '')
  const backendPort = env.VITE_BACKEND_PORT || '3000'
  return {
    plugins: [vue()],
    server: {
      host: '0.0.0.0',
      port: Number(env.VITE_PORT || 5173),
      proxy: {
        '/api': {
          target: 'http://127.0.0.1:' + backendPort,
          changeOrigin: true
        }
      }
    }
  }
})
