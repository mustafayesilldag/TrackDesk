# tanitim.html hero + panel.html geniş ekran (>=1240px) arka planlarını
# üretir (tek tema, tek görsel: hero-bg.jpg). Renk/marka değişirse
# INDIGO/DEEP/LAV/LAV_LIGHT değerlerini güncelle, sonra:
# pip install pillow numpy && python generate-hero-bg.py .
import math
import random
import sys
import numpy as np
from PIL import Image, ImageDraw, ImageFilter, ImageChops

SCALE = 2  # supersample factor for smooth anti-aliased ribbons
W, H = 2400, 1350
SW, SH = W * SCALE, H * SCALE

INDIGO = (29, 78, 216)
DEEP = (30, 64, 175)
LAV = (37, 99, 235)
LAV_LIGHT = (96, 165, 250)

random.seed(7)


def catmull_rom(points, n=320):
    pts = [points[0]] + list(points) + [points[-1]]
    out = []
    segs = len(points) - 1
    for seg in range(segs):
        p0, p1, p2, p3 = pts[seg], pts[seg + 1], pts[seg + 2], pts[seg + 3]
        steps = max(2, n // segs)
        for s in range(steps):
            t = s / steps
            t2 = t * t
            t3 = t2 * t
            x = 0.5 * (
                (2 * p1[0])
                + (-p0[0] + p2[0]) * t
                + (2 * p0[0] - 5 * p1[0] + 4 * p2[0] - p3[0]) * t2
                + (-p0[0] + 3 * p1[0] - 3 * p2[0] + p3[0]) * t3
            )
            y = 0.5 * (
                (2 * p1[1])
                + (-p0[1] + p2[1]) * t
                + (2 * p0[1] - 5 * p1[1] + 4 * p2[1] - p3[1]) * t2
                + (-p0[1] + 3 * p1[1] - 3 * p2[1] + p3[1]) * t3
            )
            out.append((x, y))
    out.append(points[-1])
    return out


def stamp_ribbon(size, points, color, max_width, alpha_scale=1.0, taper_pow=0.75, core=False):
    """Smooth rope-like ribbon by stamping soft overlapping circles along a spline."""
    layer = Image.new("RGBA", size, (0, 0, 0, 0))
    draw = ImageDraw.Draw(layer)
    path = catmull_rom(points, n=420)
    n = len(path)
    step = 1 if not core else 1
    for i in range(0, n, step):
        t = i / (n - 1)
        taper = math.sin(t * math.pi) ** taper_pow
        if taper <= 0.01:
            continue
        radius = max(1.0, (max_width * 0.5) * taper)
        alpha = int(255 * taper * alpha_scale)
        if alpha <= 0:
            continue
        x, y = path[i]
        draw.ellipse([x - radius, y - radius, x + radius, y + radius], fill=color + (alpha,))
    return layer


def add_glow(layer, blur_radius, boost=1.0):
    """Gaussian-blur an RGBA layer using premultiplied alpha so transparent
    (black) pixels never bleed color into the soft edges (avoids gray/black
    halos around glow shapes)."""
    arr = np.asarray(layer).astype(np.float32)
    rgb = arr[..., :3]
    alpha = arr[..., 3]
    premult = rgb * (alpha[..., None] / 255.0)
    premult_img = Image.fromarray(np.clip(premult, 0, 255).astype(np.uint8), mode="RGB")
    alpha_img = Image.fromarray(np.clip(alpha, 0, 255).astype(np.uint8), mode="L")

    premult_blurred = premult_img.filter(ImageFilter.GaussianBlur(blur_radius))
    alpha_blurred = alpha_img.filter(ImageFilter.GaussianBlur(blur_radius))

    pb = np.asarray(premult_blurred).astype(np.float32)
    ab = np.asarray(alpha_blurred).astype(np.float32)
    ab_safe = np.where(ab < 1.0, 1.0, ab)
    unpremult = np.clip(pb / (ab_safe[..., None] / 255.0), 0, 255)
    ab_out = np.clip(ab * boost, 0, 255)

    out = np.dstack([unpremult, ab_out]).astype(np.uint8)
    return Image.fromarray(out, mode="RGBA")


def screen_blend(base, top):
    bb = base.convert("RGBA")
    tb = top.convert("RGBA")
    br, bg, bbb, ba = bb.split()
    tr, tg, tbb, ta = tb.split()

    def screen(c1, c2):
        return ImageChops.invert(ImageChops.multiply(ImageChops.invert(c1), ImageChops.invert(c2)))

    nr = screen(br, tr)
    ng = screen(bg, tg)
    nb = screen(bbb, tbb)
    out = Image.merge("RGB", (nr, ng, nb))
    base_rgb = bb.convert("RGB")
    out_final = Image.composite(out, base_rgb, ta)
    return out_final.convert("RGBA")


def radial_mask(size, strength=0.55, radius_scale=0.5, cx=0.5, cy=0.5):
    w, h = size
    mask = Image.new("L", size, 0)
    md = ImageDraw.Draw(mask)
    max_r = math.hypot(w, h) * radius_scale
    steps = 120
    for i in range(steps, 0, -1):
        t = i / steps
        r = max_r * t
        val = int(255 * (1 - t) ** 1.7 * strength)
        md.ellipse(
            [cx * w - r, cy * h - r * (h / w) * 1.1, cx * w + r, cy * h + r * (h / w) * 1.1],
            fill=val,
        )
    return mask.filter(ImageFilter.GaussianBlur(max_r * 0.04))


RIBBON_PATHS = [
    ([(-0.06, 0.10), (0.09, 0.04), (0.20, 0.10), (0.27, 0.20), (0.38, 0.34)], LAV, 46, 0.95),
    ([(-0.06, 0.24), (0.06, 0.18), (0.18, 0.24), (0.26, 0.34), (0.36, 0.46)], INDIGO, 60, 0.85),
    ([(-0.06, 0.36), (0.05, 0.33), (0.14, 0.37), (0.22, 0.45)], DEEP, 34, 0.55),
    ([(0.62, 0.26), (0.74, 0.14), (0.86, 0.06), (0.95, 0.10), (1.06, 0.18)], LAV_LIGHT, 50, 0.95),
    ([(0.64, 0.42), (0.76, 0.30), (0.88, 0.20), (0.98, 0.22), (1.06, 0.30)], DEEP, 64, 0.8),
    ([(0.78, 0.50), (0.88, 0.42), (0.97, 0.38), (1.06, 0.42)], INDIGO, 30, 0.5),
    ([(-0.06, 0.76), (0.08, 0.84), (0.18, 0.76), (0.27, 0.82), (0.38, 0.76)], DEEP, 56, 0.85),
    ([(-0.06, 0.90), (0.10, 0.97), (0.22, 0.90), (0.34, 0.95)], INDIGO, 40, 0.65),
    ([(0.04, 0.62), (0.14, 0.58), (0.22, 0.64)], LAV, 22, 0.4),
    ([(0.64, 0.78), (0.76, 0.88), (0.88, 0.80), (0.97, 0.86), (1.06, 0.80)], LAV, 52, 0.85),
    ([(0.70, 0.94), (0.82, 1.0), (0.92, 0.93), (1.06, 0.98)], LAV_LIGHT, 36, 0.6),
    ([(0.78, 0.60), (0.88, 0.56), (0.97, 0.6)], DEEP, 20, 0.4),
]

# small luminous "data pulse" nodes scattered along the outer ribbon zones
NODES = [
    (0.16, 0.14, LAV_LIGHT, 10), (0.30, 0.26, INDIGO, 7), (0.09, 0.32, LAV, 6),
    (0.86, 0.10, LAV_LIGHT, 9), (0.93, 0.28, DEEP, 7), (0.74, 0.20, INDIGO, 6),
    (0.20, 0.80, DEEP, 9), (0.31, 0.90, LAV, 6), (0.10, 0.94, INDIGO, 7),
    (0.84, 0.84, LAV, 9), (0.92, 0.95, LAV_LIGHT, 7), (0.73, 0.92, DEEP, 6),
]


def build_glow_stack(width, height, color_alpha_mult, node_alpha_mult):
    glow_layer = Image.new("RGBA", (width, height), (0, 0, 0, 0))
    core_layer = Image.new("RGBA", (width, height), (0, 0, 0, 0))
    for pts, color, w_, a_ in RIBBON_PATHS:
        scaled = [(x * width, y * height) for x, y in pts]
        body = stamp_ribbon((width, height), scaled, color, w_, alpha_scale=a_ * color_alpha_mult)
        glow_layer = Image.alpha_composite(glow_layer, body)
        bright = tuple(min(255, int(c * 1.15)) for c in color)
        core = stamp_ribbon((width, height), scaled, bright, w_ * 0.32, alpha_scale=min(1.0, a_ * 1.05 * color_alpha_mult), taper_pow=0.9)
        core_layer = Image.alpha_composite(core_layer, core)

    node_layer = Image.new("RGBA", (width, height), (0, 0, 0, 0))
    nd = ImageDraw.Draw(node_layer)
    for nx, ny, color, r in NODES:
        x, y = nx * width, ny * height
        rr = r * (width / 2400)
        nd.ellipse([x - rr, y - rr, x + rr, y + rr], fill=color + (int(235 * node_alpha_mult),))
    return glow_layer, core_layer, node_layer


def build():
    img = Image.new("RGB", (SW, SH), (255, 255, 255))
    base_tint = Image.new("RGB", (SW, SH), (241, 242, 248))
    grad = radial_mask((SW, SH), strength=1.0, radius_scale=0.85)
    img = Image.composite(base_tint, img, grad)

    glow_layer, core_layer, node_layer = build_glow_stack(SW, SH, color_alpha_mult=0.72, node_alpha_mult=0.78)

    wide_glow = add_glow(glow_layer, 60 * SCALE / 2, boost=0.95)
    soft_glow = add_glow(glow_layer, 18 * SCALE / 2, boost=1.05)
    node_glow = add_glow(node_layer, 22 * SCALE / 2, boost=1.0)
    crisp_core = add_glow(core_layer, 1.6 * SCALE / 2, boost=1.05)

    result = img.convert("RGBA")
    result = Image.alpha_composite(result, wide_glow)
    result = Image.alpha_composite(result, soft_glow)
    result = Image.alpha_composite(result, node_glow)
    result = Image.alpha_composite(result, crisp_core)

    center_mask = radial_mask((SW, SH), strength=0.6, radius_scale=0.46)
    white_overlay = Image.new("RGBA", (SW, SH), (255, 255, 255, 255))
    result = Image.composite(white_overlay, result, center_mask)

    result = result.convert("RGB")
    result = result.resize((W, H), Image.LANCZOS)
    return result


if __name__ == "__main__":
    out_dir = sys.argv[1] if len(sys.argv) > 1 else "."
    build().save(f"{out_dir}/hero-bg.png", optimize=True)
    print("saved hero-bg")
