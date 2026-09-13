import shutil
import logging
from pathlib import Path

def purge_job_work(job_name: str, root_dir: Path, purge_type: str):
    input_dir = root_dir / "Input" / job_name
    merge_mp3 = root_dir / "Merge" / f"{job_name}.mp3"
    whisper_dir = root_dir / "Whisper" / job_name
    pcm_work = input_dir / "__MP3_PCM_WORK"

    items_to_delete = []

    if purge_type == "temp":
        if pcm_work.exists():
            items_to_delete.append(pcm_work)
        for pcm in (root_dir / "Merge").glob(f"{job_name}*.pcm"):
            items_to_delete.append(pcm)

    elif purge_type == "intermediate":
        if merge_mp3.exists():
            items_to_delete.append(merge_mp3)
        if whisper_dir.exists():
            items_to_delete.append(whisper_dir)

    elif purge_type == "job":
        # Full wipe of inputs/intermediates (leaves Output untouched)
        if input_dir.exists():
            items_to_delete.append(input_dir)
        if merge_mp3.exists():
            items_to_delete.append(merge_mp3)
        if whisper_dir.exists():
            items_to_delete.append(whisper_dir)

    if not items_to_delete:
        print("[*] No matching files found to clean.")
        return

    print("\n[!] The following paths will be permanently deleted:")
    total_bytes = 0
    for item in items_to_delete:
        if item.is_dir():
            size = sum(f.stat().st_size for f in item.rglob('*') if f.is_file())
        else:
            size = item.stat().st_size
        total_bytes += size
        print(f"    - {item} ({size / (1024 * 1024):.2f} MB)")

    print(f"Total disk reclamation: {total_bytes / (1024 * 1024):.2f} MB")
    confirm = input(f"\nType PURGE {job_name} to confirm: ").strip()
    if confirm == f"PURGE {job_name}":
        for item in items_to_delete:
            if item.is_dir():
                shutil.rmtree(item)
            else:
                item.unlink()
        print("[+] Cleanup complete.")
    else:
        print("[-] Confirmation mismatch. Purge cancelled.")