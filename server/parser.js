function normalizeFormula(text) {
  return text.replace(/\s+/g, ' ').trim()
}

export function extractPropertiesFromSmv(smvText) {
  const lines = smvText.split(/\r?\n/)
  const properties = []

  for (const line of lines) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('--')) continue

    const match =
      trimmed.match(/^(SPEC)\s+(.+)$/i) ||
      trimmed.match(/^(CTLSPEC)\s+(.+)$/i) ||
      trimmed.match(/^(LTLSPEC)\s+(.+)$/i) ||
      trimmed.match(/^(INVARSPEC)\s+(.+)$/i)

    if (!match) continue

    const keyword = match[1].toUpperCase()
    const formula = normalizeFormula(match[2])

    let type = 'UNKNOWN'
    if (keyword === 'SPEC' || keyword === 'CTLSPEC') type = 'CTL'
    if (keyword === 'LTLSPEC') type = 'LTL'
    if (keyword === 'INVARSPEC') type = 'INVAR'

    properties.push({
      id: `P${properties.length + 1}`,
      type,
      formula,
      status: 'unknown',
      description: '',
    })
  }

  return properties
}

function parseStatesFromLines(lines) {
  const states = []
  let current = null

  for (const line of lines) {
    const stateMatch =
      line.match(/^\s*->\s*State:\s*([0-9.]+)\s*<-\s*$/) ||
      line.match(/^\s*State:\s*([0-9.]+)\s*$/)

    if (stateMatch) {
      if (current) states.push(current)
      current = {
        id: stateMatch[1],
        variables: {},
      }
      continue
    }

    if (!current) continue
    if (!line.trim()) continue
    if (/^--\s*Loop starts here/i.test(line)) continue
    if (/^Trace /i.test(line)) continue
    if (/^\*\*\*/.test(line)) continue
    if (/^-- /.test(line)) continue

    const varMatch = line.match(/^\s*([^=]+?)\s*=\s*(.+)\s*$/)
    if (varMatch) {
      current.variables[varMatch[1].trim()] = varMatch[2].trim()
    }
  }

  if (current) states.push(current)

  return states
}

export function parseNuXmvOutput({ smvText, stdout, stderr, fileName }) {
  const modelProperties = extractPropertiesFromSmv(smvText)
  const lines = stdout.split(/\r?\n/)

  const statusEntries = []
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i]
    const match = line.match(/^\s*-- specification\s+(.+?)\s+is\s+(true|false)\s*$/i)
    if (match) {
      statusEntries.push({
        lineIndex: i,
        formula: normalizeFormula(match[1]),
        status: match[2].toLowerCase() === 'true' ? 'passed' : 'failed',
      })
    }
  }

  const mergedProperties = modelProperties.map((property, index) => {
    const statusEntry = statusEntries[index]
    return {
      ...property,
      formula: property.formula,
      status: statusEntry?.status ?? 'unknown',
    }
  })

  for (let i = 0; i < mergedProperties.length; i += 1) {
    const property = mergedProperties[i]
    const statusEntry = statusEntries[i]
    if (!statusEntry || property.status !== 'failed') continue

    const nextStatusLine = statusEntries[i + 1]?.lineIndex ?? lines.length
    const segment = lines.slice(statusEntry.lineIndex, nextStatusLine)
    const states = parseStatesFromLines(segment)

    if (states.length > 0) {
      property.counterexample = { states }
    }
  }

  const passed = mergedProperties.filter((property) => property.status === 'passed').length
  const failed = mergedProperties.filter((property) => property.status === 'failed').length

  return {
    modelName: fileName.replace(/\.[^.]+$/, '') || 'model',
    source: 'Jjodel',
    engine: 'nuXmv',
    generatedAt: new Date().toISOString(),
    inputModel: {
      fileName,
      content: smvText,
    },
    summary: {
      totalProperties: mergedProperties.length,
      passed,
      failed,
    },
    properties: mergedProperties,
    rawOutput: stdout,
    rawError: stderr,
  }
}