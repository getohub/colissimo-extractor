import { useState, useRef, useCallback } from "react";
import Head from "next/head";
import * as XLSX from "xlsx";

const STATUS = { IDLE: "idle", LOADING: "loading", DONE: "done", ERROR: "error" };

export default function Home() {
  const [status, setStatus] = useState(STATUS.IDLE);
  const [results, setResults] = useState([]);
  const [error, setError] = useState("");
  const [dragging, setDragging] = useState(false);
  const inputRef = useRef();

  const process = useCallback(async (files) => {
    if (!files.length) return;
    setStatus(STATUS.LOADING);
    setError("");
    setResults([]);

    const fd = new FormData();
    for (const f of files) fd.append("pdfs", f);

    try {
      const r = await fetch("/api/extract", { method: "POST", body: fd });
      const data = await r.json();
      if (!r.ok) throw new Error(data.error || "Erreur serveur");
      setResults(data.results || []);
      setStatus(STATUS.DONE);
    } catch (e) {
      setError(e.message);
      setStatus(STATUS.ERROR);
    }
  }, []);

  const onFileChange = (e) => process([...e.target.files]);

  const onDrop = (e) => {
    e.preventDefault();
    setDragging(false);
    const files = [...e.dataTransfer.files].filter((f) => f.type === "application/pdf");
    process(files);
  };

  const exportCSV = () => {
    const header = ["Fichier", "Destinataire", "Adresse Complète", "Téléphone", "Source"];
    const rows = results.map((r) => [
      r.fichier, r.nom_complet, r.adresse_complete, r.telephone, r.source,
    ]);
    const csvContent = [header, ...rows]
      .map((row) => row.map((v) => `"${(v ?? "").replace(/"/g, '""')}"`).join(","))
      .join("\n");
    download("destinataires_colissimo.csv", "text/csv;charset=utf-8;", "\uFEFF" + csvContent);
  };

  const exportExcel = () => {
    const ws = XLSX.utils.json_to_sheet(
      results.map((r) => ({
        Fichier: r.fichier,
        Destinataire: r.nom_complet,
        "Adresse Complète": r.adresse_complete,
        Téléphone: r.telephone,
        Source: r.source,
      }))
    );
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Destinataires");
    XLSX.writeFile(wb, "destinataires_colissimo.xlsx");
  };

  const download = (name, type, content) => {
    const blob = new Blob([content], { type });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = name;
    a.click();
    URL.revokeObjectURL(url);
  };

  const reset = () => {
    setStatus(STATUS.IDLE);
    setResults([]);
    setError("");
    if (inputRef.current) inputRef.current.value = "";
  };

  return (
    <>
      <Head>
        <title>Colissimo — Extraction destinataires</title>
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link href="https://fonts.googleapis.com/css2?family=DM+Mono:wght@400;500&family=Syne:wght@600;700;800&display=swap" rel="stylesheet" />
      </Head>

      <div className="root">
        {/* Header */}
        <header>
          <div className="logo-area">
            <span className="logo-dot" />
            <span className="logo-text">COLISSIMO EXTRACTOR</span>
          </div>
          <p className="subtitle">Import PDF · Extraction destinataires · Export CSV / Excel</p>
        </header>

        <main>
          {/* Drop Zone */}
          <div
            className={`dropzone ${dragging ? "dragging" : ""} ${status === STATUS.LOADING ? "loading" : ""}`}
            onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
            onDragLeave={() => setDragging(false)}
            onDrop={onDrop}
            onClick={() => status !== STATUS.LOADING && inputRef.current?.click()}
          >
            <input
              ref={inputRef}
              type="file"
              accept=".pdf"
              multiple
              style={{ display: "none" }}
              onChange={onFileChange}
            />
            {status === STATUS.LOADING ? (
              <div className="loader-area">
                <div className="spinner" />
                <span>Extraction en cours…</span>
              </div>
            ) : (
              <>
                <div className="drop-icon">⊕</div>
                <p className="drop-label">Glissez vos PDFs Colissimo ici</p>
                <p className="drop-sub">ou cliquez pour sélectionner · Plusieurs fichiers acceptés</p>
              </>
            )}
          </div>

          {/* Error */}
          {status === STATUS.ERROR && (
            <div className="error-box">
              <strong>Erreur :</strong> {error}
              <button className="btn-reset" onClick={reset}>Réessayer</button>
            </div>
          )}

          {/* Results */}
          {status === STATUS.DONE && results.length > 0 && (
            <div className="results-area">
              <div className="results-header">
                <span className="results-count">{results.length} destinataire{results.length > 1 ? "s" : ""} extrait{results.length > 1 ? "s" : ""}</span>
                <div className="export-btns">
                  <button className="btn btn-csv" onClick={exportCSV}>↓ CSV</button>
                  <button className="btn btn-xlsx" onClick={exportExcel}>↓ Excel</button>
                  <button className="btn btn-reset" onClick={reset}>Nouveau</button>
                </div>
              </div>

              <div className="table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th>Fichier</th>
                      <th>Destinataire</th>
                      <th>Adresse</th>
                      <th>Téléphone</th>
                      <th>Source</th>
                    </tr>
                  </thead>
                  <tbody>
                    {results.map((r, i) => (
                      <tr key={i} className={r.error ? "row-error" : ""}>
                        <td className="cell-file" title={r.fichier}>{r.fichier}</td>
                        {r.error ? (
                          <td colSpan="3" style={{ color: "var(--error)", fontSize: ".7rem" }}>
                            <strong>Erreur :</strong> {r.error}
                          </td>
                        ) : (
                          <>
                            <td>{r.nom_complet || <span className="empty">—</span>}</td>
                            <td>{r.adresse_complete || <span className="empty">—</span>}</td>
                            <td className="cell-mono">{r.telephone || <span className="empty">—</span>}</td>
                          </>
                        )}
                        <td>
                          <span className={`badge badge-${r.source === "ocr" ? "ocr" : r.source === "native" ? "native" : "error"}`}>
                            {r.source || "?"}
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </main>
      </div>

      <style jsx global>{`
        *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }

        :root {
          --bg: #0e0f11;
          --surface: #16181c;
          --border: #2a2d35;
          --accent: #f0c040;
          --accent2: #4af0a0;
          --text: #e8eaf0;
          --muted: #6b7080;
          --error: #f05a5a;
          --font-display: 'Syne', sans-serif;
          --font-mono: 'DM Mono', monospace;
        }

        html, body { background: var(--bg); color: var(--text); font-family: var(--font-mono); min-height: 100vh; }

        .root { max-width: 1100px; margin: 0 auto; padding: 2rem 1.5rem 4rem; }

        header {
          padding: 2rem 0 2.5rem;
          border-bottom: 1px solid var(--border);
          margin-bottom: 2.5rem;
        }
        .logo-area { display: flex; align-items: center; gap: .75rem; margin-bottom: .5rem; }
        .logo-dot { width: 14px; height: 14px; background: var(--accent); border-radius: 50%; flex-shrink: 0; }
        .logo-text { font-family: var(--font-display); font-size: 1.5rem; font-weight: 800; letter-spacing: .04em; color: var(--text); }
        .subtitle { font-size: .78rem; color: var(--muted); letter-spacing: .06em; }

        /* Drop zone */
        .dropzone {
          border: 2px dashed var(--border);
          border-radius: 12px;
          padding: 3.5rem 2rem;
          text-align: center;
          cursor: pointer;
          transition: border-color .2s, background .2s;
          background: var(--surface);
          position: relative;
          user-select: none;
        }
        .dropzone:hover, .dropzone.dragging {
          border-color: var(--accent);
          background: #1a1c20;
        }
        .dropzone.loading { cursor: default; pointer-events: none; }

        .drop-icon { font-size: 2.8rem; line-height: 1; color: var(--accent); margin-bottom: 1rem; }
        .drop-label { font-family: var(--font-display); font-size: 1.1rem; font-weight: 600; color: var(--text); margin-bottom: .4rem; }
        .drop-sub { font-size: .75rem; color: var(--muted); }

        .loader-area { display: flex; flex-direction: column; align-items: center; gap: 1rem; color: var(--muted); font-size: .85rem; }
        .spinner {
          width: 36px; height: 36px;
          border: 3px solid var(--border);
          border-top-color: var(--accent);
          border-radius: 50%;
          animation: spin .8s linear infinite;
        }
        @keyframes spin { to { transform: rotate(360deg); } }

        /* Error */
        .error-box {
          margin-top: 1.5rem;
          background: rgba(240,90,90,.1);
          border: 1px solid var(--error);
          border-radius: 8px;
          padding: 1rem 1.25rem;
          color: var(--error);
          font-size: .85rem;
          display: flex;
          align-items: center;
          gap: 1rem;
        }

        /* Results */
        .results-area { margin-top: 2rem; }
        .results-header {
          display: flex;
          justify-content: space-between;
          align-items: center;
          margin-bottom: 1rem;
          flex-wrap: wrap;
          gap: .75rem;
        }
        .results-count {
          font-family: var(--font-display);
          font-size: 1rem;
          font-weight: 700;
          color: var(--accent2);
        }
        .export-btns { display: flex; gap: .5rem; flex-wrap: wrap; }

        .btn {
          font-family: var(--font-mono);
          font-size: .75rem;
          font-weight: 500;
          letter-spacing: .05em;
          padding: .45rem 1rem;
          border-radius: 6px;
          border: 1px solid;
          cursor: pointer;
          transition: all .15s;
        }
        .btn-csv { background: transparent; border-color: var(--accent); color: var(--accent); }
        .btn-csv:hover { background: var(--accent); color: var(--bg); }
        .btn-xlsx { background: transparent; border-color: var(--accent2); color: var(--accent2); }
        .btn-xlsx:hover { background: var(--accent2); color: var(--bg); }
        .btn-reset { background: transparent; border-color: var(--border); color: var(--muted); }
        .btn-reset:hover { border-color: var(--muted); color: var(--text); }

        /* Table */
        .table-wrap { overflow-x: auto; border-radius: 10px; border: 1px solid var(--border); }
        table { width: 100%; border-collapse: collapse; font-size: .8rem; }
        thead { background: var(--surface); }
        th {
          padding: .75rem 1rem;
          text-align: left;
          font-size: .7rem;
          letter-spacing: .08em;
          color: var(--muted);
          font-weight: 500;
          border-bottom: 1px solid var(--border);
          white-space: nowrap;
        }
        td {
          padding: .7rem 1rem;
          border-bottom: 1px solid var(--border);
          vertical-align: middle;
          color: var(--text);
        }
        tr:last-child td { border-bottom: none; }
        tr:hover td { background: rgba(255,255,255,.02); }
        tr.row-error td { color: var(--error); }

        .cell-file { max-width: 150px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: var(--muted); }
        .cell-mono { font-family: var(--font-mono); letter-spacing: .03em; }
        .empty { color: var(--border); }

        .badge {
          display: inline-block;
          padding: .2rem .5rem;
          border-radius: 4px;
          font-size: .65rem;
          letter-spacing: .06em;
          font-weight: 500;
        }
        .badge-native { background: rgba(74,240,160,.12); color: var(--accent2); }
        .badge-ocr { background: rgba(240,192,64,.12); color: var(--accent); }

        @media (max-width: 600px) {
          th, td { padding: .5rem .6rem; }
        }
      `}</style>
    </>
  );
}
