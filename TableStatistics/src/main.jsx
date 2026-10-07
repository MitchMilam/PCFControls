import React, { useEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";

// Web resources are same-origin with the org, so relative URLs work with the session cookie.
const API = "/api/data/v9.2/";
const TOP = 100;
const CONCURRENCY = 8;
const AGGREGATE_LIMIT_CODE = "8004e023"; // AggregateQueryRecordLimit exceeded (50,000 rows)
const EPOCH = Date.UTC(2000, 0, 1);

const HEADERS = { Accept: "application/json", "OData-MaxVersion": "4.0", "OData-Version": "4.0" };

async function getJson(url) {
  const r = await fetch(url, { headers: HEADERS });
  const text = await r.text();
  let json = null;
  try { json = JSON.parse(text); } catch { /* not json */ }
  if (!r.ok) {
    const err = new Error(json?.error?.message ?? `HTTP ${r.status}`);
    err.code = String(json?.error?.code ?? "").toLowerCase();
    err.text = (json?.error?.message ?? "").toLowerCase();
    throw err;
  }
  return json;
}

const isLimitError = (e) => e.code.includes(AGGREGATE_LIMIT_CODE) || e.text.includes("aggregatequeryrecordlimit");

// Tables people can add data to: real (non-virtual) tables that are not private or intersect tables
// and that Advanced Find can query. Metadata flags cannot separate system tables from user tables
// in an org full of installed solutions, so empty tables simply fall out of the ranking.
async function loadTables() {
  const json = await getJson(
    `${API}EntityDefinitions?$select=LogicalName,EntitySetName,DisplayName,IsPrivate,IsIntersect,IsValidForAdvancedFind,TableType`
  );
  return json.value
    .filter((e) => !e.IsPrivate && !e.IsIntersect && e.IsValidForAdvancedFind && e.TableType !== "Virtual" && e.EntitySetName)
    .map((e) => ({
      logical: e.LogicalName,
      set: e.EntitySetName,
      display: e.DisplayName?.UserLocalizedLabel?.Label ?? e.LogicalName,
    }));
}

const sqlDate = (ms) => new Date(ms).toISOString().slice(0, 19).replace("T", " ");

async function countSql(set, table, where) {
  const sql = `SELECT COUNT(*) AS n FROM ${table}${where ? ` WHERE ${where}` : ""}`;
  const json = await getJson(`${API}${set}?sql=${encodeURIComponent(sql)}`);
  return json.value[0].n;
}

// Exact count for tables over the 50,000-row aggregate cap: split on createdon and bisect any slice that is still too big.
async function countSliced(t, lo, hi) {
  const where = `createdon >= '${sqlDate(lo)}' AND createdon < '${sqlDate(hi)}'`;
  try {
    return await countSql(t.set, t.logical, where);
  } catch (e) {
    if (!isLimitError(e) || hi - lo <= 1000) throw e;
    const mid = Math.floor((lo + hi) / 2);
    const [a, b] = await Promise.all([countSliced(t, lo, mid), countSliced(t, mid, hi)]);
    return a + b;
  }
}

// Last resort: Dataverse's own cached total, which can be hours old. Flagged as approximate in the grid.
async function countApprox(t) {
  const json = await getJson(`${API}RetrieveTotalRecordCount(EntityNames=['${t.logical}'])`);
  const entry = json.EntityRecordCountCollection?.Values?.[0] ?? json.EntityRecordCountCollection?.Entities?.[0];
  return Number(entry ?? 0);
}

async function countTable(t) {
  try {
    return { count: await countSql(t.set, t.logical), approx: false };
  } catch (e) {
    if (!isLimitError(e)) throw e;
  }
  try {
    const end = Date.now() + 86400000;
    const dated = await countSliced(t, EPOCH, end);
    // Rows with no created-on date (typically imported) are outside every slice.
    const undated = await countSql(t.set, t.logical, "createdon IS NULL").catch(() => 0);
    return { count: dated + undated, approx: false };
  } catch {
    return { count: await countApprox(t), approx: true };
  }
}

const fmt = (n) => n.toLocaleString();

function App() {
  const [results, setResults] = useState([]);
  const [progress, setProgress] = useState({ done: 0, total: 0, failed: 0 });
  const [running, setRunning] = useState(false);
  const [error, setError] = useState("");
  const [elapsed, setElapsed] = useState(0);
  const cancel = useRef(false);

  async function run() {
    cancel.current = false;
    setRunning(true); setError(""); setResults([]); setProgress({ done: 0, total: 0, failed: 0 });
    const t0 = performance.now();
    try {
      const tables = await loadTables();
      setProgress({ done: 0, total: tables.length, failed: 0 });
      const found = [];
      let done = 0, failed = 0, next = 0;
      const publish = () => {
        setResults(found.filter((r) => r.count > 0).sort((a, b) => b.count - a.count).slice(0, TOP));
        setProgress({ done, total: tables.length, failed });
      };
      const worker = async () => {
        while (!cancel.current && next < tables.length) {
          const t = tables[next++];
          try {
            const c = await countTable(t);
            found.push({ ...t, ...c });
          } catch { failed++; }
          done++;
          if (done % 25 === 0) publish();
        }
      };
      await Promise.all(Array.from({ length: CONCURRENCY }, worker));
      publish();
    } catch (e) {
      setError(e.message);
    } finally {
      setElapsed(Math.round((performance.now() - t0) / 1000));
      setRunning(false);
    }
  }

  useEffect(() => { run(); return () => { cancel.current = true; }; }, []);

  const pct = progress.total ? Math.round((progress.done / progress.total) * 100) : 0;

  return (
    <div className="app">
      <h1>Table Statistics</h1>
      <div className="row">
        <button onClick={run} disabled={running}>Refresh</button>
        {running && <button className="secondary" onClick={() => { cancel.current = true; }}>Stop</button>}
        <span className="status">
          {running
            ? `Counting ${fmt(progress.done)} of ${fmt(progress.total)} tables (${pct}%)…`
            : progress.total
              ? `${fmt(progress.total)} tables counted in ${elapsed}s${progress.failed ? `, ${fmt(progress.failed)} could not be queried` : ""}`
              : ""}
        </span>
      </div>
      {error && <div className="error">{error}</div>}
      <div className="grid">
        <table>
          <thead><tr><th>Table Name</th><th className="num">Row Count</th></tr></thead>
          <tbody>
            {results.map((r) => (
              <tr key={r.logical}>
                <td>{r.display} <span className="muted">({r.logical})</span></td>
                <td className="num">{r.approx ? "~" : ""}{fmt(r.count)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="status">A ~ prefix marks a cached approximate count; every other count is exact.</div>
    </div>
  );
}

createRoot(document.getElementById("root")).render(<App />);
