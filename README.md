# Colissimo Extractor

Outil ponctuel d'extraction des destinataires depuis des PDFs Colissimo.

## Prérequis

- Node.js 18+
- Python 3.9+
- Tesseract OCR (optionnel, pour PDFs scannés)

## Installation

### 1. Tesseract (pour OCR des PDFs scannés)

```bash
# Ubuntu/Debian
sudo apt install tesseract-ocr tesseract-ocr-fra

# macOS
brew install tesseract tesseract-lang
```

### 2. Dépendances Python

```bash
pip install -r requirements.txt
```

### 3. Dépendances Node

```bash
npm install
```

## Lancement

```bash
npm run dev
# → http://localhost:3000
```

## Utilisation

1. Glissez vos PDFs Colissimo dans la zone de dépôt
2. L'extraction s'effectue automatiquement (PyMuPDF natif, Tesseract en fallback)
3. Exportez en CSV ou Excel

## Colonnes extraites

| Colonne | Description |
|---------|-------------|
| Nom | Nom de famille du destinataire |
| Prénom | Prénom du destinataire |
| Téléphone | Numéro de téléphone (portable ou fixe) |
| Adresse | Rue et numéro |
| Code Postal | Code postal |
| Ville | Ville |
| Source | `native` (texte PDF) ou `ocr` (scanné) |

## Variables d'environnement (optionnel)

```bash
PYTHON_BIN=python3   # chemin vers python si non standard
```
