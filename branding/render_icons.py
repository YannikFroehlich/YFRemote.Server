"""Erzeugt alle Logo-Dateien und die Installer-Grafiken aus dem Motiv unten (Mauszeiger mit Funkwellen).

Rendert per Edge headless (SVG -> PNG), skaliert mit Pillow und schreibt die ICO.
Aufruf aus dem Repo-Root: python branding/render_icons.py
"""
import subprocess
import tempfile
import time
from pathlib import Path

from PIL import Image

ROOT = Path(__file__).resolve().parent.parent
EDGE = r"C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe"
MASTER = 1024

DEFS = """<defs>
<linearGradient id="bg" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#16243C"/><stop offset="1" stop-color="#0B1220"/></linearGradient>
<linearGradient id="accent" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#38BDF8"/><stop offset="1" stop-color="#62E3C4"/></linearGradient>
</defs>"""

GLYPH = """<path d="M226 214 L226 410 L276 362 L312 440 L352 422 L316 346 L386 346 Z" fill="#E8EEF8" stroke="#E8EEF8" stroke-width="22" stroke-linejoin="round"/>
<g fill="none" stroke="url(#accent)" stroke-width="32" stroke-linecap="round"><path d="M156 214 A70 70 0 0 1 226 144"/><path d="M96 214 A130 130 0 0 1 226 84"/></g>"""

# In 16 px verschwimmen zwei Boegen zu einem Fleck, dort nur ein kraeftiger Bogen.
GLYPH_16 = GLYPH.split("<g ")[0] + """<path d="M130 214 A96 96 0 0 1 226 118" fill="none" stroke="url(#accent)" stroke-width="56" stroke-linecap="round"/>"""

# Mittelpunkt der Motiv-Bounding-Box; fuer maskierbare Varianten wird darum zentriert skaliert.
GLYPH_CENTER = (238.5, 260)


def centered(scale: float) -> str:
    cx, cy = GLYPH_CENTER
    return f'<g transform="translate(256 256) scale({scale}) translate({-cx} {-cy})">{GLYPH}</g>'


VARIANTS = {
    # Abgerundete Kachel mit transparenten Ecken: Favicon, Tray, Installer, PWA "any".
    "tile": f'<rect width="512" height="512" rx="112" fill="url(#bg)"/>{GLYPH}',
    # Randlos, Motiv in der 80-%-Sicherheitszone fuer PWA "maskable".
    "maskable": f'<rect width="512" height="512" fill="url(#bg)"/>{centered(0.8)}',
    # Android-Adaptive-Vordergrund: transparent, Motiv in der 66/108-Sicherheitszone.
    "foreground": centered(0.6),
    "tile16": f'<rect width="512" height="512" rx="112" fill="url(#bg)"/>{GLYPH_16}',
    "round": f'<circle cx="256" cy="256" r="256" fill="url(#bg)"/>{centered(0.75)}',
}


def glyph_at(x: float, y: float, scale: float) -> str:
    cx, cy = GLYPH_CENTER
    return f'<g transform="translate({x} {y}) scale({scale}) translate({-cx} {-cy})">{GLYPH}</g>'


TEXT = 'font-family="Segoe UI, sans-serif" text-anchor="middle"'

# Installer-Grafiken in Zielpixeln. Die MSI-Dialoge schreiben schwarzen Text auf das Bild, deshalb
# bleibt dort alles ausser dem Markenfeld weiss; nur das Setup.exe-Fenster ist ganz dunkel.
INSTALLER = {
    # Kopfzeile der MSI-Seiten: Titeltext links, Markenfeld rechts.
    "msi-banner.bmp": (493, 58, f'''<rect width="493" height="58" fill="#FFFFFF"/>
<path d="M424 0 H493 V58 H404 Z" fill="url(#bg)"/>{glyph_at(455, 29, 0.105)}'''),
    # Willkommens- und Abschlussseite: Markenfeld in den linken 164 px, Text rechts davon.
    "msi-dialog.bmp": (493, 312, f'''<rect width="493" height="312" fill="#FFFFFF"/>
<rect width="164" height="312" fill="url(#bg)"/><rect x="161" width="3" height="312" fill="url(#accent)"/>
{glyph_at(80, 118, 0.24)}<text x="80" y="206" {TEXT} font-size="21" font-weight="600" fill="#E8EEF8">YFRemote</text>'''),
    "splash.png": (480, 270, f'''<rect width="480" height="270" fill="url(#bg)"/>
{glyph_at(240, 100, 0.27)}<text x="240" y="196" {TEXT} font-size="30" font-weight="600" fill="#E8EEF8">YFRemote</text>
<text x="240" y="222" {TEXT} font-size="14" fill="#9AACC6">wird installiert</text>'''),
}
INSTALLER_SCALE = 4


def svg(body: str, size: int | None = None) -> str:
    dims = f' width="{size}" height="{size}"' if size else ""
    return f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512"{dims}>{DEFS}{body}</svg>\n'


def render(body: str, tmp: Path, name: str, width: int = MASTER, height: int = MASTER) -> Image.Image:
    src, out = tmp / f"{name}.svg", tmp / f"{name}.png"
    square = (width, height) == (MASTER, MASTER)
    src.write_text(svg(body, MASTER) if square else body, encoding="utf-8")
    subprocess.run(
        # Eigenes Profil, sonst uebergibt Edge an eine laufende Instanz und schreibt nichts.
        [EDGE, "--headless", "--disable-gpu", "--hide-scrollbars", f"--user-data-dir={tmp / 'edge'}",
         "--default-background-color=00000000", f"--window-size={width},{height}",
         f"--screenshot={out}", src.as_uri()],
        check=True, capture_output=True,
    )
    # msedge.exe kehrt sofort zurueck, der Screenshot entsteht erst danach im Hintergrund.
    for _ in range(300):
        if out.exists() and out.stat().st_size > 0:
            break
        time.sleep(0.1)
    time.sleep(0.5)
    image = Image.open(out).convert("RGBA")
    assert image.size == (width, height), image.size
    return image


def save(image: Image.Image, path: str, size: int) -> None:
    image.resize((size, size), Image.LANCZOS).save(ROOT / path, optimize=True)


def main() -> None:
    (ROOT / "branding" / "logo.svg").write_text(svg(VARIANTS["tile"]), encoding="utf-8")
    with tempfile.TemporaryDirectory(ignore_cleanup_errors=True) as tmp:
        img = {name: render(body, Path(tmp), name) for name, body in VARIANTS.items()}

        installer = {}
        for name, (width, height, body) in INSTALLER.items():
            w, h = width * INSTALLER_SCALE, height * INSTALLER_SCALE
            doc = f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {width} {height}" width="{w}" height="{h}">{DEFS}{body}</svg>'
            installer[name] = render(doc, Path(tmp), name.split(".")[0], w, h).resize((width, height), Image.LANCZOS)

    (ROOT / "branding" / "installer").mkdir(exist_ok=True)
    for name, image in installer.items():
        # BMP kennt hier keine Transparenz, alle drei Bilder sind ohnehin deckend.
        image.convert("RGB").save(ROOT / "branding" / "installer" / name)

    tile = img["tile"]
    save(tile, "client/public/brand-mark.png", 1024)
    save(tile, "client/public/brand-mark-512.png", 512)
    save(tile, "client/public/brand-mark-192.png", 192)
    save(img["maskable"], "client/public/brand-mark-512-maskable.png", 512)
    ico_sizes = [16, 32, 48, 128, 256]
    frames = [(img["tile16"] if s == 16 else tile).resize((s, s), Image.LANCZOS) for s in ico_sizes]
    frames[-1].save(ROOT / "client/public/favicon.ico", format="ICO",
                    sizes=[(s, s) for s in ico_sizes], append_images=frames[:-1])

    res = "android/app/src/main/res/mipmap-xxxhdpi"
    save(tile, f"{res}/ic_launcher.png", 192)
    save(img["foreground"], f"{res}/ic_launcher_foreground.png", 512)
    save(img["round"], f"{res}/ic_launcher_round.png", 512)


if __name__ == "__main__":
    main()
