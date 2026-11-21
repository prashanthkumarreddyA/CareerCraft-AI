"""Compare the original resume PDF with a generated one.

usage: python validate.py <original.pdf> <generated.pdf> <out_dir>
requires: pip install pymupdf

Checks: page count/size, per-line text equality, baseline / left / right deltas,
overlapping lines, and a pixel overlay per page:
    black = ink in both, red = only in original, blue = only in generated.
"""
import json
import sys
from pathlib import Path

import pymupdf

TRAILING = "  "


def lines_of(pdf_path):
    doc = pymupdf.open(pdf_path)
    out = []
    for pno, page in enumerate(doc):
        raw = page.get_text("rawdict")
        rows = {}
        for block in raw["blocks"]:
            for line in block.get("lines", []):
                for span in line["spans"]:
                    chars = [c for c in span["chars"]]
                    if not chars:
                        continue
                    key = round(span["origin"][1] * 2) / 2
                    # merge spans that share a baseline (within 1pt)
                    match = next((k for k in rows if abs(k - key) <= 1.0), key)
                    rows.setdefault(match, []).extend(chars)
        for baseline, chars in sorted(rows.items()):
            chars.sort(key=lambda c: c["origin"][0])
            text = "".join(c["c"] for c in chars)
            ink = [c for c in chars if c["c"] not in TRAILING]
            if not ink:
                continue
            out.append({
                "page": pno + 1,
                "baseline": round(chars[0]["origin"][1], 2),
                "x0": round(ink[0]["origin"][0], 2),
                "x1": round(ink[-1]["bbox"][2], 2),
                "top": min(c["bbox"][1] for c in ink),
                "bottom": max(c["bbox"][3] for c in ink),
                "text": " ".join(text.split()),
            })
    return doc, out


def overlay(orig_doc, gen_doc, out_dir, dpi=110):
    results = []
    for i in range(max(len(orig_doc), len(gen_doc))):
        po = orig_doc[i].get_pixmap(dpi=dpi, colorspace=pymupdf.csGRAY) if i < len(orig_doc) else None
        pg = gen_doc[i].get_pixmap(dpi=dpi, colorspace=pymupdf.csGRAY) if i < len(gen_doc) else None
        ref = po or pg
        w, h = ref.width, ref.height
        o = po.samples if po else bytes([255]) * (w * h)
        g = pg.samples if pg else bytes([255]) * (w * h)
        rgb = bytearray(w * h * 3)
        ink_o = ink_g = only_o = only_g = 0
        for j in range(w * h):
            a, b = o[j], g[j]
            rgb[3 * j] = b
            rgb[3 * j + 1] = min(a, b)
            rgb[3 * j + 2] = a
            io, ig = a < 128, b < 128
            ink_o += io
            ink_g += ig
            only_o += io and not ig
            only_g += ig and not io
        pix = pymupdf.Pixmap(pymupdf.csRGB, w, h, bytes(rgb), False)
        path = Path(out_dir) / f"overlay-page{i + 1}.png"
        pix.save(path)
        for name, src in (("original", po), ("generated", pg)):
            if src:
                src.save(Path(out_dir) / f"{name}-page{i + 1}.png")
        results.append({
            "page": i + 1,
            "overlay": str(path),
            "inkPixelsOriginal": ink_o,
            "inkPixelsGenerated": ink_g,
            "onlyInOriginalPct": round(100 * only_o / max(ink_o, 1), 2),
            "onlyInGeneratedPct": round(100 * only_g / max(ink_g, 1), 2),
        })
    return results


def main():
    orig_path, gen_path, out_dir = sys.argv[1:4]
    Path(out_dir).mkdir(parents=True, exist_ok=True)
    orig_doc, a = lines_of(orig_path)
    gen_doc, b = lines_of(gen_path)

    report = {
        "pageCount": {"original": len(orig_doc), "generated": len(gen_doc)},
        "pageSize": {
            "original": [tuple(round(v, 2) for v in p.rect[2:]) for p in orig_doc],
            "generated": [tuple(round(v, 2) for v in p.rect[2:]) for p in gen_doc],
        },
        "lineCount": {"original": len(a), "generated": len(b)},
        "fonts": {
            "original": sorted({f[3].split("+")[-1] for p in orig_doc for f in p.get_fonts()}),
            "generated": sorted({f[3].split("+")[-1] for p in gen_doc for f in p.get_fonts()}),
        },
    }

    mismatches, deltas = [], {"baseline": [], "x0": [], "x1": []}
    for i in range(max(len(a), len(b))):
        la = a[i] if i < len(a) else None
        lb = b[i] if i < len(b) else None
        if not la or not lb or la["text"] != lb["text"] or la["page"] != lb["page"]:
            mismatches.append({"index": i, "original": la, "generated": lb})
            continue
        for k in deltas:
            deltas[k].append(abs(la[k] - lb[k]))

    def stats(v):
        return {"max": round(max(v), 2), "mean": round(sum(v) / len(v), 3)} if v else None

    overlaps = []
    for page in {l["page"] for l in b}:
        rows = sorted((l for l in b if l["page"] == page), key=lambda l: l["baseline"])
        for p, q in zip(rows, rows[1:]):
            if q["top"] < p["bottom"] - 0.5 and not (q["x0"] > p["x1"] or p["x0"] > q["x1"]):
                overlaps.append({"page": page, "a": p["text"][:50], "b": q["text"][:50]})

    out_of_bounds = [l["text"][:60] for l in b if l["x1"] > 540.5 or l["x0"] < 71.5 or l["bottom"] > 722]

    report.update({
        "identicalLines": len(deltas["baseline"]),
        "textMismatches": mismatches,
        "deltaPt": {k: stats(v) for k, v in deltas.items()},
        "overlappingLines": overlaps,
        "linesOutsideMargins": out_of_bounds,
        "pixelOverlay": overlay(orig_doc, gen_doc, out_dir),
    })
    Path(out_dir, "validation-report.json").write_text(json.dumps(report, indent=2, ensure_ascii=False), encoding="utf-8")

    print(f"pages: {report['pageCount']}  lines: {report['lineCount']}  identical-text lines: {report['identicalLines']}")
    print(f"fonts original={report['fonts']['original']} generated={report['fonts']['generated']}")
    print(f"position delta (pt): {report['deltaPt']}")
    print(f"text mismatches: {len(mismatches)}  overlaps: {len(overlaps)}  outside margins: {len(out_of_bounds)}")
    for m in mismatches[:8]:
        print("  MISMATCH", json.dumps({k: (v and v['text'][:70]) for k, v in m.items() if k != 'index'}, ensure_ascii=False))
    for p in report["pixelOverlay"]:
        print(f"  page {p['page']}: only-in-original {p['onlyInOriginalPct']}%  only-in-generated {p['onlyInGeneratedPct']}%")


if __name__ == "__main__":
    main()
