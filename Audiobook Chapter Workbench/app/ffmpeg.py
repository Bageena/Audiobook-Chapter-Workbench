import subprocess
import json
import logging
from pathlib import Path

STANDARD_BITRATES = [32, 40, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320]

def probe_file(file_path: Path, ffprobe_path="ffprobe") -> dict:
    cmd = [
        ffprobe_path,
        "-v", "quiet",
        "-print_format", "json",
        "-show_format",
        "-show_streams",
        str(file_path)
    ]
    res = subprocess.run(cmd, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True, shell=False)
    if res.returncode != 0:
        raise RuntimeError(f"FFprobe failed on {file_path}: {res.stderr}")
    return json.loads(res.stdout)

def get_audio_info(file_path: Path, ffprobe_path="ffprobe"):
    data = probe_file(file_path, ffprobe_path)
    streams = [s for s in data.get("streams", []) if s.get("codec_type") == "audio"]
    if not streams:
        raise ValueError(f"No audio stream found in {file_path}")
    
    stream = streams[0]
    duration = None
    if "duration" in stream:
        duration = float(stream["duration"])
    elif "format" in data and "duration" in data["format"]:
        duration = float(data["format"]["duration"])

    bitrate = None
    if "bit_rate" in stream:
        bitrate = int(stream["bit_rate"])
    elif "format" in data and "bit_rate" in data["format"]:
        bitrate = int(data["format"]["bit_rate"])

    channels = int(stream.get("channels", 2))
    sample_rate = int(stream.get("sample_rate", 44100))

    return {
        "duration": duration,
        "bitrate": bitrate,
        "channels": channels,
        "sample_rate": sample_rate
    }

def choose_cbr_bitrate(detected_bps_list: list[int]) -> int:
    usable = [b for b in detected_bps_list if b is not None]
    if not usable:
        logging.warning("No usable bitrate found. Defaulting to 192 kbps.")
        return 192
    max_kbps = max(usable) // 1000
    for target in STANDARD_BITRATES:
        if target >= max_kbps:
            return target
    return 320

def decode_to_pcm(input_mp3: Path, output_pcm: Path, ffmpeg_path="ffmpeg"):
    cmd = [
        ffmpeg_path,
        "-hide_banner",
        "-y",
        "-i", str(input_mp3),
        "-map", "0:a:0",
        "-vn",
        "-ac", "2",
        "-ar", "44100",
        "-c:a", "pcm_s16le",
        "-f", "s16le",
        str(output_pcm)
    ]
    logging.info(f"Decoding {input_mp3.name} to raw PCM...")
    res = subprocess.run(cmd, shell=False, capture_output=True, text=True)
    if res.returncode != 0:
        raise RuntimeError(f"FFmpeg decode error ({input_mp3.name}): {res.stderr}")

def encode_pcm_to_mp3(pcm_path: Path, output_mp3: Path, bitrate_kbps: int, ffmpeg_path="ffmpeg"):
    cmd = [
        ffmpeg_path,
        "-hide_banner",
        "-y",
        "-f", "s16le",
        "-ar", "44100",
        "-ac", "2",
        "-i", str(pcm_path),
        "-map", "0:a:0",
        "-map_metadata", "-1",
        "-map_chapters", "-1",
        "-c:a", "libmp3lame",
        "-b:a", f"{bitrate_kbps}k",
        "-write_xing", "0",
        str(output_mp3)
    ]
    logging.info(f"Encoding merged PCM to MP3 at {bitrate_kbps}k CBR...")
    res = subprocess.run(cmd, shell=False, capture_output=True, text=True)
    if res.returncode != 0:
        raise RuntimeError(f"FFmpeg encode error ({output_mp3.name}): {res.stderr}")

def verify_full_decode(mp3_path: Path, ffmpeg_path="ffmpeg") -> float:
    cmd = [
        ffmpeg_path,
        "-hide_banner",
        "-i", str(mp3_path),
        "-f", "null",
        "-"
    ]
    res = subprocess.run(cmd, shell=False, capture_output=True, text=True)
    if res.returncode != 0:
        raise RuntimeError(f"Null decode failed for {mp3_path}: {res.stderr}")
    
    info = get_audio_info(mp3_path)
    return info["duration"] if info["duration"] else 0.0