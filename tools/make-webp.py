"""Create the WebP versions of product photos that the store serves.

Usage:  python tools/make-webp.py
Needs:  pip install pillow

For every public/images/<id>.jpg this writes
  <id>.webp      800 px wide  (product page, hero, builder)
  <id>-400.webp  400 px wide  (catalog cards, cart, search)
The jpg stays as the fallback for very old browsers.
"""
from pathlib import Path
from PIL import Image

folder = Path(__file__).resolve().parent.parent / "public" / "images"
for jpg in sorted(folder.glob("*.jpg")):
    img = Image.open(jpg).convert("RGB")
    img.save(jpg.with_suffix(".webp"), "WEBP", quality=80, method=6)
    img.resize((400, round(img.height * 400 / img.width)), Image.LANCZOS).save(
        folder / f"{jpg.stem}-400.webp", "WEBP", quality=78, method=6
    )
    print("ok", jpg.name)
