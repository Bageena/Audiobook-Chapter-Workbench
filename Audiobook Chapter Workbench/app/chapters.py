import csv
import re
from pathlib import Path

def parse_timestamp_to_ms(ts_str: str) -> int:
    match = re.match(r"^(\d+):(\d{2}):(\d{2})(?:\.(\d+))?$", ts_str.strip())
    if not match:
        raise ValueError(f"Invalid timestamp format: '{ts_str}'. Expected HH:MM:SS.mmm")
    hrs, mins, secs, ms = match.groups()
    total_ms = (int(hrs) * 3600 + int(mins) * 60 + int(secs)) * 1000
    if ms:
        ms_clean = (ms + "000")[:3]
        total_ms += int(ms_clean)
    return total_ms

def escape_ffmeta(val: str) -> str:
    val = val.replace("\\", "\\\\")
    val = val.replace("=", "\\=")
    val = val.replace(";", "\\;")
    val = val.replace("#", "\\#")
    val = val.replace("\n", " ")
    return val

def validate_and_generate_ffmeta(chapters_csv: Path, ffmeta_path: Path, total_duration_seconds: float) -> list[dict]:
    if not chapters_csv.exists():
        raise FileNotFoundError(f"Chapter CSV not found: {chapters_csv}")

    chapters = []
    with open(chapters_csv, "r", encoding="utf-8-sig") as f:
        reader = csv.DictReader(f)
        if "start" not in reader.fieldnames or "title" not in reader.fieldnames:
            raise ValueError("CSV must contain at least 'start' and 'title' columns.")
        for row_num, row in enumerate(reader, start=2):
            raw_start = row.get("start", "").strip()
            raw_title = row.get("title", "").strip()
            if not raw_start or not raw_title:
                raise ValueError(f"Line {row_num}: Missing start or title.")
            ms = parse_timestamp_to_ms(raw_start)
            chapters.append({"start_ms": ms, "title": raw_title, "line": row_num})

    if not chapters:
        raise ValueError("Chapters file contains no entries.")

    # Validation rules
    if chapters[0]["start_ms"] != 0:
        raise ValueError("First chapter must start at 00:00:00.000 (0ms).")

    total_duration_ms = int(total_duration_seconds * 1000)
    for i in range(len(chapters)):
        current = chapters[i]
        if i > 0:
            prev = chapters[i - 1]
            if current["start_ms"] <= prev["start_ms"]:
                raise ValueError(
                    f"Line {current['line']}: Timestamp {current['start_ms']}ms does not strictly increase "
                    f"after previous {prev['start_ms']}ms."
                )
        if current["start_ms"] >= total_duration_ms:
            raise ValueError(
                f"Line {current['line']}: Chapter start ({current['start_ms']}ms) exceeds total duration ({total_duration_ms}ms)."
            )

    # Build FFmetadata file
    with open(ffmeta_path, "w", encoding="utf-8") as out:
        out.write(";FFMETADATA1\n")
        out.write("genre=Audiobook\n")
        for i, chap in enumerate(chapters):
            start_ms = chap["start_ms"]
            end_ms = chapters[i + 1]["start_ms"] if i + 1 < len(chapters) else total_duration_ms
            out.write("[CHAPTER]\n")
            out.write("TIMEBASE=1/1000\n")
            out.write(f"START={start_ms}\n")
            out.write(f"END={end_ms}\n")
            out.write(f"title={escape_ffmeta(chap['title'])}\n")

    return chapters