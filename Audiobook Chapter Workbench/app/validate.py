import subprocess
import json
import logging
from pathlib import Path
from .ffmpeg import probe_file

def validate_m4b_structure(m4b_file: Path, original_duration: float = None, ffprobe_path="ffprobe") -> dict:
    if not m4b_file.exists() or m4b_file.stat().st_size == 0:
        return {"status": "FAIL", "reason": "File does not exist or has 0 bytes."}

    cmd = [
        ffprobe_path,
        "-v", "quiet",
        "-print_format", "json",
        "-show_chapters",
        "-show_format",
        "-show_streams",
        str(m4b_file)
    ]
    res = subprocess.run(cmd, shell=False, capture_output=True, text=True)
    if res.returncode != 0:
        return {"status": "FAIL", "reason": f"FFprobe error: {res.stderr}"}

    data = json.loads(res.stdout)
    chapters = data.get("chapters", [])
    duration_str = data.get("format", {}).get("duration")
    duration = float(duration_str) if duration_str else 0.0

    report = {
        "file": m4b_file.name,
        "size_mb": round(m4b_file.stat().st_size / (1024 * 1024), 2),
        "duration_seconds": round(duration, 2),
        "chapters_count": len(chapters),
        "status": "PASS"
    }

    if len(chapters) == 0:
        report["status"] = "FAIL"
        report["reason"] = "No embedded chapters detected."
    elif original_duration and abs(duration - original_duration) > 2.0:
        report["status"] = "WARNING"
        report["reason"] = f"Duration mismatch vs source: diff {abs(duration - original_duration):.2f}s"

    return report