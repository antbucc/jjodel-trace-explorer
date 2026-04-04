import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
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
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';

const demoReport = {
  modelName: 'drone-controller',
  source: 'Jjodel',
  engine: 'nuXmv',
  generatedAt: '2026-04-04T18:00:00Z',
  inputModel: {
    fileName: 'drone-controller.smv',
    content: `MODULE main
VAR
  mode : {monitor, analyze, plan, execute};
  battery : {low, medium, high};
  action : {none, replan, reduce_speed, apply_plan};
  goal_reached : boolean;
  deadlock : boolean;
  req : boolean;
  ack : boolean;
  score : 0..10;

ASSIGN
  init(mode) := monitor;
  init(battery) := low;
  init(action) := none;
  init(goal_reached) := FALSE;
  init(deadlock) := FALSE;
  init(req) := FALSE;
  init(ack) := FALSE;
  init(score) := 0;

  next(mode) := case
    mode = monitor : analyze;
    mode = analyze : plan;
    mode = plan : execute;
    TRUE : execute;
  esac;

  next(battery) := case
    mode = execute : medium;
    TRUE : low;
  esac;

  next(action) := case
    mode = monitor : none;
    mode = analyze : replan;
    mode = plan : reduce_speed;
    TRUE : apply_plan;
  esac;

SPEC AG !deadlock
SPEC AG EF goal_reached
LTLSPEC G (req -> F ack)`,
  },
  summary: { totalProperties: 3, passed: 2, failed: 1 },
  properties: [
    {
      id: 'P1',
      type: 'CTL',
      formula: 'AG !deadlock',
      description: 'The system should never deadlock.',
      status: 'passed',
    },
    {
      id: 'P2',
      type: 'CTL',
      formula: 'AG EF goal_reached',
      description: 'The goal should always remain reachable.',
      status: 'failed',
      counterexample: {
        states: [
          { id: '1.1', variables: { mode: 'monitor', battery: 'low', action: 'none', score: '0', goal_reached: 'FALSE' } },
          { id: '1.2', variables: { mode: 'analyze', battery: 'low', action: 'replan', score: '5', goal_reached: 'FALSE' } },
          { id: '1.3', variables: { mode: 'plan', battery: 'low', action: 'reduce_speed', score: '10', goal_reached: 'FALSE' } },
          { id: '1.4', variables: { mode: 'execute', battery: 'medium', action: 'apply_plan', score: '10', goal_reached: 'FALSE' } },
        ],
      },
    },
    {
      id: 'P3',
      type: 'LTL',
      formula: 'G (req -> F ack)',
      description: 'Every request is eventually acknowledged.',
      status: 'passed',
    },
  ],
};

function readFileAsText(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ''));
    reader.onerror = reject;
    reader.readAsText(file);
  });
}

function statesFromCounterexample(counterexample) {
  if (!counterexample?.states) return [];
  return counterexample.states.map((state) => ({
    id: state.id,
    vars: Object.entries(state.variables || {}).map(([name, value]) => ({ name, value: String(value) })),
  }));
}

function varsToMap(state) {
  return Object.fromEntries(state.vars.map((item) => [item.name, item.value]));
}

function changedVariables(prevState, nextState) {
  if (!prevState || !nextState) return [];
  const prev = varsToMap(prevState);
  const next = varsToMap(nextState);
  const keys = new Set([...Object.keys(prev), ...Object.keys(next)]);
  const changed = [];

  keys.forEach((key) => {
    if (prev[key] !== next[key]) {
      changed.push({ name: key, from: prev[key] ?? 'undefined', to: next[key] ?? 'undefined' });
    }
  });

  return changed;
}

function buildGraph(states) {
  const columns = 3;
  const horizontalGap = 320;
  const verticalGap = 220;

  const nodes = states.map((state, index) => {
    const row = Math.floor(index / columns);
    const col = index % columns;

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
    };
  });

  const edges = states.slice(0, -1).map((state, index) => {
    const nextState = states[index + 1];
    const changes = changedVariables(state, nextState);
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
    };
  });

  return { nodes, edges };
}

function exportJson(payload) {
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'verification-report.json';
  a.click();
  URL.revokeObjectURL(url);
}

function StateNode({ data }) {
  return (
    <div style={{ minWidth: 230, maxWidth: 270, background: '#fff', border: '2px solid #cbd5e1', borderRadius: 18, padding: 12, boxShadow: '0 8px 18px rgba(15,23,42,0.08)' }}>
      <Handle type="target" position={Position.Left} style={{ width: 10, height: 10, background: '#4f46e5' }} />
      <Handle type="source" position={Position.Right} style={{ width: 10, height: 10, background: '#4f46e5' }} />
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10, marginBottom: 10 }}>
        <div>
          <div style={{ fontSize: 15, fontWeight: 800 }}>State {data.id}</div>
          <div style={{ fontSize: 11, color: '#64748b' }}>Execution snapshot</div>
        </div>
        <div style={{ borderRadius: 999, background: '#eef2ff', color: '#4338ca', padding: '4px 8px', fontSize: 11, fontWeight: 800 }}>{data.vars.length} vars</div>
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        {data.vars.map((item) => (
          <div key={`${data.id}-${item.name}`} style={{ borderRadius: 12, background: '#f8fafc', padding: '8px 10px', fontSize: 12, border: '1px solid #e2e8f0' }}>
            <span style={{ fontWeight: 700 }}>{item.name}</span>
            <span style={{ color: '#94a3b8', margin: '0 6px' }}>=</span>
            <span>{item.value}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

const nodeTypes = { stateNode: StateNode };

export default function JjodelTraceExplorerRevisedUI() {
  const reactFlowRef = useRef(null);
  const [smvText, setSmvText] = useState(demoReport.inputModel.content);
  const [smvFileName, setSmvFileName] = useState(demoReport.inputModel.fileName);
  const [report, setReport] = useState(demoReport);
  const [isChecking, setIsChecking] = useState(false);
  const [checkFeedback, setCheckFeedback] = useState('Ready to verify.');
  const [propertyFilter, setPropertyFilter] = useState('all');
  const [selectedPropertyId, setSelectedPropertyId] = useState(demoReport.properties.find((p) => p.status === 'failed')?.id ?? demoReport.properties[0]?.id ?? null);
  const [selectedEdgeId, setSelectedEdgeId] = useState(null);
  const [selectedStateId, setSelectedStateId] = useState(null);

  const filteredProperties = useMemo(() => {
    if (propertyFilter === 'all') return report.properties;
    return report.properties.filter((property) => property.status === propertyFilter);
  }, [report.properties, propertyFilter]);

  const selectedProperty = useMemo(
    () => report.properties.find((property) => property.id === selectedPropertyId) ?? null,
    [report.properties, selectedPropertyId]
  );

  const traceStates = useMemo(() => statesFromCounterexample(selectedProperty?.counterexample), [selectedProperty]);
  const graph = useMemo(() => buildGraph(traceStates), [traceStates]);
  const [nodes, setNodes, onNodesChange] = useNodesState(graph.nodes);
  const [edges, setEdges, onEdgesChange] = useEdgesState(graph.edges);

  useEffect(() => {
    setNodes(graph.nodes);
    setEdges(graph.edges);
    setSelectedStateId(graph.nodes[0]?.id ?? null);
    setSelectedEdgeId(graph.edges[0]?.id ?? null);
  }, [graph, setNodes, setEdges]);

  useEffect(() => {
    if (!reactFlowRef.current) return;
    if (graph.nodes.length === 0) return;

    const timer = setTimeout(() => {
      reactFlowRef.current.fitView({
        padding: 0.22,
        duration: 500,
        includeHiddenNodes: true,
        minZoom: 0.35,
        maxZoom: 1.2,
      });
    }, 80);

    return () => clearTimeout(timer);
  }, [graph]);

  const selectedState = useMemo(
    () => traceStates.find((state) => state.id === selectedStateId) ?? null,
    [traceStates, selectedStateId]
  );

  const selectedEdge = useMemo(
    () => edges.find((edge) => edge.id === selectedEdgeId) ?? null,
    [edges, selectedEdgeId]
  );

  const traceSteps = useMemo(() => {
    return traceStates.map((state, index) => ({
      state,
      nextState: traceStates[index + 1] ?? null,
      changes: traceStates[index + 1] ? changedVariables(state, traceStates[index + 1]) : [],
    }));
  }, [traceStates]);

  const handleSmvUpload = useCallback(async (event) => {
    const file = event.target.files?.[0];
    if (!file) return;
    const text = await readFileAsText(file);
    setSmvText(text);
    setSmvFileName(file.name);
    setCheckFeedback(`Loaded model: ${file.name}`);
  }, []);

  const handleRunChecking = useCallback(async () => {
    setIsChecking(true);
    setCheckFeedback('Running formal verification...');

    try {
      // Replace this mock branch with a real backend call, e.g.:
      // const formData = new FormData();
      // formData.append('model', new Blob([smvText], { type: 'text/plain' }), smvFileName);
      // const response = await fetch('/api/verify', { method: 'POST', body: formData });
      // const result = await response.json();
      // setReport(result);

      await new Promise((resolve) => setTimeout(resolve, 900));
      setReport({
        ...demoReport,
        inputModel: {
          fileName: smvFileName,
          content: smvText,
        },
      });
      setSelectedPropertyId(demoReport.properties.find((p) => p.status === 'failed')?.id ?? demoReport.properties[0]?.id ?? null);
      setCheckFeedback('Verification completed. Review the property results and counterexamples below.');
    } catch (error) {
      setCheckFeedback('Verification failed. Please check the backend response and the input model.');
    } finally {
      setIsChecking(false);
    }
  }, [smvFileName, smvText]);

  const summary = report.summary;
  const hasFailedProperties = report.properties.some((property) => property.status === 'failed');

  const handleAutoLayout = useCallback(() => {
    if (!reactFlowRef.current) return;
    reactFlowRef.current.fitView({
      padding: 0.22,
      duration: 500,
      includeHiddenNodes: true,
      minZoom: 0.35,
      maxZoom: 1.2,
    });
  }, []);

  const handleZoomIn = useCallback(() => {
    if (!reactFlowRef.current) return;
    reactFlowRef.current.zoomIn({ duration: 250 });
  }, []);

  const handleZoomOut = useCallback(() => {
    if (!reactFlowRef.current) return;
    reactFlowRef.current.zoomOut({ duration: 250 });
  }, []);

  return (
    <div style={{ minHeight: '100vh', background: 'linear-gradient(180deg, #f8fafc 0%, #eef2ff 100%)', padding: 24, color: '#0f172a', fontFamily: 'Inter, system-ui, sans-serif' }}>
      <div style={{ maxWidth: 1700, margin: '0 auto 20px', display: 'flex', justifyContent: 'space-between', gap: 20, flexWrap: 'wrap' }}>
        <div>
          <h1 style={{ margin: 0, fontSize: 32, fontWeight: 800 }}>Jjodel Verification Explorer</h1>
          <p style={{ margin: '8px 0 0', color: '#475569', fontSize: 14 }}>
            Load an SMV model, run formal checking, and inspect passed properties, failed properties, and counterexamples with clear visual feedback.
          </p>
        </div>
        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
          <label style={{ borderRadius: 14, background: '#e2e8f0', color: '#0f172a', padding: '10px 14px', fontWeight: 700, cursor: 'pointer' }}>
            Load SMV model
            <input type="file" accept=".smv,.txt" hidden onChange={handleSmvUpload} />
          </label>
          <button onClick={handleRunChecking} disabled={isChecking} style={{ border: 0, borderRadius: 14, background: '#4f46e5', color: '#fff', padding: '10px 14px', fontWeight: 700, cursor: 'pointer', opacity: isChecking ? 0.7 : 1 }}>
            {isChecking ? 'Checking...' : 'Run checking'}
          </button>
          <button onClick={() => exportJson(report)} style={{ border: 0, borderRadius: 14, background: '#0f172a', color: '#fff', padding: '10px 14px', fontWeight: 700, cursor: 'pointer' }}>
            Export report
          </button>
        </div>
      </div>

      <div style={{ maxWidth: 1700, margin: '0 auto 18px', border: '1px solid #e2e8f0', background: '#fff', borderRadius: 18, padding: 14, boxShadow: '0 10px 30px rgba(15,23,42,0.06)' }}>
        <div style={{ fontSize: 12, textTransform: 'uppercase', letterSpacing: '0.08em', color: '#64748b' }}>Status</div>
        <div style={{ marginTop: 6, fontSize: 14, fontWeight: 700 }}>{checkFeedback}</div>
      </div>

      <div style={{ maxWidth: 1700, margin: '0 auto', display: 'grid', gridTemplateColumns: '380px minmax(780px, 1fr) 300px', gap: 20 }}>
        <section style={{ background: 'rgba(255,255,255,0.96)', border: '1px solid #e2e8f0', borderRadius: 24, padding: 20, boxShadow: '0 10px 30px rgba(15,23,42,0.08)' }}>
          <h2 style={{ margin: 0, fontSize: 22, fontWeight: 800 }}>Input model</h2>
          <p style={{ margin: '8px 0 0', color: '#475569', fontSize: 13 }}>The SMV model is loaded from file and displayed here exactly as submitted.</p>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginTop: 14 }}>
            {[
              ['File', smvFileName],
              ['Source', report.source],
              ['Engine', report.engine],
              ['Generated', report.generatedAt],
            ].map(([label, value]) => (
              <div key={label} style={{ border: '1px solid #e2e8f0', borderRadius: 18, background: '#fff', padding: 14 }}>
                <div style={{ textTransform: 'uppercase', letterSpacing: '0.08em', color: '#64748b', fontSize: 11 }}>{label}</div>
                <div style={{ marginTop: 4, fontSize: 14, fontWeight: 700, wordBreak: 'break-word' }}>{value}</div>
              </div>
            ))}
          </div>

          <div style={{ marginTop: 16, border: '1px solid #dbe3ef', borderRadius: 18, overflow: 'hidden', background: '#0f172a' }}>
            <div style={{ padding: '10px 14px', fontSize: 12, fontWeight: 700, color: '#cbd5e1', background: '#1e293b' }}>{smvFileName}</div>
            <pre style={{ margin: 0, padding: 16, maxHeight: 520, overflow: 'auto', whiteSpace: 'pre-wrap', color: '#e2e8f0', fontSize: 12, lineHeight: 1.55, fontFamily: 'ui-monospace, Menlo, monospace' }}>{smvText}</pre>
          </div>
        </section>

        <section style={{ background: 'rgba(255,255,255,0.96)', border: '1px solid #e2e8f0', borderRadius: 24, overflow: 'hidden', boxShadow: '0 10px 30px rgba(15,23,42,0.08)' }}>
          <div style={{ padding: 20, borderBottom: '1px solid #e2e8f0' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', gap: 20, alignItems: 'flex-start', flexWrap: 'wrap' }}>
              <div>
                <h2 style={{ margin: 0, fontSize: 22, fontWeight: 800 }}>Verification results</h2>
                <p style={{ margin: '8px 0 0', color: '#475569', fontSize: 13 }}>Clear feedback on passing and failing properties, with a focused view on the properties that break the model.</p>
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
                <div style={{ textTransform: 'uppercase', letterSpacing: '0.08em', color: '#64748b', fontSize: 11 }}>Total properties</div>
                <div style={{ marginTop: 4, fontSize: 28, fontWeight: 800 }}>{summary.totalProperties}</div>
              </div>
              <div style={{ border: '1px solid #e2e8f0', borderRadius: 18, background: '#fff', padding: 14 }}>
                <div style={{ textTransform: 'uppercase', letterSpacing: '0.08em', color: '#64748b', fontSize: 11 }}>Passed</div>
                <div style={{ marginTop: 4, fontSize: 28, fontWeight: 800, color: '#15803d' }}>{summary.passed}</div>
              </div>
              <div style={{ border: '1px solid #e2e8f0', borderRadius: 18, background: '#fff', padding: 14 }}>
                <div style={{ textTransform: 'uppercase', letterSpacing: '0.08em', color: '#64748b', fontSize: 11 }}>Failed</div>
                <div style={{ marginTop: 4, fontSize: 28, fontWeight: 800, color: '#b91c1c' }}>{summary.failed}</div>
              </div>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr', gap: 10, marginTop: 18 }}>
              {filteredProperties.map((property) => (
                <button
                  key={property.id}
                  onClick={() => setSelectedPropertyId(property.id)}
                  style={{
                    border: selectedPropertyId === property.id ? '1px solid #4338ca' : '1px solid #e2e8f0',
                    boxShadow: selectedPropertyId === property.id ? '0 0 0 3px rgba(67,56,202,0.12)' : 'none',
                    background: '#fff',
                    borderRadius: 16,
                    padding: '12px 14px',
                    cursor: 'pointer',
                    textAlign: 'left',
                  }}
                >
                  <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10, alignItems: 'flex-start' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                      <span style={{ fontWeight: 800 }}>{property.id}</span>
                      <span style={{ borderRadius: 999, padding: '4px 8px', fontSize: 11, fontWeight: 800, background: '#eef2ff', color: '#312e81' }}>
                        {property.type}
                      </span>
                    </div>
                    <span
                      style={{
                        borderRadius: 999,
                        padding: '5px 10px',
                        fontSize: 12,
                        fontWeight: 800,
                        background: property.status === 'passed' ? '#dcfce7' : '#fee2e2',
                        color: property.status === 'passed' ? '#166534' : '#991b1b',
                        whiteSpace: 'nowrap',
                      }}
                    >
                      {property.status === 'passed' ? 'Passed' : 'Failed'}
                    </span>
                  </div>
                  <div
                    style={{
                      marginTop: 10,
                      fontFamily: 'ui-monospace, Menlo, monospace',
                      fontSize: 12,
                      color: '#1e293b',
                      wordBreak: 'break-word',
                    }}
                  >
                    {property.formula}
                  </div>
                </button>
              ))}
            </div>

            {selectedProperty && (
              <div style={{ marginTop: 18, border: `2px solid ${selectedProperty.status === 'failed' ? '#fecaca' : '#bbf7d0'}`, borderRadius: 18, background: selectedProperty.status === 'failed' ? '#fff1f2' : '#f0fdf4', padding: 14 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, alignItems: 'flex-start' }}>
                  <div>
                    <div style={{ fontSize: 16, fontWeight: 800 }}>{selectedProperty.id} — {selectedProperty.type}</div>
                    <div style={{ marginTop: 8, fontFamily: 'ui-monospace, Menlo, monospace', fontSize: 12, color: '#1e293b' }}>{selectedProperty.formula}</div>
                  </div>
                  <div style={{ borderRadius: 999, padding: '5px 10px', fontSize: 12, fontWeight: 800, background: selectedProperty.status === 'passed' ? '#dcfce7' : '#fee2e2', color: selectedProperty.status === 'passed' ? '#166534' : '#991b1b' }}>
                    {selectedProperty.status === 'passed' ? 'Passed' : 'Failed'}
                  </div>
                </div>
                <div style={{ marginTop: 8, fontSize: 13, color: '#475569' }}>{selectedProperty.description}</div>
                {selectedProperty.status === 'failed' && (
                  <div style={{ marginTop: 10, fontSize: 13, fontWeight: 700, color: '#991b1b' }}>
                    This property fails. The counterexample below shows how the model reaches a violating execution path.
                  </div>
                )}
              </div>
            )}
          </div>

          <div style={{ padding: '0 18px 0', display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
            <div style={{ fontSize: 13, color: '#475569', fontWeight: 600 }}>
              Use the controls below to center the counterexample and keep the graph readable.
            </div>
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
                  reactFlowRef.current = instance;
                  instance.fitView({
                    padding: 0.22,
                    duration: 300,
                    includeHiddenNodes: true,
                    minZoom: 0.35,
                    maxZoom: 1.2,
                  });
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

        <section style={{ background: 'rgba(255,255,255,0.96)', border: '1px solid #e2e8f0', borderRadius: 24, padding: 20, boxShadow: '0 10px 30px rgba(15,23,42,0.08)' }}>
          <h2 style={{ margin: 0, fontSize: 20, fontWeight: 800 }}>Failure focus</h2>
          <p style={{ margin: '8px 0 0', color: '#475569', fontSize: 13 }}>A compact panel focused on what breaks when a property fails.</p>

          <div style={{ marginTop: 18 }}>
            <div style={{ fontSize: 16, fontWeight: 800 }}>Selected state</div>
            {selectedState ? (
              <div style={{ marginTop: 10, border: '1px solid #e2e8f0', borderRadius: 18, background: '#fff', padding: 14 }}>
                <div style={{ fontSize: 15, fontWeight: 800, marginBottom: 10 }}>State {selectedState.id}</div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                  {selectedState.vars.map((item) => (
                    <div key={`${selectedState.id}-${item.name}`} style={{ borderRadius: 12, background: '#f8fafc', padding: '8px 10px', fontSize: 12, border: '1px solid #e2e8f0' }}>
                      <span style={{ fontWeight: 700 }}>{item.name}</span>
                      <span style={{ color: '#94a3b8', margin: '0 6px' }}>=</span>
                      <span>{item.value}</span>
                    </div>
                  ))}
                </div>
              </div>
            ) : (
              <div style={{ marginTop: 10, border: '1px solid #e2e8f0', borderRadius: 18, background: '#fff', padding: 14 }}>Select a state in the graph.</div>
            )}
          </div>

          <div style={{ marginTop: 22 }}>
            <div style={{ fontSize: 16, fontWeight: 800 }}>Transition changes</div>
            {selectedEdge ? (
              <div style={{ marginTop: 10, border: '1px solid #fecaca', borderRadius: 18, background: '#fff1f2', padding: 14 }}>
                <div style={{ fontSize: 15, fontWeight: 800, marginBottom: 10 }}>{selectedEdge.source} → {selectedEdge.target}</div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                  {(selectedEdge.data?.changes ?? []).length === 0 ? (
                    <div style={{ fontStyle: 'italic', color: '#64748b', fontSize: 12 }}>No variable changes in this transition.</div>
                  ) : (
                    selectedEdge.data.changes.map((item) => (
                      <div key={`${selectedEdge.id}-${item.name}`} style={{ borderRadius: 12, background: '#fff', padding: '8px 10px', fontSize: 12, border: '1px solid #fda4af' }}>
                        <div style={{ fontWeight: 800 }}>{item.name}</div>
                        <div style={{ marginTop: 4, color: '#334155' }}>{item.from} → {item.to}</div>
                      </div>
                    ))
                  )}
                </div>
              </div>
            ) : (
              <div style={{ marginTop: 10, border: '1px solid #e2e8f0', borderRadius: 18, background: '#fff', padding: 14 }}>Select a transition in the graph.</div>
            )}
          </div>

          <div style={{ marginTop: 22 }}>
            <div style={{ fontSize: 16, fontWeight: 800 }}>Trace steps</div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginTop: 10, maxHeight: 430, overflow: 'auto' }}>
              {traceSteps.length === 0 ? (
                <div style={{ border: '1px solid #e2e8f0', borderRadius: 18, background: '#fff', padding: 14 }}>No trace available for the selected property.</div>
              ) : (
                traceSteps.map(({ state, nextState, changes }) => (
                  <div key={state.id} style={{ border: '1px solid #e2e8f0', borderRadius: 18, background: '#fff', padding: 14 }}>
                    <div style={{ fontSize: 15, fontWeight: 800 }}>State {state.id}</div>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 10 }}>
                      {state.vars.map((item) => (
                        <div key={`${state.id}-${item.name}`} style={{ borderRadius: 12, background: '#f8fafc', padding: '8px 10px', fontSize: 12, border: '1px solid #e2e8f0' }}>
                          <span style={{ fontWeight: 700 }}>{item.name}</span>
                          <span style={{ color: '#94a3b8', margin: '0 6px' }}>=</span>
                          <span>{item.value}</span>
                        </div>
                      ))}
                    </div>
                    {nextState && (
                      <div style={{ marginTop: 12, padding: 12, borderRadius: 14, background: '#eef2ff', border: '1px solid #c7d2fe' }}>
                        <div style={{ fontSize: 13, fontWeight: 800, marginBottom: 8, color: '#312e81' }}>Transition {state.id} → {nextState.id}</div>
                        {changes.length === 0 ? (
                          <div style={{ fontSize: 12, color: '#475569' }}>No variable changes</div>
                        ) : (
                          changes.map((item) => (
                            <div key={`${state.id}-${nextState.id}-${item.name}`} style={{ borderRadius: 12, background: '#fff', padding: '8px 10px', fontSize: 12, border: '1px solid #c7d2fe', marginTop: 8 }}>
                              <div style={{ fontWeight: 800 }}>{item.name}</div>
                              <div style={{ marginTop: 4, color: '#334155' }}>{item.from} → {item.to}</div>
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
  );
}
