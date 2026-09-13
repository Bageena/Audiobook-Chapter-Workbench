import shutil
import logging
from pathlib import Path
from natsort import natsorted
from .ffmpeg import (
    get_audio_info,
    choose_cbr_bitrate,
    decode_to_pcm,
    encode_pcm_to_mp3,
    verify_full_decode
)

PCM_BYTES_PER_SECOND = 44100 * 2 * 2  # 176,400 bytes/sec for 16-bit 44.1kHz Stereo

def process_merge_job(job_folder: Path, merge_dir: Path, ffmpeg_path="ffmpeg", ffprobe_path="ffprobe") -> Path:
    job_name = job_folder.name
    target_mp3 = merge_dir / f"{job_name}.mp3"

    if target_mp3.exists():
        logging.info(f"Merged output {target_mp3.name} already exists. Skipping merge.")
        return target_mp3

    mp3_files = natsorted([f for f in job_folder.glob("*.mp3") if f.is_file()])
    if not mp3_files:
        raise FileNotFoundError(f"No MP3 files found in folder: {job_folder}")

    logging.info(f"Found {len(mp3_files)} MP3 pieces for job '{job_name}'. Inspecting bitrates...")
    
    bitrates = []
    total_est_seconds = 0.0
    for mp3 in mp3_files:
        info = get_audio_info(mp3, ffprobe_path)
        bitrates.append(info.get("bitrate"))
        if info.get("duration"):
            total_est_seconds += info["duration"]

    target_bitrate = choose_cbr_bitrate(bitrates)
    logging.info(f"Selected CBR target bitrate: {target_bitrate} kbps")

    # Disk space verification
    pcm_work_dir = job_folder / "__MP3_PCM_WORK"
    pcm_work_dir.mkdir(exist_ok=True)
    
    est_pcm_bytes = int(total_est_seconds * PCM_BYTES_PER_SECOND) * 2  # Chunks + unified PCM
    free_space = shutil.disk_usage(job_folder).free
    if free_space < est_pcm_bytes * 1.5:
        logging.warning(
            f"Low disk space warning! Free: {free_space / (1024**3):.2f} GB, "
            f"Estimated required: {est_pcm_bytes / (1024**3):.2f} GB."
        )

    # 1. Decode each source MP3 to PCM
    pcm_chunks = []
    for idx, mp3 in enumerate(mp3_files):
        out_pcm = pcm_work_dir / f"{idx:05d}.pcm"
        pcm_chunks.append(out_pcm)
        if not out_pcm.exists():
            decode_to_pcm(mp3, out_pcm, ffmpeg_path)

    # 2. Append all raw PCM chunks sequentially
    unified_pcm = merge_dir / f"{job_name}.tmp.pcm"
    logging.info(f"Combining raw PCM streams into {unified_pcm.name}...")
    total_written_bytes = 0
    with open(unified_pcm, "wb") as outfile:
        for chunk in pcm_chunks:
            with open(chunk, "rb") as infile:
                shutil.copyfileobj(infile, outfile)
            total_written_bytes += chunk.stat().st_size

    # 3. Verify total bytes vs sum of chunks
    assert unified_pcm.stat().st_size == total_written_bytes, "PCM chunk size sum mismatch!"
    pcm_duration = total_written_bytes / PCM_BYTES_PER_SECOND
    logging.info(f"Total PCM bytes: {total_written_bytes} (~{pcm_duration:.2f} seconds)")

    # 4. Encode PCM to CBR MP3
    encode_pcm_to_mp3(unified_pcm, target_mp3, target_bitrate, ffmpeg_path)

    # 5. Verify final output by full null decode
    decoded_duration = verify_full_decode(target_mp3, ffmpeg_path)
    duration_diff = abs(decoded_duration - pcm_duration)
    logging.info(f"Decoded verify duration: {decoded_duration:.2f}s (Diff: {duration_diff:.2f}s)")
    if duration_diff > 1.5:
        logging.warning("MP3 decoded duration deviates by >1.5s from PCM timeline. Inspect file integrity.")

    # 6. Cleanup PCM intermediates
    if unified_pcm.exists():
        unified_pcm.unlink()
    shutil.rmtree(pcm_work_dir, ignore_errors=True)
    logging.info(f"Successfully created merged MP3: {target_mp3.name}")

    return target_mp3