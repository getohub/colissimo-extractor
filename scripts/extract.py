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

    tesseract_win_path = r'C:\Program Files\Tesseract-OCR\tesseract.exe'
    if os.path.exists(tesseract_win_path):
        pytesseract.pytesseract.tesseract_cmd = tesseract_win_path

    OCR_AVAILABLE = True
except ImportError:
    OCR_AVAILABLE = False


def clean(text: str) -> str:
    if not text:
        return ""
    cleaned = text.replace("\ufffd", "e").replace("\u00ef", "i")
    cleaned = re.sub(r"[^\x20-\x7E\u00C0-\u00FF]", "", cleaned)
    return " ".join(cleaned.strip().split())


def extract_text_ocr(pdf_path: str) -> str:
    """Fallback OCR Tesseract page par page."""
    if not OCR_AVAILABLE:
        return ""

    base_dir = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    tessdata_dir = os.path.join(base_dir, "tessdata")
    os.environ["TESSDATA_PREFIX"] = tessdata_dir
    custom_config = f'--tessdata-dir {tessdata_dir}'

    doc = fitz.open(pdf_path)
    pages_text = []
    for page in doc:
        mat = fitz.Matrix(3, 3)
        pix = page.get_pixmap(matrix=mat)
        img = Image.open(io.BytesIO(pix.tobytes("png")))
        text = pytesseract.image_to_string(img, lang="fra", config=custom_config)
        pages_text.append(text)
    doc.close()
    return "\n".join(pages_text)


def extract_text_spatial(pdf_path: str) -> str:
    """
    Extrait le texte de la colonne droite (Preuve de dépôt) en ordre visuel.

    Deux passes :
    1. Localiser le bloc "Adresse du destinataire" pour calibrer dynamiquement
       la limite gauche de la zone à extraire.
    2. Extraire tous les blocs à droite de cette limite, triés par Y.
    """
    doc = fitz.open(pdf_path)
    all_lines = []

    for page in doc:
        width = page.rect.width
        blocks = page.get_text("dict")["blocks"]
        text_blocks = [b for b in blocks if b["type"] == 0]

        # Passe 1 : trouver l'abscisse du bloc "Adresse du destinataire"
        dest_x0 = None
        for b in text_blocks:
            block_text = " ".join(
                "".join(s["text"] for s in ln["spans"])
                for ln in b["lines"]
            ).lower()
            if re.search(r"adresse\s*du\s*destinataire", block_text):
                dest_x0 = b["bbox"][0]
                break

        # Limite gauche : x0 du bloc ancre – marge, ou 40 % en fallback
        if dest_x0 is not None:
            x_limit = max(dest_x0 - 10.0, width * 0.25)
        else:
            x_limit = width * 0.40

        # Passe 2 : blocs à droite de x_limit, triés de haut en bas
        right_blocks = [b for b in text_blocks if b["bbox"][0] >= x_limit]
        right_blocks.sort(key=lambda b: b["bbox"][1])

        for b in right_blocks:
            for ln in b["lines"]:
                line_text = "".join(s["text"] for s in ln["spans"]).strip()
                if line_text:
                    all_lines.append(line_text)

    doc.close()
    return "\n".join(all_lines)


# ── Patterns globaux ───────────────────────────────────────────────────────────

# Numéro de téléphone français (mobile ou fixe, format national ou +33)
TEL_PATTERN = re.compile(r"(?:0|\+33\s*)[1-9](?:[\s.\-]*\d){8}")

# Labels parasites seuls sur une ligne (Tél., Portable, M., Mme, …)
NOISE_LABEL_RE = re.compile(
    r"^(tél\.?|tel\.?|téléphone|portable|mobile|phone"
    r"|m\.|mme\.?|mr\.?|monsieur|madame)\s*:?\s*$",
    re.IGNORECASE,
)

# Marqueurs qui signalent la fin de la section destinataire
STOP_MARKERS = [
    r"réf\.?\s*client",
    r"cachet",
    r"signature",
    r"preuve\s*de\s*dépôt",
    r"n°\s*contrat",
    r"^[A-Z0-9]{10,}$",   # code-barres (que des majuscules + chiffres, ≥ 10 car.)
]

# Ligne de nom : uniquement lettres, espaces, tirets, apostrophes, points
NAME_ONLY_RE = re.compile(r"^[A-Za-zÀ-ÖØ-öø-ÿ\s\-\'\.]+$")

# Ligne commençant par un chiffre → rue ou code postal
STARTS_WITH_DIGIT_RE = re.compile(r"^\d")


def parse_destinataire(text: str) -> dict:
    """
    Extrait nom complet, adresse complète et téléphone depuis le texte
    de la zone "Adresse du destinataire".
    """
    result = {"nom_complet": "", "adresse_complete": "", "telephone": ""}

    lines = [ln.strip() for ln in text.splitlines() if ln.strip()]

    # 1. Téléphone — recherche globale dans tout le texte extrait
    found_tel = None
    for line in lines:
        m = TEL_PATTERN.search(line)
        if m:
            found_tel = re.sub(r"[\s.\-]", "", m.group(0))
            # Normaliser +33X → 0X
            if found_tel.startswith("+33"):
                found_tel = "0" + found_tel[3:]
            break
    result["telephone"] = found_tel or ""

    # 2. Trouver l'ancrage "Adresse du destinataire"
    dest_idx = -1
    for i, line in enumerate(lines):
        if re.search(r"adresse\s*du\s*destinataire", line, re.IGNORECASE):
            dest_idx = i
            break

    if dest_idx == -1:
        return result

    # 3. Collecter les lignes candidates après l'ancrage
    candidate_lines = []
    for j in range(dest_idx + 1, min(dest_idx + 25, len(lines))):
        line = lines[j].strip()
        if not line:
            continue
        # Arrêt sur marqueur de fin de section
        if any(re.search(m, line, re.IGNORECASE) for m in STOP_MARKERS):
            break
        # Ignorer les labels standalone parasites
        if NOISE_LABEL_RE.match(line):
            continue
        # Ignorer les lignes qui ne contiennent QUE le numéro de téléphone
        if found_tel:
            line_without_tel = TEL_PATTERN.sub("", line).strip(" :,.-")
            if not line_without_tel:
                continue
        candidate_lines.append(line)

    if not candidate_lines:
        return result

    # 4. Séparer le nom et l'adresse
    #
    # Règle : TOUTES les lignes consécutives sans chiffre en début = nom complet
    # (cas fréquent : point relais sur ligne 1, nom de la personne sur ligne 2).
    # La première ligne commençant par un chiffre marque le début de l'adresse.
    #
    nom_lines = []
    addr_parts = []
    address_started = False

    for line in candidate_lines:
        if not address_started:
            if STARTS_WITH_DIGIT_RE.match(line):
                # Début de l'adresse (numéro de rue ou code postal)
                address_started = True
                addr_parts.append(line)
            else:
                # Ligne de nom (point relais, nom, prénom…)
                nom_lines.append(line)
        else:
            # Nettoyer le téléphone intégré dans la ligne d'adresse
            clean_line = TEL_PATTERN.sub("", line) if found_tel else line
            # Supprimer les préfixes de label résiduels
            clean_line = re.sub(
                r"(Tél\.?|Tel\.?|Téléphone\s*:?|Portable\s*:?|Mobile\s*:?)\s*",
                "", clean_line, flags=re.IGNORECASE,
            )
            clean_line = clean_line.strip(" :,-")
            if clean_line:
                addr_parts.append(clean_line)

    result["nom_complet"] = " ".join(nom_lines)
    result["adresse_complete"] = " ".join(addr_parts)

    # Nettoyage final des caractères parasites
    for k in result:
        result[k] = clean(result[k])

    return result


def process_pdf(pdf_path: str) -> dict:
    """Traite un PDF et retourne les données du destinataire."""
    text = extract_text_spatial(pdf_path)

    # Fallback OCR si la zone droite est vide ou ne contient pas l'ancrage
    if not text.strip() or "destinataire" not in text.lower():
        if OCR_AVAILABLE:
            text = extract_text_ocr(pdf_path)

    return parse_destinataire(text)


if __name__ == "__main__":
    if len(sys.argv) < 2:
        print(json.dumps({"error": "No PDF path provided"}))
        sys.exit(1)

    results = []
    for arg in sys.argv[1:]:
        # Chaque argument est sous la forme "tmppath|||nomoriginal"
        if "|||" in arg:
            pdf_path, orig_name = arg.split("|||", 1)
        else:
            pdf_path, orig_name = arg, os.path.basename(arg)

        try:
            data = process_pdf(pdf_path)
            data["fichier"] = orig_name
            results.append(data)
        except Exception as e:
            results.append({
                "fichier": orig_name,
                "error": str(e),
            })

    print(json.dumps(results, ensure_ascii=False))
