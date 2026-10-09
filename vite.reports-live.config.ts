import {defineConfig} from 'vite'
import base from './vite.config'
export default defineConfig({...base,preview:{proxy:{'/api':{target:process.env.BILLING_REPORT_API_URL??'http://127.0.0.1:15064',changeOrigin:true}}}})
