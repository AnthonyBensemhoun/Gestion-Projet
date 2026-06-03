# -*- mode: python ; coding: utf-8 -*-
# Configuration PyInstaller pour produire atelier.exe (exécutable autonome).
# Construire avec :  pyinstaller atelier.spec
from PyInstaller.utils.hooks import collect_all, collect_submodules

# Fichiers embarqués : templates Jinja2 + dossier static
datas = [("templates", "templates"), ("static", "static")]
binaries = []
hiddenimports = ["passlib.handlers.bcrypt"]

# Embarque entièrement les paquets qui chargent des sous-modules/données
# dynamiquement (sinon l'exe plante au démarrage avec "ModuleNotFound").
for pkg in [
    "uvicorn", "fastapi", "starlette", "sqlmodel", "sqlalchemy",
    "pydantic", "passlib", "bcrypt", "anthropic", "apscheduler",
    "docx", "pptx", "pypdf", "pg8000", "multipart",
]:
    d, b, h = collect_all(pkg)
    datas += d
    binaries += b
    hiddenimports += h

hiddenimports += collect_submodules("uvicorn")

a = Analysis(
    ["run_server.py"],
    pathex=[],
    binaries=binaries,
    datas=datas,
    hiddenimports=hiddenimports,
    hookspath=[],
    runtime_hooks=[],
    excludes=[],
    noarchive=False,
)
pyz = PYZ(a.pure)

exe = EXE(
    pyz,
    a.scripts,
    a.binaries,
    a.datas,
    [],
    name="atelier",
    debug=False,
    bootloader_ignore_signals=False,
    strip=False,
    upx=False,
    runtime_tmpdir=None,
    console=True,   # fenêtre console = affiche l'URL et l'état du serveur
)
