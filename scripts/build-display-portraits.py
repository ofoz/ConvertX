#!/usr/bin/env python3
"""Build responsive display-only WebP derivatives of attributed standing portraits.

The original artwork is read-only and remains the final srcset fallback. Regeneration is
idempotent and updates only public/characters/display plus localDerivedAssets metadata.
"""

from __future__ import annotations

import hashlib
import json
from pathlib import Path

from PIL import Image

ROOT = Path(__file__).resolve().parents[1]
CHARACTERS = ROOT / "public" / "characters"
MANIFEST = CHARACTERS / "assets.json"
SOURCES = (
    "deepseek-standing.webp",
    "claude.webp",
    "gpt.webp",
    "whale-cheerful.webp",
    "whale-serious.webp",
    "whale-exasperated.webp",
    "whale-starry.webp",
)
WIDTHS = (384, 768)
QUALITY = 90
RESAMPLE = Image.Resampling.LANCZOS


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as source:
        for block in iter(lambda: source.read(1024 * 1024), b""):
            digest.update(block)
    return digest.hexdigest()


def main() -> None:
    manifest = json.loads(MANIFEST.read_text(encoding="utf-8"))
    original_records = {entry["file"]: entry for entry in manifest["assets"]}
    derived = []

    for filename in SOURCES:
        source_path = CHARACTERS / filename
        source_meta = original_records.get(filename)
        if source_meta is None:
            raise SystemExit(f"No original manifest record for {filename}")
        actual_source_sha = sha256(source_path)
        if actual_source_sha != source_meta["sha256"]:
            raise SystemExit(
                f"Source SHA mismatch for {filename}: expected {source_meta['sha256']}, got {actual_source_sha}"
            )

        with Image.open(source_path) as image:
            if image.format != "WEBP" or image.mode not in ("RGBA", "LA", "PA"):
                raise SystemExit(f"Expected transparent WebP portrait: {filename} ({image.format}, {image.mode})")
            rgba = image.convert("RGBA")
            original_width, original_height = rgba.size
            if [original_width, original_height] != [source_meta["width"], source_meta["height"]]:
                raise SystemExit(f"Source dimension mismatch for {filename}: {rgba.size}")

            for target_width in WIDTHS:
                target_height = round(original_height * target_width / original_width)
                output_path = CHARACTERS / "display" / str(target_width) / filename
                output_path.parent.mkdir(parents=True, exist_ok=True)
                resized = rgba.resize((target_width, target_height), RESAMPLE)
                resized.save(output_path, "WEBP", quality=QUALITY, method=6, lossless=False, exact=True)
                with Image.open(output_path) as check:
                    check.load()
                    if check.size != (target_width, target_height) or check.mode not in ("RGBA", "LA"):
                        raise SystemExit(f"Invalid derivative: {output_path} ({check.size}, {check.mode})")
                    if check.getextrema()[3] == (255, 255):
                        raise SystemExit(f"Expected preserved alpha: {output_path}")

                relative = output_path.relative_to(ROOT / "public").as_posix()
                route = f"/{relative}"
                derived.append(
                    {
                        "file": f"display/{target_width}/{filename}",
                        "url": route,
                        "sourceFile": filename,
                        "sourceSha256": actual_source_sha,
                        "sourceUrl": source_meta["sourceUrl"],
                        "width": target_width,
                        "height": target_height,
                        "bytes": output_path.stat().st_size,
                        "sha256": sha256(output_path),
                        "hasAlpha": True,
                        "format": "WebP",
                        "quality": QUALITY,
                        "resampling": "Lanczos",
                        "authors": source_meta["authors"],
                        "license": source_meta["license"],
                        "modifications": (
                            f"Local responsive display derivative of {filename}; resized proportionally from "
                            f"{original_width}x{original_height} to {target_width}x{target_height}, "
                            f"Lanczos resampling, lossy WebP quality {QUALITY}; original source is unchanged."
                        ),
                        "sourceWidth": original_width,
                        "sourceHeight": original_height,
                    }
                )
                print(f"{relative}: {target_width}x{target_height}, {output_path.stat().st_size:,} bytes")

        if sha256(source_path) != actual_source_sha:
            raise SystemExit(f"Source changed while building derivatives: {filename}")

    manifest["localDerivedAssets"] = derived
    MANIFEST.write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")

    total_bytes = sum(item["bytes"] for item in derived)
    original_rgba_bytes = sum(item["sourceWidth"] * item["sourceHeight"] * 4 for item in derived if item["width"] == 384)
    display_rgba_bytes = sum(item["width"] * item["height"] * 4 for item in derived if item["width"] == 384)
    print(f"\nGenerated {len(derived)} display derivatives; encoded total={total_bytes:,} bytes")
    print(f"384w decoded RGBA theoretical reduction: {original_rgba_bytes:,} -> {display_rgba_bytes:,} bytes")
    print("This decoded-pixel estimate is not a measured browser/RAM benchmark.")


if __name__ == "__main__":
    main()
