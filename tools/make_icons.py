#!/usr/bin/env python3
"""Generate calm placeholder PNG icons (a soft glowing circle) with no deps."""
import struct, zlib, os, math

OUT = os.path.join(os.path.dirname(__file__), "..", "icons")
os.makedirs(OUT, exist_ok=True)

# Palette (matches the app)
BG_TOP   = (0x12, 0x20, 0x31)
BG       = (0x0e, 0x16, 0x20)
C_CENTER = (0xc4, 0xe3, 0xf0)
C_MID    = (0x7f, 0xb6, 0xcf)
C_EDGE   = (0x5d, 0x93, 0xb0)


def lerp(a, b, t):
    return tuple(int(round(a[i] + (b[i] - a[i]) * t)) for i in range(3))


def render(size, circle_frac):
    cx = cy = (size - 1) / 2.0
    R = size * circle_frac
    glow = R * 1.75
    rows = bytearray()
    for y in range(size):
        rows.append(0)  # filter byte: none
        for x in range(size):
            # vertical background gradient
            vt = y / (size - 1)
            r, g, b = lerp(BG_TOP, BG, min(1.0, vt * 1.3))
            d = math.hypot(x - cx, y - cy)
            if d <= R:
                t = d / R
                if t < 0.6:
                    col = lerp(C_CENTER, C_MID, t / 0.6)
                else:
                    col = lerp(C_MID, C_EDGE, (t - 0.6) / 0.4)
                # soft anti-aliased edge
                edge = max(0.0, min(1.0, (R - d) / 1.5))
                col = lerp((r, g, b), col, edge if d > R - 1.5 else 1.0)
                r, g, b = col
            elif d <= glow:
                # outer glow fades to background
                a = (1.0 - (d - R) / (glow - R)) ** 2 * 0.55
                r, g, b = lerp((r, g, b), C_MID, a)
            rows += bytes((r, g, b, 255))
    return bytes(rows)


def write_png(path, size, raw):
    def chunk(typ, data):
        c = struct.pack(">I", len(data)) + typ + data
        return c + struct.pack(">I", zlib.crc32(typ + data) & 0xffffffff)

    sig = b"\x89PNG\r\n\x1a\n"
    ihdr = struct.pack(">IIBBBBB", size, size, 8, 6, 0, 0, 0)
    idat = zlib.compress(raw, 9)
    with open(path, "wb") as f:
        f.write(sig + chunk(b"IHDR", ihdr) + chunk(b"IDAT", idat) + chunk(b"IEND", b""))
    print("wrote", os.path.relpath(path), size, "x", size)


# Standard icons: circle ~0.34 of canvas
for name, size in [("icon-192.png", 192), ("icon-512.png", 512), ("apple-touch-icon.png", 180)]:
    write_png(os.path.join(OUT, name), size, render(size, 0.34))

# Maskable: keep within the 80% safe zone -> smaller circle, full-bleed bg
write_png(os.path.join(OUT, "icon-512-maskable.png"), 512, render(512, 0.26))
