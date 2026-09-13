import subprocess
import sys
import shutil
import json
from pathlib import Path

ROOT_DIR = Path(__file__).resolve().parent.parent

def run_command(cmd, desc=None):
    if desc:
        print(f"[*] {desc}")
    print(f"    > {' '.join(cmd)}")
    res = subprocess.run(cmd, shell=False)
    if res.returncode != 0:
        print(f"[!] Step failed with exit code {res.returncode}")
        return False
    return True

def detect_cuda():
    print("[*] Detecting NVIDIA GPU via nvidia-smi...")
    smi = shutil.which("nvidia-smi")
    if smi:
        try:
            out = subprocess.check_output([smi, "--query-gpu=name,memory.total", "--format=csv,noheader"], text=True)
            print(f"[+] Detected GPU(s):\n    {out.strip()}")
            return True
        except Exception as e:
            print(f"[-] nvidia-smi run error: {e}")
    else:
        print("[-] nvidia-smi not found. CUDA hardware acceleration will not be available.")
    return False

def setup_environment():
    print("=" * 60)
    print(" Audiobook Chapter Workbench - Diagnostic & Setup")
    print("=" * 60)

    # 1. FFmpeg verification
    ffmpeg = shutil.which("ffmpeg")
    ffprobe = shutil.which("ffprobe")
    if not ffmpeg or not ffprobe:
        print("[!] FFmpeg/FFprobe NOT found in PATH.")
        print("    Please install FFmpeg and ensure 'ffmpeg.exe' and 'ffprobe.exe' are on your PATH.")
        return

    res = subprocess.run(["ffmpeg", "-version"], stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
    first_line = res.stdout.splitlines()[0] if res.stdout else "Unknown version"
    print(f"[+] FFmpeg verified: {first_line}")

    # 2. Virtualenv pip upgrade
    run_command([sys.executable, "-m", "pip", "install", "--upgrade", "pip"], "Upgrading pip...")
    pip_exe = sys.executable.replace("python.exe", "pip.exe")

    # 3. PyTorch selection based on GPU availability
    has_cuda = detect_cuda()
    if has_cuda:
        choice = input("\n[?] NVIDIA GPU detected. Install CUDA PyTorch (y/n)? [y]: ").strip().lower()
        if choice != 'n':
            print("[*] Installing PyTorch with CUDA 12.1...")
            run_command([pip_exe, "install", "torch", "torchaudio", "--index-url", "https://download.pytorch.org/whl/cu121"])
        else:
            print("[*] Installing CPU-only PyTorch...")
            run_command([pip_exe, "install", "torch", "torchaudio"])
    else:
        print("[*] Installing CPU-only PyTorch...")
        run_command([pip_exe, "install", "torch", "torchaudio"])

    # 4. Install WhisperX and dependencies
    req_file = ROOT_DIR / "requirements.txt"
    run_command([pip_exe, "install", "-r", str(req_file)], "Installing requirements and WhisperX...")

    print("\n[+] Setup finished. You can now launch 'Run Workbench.bat'.")

if __name__ == "__main__":
    setup_environment()