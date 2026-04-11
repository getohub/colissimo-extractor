#!/usr/bin/env python3
"""
Extraction destinataire Colissimo depuis PDF.
Tente PyMuPDF (texte natif), fallback OCR Tesseract si besoin.
Retourne JSON sur stdout.
"""

import sys
import re
import json
import fitz  # PyMuPDF

import os

# Tesseract en fallback
try:
    import pytesseract
    from PIL import Image
    import io

    # Configuration Tesseract pour Windows
    tesseract_win_path = r'C:\Program Files\Tesseract-OCR\tesseract.exe'
    if os.path.exists(tesseract_win_path):
        pytesseract.pytesseract.tesseract_cmd = tesseract_win_path

    OCR_AVAILABLE = True
except ImportError:
    OCR_AVAILABLE = False


def clean(text: str) -> str:
    if not text: return ""
    # Suppression des caractères bizarres (comme le diamant ?)
    cleaned = text.replace("\ufffd", "e").replace("\u00ef", "i")
    # Suppression de ce qui n'est pas alphanumérique ou ponctuation standard
    cleaned = re.sub(r"[^\x20-\x7E\u00C0-\u00FF]", "", cleaned)
    return " ".join(cleaned.strip().split())


def extract_text_native(pdf_path: str) -> str:
    """Extrait le texte brut de toutes les pages via PyMuPDF."""
    doc = fitz.open(pdf_path)
    pages_text = []
    for page in doc:
        pages_text.append(page.get_text("text"))
    doc.close()
    return "\n".join(pages_text)


def extract_text_ocr(pdf_path: str) -> str:
    """Fallback OCR Tesseract page par page."""
    if not OCR_AVAILABLE:
        return ""
    
    # On précise le dossier tessdata local (en mode Windows standard)
    base_dir = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    tessdata_dir = os.path.join(base_dir, "tessdata")
    
    # Configuration pour Windows : SANS guillemets car il n'y a pas d'espaces
    # On définit TESSDATA_PREFIX pour garantir le chargement
    os.environ["TESSDATA_PREFIX"] = tessdata_dir
    custom_config = f'--tessdata-dir {tessdata_dir}'
    
    doc = fitz.open(pdf_path)
    pages_text = []
    for page in doc:
        # Augmentation du zoom pour les photos (3x3)
        mat = fitz.Matrix(3, 3) 
        pix = page.get_pixmap(matrix=mat)
        img = Image.open(io.BytesIO(pix.tobytes("png")))
        
        # On passe le dossier via config ET via l'environnement
        text = pytesseract.image_to_string(img, lang="fra", config=custom_config)
        pages_text.append(text)
    doc.close()
    return "\n".join(pages_text)


def extract_text_spatial(pdf_path: str) -> str:
    """
    Extrait le texte de la colonne de droite (Preuve de dépôt) en respectant l'ordre visuel.
    """
    doc = fitz.open(pdf_path)
    all_lines = []
    
    for page in doc:
        width = page.rect.width
        # get_text("dict") donne les coordonnées de chaque bloc
        blocks = page.get_text("dict")["blocks"]
        
        # On ne garde que les blocs de texte (type 0) dans la moitié droite (Preuve de dépôt)
        # x0 > width * 0.3 pour être plus large sur les bordereaux décalés
        right_blocks = [b for b in blocks if b["type"] == 0 and b["bbox"][0] > width * 0.3]
        
        # Trier les blocs du haut vers le bas
        right_blocks.sort(key=lambda b: b["bbox"][1])
        
        for b in right_blocks:
            for l in b["lines"]:
                line_text = "".join([s["text"] for s in l["spans"]]).strip()
                if line_text:
                    all_lines.append(line_text)
                    
    doc.close()
    return "\n".join(all_lines)


def parse_destinataire(text: str) -> dict:
    """
    Extrait nom complet, adresse complète et téléphone en se basant sur le titre 'Adresse du destinataire'.
    """
    result = {
        "nom_complet": "",
        "adresse_complete": "",
        "telephone": "",
    }

    lines = [l.strip() for l in text.splitlines() if l.strip()]
    
    # 1. Recherche GLOBALE du téléphone dans tout le texte extrait de la zone droite
    tel_pattern = re.compile(r"(?:0|(?:\+33))[1-9](?:[\s.-]*\d){8}")
    found_tel = None
    for line in lines:
        m = tel_pattern.search(line)
        if m:
            found_tel = re.sub(r"[\s.-]", "", m.group(0))
            break
    
    result["telephone"] = found_tel if found_tel else ""

    # 2. Trouver l'ancrage 'Adresse du destinataire'
    dest_idx = -1
    for i, line in enumerate(lines):
        if "adresse du destinataire" in line.lower():
            dest_idx = i
            break
    
    if dest_idx == -1:
        return result

    # 3. Récupérer les lignes de l'adresse (on cherche sur 20 lignes)
    raw_info = []
    stop_markers = [r"réf\.\s*client", r"cachet", r"signature", r"preuve\s*de\s*dépôt"]
    
    for j in range(dest_idx + 1, min(dest_idx + 20, len(lines))):
        line = lines[j].strip()
        if not line: continue
        if any(re.search(m, line, re.IGNORECASE) for m in stop_markers):
            break
        # On ignore les lignes sans chiffres pour l'adresse (titres)
        if re.search(r"tél|portable", line, re.IGNORECASE) and not re.search(r"\d", line):
            continue
        raw_info.append(line)

    # Ligne 1 : Nom complet
    result["nom_complet"] = raw_info[0]
    
    # Lignes suivantes : Adresse complète (en nettoyant les résidus)
    addr_parts = []
    noise_words = ["Tél.", "portable", "Tél :", "Tél.", "Téléphone :"]
    
    for line in raw_info[1:]:
        # Si la ligne contient le téléphone trouvé, on la nettoie ou on l'ignore
        clean_line = line
        if found_tel:
            # On cherche le format brut dans la ligne pour l'enlever
            m = tel_pattern.search(line)
            if m:
                clean_line = line.replace(m.group(0), "")
        
        # Enlever les étiquettes de bruit
        for word in noise_words:
            clean_line = re.sub(re.escape(word), "", clean_line, flags=re.IGNORECASE)
        
        clean_line = clean_line.strip(" :,-")
        if clean_line:
            addr_parts.append(clean_line)
    
    result["adresse_complete"] = " ".join(addr_parts)

    # Nettoyage final
    for k in result:
        result[k] = clean(result[k])

    return result


def process_pdf(pdf_path: str) -> dict:
    # On utilise toujours la version spatiale pour la "Preuve de dépôt"
    text = extract_text_spatial(pdf_path)
    source = "native"

    # Si rien n'est trouvé, peut-être qu'il faut un OCR (plus rare sur PDF natif)
    if not text.strip() or "destinataire" not in text.lower():
        if OCR_AVAILABLE:
            text = extract_text_ocr(pdf_path)
            source = "ocr"

    data = parse_destinataire(text)
    data["source"] = source
    return data


if __name__ == "__main__":
    if len(sys.argv) < 2:
        print(json.dumps({"error": "No PDF path provided"}))
        sys.exit(1)

    results = []
    for pdf_path in sys.argv[1:]:
        try:
            data = process_pdf(pdf_path)
            # Correction pour Windows
            data["fichier"] = os.path.basename(pdf_path)
            results.append(data)
        except Exception as e:
            results.append({"fichier": os.path.basename(pdf_path), "error": str(e), "source": "error"})

    print(json.dumps(results, ensure_ascii=False))
