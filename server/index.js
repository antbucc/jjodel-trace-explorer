
import express from 'express'
import multer from 'multer'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { runNuXmv } from './nuxmvService.js'
import { parseNuXmvOutput } from './parser.js'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const rootDir = path.join(__dirname, '..')
const distDir = path.join(rootDir, 'dist')

const app = express()
const upload = multer({ storage: multer.memoryStorage() })

app.get('/api/health', (_req, res) => {
  res.status(200).json({ ok: true })
})

app.post('/api/verify', upload.single('model'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'No SMV file uploaded. Use form field "model".' })
    }

    const smvText = req.file.buffer.toString('utf8')
    const fileName = req.file.originalname || 'model.smv'

    console.log('Received file:', fileName)
    console.log('SMV size:', smvText.length)

    const result = await runNuXmv({
      modelContent: smvText,
      fileName,
    })

    const report = parseNuXmvOutput({
      smvText,
      stdout: result.stdout,
      stderr: result.stderr,
      fileName,
    })

    return res.json(report)
  } catch (error) {
    console.error('Verification error:', error)
    return res.status(500).json({
      error: error.message || 'Unexpected verification error.',
    })
  }
})

app.use(express.static(distDir))

app.get('*', (req, res, next) => {
  if (req.path.startsWith('/api/')) return next()
  res.sendFile(path.join(distDir, 'index.html'))
})

const port = Number(process.env.PORT || 8080)
const host = '0.0.0.0'

console.log('PORT env =', process.env.PORT)
console.log('NUXMV_PATH =', process.env.NUXMV_PATH)

app.listen(port, host, () => {
  console.log(`Server listening on http://${host}:${port}`)
  console.log('Health endpoint available at /api/health')
})