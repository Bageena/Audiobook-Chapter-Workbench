import json
import csv
import re
from pathlib import Path

CHAPTER_KEYWORDS = {
    "chapter", "chapters", "prologue", "prolog", "introduction",
    "foreword", "afterword", "epilogue", "appendix", "appendices",
    "part", "book", "section", "interlude"
}

def format_timestamp(seconds: float) -> str:
    hrs = int(seconds // 3600)
    mins = int((seconds % 3600) // 60)
    secs = seconds % 60
    return f"{hrs:02d}:{mins:02d}:{secs:06.3f}"

def extract_candidates_from_json(json_path: Path, candidates_csv: Path, draft_csv: Path, lead_in: float = 1.5):
    with open(json_path, "r", encoding="utf-8") as f:
        data = json.load(f)

    # Flatten all word tokens across segments
    words = []
    for seg in data.get("segments", []):
        if "words" in seg:
            for w in seg["words"]:
                words.append({
                    "word": w.get("word", "").strip(),
                    "start": w.get("start"),
                    "end": w.get("end"),
                    "score": w.get("score", "")
                })
        else:
            # Fallback when alignment is missing
            clean_text = seg.get("text", "").strip()
            for part in clean_text.split():
                words.append({
                    "word": part,
                    "start": seg.get("start"),
                    "end": seg.get("end"),
                    "score": ""
                })

    candidates = []
    # Seed Chapter 1 / Start boundary
    candidates.append({
        "candidate_id": 1,
        "candidate_start": "00:00:00.000",
        "candidate_end": "00:00:01.000",
        "matched_text": "[START]",
        "context_before": "",
        "context_after": "Audiobook begins",
        "confidence": "1.0",
        "proposed_title": "Start / Prologue",
        "approved_start": "00:00:00.000",
        "approved_title": "Chapter 1",
        "status": "preapproved",
        "notes": "Automatic opening candidate"
    })

    candidate_id = 2
    i = 0
    total_words = len(words)
    draft_entries = [("00:00:00.000", "Chapter 1")]

    while i < total_words:
        w = words[i]
        clean = re.sub(r"[^\w]", "", w["word"].lower())
        if clean in CHAPTER_KEYWORDS and w["start"] is not None:
            # Extract surrounding context
            start_idx = max(0, i - 6)
            end_idx = min(total_words, i + 8)
            ctx_before = " ".join(words[k]["word"] for k in range(start_idx, i))
            ctx_after = " ".join(words[k]["word"] for k in range(i + 1, end_idx))

            # Phrase grouping (e.g. Chapter 1, Chapter Twenty)
            matched_phrase = [w["word"]]
            proposed_title = w["word"].capitalize()
            j = i + 1
            while j < total_words and j <= i + 3:
                next_word = words[j]["word"]
                if re.match(r"^(\d+|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen|twenty|[ivxlcdm]+)$", next_word.lower()):
                    matched_phrase.append(next_word)
                    proposed_title += f" {next_word.capitalize()}"
                    j += 1
                else:
                    break

            cand_start = max(0.0, float(w["start"]) - lead_in)
            cand_end = float(w["end"]) if w["end"] else cand_start + 1.0
            ts_str = format_timestamp(cand_start)

            candidates.append({
                "candidate_id": candidate_id,
                "candidate_start": ts_str,
                "candidate_end": format_timestamp(cand_end),
                "matched_text": " ".join(matched_phrase),
                "context_before": ctx_before,
                "context_after": ctx_after,
                "confidence": str(w.get("score", "")),
                "proposed_title": proposed_title,
                "approved_start": "",
                "approved_title": "",
                "status": "review",
                "notes": ""
            })
            draft_entries.append((ts_str, proposed_title))
            candidate_id += 1
            i = j
        else:
            i += 1

    # Write review candidate CSV
    with open(candidates_csv, "w", newline="", encoding="utf-8") as f:
        fields = [
            "candidate_id", "candidate_start", "candidate_end", "matched_text",
            "context_before", "context_after", "confidence", "proposed_title",
            "approved_start", "approved_title", "status", "notes"
        ]
        writer = csv.DictWriter(f, fieldnames=fields)
        writer.writeheader()
        writer.writerows(candidates)

    # Write draft user-editable chapters CSV (if not already existing)
    if not draft_csv.exists():
        with open(draft_csv, "w", newline="", encoding="utf-8") as f:
            writer = csv.writer(f)
            writer.writerow(["start", "title"])
            for ts, title in draft_entries:
                writer.writerow([ts, title])