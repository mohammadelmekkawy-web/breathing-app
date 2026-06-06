#!/usr/bin/env python3
"""
Generate breathing app icon: concentric rings in teal-to-blue gradient on dark background.
Generates: 192x192, 512x512, and 512x512 maskable versions.
"""

from PIL import Image, ImageDraw, ImageFilter
import os

# Colors: dark background to teal/blue gradient
DARK_BG = "#0e1620"
TEAL = "#7fb6cf"
BLUE = "#3d7d99"

def create_icon(size, maskable=False):
    """Create icon with concentric rings."""
    img = Image.new("RGBA", (size, size), (14, 22, 32, 255))  # dark background
    draw = ImageDraw.Draw(img, "RGBA")
    
    center = size / 2
    num_rings = 4
    ring_spacing = size / (num_rings * 2 + 1)
    
    if maskable:
        # Maskable icons need safe zone: inner 80% of the image
        safe_radius = (size * 0.4)
        max_radius = safe_radius
    else:
        max_radius = size / 2 - ring_spacing
    
    # Draw concentric rings with gradient effect
    for i in range(num_rings, 0, -1):
        radius = (max_radius / num_rings) * i
        
        # Gradient: outer rings more teal, inner rings more blue
        ratio = i / num_rings
        r = int(127 + (61 - 127) * ratio)  # 127 (teal R) to 61 (blue R)
        g = int(182 + (125 - 182) * ratio)  # 182 (teal G) to 125 (blue G)
        b = int(207 + (153 - 207) * ratio)  # 207 (teal B) to 153 (blue B)
        
        color = (r, g, b, 220)  # slight transparency
        
        # Draw ring outline
        bbox = [
            center - radius,
            center - radius,
            center + radius,
            center + radius,
        ]
        draw.ellipse(bbox, outline=color, width=max(1, int(radius / 6)))
    
    return img

def main():
    output_dir = "icons"
    os.makedirs(output_dir, exist_ok=True)
    
    # Generate sizes
    sizes = [
        (192, False, "icon-192.png"),
        (512, False, "icon-512.png"),
        (512, True, "icon-512-maskable.png"),
    ]
    
    for size, maskable, filename in sizes:
        print(f"Generating {filename} ({size}x{size})...")
        img = create_icon(size, maskable)
        img.save(os.path.join(output_dir, filename), "PNG")
        print(f"  ✓ {filename}")
    
    # Also generate apple-touch-icon
    print("Generating apple-touch-icon.png (180x180)...")
    img = create_icon(180, False)
    img.save(os.path.join(output_dir, "apple-touch-icon.png"), "PNG")
    print("  ✓ apple-touch-icon.png")
    
    print("\n✅ All icons generated successfully!")

if __name__ == "__main__":
    main()
