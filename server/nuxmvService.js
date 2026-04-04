import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { spawn } from 'node:child_process'

export async function runNuXmv({ modelContent, fileName }) {
  const tmpDir = await mkdtemp(path.join(os.tmpdir(), 'jjodel-nuxmv-'))
  const modelPath = path.join(tmpDir, fileName || 'model.smv')
  const binary = process.env.NUXMV_PATH || 'nuXmv'

  try {
    await writeFile(modelPath, modelContent, 'utf8')

    console.log('Running nuXmv from:', binary)
    console.log('Temporary model path:', modelPath)

    const output = await new Promise((resolve, reject) => {
      const child = spawn(binary, [modelPath], {
        stdio: ['ignore', 'pipe', 'pipe'],
      })

      let stdout = ''
      let stderr = ''

      child.stdout.on('data', (chunk) => {
        stdout += chunk.toString()
      })

      child.stderr.on('data', (chunk) => {
        stderr += chunk.toString()
      })

      child.on('error', (error) => {
        reject(
          new Error(
            `Unable to start nuXmv. Make sure the binary exists in the container. Original error: ${error.message}`
          )
        )
      })

      child.on('close', (code) => {
        console.log('nuXmv exit code:', code)
        resolve({ code, stdout, stderr })
      })
    })

    return output
  } finally {
    await rm(tmpDir, { recursive: true, force: true })
  }
}