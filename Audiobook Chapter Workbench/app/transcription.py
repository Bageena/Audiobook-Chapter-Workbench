import json
import logging
from pathlib import Path
import torch
import whisperx

# Enable TensorFloat-32 for ~2x GPU speedup on supported NVIDIA hardware
torch.backends.cuda.matmul.allow_tf32 = True
torch.backends.cudnn.allow_tf32 = True


def load_whisper_model(model_name: str, device: str, compute_type: str, language: str):
    """Attempt loading WhisperX on preferred device, falling back to CPU if GPU/CUDA errors occur."""
    try:
        logging.info(f"Loading WhisperX model '{model_name}' on {device} ({compute_type})...")
        return whisperx.load_model(
            model_name,
            device=device,
            compute_type=compute_type,
            language=language
        ), device, compute_type
    except Exception as e:
        if device == "cuda":
            logging.warning(f"CUDA initialization failed ({e}). Falling back to CPU (int8)...")
            fallback_model = whisperx.load_model(
                model_name,
                device="cpu",
                compute_type="int8",
                language=language
            )
            return fallback_model, "cpu", "int8"
        raise e


def run_transcription(audio_file: Path, output_dir: Path, config: dict):
    output_dir.mkdir(parents=True, exist_ok=True)
    json_path = output_dir / f"{audio_file.stem}.json"

    if json_path.exists():
        logging.info(f"Transcription JSON already exists at {json_path}. Skipping transcription.")
        return json_path

    prof_name = config.get("whisper_profile", "turbo")
    prof = config["profiles"].get(prof_name, config["profiles"]["turbo"])
    
    device = prof.get("device_preference", "cuda")
    if device == "cuda" and not torch.cuda.is_available():
        logging.warning("CUDA preferred in config but PyTorch reports CUDA is unavailable! Falling back to CPU.")
        device = "cpu"

    compute_type = prof.get("compute_type_cuda", "float16") if device == "cuda" else prof.get("compute_type_cpu", "int8")
    batch_size = prof.get("batch_size_cuda", 4) if device == "cuda" else prof.get("batch_size_cpu", 1)
    model_name = prof.get("model", "large-v3-turbo")
    language = prof.get("language", "en")

    # Load model with runtime fallback check
    model, device, compute_type = load_whisper_model(model_name, device, compute_type, language)

    logging.info(f"Loading audio: {audio_file.name}")
    audio = whisperx.load_audio(str(audio_file))

    logging.info(f"Transcribing (batch_size={batch_size})...")
    result = model.transcribe(audio, batch_size=batch_size, language=language)

    if prof.get("alignment", True):
        logging.info("Aligning transcript with wav2vec2 model...")
        model_a, metadata = whisperx.load_align_model(
            language_code=result["language"],
            device=device
        )
        result = whisperx.align(
            result["segments"],
            model_a,
            metadata,
            audio,
            device,
            return_char_alignments=False
        )

    # Save complete JSON transcript
    logging.info(f"Saving WhisperX transcript to {json_path}...")
    with open(json_path, "w", encoding="utf-8") as f:
        json.dump(result, f, indent=2, ensure_ascii=False)

    # Write command/version trace
    with open(output_dir / "command-and-version.txt", "w", encoding="utf-8") as f:
        f.write(f"WhisperX Version: {whisperx.__version__}\n")
        f.write(f"Model: {model_name}\nDevice: {device}\nCompute: {compute_type}\nBatch Size: {batch_size}\n")

    return json_path