import React, { useMemo, useState } from "react";
import { createRoot } from "react-dom/client";

const DEFAULT_SQL = "SELECT COUNT(*) AS count FROM account";

// Web resources are same-origin with the org, so a relative URL works with the session cookie.
const API = "/api/data/v9.2/";

// The sql option hangs off an entity set, so look up the EntitySetName of the first FROM table.
async function entitySetFor(sql) {
  const m = /\bfrom\s+([a-z0-9_]+)/i.exec(sql);
  if (!m) throw new Error("Could not find a FROM table in the query.");
  const logical = m[1].toLowerCase();
  const r = await fetch(`${API}EntityDefinitions(LogicalName='${logical}')?$select=EntitySetName`, {
    headers: { Accept: "application/json" },
  });
  if (!r.ok) throw new Error(`Table '${logical}' not found (${r.status}).`);
  return (await r.json()).EntitySetName;
}

async function getJson(url, maxPageSize) {
  const headers = { Accept: "application/json", "OData-MaxVersion": "4.0", "OData-Version": "4.0" };
  if (maxPageSize) headers.Prefer = `odata.maxpagesize=${maxPageSize}`;
  const r = await fetch(url, { headers });
  const text = await r.text();
  let json;
  try { json = JSON.parse(text); } catch { json = null; }
  if (!r.ok) throw new Error(json?.error?.message ?? `HTTP ${r.status}\n${text.slice(0, 500)}`);
  return json;
}

const isAnnotation = (k) => k.includes("@");

function toCsv(columns, rows) {
  const esc = (v) => {
    const s = v == null ? "" : String(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return [columns.join(","), ...rows.map((r) => columns.map((c) => esc(r[c])).join(","))].join("\n");
}

function App() {
  const [sql, setSql] = useState(DEFAULT_SQL);
  const [pageSize, setPageSize] = useState(100);
  const [rows, setRows] = useState([]);
  const [nextLink, setNextLink] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [status, setStatus] = useState("");

  const columns = useMemo(() => {
    const set = new Set();
    rows.forEach((r) => Object.keys(r).forEach((k) => !isAnnotation(k) && set.add(k)));
    // The primary key is returned automatically; keep it last so the requested columns lead.
    const cols = [...set];
    const pk = cols.find((c) => /id$/.test(c) && rows.every((r) => typeof r[c] === "string" && r[c].length === 36));
    return pk ? [...cols.filter((c) => c !== pk), pk] : cols;
  }, [rows]);

  async function run() {
    setBusy(true); setError(""); setStatus(""); setRows([]); setNextLink(null);
    const t0 = performance.now();
    try {
      const set = await entitySetFor(sql);
      const json = await getJson(`${API}${set}?sql=${encodeURIComponent(sql.trim().replace(/;$/, ""))}`, pageSize);
      setRows(json.value);
      setNextLink(json["@odata.nextLink"] ?? null);
      setStatus(`${json.value.length} row(s) in ${Math.round(performance.now() - t0)} ms`);
    } catch (e) {
      setError(e.message);
    } finally { setBusy(false); }
  }

  async function more() {
    setBusy(true); setError("");
    const t0 = performance.now();
    try {
      const json = await getJson(nextLink, pageSize);
      setRows((r) => [...r, ...json.value]);
      setNextLink(json["@odata.nextLink"] ?? null);
      setStatus(`+${json.value.length} row(s) in ${Math.round(performance.now() - t0)} ms`);
    } catch (e) { setError(e.message); } finally { setBusy(false); }
  }

  function download() {
    const blob = new Blob([toCsv(columns, rows)], { type: "text/csv" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = "query.csv";
    a.click();
    URL.revokeObjectURL(a.href);
  }

  return (
    <div className="app">
      <h1>SQL Runner</h1>
      <textarea value={sql} onChange={(e) => setSql(e.target.value)} spellCheck={false}
        onKeyDown={(e) => { if ((e.ctrlKey || e.metaKey) && e.key === "Enter") run(); }} />
      <div className="row">
        <button onClick={run} disabled={busy || !sql.trim()}>Run (Ctrl+Enter)</button>
        <label>Page size <input type="text" size={5} value={pageSize}
          onChange={(e) => setPageSize(parseInt(e.target.value, 10) || 100)} /></label>
        {nextLink && <button className="secondary" onClick={more} disabled={busy}>Load more</button>}
        {rows.length > 0 && <button className="secondary" onClick={download}>Export CSV</button>}
        <span className="status">{busy ? "Running…" : status}</span>
      </div>
      {error && <div className="error">{error}</div>}
      <div className="grid">
        <table>
          <thead><tr>{columns.map((c) => <th key={c}>{c}</th>)}</tr></thead>
          <tbody>{rows.map((r, i) => (
            <tr key={i}>{columns.map((c) => <td key={c}>{r[`${c}@OData.Community.Display.V1.FormattedValue`] ?? (r[c] == null ? "" : String(r[c]))}</td>)}</tr>
          ))}</tbody>
        </table>
      </div>
    </div>
  );
}

createRoot(document.getElementById("root")).render(<App />);
