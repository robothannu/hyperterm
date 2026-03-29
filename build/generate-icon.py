#!/usr/bin/env python3
"""Generate HyperTerm app icon — clean dark terminal with bold >_ prompt."""

from PIL import Image, ImageDraw, ImageFont
import os

SIZE = 1024
PADDING = 100
CORNER_RADIUS = 220

def rounded_rect(draw, xy, radius, fill):
    x0, y0, x1, y1 = xy
    r = radius
    draw.rectangle([x0 + r, y0, x1 - r, y1], fill=fill)
    draw.rectangle([x0, y0 + r, x1, y1 - r], fill=fill)
    draw.pieslice([x0, y0, x0 + 2*r, y0 + 2*r], 180, 270, fill=fill)
    draw.pieslice([x1 - 2*r, y0, x1, y0 + 2*r], 270, 360, fill=fill)
    draw.pieslice([x0, y1 - 2*r, x0 + 2*r, y1], 90, 180, fill=fill)
    draw.pieslice([x1 - 2*r, y1 - 2*r, x1, y1], 0, 90, fill=fill)

def main():
    img = Image.new("RGBA", (SIZE, SIZE), (0, 0, 0, 0))
    draw = ImageDraw.Draw(img)

    # Background
    bg_outer = (13, 17, 23)
    bg_inner = (22, 27, 34)

    rounded_rect(draw, [PADDING, PADDING, SIZE - PADDING, SIZE - PADDING],
                 CORNER_RADIUS, bg_outer)

    inset = 10
    rounded_rect(draw, [PADDING + inset, PADDING + inset,
                        SIZE - PADDING - inset, SIZE - PADDING - inset],
                 CORNER_RADIUS - 6, bg_inner)

    # Title bar
    bar_y = PADDING + inset
    bar_height = 72
    bar_left = PADDING + inset + CORNER_RADIUS // 2
    bar_right = SIZE - PADDING - inset - CORNER_RADIUS // 2
    draw.rectangle([bar_left, bar_y, bar_right, bar_y + bar_height],
                   fill=(30, 37, 46))

    # Traffic lights
    dot_y = bar_y + bar_height // 2
    dot_x = bar_left + 36
    for color in [(255, 95, 86), (255, 189, 46), (39, 201, 63)]:
        draw.ellipse([dot_x - 10, dot_y - 10, dot_x + 10, dot_y + 10], fill=color)
        dot_x += 36

    # Subtle glow behind prompt
    glow = Image.new("RGBA", img.size, (0, 0, 0, 0))
    gd = ImageDraw.Draw(glow)
    cx, cy = SIZE // 2 - 20, SIZE // 2 + 30
    for r in range(180, 0, -1):
        alpha = int(40 * (1 - (r / 180) ** 2))
        gd.ellipse([cx - r, cy - r, cx + r, cy + r], fill=(88, 166, 255, alpha))
    img = Image.alpha_composite(img, glow)
    draw = ImageDraw.Draw(img)

    # Load bold monospace font
    font_size = 340
    font = None
    bold_paths = [
        "/System/Library/Fonts/Menlo.ttc",
        "/System/Library/Fonts/SFMono-Bold.otf",
        "/Library/Fonts/SF-Mono-Bold.otf",
        "/System/Library/Fonts/Monaco.ttf",
    ]
    for fp in bold_paths:
        if os.path.exists(fp):
            try:
                font = ImageFont.truetype(fp, font_size)
                break
            except Exception:
                continue

    # Draw ">_" as one string, centered
    blue = (88, 166, 255)
    green = (63, 185, 80)

    prompt = ">_"
    bbox = draw.textbbox((0, 0), prompt, font=font)
    tw = bbox[2] - bbox[0]
    th = bbox[3] - bbox[1]
    tx = (SIZE - tw) // 2 - 10
    ty = (SIZE - th) // 2 + 10

    # Draw ">" in blue
    gt_bbox = draw.textbbox((0, 0), ">", font=font)
    gt_w = gt_bbox[2] - gt_bbox[0]
    draw.text((tx, ty), ">", fill=blue, font=font)

    # Draw "_" in green
    draw.text((tx + gt_w + 8, ty), "_", fill=green, font=font)

    # Bottom decoration lines
    overlay = Image.new("RGBA", img.size, (0, 0, 0, 0))
    od = ImageDraw.Draw(overlay)
    line_y = SIZE // 2 + 210
    lines = [
        (300, (88, 166, 255, 70)),
        (220, (63, 185, 80, 55)),
        (260, (139, 148, 158, 35)),
    ]
    for width, color in lines:
        lx = SIZE // 2 - width // 2
        od.rounded_rectangle([lx, line_y, lx + width, line_y + 6], radius=3, fill=color)
        line_y += 32
    img = Image.alpha_composite(img, overlay)

    # Save
    out_path = os.path.join(os.path.dirname(__file__), "icon.png")
    img.save(out_path, "PNG")
    print(f"Saved {out_path}")

    # Generate iconset
    iconset_dir = os.path.join(os.path.dirname(__file__), "icon.iconset")
    os.makedirs(iconset_dir, exist_ok=True)
    for s in [16, 32, 64, 128, 256, 512]:
        img.resize((s, s), Image.LANCZOS).save(
            os.path.join(iconset_dir, f"icon_{s}x{s}.png"))
        img.resize((s * 2, s * 2), Image.LANCZOS).save(
            os.path.join(iconset_dir, f"icon_{s}x{s}@2x.png"))
    print("Iconset generated")

if __name__ == "__main__":
    main()
