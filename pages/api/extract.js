import { IncomingForm } from "formidable";
import { spawn } from "child_process";
import path from "path";
import fs from "fs";

export const config = {
  api: { bodyParser: false },
};

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const uploadDir = path.join(process.cwd(), "tmp");
  if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir);

  const form = new IncomingForm({
    uploadDir,
    keepExtensions: true,
    multiples: true,
    maxFileSize: 500 * 1024 * 1024, // 500MB
    maxTotalFileSize: 1000 * 1024 * 1024, // 1GB
  });

  try {
    const results = await new Promise((resolve, reject) => {
      form.parse(req, async (err, _fields, files) => {
        if (err) return reject(new Error("Erreur d'upload : " + err.message));

        let fileList = files.pdfs ?? files["pdfs[]"] ?? [];
        if (!Array.isArray(fileList)) fileList = [fileList];
        if (!fileList.length) return reject(new Error("Aucun fichier reçu"));

        const paths = fileList.map((f) => f.filepath ?? f.path);
        const origNames = fileList.map((f) => f.originalFilename ?? f.name ?? "fichier.pdf");
        
        // On prépare les arguments pour stdin
        const fileData = paths.map((p, i) => `${p}|||${origNames[i]}`).join("\n");

        const exePath = path.join(process.cwd(), "scripts", "dist", "extract.exe");
        const scriptPath = path.join(process.cwd(), "scripts", "extract.py");
        const pythonDefault = path.join(process.env.LOCALAPPDATA || "", "Programs", "Python", "Python312", "python.exe");
        const python = process.env.PYTHON_BIN || (fs.existsSync(pythonDefault) ? pythonDefault : "python");

        const [bin, args] = fs.existsSync(exePath)
          ? [exePath, []]
          : [python, [scriptPath]];

        try {
          const extractionResults = await runPython(bin, args, fileData);
          // Nettoyage fichiers tmp après extraction
          paths.forEach((p) => { try { fs.unlinkSync(p); } catch {} });
          resolve(extractionResults);
        } catch (e) {
          paths.forEach((p) => { try { fs.unlinkSync(p); } catch {} });
          reject(e);
        }
      });
    });

    return res.status(200).json({ results });
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
}

function runPython(bin, args, inputData) {
  return new Promise((resolve, reject) => {
    const proc = spawn(bin, args);
    let stdout = "";
    let stderr = "";

    // Envoi des données via stdin
    if (inputData) {
      proc.stdin.write(inputData);
      proc.stdin.end();
    }

    proc.stdout.on("data", (d) => (stdout += d));
    proc.stderr.on("data", (d) => (stderr += d));
    proc.on("close", (code) => {
      if (code !== 0) return reject(new Error(stderr || `Python exited with code ${code}`));
      try {
        resolve(JSON.parse(stdout));
      } catch {
        reject(new Error("Invalid JSON from Python: " + stdout.slice(0, 200)));
      }
    });
  });
}
