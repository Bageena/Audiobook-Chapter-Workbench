import sys
import os
import platform

# Ensure Windows locates NVIDIA cuDNN v8 DLLs installed via pip BEFORE heavy libraries load
if platform.system() == "Windows":
    site_packages = os.path.join(sys.prefix, "Lib", "site-packages")
    nvidia_paths = [
        os.path.join(site_packages, "nvidia", "cudnn", "bin"),
        os.path.join(site_packages, "nvidia", "cublas", "bin"),
    ]
    for path in nvidia_paths:
        if os.path.exists(path):
            os.add_dll_directory(path)

import json
import logging
from datetime import datetime
from pathlib import Path
from natsort import natsorted

from .merge import process_merge_job
from .transcription import run_transcription
from .candidates import extract_candidates_from_json
from .m4b import build_m4b_package
from .validate import validate_m4b_structure
from .purge import purge_job_work
from .ffmpeg import get_audio_info

ROOT_DIR = Path(__file__).resolve().parent.parent

def init_environment():
    for folder in ["Input", "Merge", "Whisper", "CSV", "Output", "Logs"]:
        (ROOT_DIR / folder).mkdir(exist_ok=True)

    log_file = ROOT_DIR / "Logs" / f"workbench_{datetime.now().strftime('%Y%m%d_%H%M%S')}.log"
    logging.basicConfig(
        level=logging.INFO,
        format="%(asctime)s [%(levelname)s] %(message)s",
        handlers=[
            logging.FileHandler(log_file, encoding="utf-8"),
            logging.StreamHandler(sys.stdout)
        ]
    )

def load_config():
    with open(ROOT_DIR / "config.json", "r", encoding="utf-8") as f:
        return json.load(f)

def list_jobs():
    input_dir = ROOT_DIR / "Input"
    return natsorted([d for d in input_dir.iterdir() if d.is_dir() and not d.name.startswith(".")])

def step1_merge_and_detect():
    jobs = list_jobs()
    if not jobs:
        print("[!] No subfolders found in Input/.")
        return

    cfg = load_config()
    for job_dir in jobs:
        job_name = job_dir.name
        logging.info(f"=== Starting Step 1 for: {job_name} ===")
        # Merge
        merged_mp3 = process_merge_job(job_dir, ROOT_DIR / "Merge")
        # Transcribe
        whisper_dir = ROOT_DIR / "Whisper" / job_name
        json_path = run_transcription(merged_mp3, whisper_dir, cfg)
        # CSV Extract
        cand_csv = ROOT_DIR / "CSV" / f"{job_name}-candidates.csv"
        draft_csv = ROOT_DIR / "CSV" / f"{job_name}-chapters.csv"
        extract_candidates_from_json(json_path, cand_csv, draft_csv, cfg.get("lead_in_seconds", 1.5))
        logging.info(f"Step 1 complete for {job_name}. Chapters CSV: {draft_csv.name}")

def step2_build_m4b():
    jobs = list_jobs()
    if not jobs:
        print("[!] No jobs found.")
        return

    cfg = load_config()
    for job_dir in jobs:
        job_name = job_dir.name
        merged_mp3 = ROOT_DIR / "Merge" / f"{job_name}.mp3"
        chapters_csv = ROOT_DIR / "CSV" / f"{job_name}-chapters.csv"
        out_m4b = ROOT_DIR / "Output" / f"{job_name}.m4b"
        ffmeta = ROOT_DIR / "CSV" / f"{job_name}.ffmeta"

        if not merged_mp3.exists():
            print(f"[-] Skipped {job_name}: Merged MP3 missing. Run Step 1 first.")
            continue
        if not chapters_csv.exists():
            print(f"[-] Skipped {job_name}: CSV/{chapters_csv.name} missing. Review candidates first.")
            continue

        try:
            build_m4b_package(merged_mp3, chapters_csv, out_m4b, ffmeta, cfg)
        except Exception as e:
            logging.error(f"Failed to build {job_name}.m4b: {e}", exc_info=True)

def step3_validate():
    out_dir = ROOT_DIR / "Output"
    m4bs = list(out_dir.glob("*.m4b"))
    if not m4bs:
        print("[*] No M4B files found in Output/.")
        return

    for m4b in m4bs:
        job_name = m4b.stem
        merged_mp3 = ROOT_DIR / "Merge" / f"{job_name}.mp3"
        orig_dur = get_audio_info(merged_mp3)["duration"] if merged_mp3.exists() else None
        report = validate_m4b_structure(m4b, orig_dur)
        print(f"\nOutput: Output/{report['file']}")
        print(f"Status: {report['status']}")
        print(f"Duration: {report.get('duration_seconds')}s | Chapters: {report.get('chapters_count')}")
        if "reason" in report:
            print(f"Notes: {report['reason']}")

def step4_purge_menu():
    jobs = list_jobs()
    if not jobs:
        print("[*] No jobs available.")
        return
    print("\nSelect job to purge:")
    for idx, j in enumerate(jobs, 1):
        print(f" {idx}. {j.name}")
    choice = input("Job number: ").strip()
    try:
        job = jobs[int(choice) - 1].name
    except (ValueError, IndexError):
        print("Invalid selection.")
        return

    print("\nPurge Actions:")
    print(" 1. Temporary PCM work files only")
    print(" 2. Intermediate files (Merged MP3 + Whisper JSON)")
    print(" 3. All job source data (Input + Intermediates, keeps Output/CSV)")
    pchoice = input("Select purge type [1-3]: ").strip()
    pmap = {"1": "temp", "2": "intermediate", "3": "job"}
    if pchoice in pmap:
        purge_job_work(job, ROOT_DIR, pmap[pchoice])

def interactive_menu():
    while True:
        print("\n" + "=" * 45)
        print("    Audiobook Chapter Workbench")
        print("=" * 45)
        print(" 1. Run Setup / Dependency Check")
        print(" 2. Step 1: Merge MP3s and Find Chapters")
        print(" 3. Open CSV Review Directory")
        print(" 4. Step 2: Build Chaptered M4B")
        print(" 5. Validate Output M4B")
        print(" 6. Purge Temporary / Intermediate Files")
        print(" 7. Exit")
        c = input("\nEnter choice [1-7]: ").strip()

        if c == "1":
            from .setup import setup_environment
            setup_environment()
        elif c == "2":
            step1_merge_and_detect()
        elif c == "3":
            os.startfile(str(ROOT_DIR / "CSV"))
        elif c == "4":
            step2_build_m4b()
        elif c == "5":
            step3_validate()
        elif c == "6":
            step4_purge_menu()
        elif c == "7":
            break

if __name__ == "__main__":
    init_environment()
    if len(sys.argv) > 2 and sys.argv[1] == "--step":
        arg = sys.argv[2]
        if arg == "1":
            step1_merge_and_detect()
        elif arg == "2":
            step2_build_m4b()
        elif arg == "3":
            step3_validate()
        elif arg == "4":
            step4_purge_menu()
    else:
        interactive_menu()