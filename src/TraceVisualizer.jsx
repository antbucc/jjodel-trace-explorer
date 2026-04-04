import { useCallback, useMemo, useState } from 'react'
import {
  ReactFlow,
  Background,
  Controls,
  MiniMap,
  MarkerType,
  Panel,
  useEdgesState,
  useNodesState,
} from '@xyflow/react'
import '@xyflow/react/dist/style.css'

function parseNuXmvTrace(traceText) {
  const lines = traceText.split(/\r?\n/)
  const states = []
  let current = null

  for (const rawLine of lines) {
    const line = rawLine.trimEnd()

    const stateMatch = line.match(/^\s*->\s*State:\s*([\d.]+)\s*<-$|^\s*State:\s*([\d.]+)\s*$/i)
    if (stateMatch) {
      if (current) states.push(current)
      current = {
        id: stateMatch[1] || stateMatch[2],
        vars: [],
      }
      continue
    }

    if (!current) continue
    if (!line.trim()) continue
    if (/^\*{2,}/.test(line)) continue
    if (/^Trace /i.test(line)) continue
    if (/^-- /.test(line)) continue

    const varMatch = line.match(/^\s*([^=]+?)\s*=\s*(.+)\s*$/)
    if (varMatch) {
      current.vars.push({
        name: varMatch[1].trim(),
        value: varMatch[2].trim(),
      })
    }
  }

  if (current) states.push(current)

  return states
}

function buildGraph(states) {
  const spacingX = 310
  const spacingY = 120

  const nodes = states.map((state, index) => ({
    id: state.id,
    position: {
      x: index * spacingX,
      y: index % 2 === 0 ? 40 : spacingY,
    },
    data: state,
    type: 'stateNode',
  }))

  const edges = states.slice(0, -1).map((state, index) => ({
    id: `e-${state.id}-${states[index + 1].id}`,
    source: state.id,
    target: states[index + 1].id,
    type: 'smoothstep',
    animated: true,
    markerEnd: {
      type: MarkerType.ArrowClosed,
    },
    label: `${state.id} → ${states[index + 1].id}`,
    style: {
      strokeWidth: 2,
    },
    labelStyle: {
      fontSize: 12,
      fontWeight: 600,
    },
  }))

  return { nodes, edges }
}

function exportJson(parsedStates) {
  const blob = new Blob([JSON.stringify(parsedStates, null, 2)], {
    type: 'application/json',
  })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = 'nuxmv-trace.json'
  a.click()
  URL.revokeObjectURL(url)
}

function exportDot(parsedStates) {
  const lines = [
    'digraph nuXmvTrace {',
    '  rankdir=LR;',
    '  node [shape=box, style="rounded,filled", fillcolor="#f8fafc", color="#94a3b8"];'
  ]

  parsedStates.forEach((state) => {
    const vars = state.vars.map((item) => `${item.name} = ${item.value}`).join('\\n')
    const label = `State ${state.id}${vars ? `\\n${vars}` : ''}`.replace(/"/g, '\\"')
    lines.push(`  "${state.id}" [label="${label}"];`)
  })

  for (let i = 0; i < parsedStates.length - 1; i += 1) {
    lines.push(`  "${parsedStates[i].id}" -> "${parsedStates[i + 1].id}";`)
  }

  lines.push('}')

  const blob = new Blob([lines.join('\n')], { type: 'text/plain' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = 'nuxmv-trace.dot'
  a.click()
  URL.revokeObjectURL(url)
}

function readFileAsText(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result || ''))
    reader.onerror = reject
    reader.readAsText(file)
  })
}

function StateNode({ data }) {
  return (
    <div className="state-node">
      <div className="state-node-header">
        <div className="state-node-title">State {data.id}</div>
        <div className="badge">{data.vars.length} vars</div>
      </div>

      <div className="var-list">
        {data.vars.length === 0 ? (
          <div className="empty-note">No variables parsed</div>
        ) : (
          data.vars.map((item, index) => (
            <div className="var-row" key={`${data.id}-${item.name}-${index}`}>
              <span className="var-name">{item.name}</span>
              <span className="var-sep">=</span>
              <span>{item.value}</span>
            </div>
          ))
        )}
      </div>
    </div>
  )
}

const nodeTypes = {
  stateNode: StateNode,
}

const sampleTrace = `-- specification AG p is false
-- as demonstrated by the following execution sequence
Trace Description: CTL Counterexample
Trace Type: Counterexample
-> State: 1.1 <-
  mode = monitor
  battery = low
  action = none
  score = 0
-> State: 1.2 <-
  mode = analyze
  battery = low
  action = replan
  score = 5
-> State: 1.3 <-
  mode = plan
  battery = low
  action = reduce_speed
  score = 10
-> State: 1.4 <-
  mode = execute
  battery = medium
  action = apply_plan
  score = 10`

export default function TraceVisualizer() {
  const [traceText, setTraceText] = useState(sampleTrace)

  const parsedStates = useMemo(() => parseNuXmvTrace(traceText), [traceText])
  const graph = useMemo(() => buildGraph(parsedStates), [parsedStates])

  const [nodes, setNodes, onNodesChange] = useNodesState(graph.nodes)
  const [edges, setEdges, onEdgesChange] = useEdgesState(graph.edges)

  const refreshGraph = useCallback(() => {
    setNodes(graph.nodes)
    setEdges(graph.edges)
  }, [graph, setNodes, setEdges])

  const handleLoadSample = useCallback(() => {
    setTraceText(sampleTrace)
  }, [])

  const handleClear = useCallback(() => {
    setTraceText('')
    setNodes([])
    setEdges([])
  }, [setNodes, setEdges])

  const handleFileUpload = useCallback(async (event) => {
    const file = event.target.files?.[0]
    if (!file) return
    const text = await readFileAsText(file)
    setTraceText(text)
  }, [])

  const changedVariables = useMemo(() => {
    const all = new Set()
    for (let i = 1; i < parsedStates.length; i += 1) {
      const prev = Object.fromEntries(parsedStates[i - 1].vars.map((v) => [v.name, v.value]))
      const curr = Object.fromEntries(parsedStates[i].vars.map((v) => [v.name, v.value]))
      const keys = new Set([...Object.keys(prev), ...Object.keys(curr)])
      keys.forEach((key) => {
        if (prev[key] !== curr[key]) all.add(key)
      })
    }
    return Array.from(all)
  }, [parsedStates])

  return (
    <div className="app-shell">
      <div className="layout">
        <section className="panel">
          <h1 className="title">Jjodel Trace Explorer</h1>
          <p className="subtitle">
            Visualizzatore di trace di verifica formale per modelli Jjodel e output nuXmv.
          </p>

          <textarea
            className="textarea"
            value={traceText}
            onChange={(e) => setTraceText(e.target.value)}
            placeholder="Paste nuXmv trace here..."
          />

          <div className="toolbar">
            <button className="btn btn-primary" onClick={refreshGraph}>Parse trace</button>
            <button className="btn btn-secondary" onClick={handleLoadSample}>Load sample</button>
            <button className="btn btn-secondary" onClick={handleClear}>Clear</button>
            <button className="btn btn-dark" onClick={() => exportJson(parsedStates)}>Export JSON</button>
            <button className="btn btn-dark" onClick={() => exportDot(parsedStates)}>Export DOT</button>
            <label className="btn btn-secondary" style={{ display: 'inline-flex', alignItems: 'center' }}>
              Upload file
              <input type="file" accept=".txt,.log,.out" onChange={handleFileUpload} style={{ display: 'none' }} />
            </label>
          </div>

          <div className="stats">
            <div className="stat-card">
              <div className="stat-label">States</div>
              <div className="stat-value">{parsedStates.length}</div>
            </div>
            <div className="stat-card">
              <div className="stat-label">Transitions</div>
              <div className="stat-value">{Math.max(parsedStates.length - 1, 0)}</div>
            </div>
          </div>

          <div className="legend">
            {changedVariables.length === 0 ? (
              <div className="legend-item">No variable changes detected yet</div>
            ) : (
              changedVariables.map((name) => (
                <div key={name} className="legend-item">Changed: {name}</div>
              ))
            )}
          </div>

          <div className="tip">
            Formato supportato: <strong>-&gt; State: 1.1 &lt;-</strong> oppure <strong>State: 1.1</strong>, seguite da righe tipo <strong>x = TRUE</strong>.
          </div>
        </section>

        <section className="viewer">
          <div className="viewer-header">
            <h2 className="viewer-title">Graph View</h2>
            <p className="viewer-subtitle">
              Zoom, pan e mini-map per esplorare trace lunghe.
            </p>
          </div>

          <div className="flow-wrapper">
            <ReactFlow
              nodes={nodes}
              edges={edges}
              nodeTypes={nodeTypes}
              onNodesChange={onNodesChange}
              onEdgesChange={onEdgesChange}
              fitView
            >
              <MiniMap pannable zoomable />
              <Controls />
              <Background />
              <Panel position="top-right">
                <div className="legend-item">Interactive trace graph</div>
              </Panel>
            </ReactFlow>
          </div>
        </section>
      </div>
    </div>
  )
}