// P1 render-smoke artifact: a recharts line chart. Proves the full 路径 D pipeline
// (loopback server → iframe → sandbox-bridge handshake → react-runner eval →
// whitelisted-lib render) is alive. Shown only in dev (see ArtifactPanel); P3
// replaces this with real agent-generated artifacts.
//
// Format: a react-runner module — bare imports resolve against the shell's scope
// (recharts is whitelisted), default export is the rendered component.

export const SMOKE_ARTIFACT_ID = 'p1-smoke-recharts';

export const SMOKE_ARTIFACT_CODE = `import {
  ResponsiveContainer, LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip,
} from 'recharts'

const data = [
  { name: 'Mon', v: 12 },
  { name: 'Tue', v: 19 },
  { name: 'Wed', v: 9 },
  { name: 'Thu', v: 23 },
  { name: 'Fri', v: 17 },
  { name: 'Sat', v: 28 },
  { name: 'Sun', v: 21 },
]

export default function App() {
  return (
    <div style={{ width: '100%', height: '100%', minHeight: 240, padding: 12, boxSizing: 'border-box', fontFamily: 'system-ui, sans-serif' }}>
      <div style={{ fontSize: 12, fontWeight: 600, marginBottom: 8, color: '#27272a' }}>
        Artifact smoke — recharts
      </div>
      <ResponsiveContainer width="100%" height={220}>
        <LineChart data={data} margin={{ top: 8, right: 12, bottom: 8, left: -12 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#e4e4e7" />
          <XAxis dataKey="name" tick={{ fontSize: 11 }} />
          <YAxis tick={{ fontSize: 11 }} />
          <Tooltip />
          <Line type="monotone" dataKey="v" stroke="#f59e0b" strokeWidth={2} dot={{ r: 3 }} />
        </LineChart>
      </ResponsiveContainer>
    </div>
  )
}
`;
