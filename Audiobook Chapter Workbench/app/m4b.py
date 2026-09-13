import subprocess
import logging
from pathlib import Path
from .ffmpeg import get_audio_info
from .chapters import validate_and_generate_ffmeta

def build_m4b_package(
    merged_mp3: Path,
    chapters_csv: Path,
    output_m4b: Path,
    ffmeta_path: Path,
    config: dict,
    ffmpeg_path="ffmpeg",
    ffprobe_path="ffprobe"
):
    if output_m4b.exists():
        raise FileExistsError(f"Output M4B already exists: {output_m4b}. Refusing to overwrite.")

    # 1. Validate duration & chapters
    info = get_audio_info(merged_mp3, ffprobe_path)
    audio_duration = info["duration"]
    logging.info(f"Source duration for {merged_mp3.name}: {audio_duration:.2f}s")
    
    chapters = validate_and_generate_ffmeta(chapters_csv, ffmeta_path, audio_duration)
    logging.info(f"Validated {len(chapters)} chapters. FFmetadata written to {ffmeta_path.name}.")

    # 2. Configure bitrate
    m4b_conf = config.get("m4b_settings", {})
    bitrate = m4b_conf.get("bitrate_stereo", "96k") if info["channels"] > 1 else m4b_conf.get("bitrate_mono", "64k")

    # 3. Assemble AAC M4B
    cmd = [
        ffmpeg_path,
        "-hide_banner",
        "-y",
        "-i", str(merged_mp3),
        "-i", str(ffmeta_path),
        "-map", "0:a:0",
        "-map_metadata", "1",
        "-map_chapters", "1",
        "-c:a", m4b_conf.get("audio_codec", "aac"),
        "-b:a", bitrate,
        "-movflags", "+faststart",
        str(output_m4b)
    ]
    logging.info(f"Building chaptered M4B: {' '.join(cmd)}")
    res = subprocess.run(cmd, shell=False, capture_output=True, text=True)
    if res.returncode != 0:
        raise RuntimeError(f"M4B encoding failed: {res.stderr}")

    logging.info(f"[SUCCESS] Exported M4B: {output_m4b}")