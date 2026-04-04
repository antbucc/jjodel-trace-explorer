function normalizeWhitespace(text) {
  return text.replace(/\s+/g, ' ').trim()
}

function stripInlineComment(line) {
  const idx = line.indexOf('--')
  if (idx === -1) return line
  return line.slice(0, idx)
}

function getPropertyType(keyword) {
  const normalized = keyword.toUpperCase()

  if (normalized === 'SPEC' || normalized === 'CTLSPEC') return 'CTL'
  if (normalized === 'LTLSPEC') return 'LTL'
  if (normalized === 'INVARSPEC') return 'INVAR'

  return 'UNKNOWN'
}

/**
 * Extract properties from SMV text.
 * Supports:
 *   SPEC ...
 *   CTLSPEC ...
 *   LTLSPEC ...
 *   INVARSPEC ...
 *
 * Also supports multi-line formulas until the next property keyword,
 * MODULE/VAR/ASSIGN/DEFINE/etc. section, or EOF.
 */
export function extractPropertiesFromSmv(smvText) {
  const lines = smvText.split(/\r?\n/)
  const properties = []

  const propertyKeywords = ['SPEC', 'CTLSPEC', 'LTLSPEC', 'INVARSPEC']
  const sectionKeywords = [
    'MODULE',
    'VAR',
    'IVAR',
    'FROZENVAR',
    'DEFINE',
    'CONSTANTS',
    'ASSIGN',
    'TRANS',
    'INIT',
    'INVAR',
    'FAIRNESS',
    'JUSTICE',
    'COMPASSION',
  ]

  let current = null

  function flushCurrent() {
    if (!current) return

    const formula = normalizeWhitespace(current.formulaLines.join(' '))

    if (formula) {
      properties.push({
        id: `P${properties.length + 1}`,
        type: getPropertyType(current.keyword),
        formula,
        status: 'unknown',
        description: '',
      })
    }

    current = null
  }

  for (let rawLine of lines) {
    const noComment = stripInlineComment(rawLine)
    const trimmed = noComment.trim()

    if (!trimmed) {
      if (current) {
        current.formulaLines.push(' ')
      }
      continue
    }

    const keywordMatch = trimmed.match(/^(SPEC|CTLSPEC|LTLSPEC|INVARSPEC)\b(.*)$/i)

    if (keywordMatch) {
      flushCurrent()

      current = {
        keyword: keywordMatch[1].toUpperCase(),
        formulaLines: [],
      }

      const rest = keywordMatch[2]?.trim()
      if (rest) {
        current.formulaLines.push(rest)
      }

      continue
    }

    if (current) {
      const upper = trimmed.toUpperCase()

      const startsNewSection = sectionKeywords.some((kw) => upper.startsWith(`${kw} `) || upper === kw)
      const startsNewProperty = propertyKeywords.some((kw) => upper.startsWith(`${kw} `) || upper === kw)

      if (startsNewProperty || startsNewSection) {
        flushCurrent()

        if (startsNewProperty) {
          const nestedMatch = trimmed.match(/^(SPEC|CTLSPEC|LTLSPEC|INVARSPEC)\b(.*)$/i)
          current = {
            keyword: nestedMatch[1].toUpperCase(),
            formulaLines: [],
          }
          const rest = nestedMatch[2]?.trim()
          if (rest) {
            current.formulaLines.push(rest)
          }
        }

        continue
      }

      current.formulaLines.push(trimmed)
    }
  }

  flushCurrent()

  console.log(
    'Extracted properties:',
    properties.map((p) => `${p.id} [${p.type}] ${p.formula}`)
  )

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
      const name = varMatch[1].trim()
      const value = varMatch[2].trim()
      current.variables[name] = value
    }
  }

  if (current) states.push(current)

  return states
}

function normalizeFormulaForComparison(formula) {
  return normalizeWhitespace(formula)
    .replace(/\(\s+/g, '(')
    .replace(/\s+\)/g, ')')
}

/**
 * Parse nuXmv stdout and align property results with extracted properties.
 */
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
        formula: normalizeFormulaForComparison(match[1]),
        status: match[2].toLowerCase() === 'true' ? 'passed' : 'failed',
      })
    }
  }

  console.log(
    'nuXmv status entries:',
    statusEntries.map((s) => `${s.status.toUpperCase()} ${s.formula}`)
  )

  const mergedProperties = modelProperties.map((property, index) => {
    const normalizedPropertyFormula = normalizeFormulaForComparison(property.formula)

    let matched = statusEntries.find(
      (entry) => entry.formula === normalizedPropertyFormula
    )

    if (!matched) {
      matched = statusEntries[index]
    }

    return {
      ...property,
      status: matched?.status ?? 'unknown',
    }
  })

  for (let i = 0; i < mergedProperties.length; i += 1) {
    const property = mergedProperties[i]
    if (property.status !== 'failed') continue

    const normalizedPropertyFormula = normalizeFormulaForComparison(property.formula)

    let currentStatusIndex = statusEntries.findIndex(
      (entry) => entry.formula === normalizedPropertyFormula && entry.status === 'failed'
    )

    if (currentStatusIndex === -1) {
      currentStatusIndex = i < statusEntries.length ? i : -1
    }

    if (currentStatusIndex === -1) continue

    const startLine = statusEntries[currentStatusIndex].lineIndex
    const endLine =
      currentStatusIndex + 1 < statusEntries.length
        ? statusEntries[currentStatusIndex + 1].lineIndex
        : lines.length

    const segment = lines.slice(startLine, endLine)
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