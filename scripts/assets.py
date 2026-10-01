"""Asset pipeline. Run once when brand files change: python scripts/assets.py

Reads brand/ and reference/, writes public/ (favicons, mark, hero coin, share card)
and src/tokens.css (the only file in the project allowed to hold colour literals).

Facts this script relies on (checked by hand, see ASSET NOTES at the bottom):
  - brand/LOGO INITIATE PNG...png is RGBA (IHDR colourtype 6). Its 3,551,604
    fully transparent pixels are stored as RGB (0,0,0). A straight resize would
    blend that black into the edge and leave a grey fringe, so every resize here
    is done on premultiplied alpha.
  - the hexagon body sits at alpha 254, not 255.
"""
import json
import os
import sys

import numpy as np
from PIL import Image

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
B = lambda *p: os.path.join(ROOT, *p)

LOGO_ALPHA = B("brand", "LOGO INITIATE PNG...png")
LOGO_OPAQUE = B("brand", "LOGO INITIATE PNG.png")
COVER = B("reference", "SAMPUL INITIATE JPG.jpg.jpeg")
SLIDE = B("reference", "INITIATE 1.jpg.jpeg")


# ---------- premultiplied resize ----------
def resize_premult(img: Image.Image, size):
    a = np.asarray(img.convert("RGBA")).astype(np.float64) / 255.0
    a[..., :3] *= a[..., 3:4]
    chans = []
    for c in range(4):
        ch = Image.fromarray(a[..., c].astype(np.float32), mode="F")
        chans.append(np.asarray(ch.resize(size, Image.LANCZOS)))
    out = np.stack(chans, axis=-1)
    al = out[..., 3:4]
    rgb = np.where(al > 1e-6, out[..., :3] / np.maximum(al, 1e-6), 0.0)
    out = np.concatenate([np.clip(rgb, 0, 1), np.clip(al, 0, 1)], axis=-1)
    return Image.fromarray((out * 255.0 + 0.5).astype(np.uint8), "RGBA")


def audit(path):
    im = Image.open(path)
    arr = np.asarray(im.convert("RGBA"))
    a = arr[..., 3]
    z = a == 0
    return {
        "file": os.path.relpath(path, ROOT).replace("\\", "/"),
        "mode": im.mode,
        "size": im.size,
        "alpha_zero": int(z.sum()),
        "alpha_full": int((a == 255).sum()),
        "alpha_partial": int(((a > 0) & (a < 255)).sum()),
        "zero_alpha_pure_black": int((z & (arr[..., :3] == 0).all(axis=2)).sum()),
    }


# ---------- mark ----------
logo = Image.open(LOGO_ALPHA).convert("RGBA")
alpha = np.asarray(logo)[..., 3]
ys, xs = np.where(alpha > 0)
x0, y0, x1, y1 = xs.min(), ys.min(), xs.max() + 1, ys.max() + 1
bw, bh = x1 - x0, y1 - y0
side = int(max(bw, bh) * 1.06)
cx, cy = (x0 + x1) // 2, (y0 + y1) // 2
box = (cx - side // 2, cy - side // 2, cx - side // 2 + side, cy - side // 2 + side)
mark = logo.crop(box)  # square, hexagon centred, transparent surround

os.makedirs(B("public"), exist_ok=True)
for name, px in (("mark-64.png", 64), ("mark-128.png", 128), ("mark-256.png", 256), ("mark-512.png", 512)):
    resize_premult(mark, (px, px)).save(B("public", name), optimize=True)

# favicon: hexagon fills the tile, so the 16px grid is spent on the shape itself
tight = logo.crop((x0 - 4, y0 - 4, x1 + 4, y1 + 4))
def fav(px):
    t = max(tight.size)
    sq = Image.new("RGBA", (t, t), (0, 0, 0, 0))
    sq.paste(tight, ((t - tight.size[0]) // 2, (t - tight.size[1]) // 2))
    return resize_premult(sq, (px, px))
sizes = [16, 32, 48]
icons = {s: fav(s) for s in sizes}
icons[32].save(B("public", "favicon-32.png"), optimize=True)
icons[16].save(B("public", "favicon-16.png"), optimize=True)
icons[48].save(B("public", "favicon-48.png"), optimize=True)
icons[48].save(B("public", "favicon.ico"), format="ICO", sizes=[(16, 16), (32, 32), (48, 48)], append_images=[icons[16], icons[32]])

# app icons sit on the ink so the platform does not paint its own background
opaque = np.asarray(Image.open(LOGO_OPAQUE).convert("RGB"))
ink_px = tuple(int(v) for v in opaque[100, 100])
def app_icon(px, pad):
    canvas = Image.new("RGBA", (px, px), ink_px + (255,))
    inner = int(px * (1 - 2 * pad))
    m = resize_premult(mark, (inner, inner))
    canvas.alpha_composite(m, ((px - inner) // 2, (px - inner) // 2))
    return canvas.convert("RGB")
app_icon(180, 0.14).save(B("public", "apple-touch-icon.png"), optimize=True)
app_icon(192, 0.14).save(B("public", "icon-192.png"), optimize=True)
app_icon(512, 0.14).save(B("public", "icon-512.png"), optimize=True)

# ---------- hero coin (crop of the rendered 3D coin in the slide) ----------
slide = Image.open(SLIDE).convert("RGB")
coin = slide.crop((1040, 320, 1600, 900))
# The slide paints the coin on near-black. Clear only the dark that is connected to the image
# edge (flood fill), so the dark inside the letter stays part of the coin, then feather the cut.
from PIL import ImageFilter
arr = np.asarray(coin).astype(np.float64)
m = arr.max(axis=2)
cand = m < 17                      # near-black pixels
outside = np.zeros_like(cand)
outside[0, :], outside[-1, :], outside[:, 0], outside[:, -1] = cand[0, :], cand[-1, :], cand[:, 0], cand[:, -1]
while True:                        # grow from the edge through near-black pixels only (4-connected)
    g = outside.copy()
    g[1:, :] |= outside[:-1, :]; g[:-1, :] |= outside[1:, :]
    g[:, 1:] |= outside[:, :-1]; g[:, :-1] |= outside[:, 1:]
    g &= cand
    if (g == outside).all():
        break
    outside = g
alpha_img = Image.fromarray(np.where(outside, 0, 255).astype(np.uint8), "L").filter(ImageFilter.GaussianBlur(0.9))
alpha = np.asarray(alpha_img).astype(np.float64) / 255.0
# pull edge pixels that were only partly covered toward their own colour, not the dark fill
rgba = np.dstack([arr, alpha * 255.0]).round().astype(np.uint8)
Image.fromarray(rgba, "RGBA").save(B("public", "coin.webp"), quality=92, method=6, alpha_quality=100)

# ---------- share card ----------
cover = Image.open(COVER).convert("RGB")
scale = 630 / cover.size[1]
big = cover.resize((round(cover.size[0] * scale), 630), Image.LANCZOS)
left = (big.size[0] - 1200) // 2
big.crop((left, 0, left + 1200, 630)).save(B("public", "share.png"), optimize=True)

# ---------- palette: k-means over real pixels, snapped to a real pixel ----------
def load_pixels(path, step):
    arr = np.asarray(Image.open(path).convert("RGB"))
    h, w, _ = arr.shape
    yy, xx = np.mgrid[0:h:step, 0:w:step]
    px = arr[yy, xx].reshape(-1, 3).astype(np.float64)
    return px, np.stack([xx.ravel(), yy.ravel()], axis=1)

sources = [(COVER, 3), (SLIDE, 4), (LOGO_OPAQUE, 8)]
P, C, S = [], [], []
for i, (path, step) in enumerate(sources):
    p, c = load_pixels(path, step)
    P.append(p); C.append(c); S.append(np.full(len(p), i))
P, C, S = np.concatenate(P), np.concatenate(C), np.concatenate(S)

K = 10
rng = np.random.default_rng(4663)
cent = P[rng.choice(len(P), K, replace=False)]
for _ in range(60):
    d = ((P[:, None, :] - cent[None]) ** 2).sum(axis=2)
    lab = d.argmin(axis=1)
    new = np.stack([P[lab == k].mean(axis=0) if (lab == k).any() else cent[k] for k in range(K)])
    if np.allclose(new, cent, atol=0.01):
        break
    cent = new
d = ((P[:, None, :] - cent[None]) ** 2).sum(axis=2)
lab = d.argmin(axis=1)

clusters = []
for k in range(K):
    idx = np.where(lab == k)[0]
    if not len(idx):
        continue
    near = idx[((P[idx] - cent[k]) ** 2).sum(axis=1).argmin()]  # real pixel closest to the centroid
    r, g, b = (int(v) for v in P[near])
    clusters.append({
        "hex": "#%02x%02x%02x" % (r, g, b),
        "rgb": [r, g, b],
        "share": round(len(idx) / len(P), 4),
        "source": os.path.relpath(sources[S[near]][0], ROOT).replace("\\", "/"),
        "x": int(C[near][0]), "y": int(C[near][1]),
        "lum": round(0.2126 * r + 0.7152 * g + 0.0722 * b, 1),
    })
clusters.sort(key=lambda c: c["lum"])

# verify each snapped colour against the file it points to
for c in clusters:
    got = tuple(np.asarray(Image.open(B(*c["source"].split("/"))).convert("RGB"))[c["y"], c["x"]])
    assert got == tuple(c["rgb"]), (c, got)

# direct samples that k-means smears: the logo fill and the flat ink of the mark
sage_xy = (700, 1000)
sage = tuple(int(v) for v in opaque[sage_xy[1], sage_xy[0]])
ink = tuple(int(v) for v in opaque[100, 100])
wm = np.asarray(slide)[30:80, 110:410].astype(int)               # slide wordmark strokes
wy, wx = np.unravel_index(wm.sum(axis=2).argmax(), wm.shape[:2])
white = tuple(int(v) for v in wm[wy, wx]); white_xy = (110 + int(wx), 30 + int(wy))
head = np.asarray(slide)[300:500, 120:850].reshape(-1, 3)      # slide headline colour
hy, hx = divmod(int(np.abs(head.astype(int) - np.array([197, 213, 192])).sum(axis=1).argmin()), 730)
headline = tuple(int(v) for v in head[hy * 730 + hx]); headline_xy = (120 + hx, 300 + hy)

json.dump({"clusters": clusters, "sage": sage, "ink": ink, "white": white, "headline": headline},
          open(os.path.join(os.environ.get("TEMP", "."), "initiate-palette.json"), "w"), indent=1)

for c in clusters:
    print(c["hex"], c["share"], c["lum"], c["source"], (c["x"], c["y"]))
print("sage", sage, sage_xy, "ink", ink, "white", white, white_xy, "headline", headline, headline_xy)
for p in (LOGO_ALPHA, LOGO_OPAQUE):
    print(audit(p))
