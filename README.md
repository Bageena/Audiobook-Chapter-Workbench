# Audiobook-Chapter-Workbench
===============================================================================
AUDIOBOOK CHAPTER WORKBENCH — USER GUIDE
===============================================================================

Audiobook Chapter Workbench is a local, offline Windows preservation tool that
safely merges multi-part MP3 audiobooks, uses WhisperX AI to detect chapter
headings, allows you to review and adjust the timestamps in a CSV, and builds
a final chaptered .m4b audiobook.

Source audio files are never altered, and nothing is deleted automatically.

A QUICK NOTE FROM THE CREATOR:
I am not a professional programmer—this tool was essentially "vibe coded" with 
a lot of trial, error, and tears to get it working! The code is entirely open 
source, so please feel free to review it. I plan to keep refining it as time 
goes on.

Because I am not a registered Windows "Trusted Developer," Windows SmartScreen 
will likely show a security warning popup when you run the batch files. 

HOW TO BYPASS THE WINDOWS POPUP: 
Before extracting the downloaded archive, right-click the .zip or .rar file, 
select "Properties," check the "Unblock" box at the bottom of the General tab, 
and click Apply.

-------------------------------------------------------------------------------
PREREQUISITES
-------------------------------------------------------------------------------
1. Windows 10 or 11 (64-bit).
2. Python 3.10 or 3.11 installed with "Add python.exe to PATH" checked.
3. FFmpeg and FFprobe installed and accessible from your system PATH.
4. (Optional) An NVIDIA GPU with CUDA for faster WhisperX processing. If no
   GPU is present, the workbench falls back to CPU processing.


-------------------------------------------------------------------------------
INITIAL SETUP (FIRST-TIME USE)
-------------------------------------------------------------------------------
1. Double-click "01 - Setup.bat".
2. The script will:
   - Verify FFmpeg and Python.
   - Create a local virtual environment (.venv).
   - Detect if an NVIDIA GPU is available and prompt to install CUDA-enabled
     PyTorch or CPU-only PyTorch.
   - Install WhisperX and required helper libraries.
3. Wait until setup completes successfully before proceeding. This may take a while, be patient.


-------------------------------------------------------------------------------
STANDARD WORKFLOW
-------------------------------------------------------------------------------

STEP 1: ADD YOUR AUDIOBOOK
- Open the "Input" folder.
- Create a subfolder for each audiobook (for example: "Input\Dune" or 
  "Input\Hitchhikers Guide").
- Place your MP3 parts inside that folder (e.g., 01.mp3, 02.mp3, 10.mp3).
- Files are processed in natural numeric order (part 2 comes before part 10).
- Do not put loose files directly in the root "Input" directory; always use a
  subfolder.

STEP 2: MERGE AND DETECT CHAPTERS
- Double-click "02 - Step 1 Merge and Detect Chapters.bat" (or choose Option 2
  in "Run Workbench.bat").
- The workbench will:
  a. Safely decode every source MP3 into standardized raw PCM audio to fix
     timestamp, sample rate, or DTS errors.
  b. Combine the audio and encode a working CBR MP3 in the "Merge" folder.
  c. Transcribe the audio using WhisperX and generate alignment data inside
     the "Whisper" folder.
  d. Search for chapter words (Chapter, Prologue, Epilogue, etc.) and generate
     two CSV files in the "CSV" folder.

STEP 3: REVIEW AND EDIT CHAPTERS (MANDATORY)
AI transcription suggests candidates, but human review is required to ensure
accurate chapter boundaries.

1. Open the "CSV" folder.
2. Open "<BookName>-candidates.csv" for reference.
   - This file displays every detected keyword, its exact timestamp, word
     confidence, and surrounding narration context to help identify false
     positives.
3. Open and edit "<BookName>-chapters.csv".
   - This is your active chapter list containing two columns: "start" and "title".
   - Adjust start times if needed (giving a 1 to 2-second lead-in before
     speech begins is often ideal).
   - Remove false positives (such as an in-dialogue use of the word "chapter").
   - Add any missing sections or adjust titles (e.g., change "Chapter Two" to
     "Chapter 2: The Journey Begins").
   - Ensure the first chapter starts at "00:00:00.000" and timestamps strictly
     increase.
   - Save and close the file.

STEP 4: BUILD CHAPTERED M4B
- Double-click "03 - Step 2 Build M4B.bat" (or choose Option 4 in
  "Run Workbench.bat").
- The workbench will:
  a. Validate your edited CSV (checking format, sorting, and boundary limits).
  b. Build a proper FFmetadata chapter map.
  c. Encode the final AAC-LC audio file into "Output\<BookName>.m4b" with 
     fast-start streaming flags.

STEP 5: VALIDATE OUTPUT
- Double-click "04 - Validate Output.bat" (or choose Option 5 in
  "Run Workbench.bat").
- This runs an FFprobe verification to ensure the final .m4b audio duration 
  matches the source material and confirms all chapters are properly embedded.


-------------------------------------------------------------------------------
DISK CLEANUP & PURGING
-------------------------------------------------------------------------------
Raw audio processing requires significant disk space while running. Once an
audiobook is finished and verified, use "05 - Purge Temporary Files.bat":

- Purge Option 1 (Temporary PCM work only):
  Removes leftover uncompressed PCM files from failed/interrupted jobs.
- Purge Option 2 (Intermediates):
  Removes the working MP3 in "Merge" and Whisper transcription files.
- Purge Option 3 (Job source data):
  Removes the original files in "Input" and working intermediates. Requires
  typing a confirmation phrase to prevent accidental deletion.

* Your generated .m4b files in "Output" are never deleted by the purge tool.


-------------------------------------------------------------------------------
CONFIGURATION (config.json)
-------------------------------------------------------------------------------
You can customize engine settings by editing "config.json" in a text editor:
- "whisper_profile": Switch between "turbo" (fastest, default), "accurate" 
  (large-v3 model), or "cpu" (medium model optimized for systems without a GPU).
- "lead_in_seconds": Pre-roll padding subtracted from detected chapter words 
  (default is 1.5 seconds).
- "m4b_settings": Adjust AAC bitrates (64k mono / 96k stereo defaults).
===============================================================================
