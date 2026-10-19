"""
Trace the RaveWall sprout logo from a flat-colour PNG into production SVG.

The reference artwork is a flat two-colour logo, so tracing the actual pixels is
more faithful than redrawing by hand. This script:

  1. decodes the PNG (no third-party image library),
  2. builds one binary mask per colour,
  3. extracts closed contours with marching squares,
  4. simplifies them with Douglas–Peucker,
  5. writes SVG paths cropped to each element's bounding box.

Usage:
  python scripts/trace-logo.py <reference.png> <out-dir>
"""
import struct
import sys
import zlib

ICON_TOLERANCE = 0.7    # px — leaves are pure curves
WORD_TOLERANCE = 0.9    # px — letterforms keep their corners


def read_png(path):
    data = open(path, "rb").read()
    width, height = struct.unpack(">II", data[16:24])
    colour_type = data[25]
    channels = {0: 1, 2: 3, 4: 2, 6: 4}[colour_type]
    idat = b""
    i = 8
    while i < len(data):
        length = struct.unpack(">I", data[i : i + 4])[0]
        kind = data[i + 4 : i + 8]
        if kind == b"IDAT":
            idat += data[i + 8 : i + 8 + length]
        i += 12 + length
    raw = zlib.decompress(idat)
    stride = width * channels
    rows = []
    prev = bytearray(stride)
    pos = 0
    for _ in range(height):
        filter_type = raw[pos]
        pos += 1
        line = bytearray(raw[pos : pos + stride])
        pos += stride
        if filter_type == 1:
            for x in range(channels, stride):
                line[x] = (line[x] + line[x - channels]) & 255
        elif filter_type == 2:
            for x in range(stride):
                line[x] = (line[x] + prev[x]) & 255
        elif filter_type == 3:
            for x in range(stride):
                a = line[x - channels] if x >= channels else 0
                line[x] = (line[x] + ((a + prev[x]) >> 1)) & 255
        elif filter_type == 4:
            for x in range(stride):
                a = line[x - channels] if x >= channels else 0
                b = prev[x]
                c = prev[x - channels] if x >= channels else 0
                p = a + b - c
                pa, pb, pc = abs(p - a), abs(p - b), abs(p - c)
                pr = a if (pa <= pb and pa <= pc) else (b if pb <= pc else c)
                line[x] = (line[x] + pr) & 255
        rows.append(line)
        prev = line
    return width, height, channels, rows


def classify(width, height, channels, rows):
    """Two masks: green icon pixels and near-black wordmark pixels."""
    green = [[False] * width for _ in range(height)]
    dark = [[False] * width for _ in range(height)]
    for y in range(height):
        row = rows[y]
        for x in range(width):
            o = x * channels
            r, g, b = row[o], row[o + 1], row[o + 2]
            a = row[o + 3] if channels == 4 else 255
            if a < 40:
                continue
            if g > r + 25 and g > b + 15 and g > 50:
                green[y][x] = True
            elif max(r, g, b) < 120:
                dark[y][x] = True
    return green, dark


def bbox(mask):
    height = len(mask)
    width = len(mask[0])
    min_x, min_y, max_x, max_y = width, height, -1, -1
    for y in range(height):
        row = mask[y]
        for x in range(width):
            if row[x]:
                if x < min_x:
                    min_x = x
                if x > max_x:
                    max_x = x
                if y < min_y:
                    min_y = y
                if y > max_y:
                    max_y = y
    return min_x, min_y, max_x, max_y


def marching_squares(mask, ox, oy):
    """
    Returns closed contours as lists of (x, y) points, in mask coordinates
    offset by (ox, oy). Cell (x, y) samples the 2x2 block at (x, y)..(x+1, y+1);
    the outer border of the mask is treated as empty so shapes always close.
    """
    height = len(mask)
    width = len(mask[0])
    inside = lambda x, y: 0 <= x < width and 0 <= y < height and mask[y][x]

    segments = {}
    for y in range(-1, height):
        for x in range(-1, width):
            tl = inside(x, y)
            tr = inside(x + 1, y)
            br = inside(x + 1, y + 1)
            bl = inside(x, y + 1)
            case = (1 if tl else 0) | (2 if tr else 0) | (4 if br else 0) | (8 if bl else 0)
            if case in (0, 15):
                continue
            # Edge midpoints of this cell.
            top = (x + 1.0, y + 0.5)
            right = (x + 1.5, y + 1.0)
            bottom = (x + 1.0, y + 1.5)
            left = (x + 0.5, y + 1.0)
            pairs = {
                1: [(left, top)],
                2: [(top, right)],
                3: [(left, right)],
                4: [(right, bottom)],
                5: [(left, top), (right, bottom)],
                6: [(top, bottom)],
                7: [(left, bottom)],
                8: [(bottom, left)],
                9: [(bottom, top)],
                10: [(top, right), (bottom, left)],
                11: [(bottom, right)],
                12: [(right, left)],
                13: [(right, top)],
                14: [(top, left)],
                15: [],
            }[case]
            for start, end in pairs:
                segments.setdefault(start, []).append(end)

    contours = []
    while segments:
        start = next(iter(segments))
        contour = [start]
        current = start
        while True:
            options = segments.get(current)
            if not options:
                break
            nxt = options.pop()
            if not options:
                del segments[current]
            current = nxt
            if current == start:
                break
            contour.append(current)
        if len(contour) >= 4:
            contours.append([(x + ox, y + oy) for x, y in contour])
    return contours


def rdp(points, epsilon):
    if len(points) < 3:
        return points
    start, end = points[0], points[-1]
    dx, dy = end[0] - start[0], end[1] - start[1]
    length = (dx * dx + dy * dy) ** 0.5
    best_index, best_distance = 0, -1.0
    for i in range(1, len(points) - 1):
        px, py = points[i]
        if length == 0:
            dist = ((px - start[0]) ** 2 + (py - start[1]) ** 2) ** 0.5
        else:
            dist = abs(dy * px - dx * py + end[0] * start[1] - end[1] * start[0]) / length
        if dist > best_distance:
            best_index, best_distance = i, dist
    if best_distance > epsilon:
        left = rdp(points[: best_index + 1], epsilon)
        right = rdp(points[best_index:], epsilon)
        return left[:-1] + right
    return [start, end]


def contour_to_path(contour, ox, oy, tolerance):
    simplified = rdp(contour + [contour[0]], tolerance)
    if simplified and simplified[-1] == simplified[0]:
        simplified = simplified[:-1]
    if len(simplified) < 3:
        return ""
    parts = []
    for index, (x, y) in enumerate(simplified):
        px, py = x - ox, y - oy
        parts.append(("M" if index == 0 else "L") + f"{px:.1f} {py:.1f}")
    return "".join(parts) + "Z"


def build(mask, tolerance):
    x0, y0, x1, y1 = bbox(mask)
    width = x1 - x0 + 1
    height = y1 - y0 + 1
    contours = marching_squares(mask, 0, 0)
    paths = [p for p in (contour_to_path(c, x0, y0, tolerance) for c in contours) if p]
    return paths, (width, height), (x0, y0)


def svg_document(width, height, body, background=None):
    bg = (
        f'<rect width="{width}" height="{height}" fill="{background}"/>'
        if background
        else ""
    )
    return (
        f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {width} {height}" '
        f'width="{width}" height="{height}" role="img" aria-label="RaveWall">'
        f"{bg}{body}</svg>\n"
    )


def main():
    source, out_dir = sys.argv[1], sys.argv[2]
    width, height, channels, rows = read_png(source)
    green, dark = classify(width, height, channels, rows)

    green_paths, (gw, gh), (gx, gy) = build(green, ICON_TOLERANCE)
    dark_paths, (dw, dh), (dx, dy) = build(dark, WORD_TOLERANCE)

    print(f"icon: {gw}x{gh} at ({gx},{gy}) — {len(green_paths)} path(s)")
    print(f"wordmark: {dw}x{dh} at ({dx},{dy}) — {len(dark_paths)} path(s)")

    # One path per colour with fill-rule="evenodd": counters (the holes in R,
    # a and e) are separate contours and must subtract, not paint over.
    green_d = "".join(green_paths)
    dark_d = "".join(dark_paths)
    green_body = f'<path fill="#097441" fill-rule="evenodd" d="{green_d}"/>'
    dark_body = f'<path fill="currentColor" fill-rule="evenodd" d="{dark_d}"/>'
    white_body = f'<path fill="#ffffff" fill-rule="evenodd" d="{dark_d}"/>'
    dark_solid = f'<path fill="#0c1615" fill-rule="evenodd" d="{dark_d}"/>' 

    # Wordmark only (dark fill, for standalone use such as email headers).
    with open(f"{out_dir}/ravewall-wordmark.svg", "w", encoding="utf-8") as handle:
        handle.write(svg_document(dw, dh, dark_solid))

    # Icon only.
    with open(f"{out_dir}/ravewall-icon.svg", "w", encoding="utf-8") as handle:
        handle.write(svg_document(gw, gh, green_body))

    # Full lockup: icon, then wordmark, offset by the measured gap.
    gap = max(0, dx - (gx + gw))
    lockup_width = gw + gap + dw
    lockup_height = max(gh, dh)
    icon_y = (lockup_height - gh) / 2
    word_y = (lockup_height - dh) / 2
    lockup_body = (
        f'<g transform="translate(0 {icon_y:.1f})">{green_body}</g>'
        f'<g transform="translate({gw + gap} {word_y:.1f})">{dark_body}</g>'
    )
    with open(f"{out_dir}/ravewall-logo.svg", "w", encoding="utf-8") as handle:
        handle.write(svg_document(lockup_width, lockup_height, lockup_body))

    # White-wordmark variant for dark surfaces (icon stays green).
    white_lockup = (
        f'<g transform="translate(0 {icon_y:.1f})">{green_body}</g>'
        f'<g transform="translate({gw + gap} {word_y:.1f})">{white_body}</g>'
    )
    with open(f"{out_dir}/ravewall-logo-white.svg", "w", encoding="utf-8") as handle:
        handle.write(svg_document(lockup_width, lockup_height, white_lockup))

    # Favicon: icon centred in a square with breathing room, sized for 16px.
    side = int(round(max(gw, gh) * 1.18))
    offset_x = (side - gw) / 2
    offset_y = (side - gh) / 2
    favicon_body = f'<g transform="translate({offset_x:.1f} {offset_y:.1f})">{green_body}</g>'
    with open(f"{out_dir}/favicon.svg", "w", encoding="utf-8") as handle:
        handle.write(svg_document(side, side, favicon_body))

    print("wrote ravewall-icon.svg, ravewall-wordmark.svg, ravewall-logo.svg, ravewall-logo-white.svg, favicon.svg")


if __name__ == "__main__":
    main()
