import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  Background,
  Controls,
  Handle,
  MarkerType,
  MiniMap,
  Position,
  ReactFlow,
  useEdgesState,
  useNodesState,
} from '@xyflow/react'
import '@xyflow/react/dist/style.css'

function readFileAsText(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result || ''))
    reader.onerror = reject
    reader.readAsText(file)
  })
}

function statesFromCounterexample(counterexample) {
  if (!counterexample?.states) return []
  return counterexample.states.map((state) => ({
    id: state.id,
    vars: Object.entries(state.variables || {}).map(([name, value]) => ({
      name,
      value: String(value),
    })),
  }))
}

function varsToMap(state) {
  return Object.fromEntries(state.vars.map((item) => [item.name, item.value]))
}

function changedVariables(prevState, nextState) {
  if (!prevState || !nextState) return []

  const prev = varsToMap(prevState)
  const next = varsToMap(nextState)
  const keys = new Set([...Object.keys(prev), ...Object.keys(next)])
  const changed = []

  keys.forEach((key) => {
    if (prev[key] !== next[key]) {
      changed.push({
        name: key,
        from: prev[key] ?? 'undefined',
        to: next[key] ?? 'undefined',
      })
    }
  })

  return changed
}

function buildGraph(states) {
  const columns = 3
  const horizontalGap = 320
  const verticalGap = 220

  const nodes = states.map((state, index) => {
    const row = Math.floor(index / columns)
    const col = index % columns

    return {
      id: state.id,
      type: 'stateNode',
      position: {
        x: col * horizontalGap,
        y: row * verticalGap + (col === 1 ? 30 : 0),
      },
      data: state,
      sourcePosition: Position.Right,
      targetPosition: Position.Left,
    }
  })

  const edges = states.slice(0, -1).map((state, index) => {
    const nextState = states[index + 1]
    const changes = changedVariables(state, nextState)

    return {
      id: `e-${state.id}-${nextState.id}`,
      source: state.id,
      target: nextState.id,
      type: 'smoothstep',
      animated: true,
      markerEnd: { type: MarkerType.ArrowClosed },
      style: { stroke: '#4f46e5', strokeWidth: 4 },
      label: changes.length ? `${changes.length} change${changes.length > 1 ? 's' : ''}` : 'No changes',
      labelStyle: { fontSize: 12, fontWeight: 700, fill: '#312e81' },
      labelBgStyle: { fill: '#ffffff', fillOpacity: 0.96, stroke: '#cbd5e1' },
      labelBgPadding: [8, 4],
      labelBgBorderRadius: 999,
      data: { changes },
      zIndex: 1000,
    }
  })

  return { nodes, edges }
}

function StateNode({ data }) {
  return (
    <div
      style={{
        minWidth: 230,
        maxWidth: 270,
        background: '#fff',
        border: '2px solid #cbd5e1',
        borderRadius: 18,
        padding: 12,
        boxShadow: '0 8px 18px rgba(15,23,42,0.08)',
      }}
    >
      <Handle type="target" position={Position.Left} style={{ width: 10, height: 10, background: '#4f46e5' }} />
      <Handle type="source" position={Position.Right} style={{ width: 10, height: 10, background: '#4f46e5' }} />

      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10, marginBottom: 10 }}>
        <div>
          <div style={{ fontSize: 15, fontWeight: 800 }}>State {data.id}</div>
          <div style={{ fontSize: 11, color: '#64748b' }}>Execution snapshot</div>
        </div>
        <div
          style={{
            borderRadius: 999,
            background: '#eef2ff',
            color: '#4338ca',
            padding: '4px 8px',
            fontSize: 11,
            fontWeight: 800,
          }}
        >
          {data.vars.length} vars
        </div>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        {data.vars.map((item) => (
          <div
            key={`${data.id}-${item.name}`}
            style={{
              borderRadius: 12,
              background: '#f8fafc',
              padding: '8px 10px',
              fontSize: 12,
              border: '1px solid #e2e8f0',
            }}
          >
            <span style={{ fontWeight: 700 }}>{item.name}</span>
            <span style={{ color: '#94a3b8', margin: '0 6px' }}>=</span>
            <span>{item.value}</span>
          </div>
        ))}
      </div>
    </div>
  )
}

const nodeTypes = { stateNode: StateNode }

function PropertyTypeBadge({ type }) {
  return (
    <span
      style={{
        borderRadius: 999,
        padding: '4px 8px',
        fontSize: 11,
        fontWeight: 800,
        background: '#eef2ff',
        color: '#312e81',
      }}
    >
      {type || 'UNKNOWN'}
    </span>
  )
}

function StatusBadge({ status }) {
  const passed = status === 'passed'
  return (
    <span
      style={{
        borderRadius: 999,
        padding: '5px 10px',
        fontSize: 12,
        fontWeight: 800,
        background: passed ? '#dcfce7' : '#fee2e2',
        color: passed ? '#166534' : '#991b1b',
        whiteSpace: 'nowrap',
      }}
    >
      {passed ? 'Passed' : 'Failed'}
    </span>
  )
}

export default function TraceVisualizer() {
  const reactFlowRef = useRef(null)

  const [smvText, setSmvText] = useState('')
  const [smvFileName, setSmvFileName] = useState('No model loaded')
  const [report, setReport] = useState(null)
  const [isChecking, setIsChecking] = useState(false)
  const [checkFeedback, setCheckFeedback] = useState('Load an SMV model and run checking.')
  const [propertyFilter, setPropertyFilter] = useState('all')
  const [selectedPropertyId, setSelectedPropertyId] = useState(null)
  const [selectedEdgeId, setSelectedEdgeId] = useState(null)
  const [selectedStateId, setSelectedStateId] = useState(null)
  const [expandedProperties, setExpandedProperties] = useState(() => new Set())

  const filteredProperties = useMemo(() => {
    if (!report) return []
    if (propertyFilter === 'all') return report.properties
    return report.properties.filter((property) => property.status === propertyFilter)
  }, [report, propertyFilter])

  const selectedProperty = useMemo(() => {
    if (!report) return null
    return report.properties.find((property) => property.id === selectedPropertyId) ?? null
  }, [report, selectedPropertyId])

  const traceStates = useMemo(
    () => statesFromCounterexample(selectedProperty?.counterexample),
    [selectedProperty]
  )

  const graph = useMemo(() => buildGraph(traceStates), [traceStates])
  const [nodes, setNodes, onNodesChange] = useNodesState(graph.nodes)
  const [edges, setEdges, onEdgesChange] = useEdgesState(graph.edges)

  useEffect(() => {
    setNodes(graph.nodes)
    setEdges(graph.edges)
    setSelectedStateId(graph.nodes[0]?.id ?? null)
    setSelectedEdgeId(graph.edges[0]?.id ?? null)
  }, [graph, setNodes, setEdges])

  useEffect(() => {
    if (!report) {
      setExpandedProperties(new Set())
      return
    }
    const failedIds = report.properties
      .filter((property) => property.status === 'failed')
      .map((property) => property.id)
    setExpandedProperties(new Set(failedIds))
  }, [report])

  useEffect(() => {
    if (!reactFlowRef.current) return
    if (graph.nodes.length === 0) return

    const timer = setTimeout(() => {
      reactFlowRef.current.fitView({
        padding: 0.22,
        duration: 500,
        includeHiddenNodes: true,
        minZoom: 0.35,
        maxZoom: 1.2,
      })
    }, 80)

    return () => clearTimeout(timer)
  }, [graph])

  const selectedState = useMemo(
    () => traceStates.find((state) => state.id === selectedStateId) ?? null,
    [traceStates, selectedStateId]
  )

  const selectedEdge = useMemo(
    () => edges.find((edge) => edge.id === selectedEdgeId) ?? null,
    [edges, selectedEdgeId]
  )

  const traceSteps = useMemo(() => {
    return traceStates.map((state, index) => ({
      state,
      nextState: traceStates[index + 1] ?? null,
      changes: traceStates[index + 1] ? changedVariables(state, traceStates[index + 1]) : [],
    }))
  }, [traceStates])

  const handleSmvUpload = useCallback(async (event) => {
    const file = event.target.files?.[0]
    if (!file) return

    const text = await readFileAsText(file)

    setSmvText(text)
    setSmvFileName(file.name)
    setReport(null)
    setSelectedPropertyId(null)
    setSelectedStateId(null)
    setSelectedEdgeId(null)
    setCheckFeedback(`Loaded model: ${file.name}`)
  }, [])

  const handleRunChecking = useCallback(async () => {
    if (!smvText.trim()) {
      setCheckFeedback('Please load an SMV model before running verification.')
      return
    }

    setIsChecking(true)
    setCheckFeedback('Running formal verification...')

    try {
      const formData = new FormData()
      const file = new Blob([smvText], { type: 'text/plain' })
      formData.append('model', file, smvFileName)

      const response = await fetch('/api/verify', {
        method: 'POST',
        body: formData,
      })

      const result = await response.json()

      if (!response.ok) {
        throw new Error(result.error || 'Verification failed.')
      }

      setReport(result)
      setSelectedPropertyId(
        result.properties.find((property) => property.status === 'failed')?.id ??
          result.properties[0]?.id ??
          null
      )
      setSelectedStateId(null)
      setSelectedEdgeId(null)
      setCheckFeedback('Verification completed. Review the results below.')
    } catch (error) {
      setCheckFeedback(error.message || 'Verification failed.')
    } finally {
      setIsChecking(false)
    }
  }, [smvText, smvFileName])

  const handleExportReport = useCallback(() => {
    if (!report) return
    const blob = new Blob([JSON.stringify(report, null, 2)], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = 'verification-report.json'
    a.click()
    URL.revokeObjectURL(url)
  }, [report])

  const togglePropertyExpansion = useCallback((id) => {
    setExpandedProperties((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }, [])

  const expandAllProperties = useCallback(() => {
    setExpandedProperties(new Set(filteredProperties.map((property) => property.id)))
  }, [filteredProperties])

  const collapseAllProperties = useCallback(() => {
    setExpandedProperties(new Set())
  }, [])

  const currentStateIndex = useMemo(
    () => traceStates.findIndex((state) => state.id === selectedStateId),
    [traceStates, selectedStateId]
  )

  const goToPrevState = useCallback(() => {
    if (currentStateIndex > 0) {
      setSelectedStateId(traceStates[currentStateIndex - 1].id)
    }
  }, [currentStateIndex, traceStates])

  const goToNextState = useCallback(() => {
    if (currentStateIndex >= 0 && currentStateIndex < traceStates.length - 1) {
      setSelectedStateId(traceStates[currentStateIndex + 1].id)
    }
  }, [currentStateIndex, traceStates])

  const handleAutoLayout = useCallback(() => {
    if (!reactFlowRef.current) return
    reactFlowRef.current.fitView({
      padding: 0.22,
      duration: 500,
      includeHiddenNodes: true,
      minZoom: 0.35,
      maxZoom: 1.2,
    })
  }, [])

  const handleZoomIn = useCallback(() => {
    if (!reactFlowRef.current) return
    reactFlowRef.current.zoomIn({ duration: 250 })
  }, [])

  const handleZoomOut = useCallback(() => {
    if (!reactFlowRef.current) return
    reactFlowRef.current.zoomOut({ duration: 250 })
  }, [])

  const summary = report?.summary ?? { totalProperties: 0, passed: 0, failed: 0 }
  const hasFailedProperties = report?.properties?.some((property) => property.status === 'failed') ?? false

  return (
    <div
      style={{
        minHeight: '100vh',
        background: 'linear-gradient(180deg, #f8fafc 0%, #eef2ff 100%)',
        padding: 24,
        color: '#0f172a',
        fontFamily: 'Inter, system-ui, sans-serif',
      }}
    >
      <div
        style={{
          maxWidth: 1700,
          margin: '0 auto 20px',
          display: 'flex',
          justifyContent: 'space-between',
          gap: 20,
          flexWrap: 'wrap',
        }}
      >
        <div>
          <h1 style={{ margin: 0, fontSize: 32, fontWeight: 800 }}>Jjodel Verification Explorer</h1>
          <p style={{ margin: '8px 0 0', color: '#475569', fontSize: 14 }}>
            Load an SMV model, run formal checking, and inspect passed properties, failed properties,
            and counterexamples with clear visual feedback.
          </p>
        </div>

        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
          <label
            style={{
              borderRadius: 14,
              background: '#e2e8f0',
              color: '#0f172a',
              padding: '10px 14px',
              fontWeight: 700,
              cursor: 'pointer',
            }}
          >
            Load SMV model
            <input type="file" accept=".smv,.txt" hidden onChange={handleSmvUpload} />
          </label>

          <button
            onClick={handleRunChecking}
            disabled={isChecking}
            style={{
              border: 0,
              borderRadius: 14,
              background: '#4f46e5',
              color: '#fff',
              padding: '10px 14px',
              fontWeight: 700,
              cursor: 'pointer',
              opacity: isChecking ? 0.7 : 1,
            }}
          >
            {isChecking ? 'Checking...' : 'Run checking'}
          </button>

          <button
            onClick={handleExportReport}
            disabled={!report}
            style={{
              border: 0,
              borderRadius: 14,
              background: '#0f172a',
              color: '#fff',
              padding: '10px 14px',
              fontWeight: 700,
              cursor: report ? 'pointer' : 'not-allowed',
              opacity: report ? 1 : 0.5,
            }}
          >
            Export report
          </button>
        </div>
      </div>

      <div
        style={{
          maxWidth: 1700,
          margin: '0 auto 18px',
          border: '1px solid #e2e8f0',
          background: '#fff',
          borderRadius: 18,
          padding: 14,
          boxShadow: '0 10px 30px rgba(15,23,42,0.06)',
        }}
      >
        <div style={{ fontSize: 12, textTransform: 'uppercase', letterSpacing: '0.08em', color: '#64748b' }}>
          Status
        </div>
        <div style={{ marginTop: 6, fontSize: 14, fontWeight: 700 }}>{checkFeedback}</div>
      </div>

      <div
        style={{
          maxWidth: 1700,
          margin: '0 auto',
          display: 'grid',
          gridTemplateColumns: '380px minmax(780px, 1fr) 300px',
          gap: 20,
        }}
      >
        <section
          style={{
            background: 'rgba(255,255,255,0.96)',
            border: '1px solid #e2e8f0',
            borderRadius: 24,
            padding: 20,
            boxShadow: '0 10px 30px rgba(15,23,42,0.08)',
          }}
        >
          <h2 style={{ margin: 0, fontSize: 22, fontWeight: 800 }}>Input model</h2>
          <p style={{ margin: '8px 0 0', color: '#475569', fontSize: 13 }}>
            The SMV model is loaded from file and displayed here exactly as submitted.
          </p>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginTop: 14 }}>
            {[
              ['File', smvFileName],
              ['Source', report?.source ?? 'Jjodel'],
              ['Engine', report?.engine ?? 'nuXmv'],
              ['Generated', report?.generatedAt ?? '-'],
            ].map(([label, value]) => (
              <div
                key={label}
                style={{ border: '1px solid #e2e8f0', borderRadius: 18, background: '#fff', padding: 14 }}
              >
                <div style={{ textTransform: 'uppercase', letterSpacing: '0.08em', color: '#64748b', fontSize: 11 }}>
                  {label}
                </div>
                <div style={{ marginTop: 4, fontSize: 14, fontWeight: 700, wordBreak: 'break-word' }}>{value}</div>
              </div>
            ))}
          </div>

          <div
            style={{
              marginTop: 16,
              border: '1px solid #dbe3ef',
              borderRadius: 18,
              overflow: 'hidden',
              background: '#0f172a',
            }}
          >
            <div
              style={{
                padding: '10px 14px',
                fontSize: 12,
                fontWeight: 700,
                color: '#cbd5e1',
                background: '#1e293b',
              }}
            >
              {smvFileName}
            </div>
            <pre
              style={{
                margin: 0,
                padding: 16,
                maxHeight: 520,
                overflow: 'auto',
                whiteSpace: 'pre-wrap',
                color: '#e2e8f0',
                fontSize: 12,
                lineHeight: 1.55,
                fontFamily: 'ui-monospace, Menlo, monospace',
              }}
            >
              {smvText || 'No model loaded.'}
            </pre>
          </div>
        </section>

        <section
          style={{
            background: 'rgba(255,255,255,0.96)',
            border: '1px solid #e2e8f0',
            borderRadius: 24,
            overflow: 'hidden',
            boxShadow: '0 10px 30px rgba(15,23,42,0.08)',
          }}
        >
          <div style={{ padding: 20, borderBottom: '1px solid #e2e8f0' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', gap: 20, alignItems: 'flex-start', flexWrap: 'wrap' }}>
              <div>
                <h2 style={{ margin: 0, fontSize: 22, fontWeight: 800 }}>Verification results</h2>
                <p style={{ margin: '8px 0 0', color: '#475569', fontSize: 13 }}>
                  Clear feedback on passing and failing properties, with a focused view on the properties that break the model.
                </p>
              </div>

              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                {['all', 'passed', 'failed'].map((value) => (
                  <button
                    key={value}
                    onClick={() => setPropertyFilter(value)}
                    style={{
                      border: '1px solid #cbd5e1',
                      background: propertyFilter === value ? '#eef2ff' : '#fff',
                      color: propertyFilter === value ? '#312e81' : '#334155',
                      borderRadius: 999,
                      padding: '8px 12px',
                      cursor: 'pointer',
                      fontSize: 12,
                      fontWeight: 700,
                    }}
                  >
                    {value.charAt(0).toUpperCase() + value.slice(1)}
                  </button>
                ))}
              </div>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 12, marginTop: 16 }}>
              <div style={{ border: '1px solid #e2e8f0', borderRadius: 18, background: '#fff', padding: 14 }}>
                <div style={{ textTransform: 'uppercase', letterSpacing: '0.08em', color: '#64748b', fontSize: 11 }}>
                  Total properties
                </div>
                <div style={{ marginTop: 4, fontSize: 28, fontWeight: 800 }}>{summary.totalProperties}</div>
              </div>
              <div style={{ border: '1px solid #e2e8f0', borderRadius: 18, background: '#fff', padding: 14 }}>
                <div style={{ textTransform: 'uppercase', letterSpacing: '0.08em', color: '#64748b', fontSize: 11 }}>
                  Passed
                </div>
                <div style={{ marginTop: 4, fontSize: 28, fontWeight: 800, color: '#15803d' }}>{summary.passed}</div>
              </div>
              <div style={{ border: '1px solid #e2e8f0', borderRadius: 18, background: '#fff', padding: 14 }}>
                <div style={{ textTransform: 'uppercase', letterSpacing: '0.08em', color: '#64748b', fontSize: 11 }}>
                  Failed
                </div>
                <div style={{ marginTop: 4, fontSize: 28, fontWeight: 800, color: '#b91c1c' }}>{summary.failed}</div>
              </div>
            </div>

            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 18, marginBottom: 10, gap: 10, flexWrap: 'wrap' }}>
              <div style={{ fontSize: 13, fontWeight: 700, color: '#0f172a' }}>
                Properties ({filteredProperties.length})
              </div>
              <div style={{ display: 'flex', gap: 6 }}>
                <button
                  onClick={expandAllProperties}
                  disabled={filteredProperties.length === 0}
                  style={{
                    border: '1px solid #cbd5e1',
                    background: '#fff',
                    color: '#334155',
                    borderRadius: 999,
                    padding: '5px 10px',
                    cursor: filteredProperties.length === 0 ? 'not-allowed' : 'pointer',
                    fontSize: 11,
                    fontWeight: 700,
                    opacity: filteredProperties.length === 0 ? 0.5 : 1,
                  }}
                >
                  Expand all
                </button>
                <button
                  onClick={collapseAllProperties}
                  disabled={expandedProperties.size === 0}
                  style={{
                    border: '1px solid #cbd5e1',
                    background: '#fff',
                    color: '#334155',
                    borderRadius: 999,
                    padding: '5px 10px',
                    cursor: expandedProperties.size === 0 ? 'not-allowed' : 'pointer',
                    fontSize: 11,
                    fontWeight: 700,
                    opacity: expandedProperties.size === 0 ? 0.5 : 1,
                  }}
                >
                  Collapse all
                </button>
              </div>
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {filteredProperties.map((property) => {
                const isExpanded = expandedProperties.has(property.id)
                const isSelected = selectedPropertyId === property.id
                const isFailed = property.status === 'failed'
                const counterexampleLength = property.counterexample?.states?.length ?? 0

                return (
                  <div
                    key={property.id}
                    style={{
                      border: isSelected ? '1px solid #4338ca' : '1px solid #e2e8f0',
                      boxShadow: isSelected ? '0 0 0 3px rgba(67,56,202,0.12)' : 'none',
                      background: '#fff',
                      borderRadius: 14,
                      overflow: 'hidden',
                    }}
                  >
                    <button
                      onClick={() => togglePropertyExpansion(property.id)}
                      aria-expanded={isExpanded}
                      style={{
                        width: '100%',
                        border: 0,
                        background: isFailed ? '#fff5f5' : '#f7fdf9',
                        padding: '10px 14px',
                        cursor: 'pointer',
                        display: 'flex',
                        justifyContent: 'space-between',
                        alignItems: 'center',
                        gap: 10,
                        textAlign: 'left',
                      }}
                    >
                      <div style={{ display: 'flex', alignItems: 'center', gap: 10, flex: 1, minWidth: 0 }}>
                        <span
                          aria-hidden="true"
                          style={{
                            display: 'inline-block',
                            fontSize: 11,
                            color: '#475569',
                            transition: 'transform 0.15s ease',
                            transform: isExpanded ? 'rotate(90deg)' : 'rotate(0deg)',
                          }}
                        >
                          ▶
                        </span>
                        <span style={{ fontWeight: 800, fontSize: 14, color: '#0f172a' }}>{property.id}</span>
                        <PropertyTypeBadge type={property.type} />
                        {isFailed && counterexampleLength > 0 && (
                          <span
                            style={{
                              borderRadius: 999,
                              padding: '3px 8px',
                              fontSize: 11,
                              fontWeight: 700,
                              background: '#fee2e2',
                              color: '#991b1b',
                            }}
                          >
                            {counterexampleLength} state{counterexampleLength !== 1 ? 's' : ''}
                          </span>
                        )}
                      </div>
                      <StatusBadge status={property.status} />
                    </button>

                    {isExpanded && (
                      <div style={{ padding: 14, borderTop: '1px solid #e2e8f0' }}>
                        <div style={{ fontSize: 11, fontWeight: 700, color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.06em' }}>
                          Formula
                        </div>
                        <div
                          style={{
                            marginTop: 6,
                            fontFamily: 'ui-monospace, Menlo, monospace',
                            fontSize: 12,
                            color: '#1e293b',
                            wordBreak: 'break-word',
                            whiteSpace: 'pre-wrap',
                          }}
                        >
                          {property.formula || 'No formula available'}
                        </div>

                        {property.description && (
                          <div style={{ marginTop: 10, fontSize: 13, color: '#475569' }}>
                            {property.description}
                          </div>
                        )}

                        {isFailed ? (
                          <div
                            style={{
                              marginTop: 12,
                              padding: 10,
                              borderRadius: 12,
                              background: '#fff1f2',
                              border: '1px solid #fecaca',
                              display: 'flex',
                              justifyContent: 'space-between',
                              alignItems: 'center',
                              gap: 10,
                              flexWrap: 'wrap',
                            }}
                          >
                            <div style={{ fontSize: 13, color: '#991b1b' }}>
                              <strong>Counterexample:</strong> {counterexampleLength} state{counterexampleLength !== 1 ? 's' : ''} leading to violation.
                            </div>
                            <button
                              onClick={() => setSelectedPropertyId(property.id)}
                              style={{
                                border: 0,
                                background: isSelected ? '#312e81' : '#4f46e5',
                                color: '#fff',
                                borderRadius: 999,
                                padding: '6px 12px',
                                fontSize: 12,
                                fontWeight: 700,
                                cursor: 'pointer',
                              }}
                            >
                              {isSelected ? 'Showing in graph' : 'Show in graph'}
                            </button>
                          </div>
                        ) : (
                          <div
                            style={{
                              marginTop: 12,
                              padding: 10,
                              borderRadius: 12,
                              background: '#f0fdf4',
                              border: '1px solid #bbf7d0',
                              fontSize: 13,
                              color: '#166534',
                            }}
                          >
                            Property holds for all reachable states.
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                )
              })}

              {filteredProperties.length === 0 && (
                <div style={{ border: '1px dashed #cbd5e1', borderRadius: 14, padding: 16, textAlign: 'center', color: '#64748b', fontSize: 13 }}>
                  No properties match the current filter.
                </div>
              )}
            </div>
          </div>

          <div style={{ padding: '14px 18px 0', display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
            {selectedProperty?.status === 'failed' && traceStates.length > 0 ? (
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
                <span style={{ fontSize: 13, color: '#475569', fontWeight: 600 }}>
                  Counterexample for{' '}
                  <strong style={{ color: '#0f172a' }}>{selectedProperty.id}</strong>
                </span>
                <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '4px 6px', borderRadius: 999, background: '#f1f5f9', border: '1px solid #e2e8f0' }}>
                  <button
                    onClick={goToPrevState}
                    disabled={currentStateIndex <= 0}
                    style={{
                      border: 0,
                      background: 'transparent',
                      color: currentStateIndex <= 0 ? '#cbd5e1' : '#334155',
                      cursor: currentStateIndex <= 0 ? 'not-allowed' : 'pointer',
                      fontSize: 12,
                      fontWeight: 800,
                      padding: '2px 6px',
                    }}
                    aria-label="Previous state"
                  >
                    ←
                  </button>
                  <span style={{ fontSize: 12, fontWeight: 700, color: '#312e81', minWidth: 84, textAlign: 'center' }}>
                    Step {currentStateIndex >= 0 ? currentStateIndex + 1 : 1} of {traceStates.length}
                  </span>
                  <button
                    onClick={goToNextState}
                    disabled={currentStateIndex < 0 || currentStateIndex >= traceStates.length - 1}
                    style={{
                      border: 0,
                      background: 'transparent',
                      color: currentStateIndex < 0 || currentStateIndex >= traceStates.length - 1 ? '#cbd5e1' : '#334155',
                      cursor: currentStateIndex < 0 || currentStateIndex >= traceStates.length - 1 ? 'not-allowed' : 'pointer',
                      fontSize: 12,
                      fontWeight: 800,
                      padding: '2px 6px',
                    }}
                    aria-label="Next state"
                  >
                    →
                  </button>
                </span>
              </div>
            ) : (
              <div style={{ fontSize: 13, color: '#475569', fontWeight: 600 }}>
                Select a failing property above to inspect its counterexample.
              </div>
            )}
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              <button onClick={handleAutoLayout} style={{ border: '1px solid #cbd5e1', background: '#fff', borderRadius: 999, padding: '8px 12px', cursor: 'pointer', fontSize: 12, fontWeight: 700, color: '#334155' }}>
                Fit graph
              </button>
              <button onClick={handleZoomIn} style={{ border: '1px solid #cbd5e1', background: '#fff', borderRadius: 999, padding: '8px 12px', cursor: 'pointer', fontSize: 12, fontWeight: 700, color: '#334155' }}>
                Zoom in
              </button>
              <button onClick={handleZoomOut} style={{ border: '1px solid #cbd5e1', background: '#fff', borderRadius: 999, padding: '8px 12px', cursor: 'pointer', fontSize: 12, fontWeight: 700, color: '#334155' }}>
                Zoom out
              </button>
            </div>
          </div>

          <div style={{ height: 660, margin: 18, border: '1px solid #e2e8f0', borderRadius: 20, overflow: 'hidden', background: '#fff' }}>
            {selectedProperty?.status === 'failed' && traceStates.length > 0 ? (
              <ReactFlow
                nodes={nodes}
                edges={edges}
                nodeTypes={nodeTypes}
                onNodesChange={onNodesChange}
                onEdgesChange={onEdgesChange}
                onNodeClick={(_, node) => setSelectedStateId(node.id)}
                onEdgeClick={(_, edge) => setSelectedEdgeId(edge.id)}
                onInit={(instance) => {
                  reactFlowRef.current = instance
                  instance.fitView({
                    padding: 0.22,
                    duration: 300,
                    includeHiddenNodes: true,
                    minZoom: 0.35,
                    maxZoom: 1.2,
                  })
                }}
                fitView
                fitViewOptions={{ padding: 0.22, minZoom: 0.35, maxZoom: 1.2 }}
                minZoom={0.25}
                maxZoom={1.6}
                defaultViewport={{ x: 0, y: 0, zoom: 0.85 }}
                attributionPosition="bottom-left"
              >
                <MiniMap pannable zoomable nodeStrokeWidth={3} />
                <Controls showInteractive={false} />
                <Background gap={18} />
              </ReactFlow>
            ) : (
              <div style={{ height: '100%', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', color: '#475569', padding: 30, textAlign: 'center' }}>
                <div style={{ fontSize: 18, fontWeight: 800, color: '#0f172a' }}>No counterexample to visualize</div>
                <div style={{ marginTop: 8, maxWidth: 420, fontSize: 14 }}>
                  {hasFailedProperties ? 'Select a failing property to inspect its counterexample.' : 'All checked properties are valid.'}
                </div>
              </div>
            )}
          </div>
        </section>

        <section
          style={{
            background: 'rgba(255,255,255,0.96)',
            border: '1px solid #e2e8f0',
            borderRadius: 24,
            padding: 20,
            boxShadow: '0 10px 30px rgba(15,23,42,0.08)',
          }}
        >
          <h2 style={{ margin: 0, fontSize: 20, fontWeight: 800 }}>Failure focus</h2>
          <p style={{ margin: '8px 0 0', color: '#475569', fontSize: 13 }}>
            A compact panel focused on what breaks when a property fails.
          </p>

          <div style={{ marginTop: 18 }}>
            <div style={{ fontSize: 16, fontWeight: 800 }}>Selected state</div>
            {selectedState ? (
              <div style={{ marginTop: 10, border: '1px solid #e2e8f0', borderRadius: 18, background: '#fff', padding: 14 }}>
                <div style={{ fontSize: 15, fontWeight: 800, marginBottom: 10 }}>State {selectedState.id}</div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                  {selectedState.vars.map((item) => (
                    <div
                      key={`${selectedState.id}-${item.name}`}
                      style={{
                        borderRadius: 12,
                        background: '#f8fafc',
                        padding: '8px 10px',
                        fontSize: 12,
                        border: '1px solid #e2e8f0',
                      }}
                    >
                      <span style={{ fontWeight: 700 }}>{item.name}</span>
                      <span style={{ color: '#94a3b8', margin: '0 6px' }}>=</span>
                      <span>{item.value}</span>
                    </div>
                  ))}
                </div>
              </div>
            ) : (
              <div style={{ marginTop: 10, border: '1px solid #e2e8f0', borderRadius: 18, background: '#fff', padding: 14 }}>
                Select a state in the graph.
              </div>
            )}
          </div>

          <div style={{ marginTop: 22 }}>
            <div style={{ fontSize: 16, fontWeight: 800 }}>Transition changes</div>
            {selectedEdge ? (
              <div style={{ marginTop: 10, border: '1px solid #fecaca', borderRadius: 18, background: '#fff1f2', padding: 14 }}>
                <div style={{ fontSize: 15, fontWeight: 800, marginBottom: 10 }}>
                  {selectedEdge.source} → {selectedEdge.target}
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                  {(selectedEdge.data?.changes ?? []).length === 0 ? (
                    <div style={{ fontStyle: 'italic', color: '#64748b', fontSize: 12 }}>
                      No variable changes in this transition.
                    </div>
                  ) : (
                    selectedEdge.data.changes.map((item) => (
                      <div
                        key={`${selectedEdge.id}-${item.name}`}
                        style={{
                          borderRadius: 12,
                          background: '#fff',
                          padding: '8px 10px',
                          fontSize: 12,
                          border: '1px solid #fda4af',
                        }}
                      >
                        <div style={{ fontWeight: 800 }}>{item.name}</div>
                        <div style={{ marginTop: 4, color: '#334155' }}>
                          {item.from} → {item.to}
                        </div>
                      </div>
                    ))
                  )}
                </div>
              </div>
            ) : (
              <div style={{ marginTop: 10, border: '1px solid #e2e8f0', borderRadius: 18, background: '#fff', padding: 14 }}>
                Select a transition in the graph.
              </div>
            )}
          </div>

          <div style={{ marginTop: 22 }}>
            <div style={{ fontSize: 16, fontWeight: 800 }}>Trace steps</div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginTop: 10, maxHeight: 430, overflow: 'auto' }}>
              {traceSteps.length === 0 ? (
                <div style={{ border: '1px solid #e2e8f0', borderRadius: 18, background: '#fff', padding: 14 }}>
                  No trace available for the selected property.
                </div>
              ) : (
                traceSteps.map(({ state, nextState, changes }) => (
                  <div key={state.id} style={{ border: '1px solid #e2e8f0', borderRadius: 18, background: '#fff', padding: 14 }}>
                    <div style={{ fontSize: 15, fontWeight: 800 }}>State {state.id}</div>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 10 }}>
                      {state.vars.map((item) => (
                        <div
                          key={`${state.id}-${item.name}`}
                          style={{
                            borderRadius: 12,
                            background: '#f8fafc',
                            padding: '8px 10px',
                            fontSize: 12,
                            border: '1px solid #e2e8f0',
                          }}
                        >
                          <span style={{ fontWeight: 700 }}>{item.name}</span>
                          <span style={{ color: '#94a3b8', margin: '0 6px' }}>=</span>
                          <span>{item.value}</span>
                        </div>
                      ))}
                    </div>

                    {nextState && (
                      <div style={{ marginTop: 12, padding: 12, borderRadius: 14, background: '#eef2ff', border: '1px solid #c7d2fe' }}>
                        <div style={{ fontSize: 13, fontWeight: 800, marginBottom: 8, color: '#312e81' }}>
                          Transition {state.id} → {nextState.id}
                        </div>
                        {changes.length === 0 ? (
                          <div style={{ fontSize: 12, color: '#475569' }}>No variable changes</div>
                        ) : (
                          changes.map((item) => (
                            <div
                              key={`${state.id}-${nextState.id}-${item.name}`}
                              style={{
                                borderRadius: 12,
                                background: '#fff',
                                padding: '8px 10px',
                                fontSize: 12,
                                border: '1px solid #c7d2fe',
                                marginTop: 8,
                              }}
                            >
                              <div style={{ fontWeight: 800 }}>{item.name}</div>
                              <div style={{ marginTop: 4, color: '#334155' }}>
                                {item.from} → {item.to}
                              </div>
                            </div>
                          ))
                        )}
                      </div>
                    )}
                  </div>
                ))
              )}
            </div>
          </div>
        </section>
      </div>
    </div>
  )
}