"""Generate launcher icons and splash images for the DSH Mobile Harness app.

Renders the Harness whale SVG to PNG with headless Chrome, then writes every
mipmap / splash / vector drawable under app/android/app/src/main/res.

Requirements: Pillow + Google Chrome (or Chromium). When headless Chrome is not
available, pre-render the SVG to a 1024x1024 PNG (black background, white glyph)
and pass it with --whale-png instead.

Usage:
    python app/tools/make-icons.py
    python app/tools/make-icons.py --whale-png whale.png
    python app/tools/make-icons.py --svg path/to/favicon.svg --chrome path/to/chrome.exe
"""
import argparse
import os
import re
import subprocess
import tempfile
from pathlib import Path

from PIL import Image, ImageDraw

ROOT = Path(__file__).resolve().parents[2]
RES = ROOT / "app" / "android" / "app" / "src" / "main" / "res"

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument("--svg", default=str(ROOT / "app" / "www" / "vendor" / "harness.svg"),
                    help="source SVG (needs one <path d=...> for the whale glyph)")
parser.add_argument("--chrome", default=os.environ.get("CHROME") or r"C:\Program Files\Google\Chrome\Application\chrome.exe",
                    help="headless Chrome/Chromium executable")
parser.add_argument("--whale-png", default=None,
                    help="skip rendering: use this 1024x1024 PNG (black background, white glyph)")
args = parser.parse_args()

BG = (21, 24, 32, 255)  # #151820
SPLASH_BG = (15, 17, 21, 255)  # #0f1115

svg = Path(args.svg).read_text(encoding="utf-8")
m = re.search(r'<path[^>]*d="([^"]+)"', svg)
if not m:
    raise SystemExit(f"whale path not found in {args.svg}")
PATH = m.group(1)

# 1) Rasterise the whale: white whale on black, then alpha = luminance.
if args.whale_png:
    raw = Image.open(args.whale_png).convert("RGB")
else:
    html = f"""<!doctype html><html><body style="margin:0;background:#000">
<svg xmlns="http://www.w3.org/2000/svg" width="1024" height="1024" viewBox="0 0 50 50">
<path d="{PATH}" fill="#ffffff"/></svg></body></html>"""
    tmp = Path(tempfile.mkdtemp(prefix="whale-"))
    page = tmp / "whale.html"
    page.write_text(html, encoding="utf-8")
    shot = tmp / "whale.png"
    subprocess.run(
        [args.chrome, "--headless=new", "--disable-gpu", "--hide-scrollbars",
         "--force-device-scale-factor=1", "--window-size=1024,1024",
         f"--screenshot={shot}", page.as_uri()],
        check=True, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
    )
    if not shot.exists():
        raise SystemExit("headless Chrome produced no screenshot; pass --whale-png <1024px png>")
    raw = Image.open(shot).convert("RGB")
whale = Image.new("RGBA", raw.size, (255, 255, 255, 0))
luma = raw.convert("L")
whale.putalpha(luma)
whale = whale.crop(whale.getbbox())
# 2) Compose helper images.
def rounded(size, radius_ratio, circle=False):
    canvas = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    draw = ImageDraw.Draw(canvas)
    if circle:
        draw.ellipse((0, 0, size - 1, size - 1), fill=BG)
    else:
        draw.rounded_rectangle((0, 0, size - 1, size - 1), radius=int(size * radius_ratio), fill=BG)
    return canvas

def place(base, icon, scale):
    target = int(base.width * scale)
    glyph = icon.copy()
    glyph.thumbnail((target, target), Image.LANCZOS)
    canvas = base.copy()
    canvas.alpha_composite(glyph, ((base.width - glyph.width) // 2, (base.height - glyph.height) // 2))
    return canvas

square = place(rounded(1024, 0.22), whale, 0.62)
circle = place(rounded(1024, 0.5, circle=True), whale, 0.6)

# 3) Adaptive foreground (whale only, transparent, 108dp box).
fg = Image.new("RGBA", (1024, 1024), (0, 0, 0, 0))
glyph = whale.copy()
glyph.thumbnail((int(1024 * 0.46), int(1024 * 0.46)), Image.LANCZOS)
fg.alpha_composite(glyph, ((1024 - glyph.width) // 2, (1024 - glyph.height) // 2))

# 4) Splash: dark background + whale.
def splash(size):
    canvas = Image.new("RGBA", size, SPLASH_BG)
    glyph = whale.copy()
    target = int(min(size) * 0.3)
    glyph.thumbnail((target, target), Image.LANCZOS)
    canvas.alpha_composite(glyph, ((size[0] - glyph.width) // 2, (size[1] - glyph.height) // 2))
    return canvas

MIPMAPS = {"mdpi": 48, "hdpi": 72, "xhdpi": 96, "xxhdpi": 144, "xxxhdpi": 192}
FG_SIZES = {"mdpi": 108, "hdpi": 162, "xhdpi": 216, "xxhdpi": 324, "xxxhdpi": 432}

for density, size in MIPMAPS.items():
    out = RES / f"mipmap-{density}"
    square.resize((size, size), Image.LANCZOS).save(out / "ic_launcher.png")
    circle.resize((size, size), Image.LANCZOS).save(out / "ic_launcher_round.png")
    fg.resize((FG_SIZES[density], FG_SIZES[density]), Image.LANCZOS).save(out / "ic_launcher_foreground.png")

for splash_file in RES.glob("drawable*/splash.png"):
    with Image.open(splash_file) as existing:
        size = existing.size
    splash(size).convert("RGB").save(splash_file)

# 5) Vector drawables.
vector_whale = f"""<?xml version="1.0" encoding="utf-8"?>
<vector xmlns:android="http://schemas.android.com/apk/res/android"
    android:width="50dp"
    android:height="50dp"
    android:viewportWidth="50"
    android:viewportHeight="50">
    <path android:fillColor="#FFFFFF" android:pathData="{PATH}" />
</vector>
"""
(RES / "drawable" / "ic_whale.xml").write_text(vector_whale, encoding="utf-8")

vector_fg = f"""<?xml version="1.0" encoding="utf-8"?>
<vector xmlns:android="http://schemas.android.com/apk/res/android"
    android:width="108dp"
    android:height="108dp"
    android:viewportWidth="108"
    android:viewportHeight="108">
    <group android:scaleX="1.0" android:scaleY="1.0" android:translateX="29.0" android:translateY="29.0">
        <path android:fillColor="#FFFFFF" android:pathData="{PATH}" />
    </group>
</vector>
"""
(RES / "drawable" / "ic_launcher_foreground.xml").write_text(vector_fg, encoding="utf-8")

adaptive = """<?xml version="1.0" encoding="utf-8"?>
<adaptive-icon xmlns:android="http://schemas.android.com/apk/res/android">
    <background android:drawable="@color/ic_launcher_background"/>
    <foreground android:drawable="@drawable/ic_launcher_foreground"/>
</adaptive-icon>
"""
for name in ("ic_launcher.xml", "ic_launcher_round.xml"):
    (RES / "mipmap-anydpi-v26" / name).write_text(adaptive, encoding="utf-8")

(RES / "values" / "ic_launcher_background.xml").write_text(
    """<?xml version="1.0" encoding="utf-8"?>
<resources>
    <color name="ic_launcher_background">#151820</color>
</resources>
""",
    encoding="utf-8",
)

print("icons + splash generated")
