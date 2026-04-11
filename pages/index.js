import { useState, useRef } from "react";
import Head from "next/head";
import * as XLSX from "xlsx";

const STATUS = { IDLE: "idle", QUEUED: "queued", LOADING: "loading", DONE: "done", ERROR: "error" };

export default function Home() {
  const [status, setStatus] = useState(STATUS.IDLE);
  const [queue, setQueue] = useState([]); // fichiers en attente
  const [results, setResults] = useState([]);
  const [error, setError] = useState("");
  const [dragging, setDragging] = useState(false);
  const inputRef = useRef();

  const addFiles = (newFiles) => {
    const pdfs = [...newFiles].filter((f) => f.type === "application/pdf");
    if (!pdfs.length) return;
    setQueue((prev) => {
      const existingNames = new Set(prev.map((f) => f.name));
      const unique = pdfs.filter((f) => !existingNames.has(f.name));
      return [...prev, ...unique];
    });
    setStatus(STATUS.QUEUED);
    if (inputRef.current) inputRef.current.value = "";
  };

  const removeFile = (idx) => {
    setQueue((prev) => {
      const next = prev.filter((_, i) => i !== idx);
      if (next.length === 0) setStatus(STATUS.IDLE);
      return next;
    });
  };

  const extract = async () => {
    if (!queue.length) return;
    setStatus(STATUS.LOADING);
    setError("");

    const fd = new FormData();
    for (const f of queue) fd.append("pdfs", f);

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
  };

  const onFileChange = (e) => addFiles(e.target.files);

  const onDrop = (e) => {
    e.preventDefault();
    setDragging(false);
    addFiles(e.dataTransfer.files);
  };

  const exportCSV = () => {
    const header = ["Fichier", "Destinataire", "Adresse Complète", "Téléphone"];
    const rows = results.map((r) => [r.fichier, r.nom_complet, r.adresse_complete, r.telephone]);
    const csv = [header, ...rows]
      .map((row) => row.map((v) => `"${(v ?? "").replace(/"/g, '""')}"`).join(","))
      .join("\n");
    download("destinataires_colissimo.csv", "text/csv;charset=utf-8;", "\uFEFF" + csv);
  };

  const exportExcel = () => {
    const ws = XLSX.utils.json_to_sheet(
      results.map((r) => ({
        Fichier: r.fichier,
        Destinataire: r.nom_complet,
        "Adresse Complète": r.adresse_complete,
        Téléphone: r.telephone,
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
    setQueue([]);
    setResults([]);
    setError("");
    if (inputRef.current) inputRef.current.value = "";
  };

  const showDropzone = status !== STATUS.LOADING && status !== STATUS.DONE;

  return (
    <>
      <Head>
        <title>Colissimo — Extraction destinataires</title>
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link href="https://fonts.googleapis.com/css2?family=DM+Mono:wght@400;500&family=Syne:wght@600;700;800&display=swap" rel="stylesheet" />
      </Head>

      <div className="root">
        <header>
          <div className="logo-area">
            <img src="/logo-api.png" alt="Logo" className="logo-img" />
            <span className="logo-text">API-Goudouneix</span>
          </div>
          <p className="subtitle">Import PDF · Extraction destinataires · Export CSV / Excel</p>
        </header>

        <main>
          {/* Zone de dépôt — visible tant qu'on n'est pas en cours ou terminé */}
          {showDropzone && (
            <div
              className={`dropzone ${dragging ? "dragging" : ""}`}
              onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
              onDragLeave={() => setDragging(false)}
              onDrop={onDrop}
              onClick={() => inputRef.current?.click()}
            >
              <input
                ref={inputRef}
                type="file"
                accept=".pdf"
                multiple
                style={{ display: "none" }}
                onChange={onFileChange}
              />
              <div className="drop-icon">⊕</div>
              <p className="drop-label">
                {status === STATUS.QUEUED ? "Ajouter d'autres PDFs" : "Glissez vos PDFs Colissimo ici"}
              </p>
              <p className="drop-sub">ou cliquez pour sélectionner · Plusieurs fichiers acceptés</p>
            </div>
          )}

          {/* Spinner extraction */}
          {status === STATUS.LOADING && (
            <div className="loading-area">
              <div className="spinner" />
              <span>Extraction en cours…</span>
            </div>
          )}

          {/* Erreur */}
          {status === STATUS.ERROR && (
            <div className="error-box">
              <strong>Erreur :</strong> {error}
              <button className="btn btn-reset" onClick={reset}>Réessayer</button>
            </div>
          )}

          {/* File en attente */}
          {status === STATUS.QUEUED && queue.length > 0 && (
            <div className="queue-area">
              <div className="queue-header">
                <span className="queue-count">{queue.length} fichier{queue.length > 1 ? "s" : ""} prêt{queue.length > 1 ? "s" : ""}</span>
                <div className="queue-actions">
                  <button className="btn btn-extract" onClick={extract}>
                    ▶ Extraire les destinataires
                  </button>
                  <button className="btn btn-reset" onClick={reset}>Tout effacer</button>
                </div>
              </div>

              <div className="file-list">
                {queue.map((f, i) => (
                  <div key={i} className="file-item">
                    <span className="file-icon">📄</span>
                    <span className="file-name" title={f.name}>{f.name}</span>
                    <button className="file-remove" onClick={() => removeFile(i)} title="Retirer">✕</button>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Résultats */}
          {status === STATUS.DONE && results.length > 0 && (
            <div className="results-area">
              <div className="results-header">
                <span className="results-count">
                  {results.length} destinataire{results.length > 1 ? "s" : ""} extrait{results.length > 1 ? "s" : ""}
                </span>
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
          --bg: #f4f5f7;
          --surface: #ffffff;
          --border: #dde1e9;
          --accent: #2563eb;
          --accent2: #0ea572;
          --text: #1a1d27;
          --muted: #7a8099;
          --error: #dc2626;
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
        .logo-img { height: 36px; width: auto; }
        .logo-text { font-family: var(--font-display); font-size: 1.5rem; font-weight: 800; letter-spacing: .04em; color: var(--text); }
        .subtitle { font-size: .78rem; color: var(--muted); letter-spacing: .06em; }

        /* Drop zone */
        .dropzone {
          border: 2px dashed var(--border);
          border-radius: 12px;
          padding: 3rem 2rem;
          text-align: center;
          cursor: pointer;
          transition: border-color .2s, background .2s;
          background: var(--surface);
          user-select: none;
        }
        .dropzone:hover, .dropzone.dragging {
          border-color: var(--accent);
          background: #eef2ff;
        }
        .drop-icon { font-size: 2.8rem; line-height: 1; color: var(--accent); margin-bottom: 1rem; }
        .drop-label { font-family: var(--font-display); font-size: 1.1rem; font-weight: 600; color: var(--text); margin-bottom: .4rem; }
        .drop-sub { font-size: .75rem; color: var(--muted); }

        /* Spinner */
        .loading-area {
          display: flex; flex-direction: column; align-items: center;
          gap: 1rem; padding: 4rem 0; color: var(--muted); font-size: .85rem;
        }
        .spinner {
          width: 36px; height: 36px;
          border: 3px solid var(--border);
          border-top-color: var(--accent);
          border-radius: 50%;
          animation: spin .8s linear infinite;
        }
        @keyframes spin { to { transform: rotate(360deg); } }

        /* Erreur */
        .error-box {
          margin-top: 1.5rem;
          background: rgba(220,38,38,.07);
          border: 1px solid var(--error);
          border-radius: 8px;
          padding: 1rem 1.25rem;
          color: var(--error);
          font-size: .85rem;
          display: flex; align-items: center; gap: 1rem;
        }

        /* File queue */
        .queue-area { margin-top: 1.5rem; }
        .queue-header {
          display: flex; justify-content: space-between; align-items: center;
          margin-bottom: 1rem; flex-wrap: wrap; gap: .75rem;
        }
        .queue-count {
          font-family: var(--font-display); font-size: 1rem; font-weight: 700; color: var(--text);
        }
        .queue-actions { display: flex; gap: .5rem; flex-wrap: wrap; }

        .file-list {
          border: 1px solid var(--border);
          border-radius: 10px;
          overflow: hidden;
          background: var(--surface);
        }
        .file-item {
          display: flex; align-items: center; gap: .75rem;
          padding: .65rem 1rem;
          border-bottom: 1px solid var(--border);
          font-size: .82rem;
          transition: background .15s;
        }
        .file-item:last-child { border-bottom: none; }
        .file-item:hover { background: rgba(37,99,235,.03); }
        .file-icon { font-size: 1rem; flex-shrink: 0; }
        .file-name { flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: var(--text); }
        .file-remove {
          background: none; border: none; cursor: pointer;
          color: var(--muted); font-size: .8rem; padding: .2rem .4rem;
          border-radius: 4px; transition: all .15s; flex-shrink: 0;
        }
        .file-remove:hover { background: rgba(220,38,38,.1); color: var(--error); }

        /* Boutons */
        .btn {
          font-family: var(--font-mono); font-size: .75rem; font-weight: 500;
          letter-spacing: .05em; padding: .45rem 1rem;
          border-radius: 6px; border: 1px solid; cursor: pointer; transition: all .15s;
        }
        .btn-extract { background: var(--accent); border-color: var(--accent); color: #fff; }
        .btn-extract:hover { background: #1d4ed8; border-color: #1d4ed8; }
        .btn-csv { background: transparent; border-color: var(--accent); color: var(--accent); }
        .btn-csv:hover { background: var(--accent); color: #fff; }
        .btn-xlsx { background: transparent; border-color: var(--accent2); color: var(--accent2); }
        .btn-xlsx:hover { background: var(--accent2); color: #fff; }
        .btn-reset { background: transparent; border-color: var(--border); color: var(--muted); }
        .btn-reset:hover { border-color: var(--muted); color: var(--text); }

        /* Résultats */
        .results-area { margin-top: 2rem; }
        .results-header {
          display: flex; justify-content: space-between; align-items: center;
          margin-bottom: 1rem; flex-wrap: wrap; gap: .75rem;
        }
        .results-count { font-family: var(--font-display); font-size: 1rem; font-weight: 700; color: var(--accent2); }
        .export-btns { display: flex; gap: .5rem; flex-wrap: wrap; }

        .table-wrap { overflow-x: auto; border-radius: 10px; border: 1px solid var(--border); }
        table { width: 100%; border-collapse: collapse; font-size: .8rem; }
        thead { background: var(--surface); }
        th {
          padding: .75rem 1rem; text-align: left; font-size: .7rem;
          letter-spacing: .08em; color: var(--muted); font-weight: 500;
          border-bottom: 1px solid var(--border); white-space: nowrap;
        }
        td {
          padding: .7rem 1rem; border-bottom: 1px solid var(--border);
          vertical-align: middle; color: var(--text);
        }
        tr:last-child td { border-bottom: none; }
        tr:hover td { background: rgba(37,99,235,.04); }
        tr.row-error td { color: var(--error); }

        .cell-file { max-width: 180px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: var(--muted); }
        .cell-mono { font-family: var(--font-mono); letter-spacing: .03em; }
        .empty { color: var(--border); }

        @media (max-width: 600px) {
          th, td { padding: .5rem .6rem; }
        }
      `}</style>
    </>
  );
}
