"""Make the light-blue background of the workshop brand image transparent.

Only the outer background region is cleared: it is flood-filled from the border, so
enclosed art (the white logo tile, the dark wordmark and the green status pill) keeps
its pixels. A short alpha feather removes the hard cut on anti-aliased edges.
"""

from collections import deque
from pathlib import Path

from PIL import Image

SOURCE = Path("public/brand-workshop.png")
BACKUP = Path("data/setup/brand-workshop-original.png")
BACKGROUND_TOLERANCE = 8
# Keep the art edges crisp: the image is displayed downscaled to 230px, so a
# one-pixel background rim is already sub-pixel. Feathering made it look mottled.
FEATHER_TOLERANCE = 0


def distance(pixel, reference):
    return max(abs(pixel[0] - reference[0]), abs(pixel[1] - reference[1]), abs(pixel[2] - reference[2]))


def main():
    if not BACKUP.exists():
        BACKUP.parent.mkdir(parents=True, exist_ok=True)
        BACKUP.write_bytes(SOURCE.read_bytes())

    image = Image.open(SOURCE).convert("RGBA")
    width, height = image.size
    pixels = image.load()
    reference = pixels[0, 0][:3]

    cleared = [[False] * width for _ in range(height)]
    queue = deque()
    for x in range(width):
        for y in (0, height - 1):
            queue.append((x, y))
    for y in range(height):
        for x in (0, width - 1):
            queue.append((x, y))

    while queue:
        x, y = queue.popleft()
        if not (0 <= x < width and 0 <= y < height) or cleared[y][x]:
            continue
        if distance(pixels[x, y], reference) > BACKGROUND_TOLERANCE:
            continue
        cleared[y][x] = True
        queue.extend(((x + 1, y), (x - 1, y), (x, y + 1), (x, y - 1)))

    for y in range(height):
        for x in range(width):
            if cleared[y][x]:
                pixels[x, y] = (0, 0, 0, 0)

    # Decontaminate the boundary: blend pixels hold the old background colour, which would
    # otherwise show as a pale rim once the image sits on a different background. Re-derive
    # their transparency against the neighbouring solid art colour and drop the tint.
    neighbours8 = (
        (1, 0),
        (-1, 0),
        (0, 1),
        (0, -1),
        (1, 1),
        (-1, -1),
        (1, -1),
        (-1, 1),
    )

    def inside(x, y):
        return 0 <= x < width and 0 <= y < height

    rim = [
        (x, y)
        for y in range(height)
        for x in range(width)
        if not cleared[y][x] and any(inside(x + dx, y + dy) and cleared[y + dy][x + dx] for dx, dy in neighbours8)
    ]
    rim_set = set(rim)
    for x, y in rim:
        solid = [
            pixels[x + dx, y + dy][:3]
            for dx, dy in neighbours8
            if inside(x + dx, y + dy)
            and not cleared[y + dy][x + dx]
            and (x + dx, y + dy) not in rim_set
        ]
        if not solid:
            continue
        target = tuple(sum(channel) // len(solid) for channel in zip(*solid))
        vector = [target[i] - reference[i] for i in range(3)]
        length = sum(component * component for component in vector)
        if not length:
            continue
        observed = [pixels[x, y][i] - reference[i] for i in range(3)]
        coverage = sum(observed[i] * vector[i] for i in range(3)) / length
        coverage = max(0.0, min(1.0, coverage))
        # Keep the boundary binary: partial alpha from noisy blend pixels showed up as a
        # dotted rim around the logo tile once the image was scaled down.
        pixels[x, y] = (*target, 255) if coverage >= 0.5 else (0, 0, 0, 0)

    image.save(SOURCE, optimize=True)

    opaque = sum(1 for y in range(height) for x in range(width) if pixels[x, y][3] > 0)
    corner = pixels[0, 0]
    print(
        {
            "size": image.size,
            "background_pixel": corner,
            "opaque_pixels": opaque,
            "total_pixels": width * height,
        }
    )


main()
