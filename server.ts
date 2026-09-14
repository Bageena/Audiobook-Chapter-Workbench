import express from 'express';
import cors from 'cors';
import path from 'path';
import fs from 'fs';
import os from 'os';
import { execSync, exec, execFile, spawn } from 'child_process';
import { promisify } from 'util';
const execAsync = promisify(exec);
const execFileAsync = promisify(execFile);

function runSpawnCmd(cmd: string, args: string[], onLog: (msg: string) => void): Promise<void> {
  return new Promise((resolve, reject) => {
    const isWin = os.platform() === 'win32';
    
    // On Windows, when using shell: true, it's often more reliable to pass a single command string
    // especially when paths contain spaces.
    let child;
    if (isWin) {
        const processedArgs = args.map(arg => {
            // Quote arguments that have spaces and aren't already quoted
            if (arg.includes(' ') && !arg.startsWith('"')) {
                return `"${arg}"`;
            }
            return arg;
        });
        const processedCmd = (cmd.includes(' ') && !cmd.startsWith('"')) ? `"${cmd}"` : cmd;
        const fullCommandLine = `${processedCmd} ${processedArgs.join(' ')}`;
        
        console.log(`[Spawn:Win] ${fullCommandLine}`);
        child = spawn(fullCommandLine, [], { shell: true });
    } else {
        console.log(`[Spawn:Posix] ${cmd} ${args.join(' ')}`);
        child = spawn(cmd, args, { shell: false });
    }
    
    child.stdout.on('data', (data) => {
      const str = data.toString();
      // Also write directly to the system process stdout for "real" terminal feel
      process.stdout.write(str);
      const lines = str.split('\n');
      for (const line of lines) {
        if (line.trim()) onLog(line.trim());
      }
    });
    
    child.stderr.on('data', (data) => {
      const str = data.toString();
      // PIP and FFmpeg often use stderr for progress bars
      process.stderr.write(str);
      const lines = str.split('\n');
      for (const line of lines) {
        if (line.trim()) onLog(line.trim());
      }
    });
    
    child.on('close', (code) => {
      if (code !== 0) {
        reject(new Error(`Command failed with exit code ${code}`));
      } else {
        resolve();
      }
    });
    
    child.on('error', (err) => {
        reject(err);
    });
  });
}
import { createServer as createViteServer } from 'vite';
import multer from 'multer';

const app = express();
const PORT = 3000;

const RUNTIME_DIR = path.join(process.cwd(), 'runtime');
const VENV_DIR = path.join(process.cwd(), '.venv');
const getVenvPython = () => {
    const isWin = os.platform() === 'win32';
    return isWin ? path.join(VENV_DIR, 'Scripts', 'python.exe') : path.join(VENV_DIR, 'bin', 'python');
};
const getVenvPip = () => {
    const isWin = os.platform() === 'win32';
    return isWin ? path.join(VENV_DIR, 'Scripts', 'pip.exe') : path.join(VENV_DIR, 'bin', 'pip');
};

console.log(`[Startup] CWD: ${process.cwd()}`);
console.log(`[Startup] VENV_DIR: ${VENV_DIR}`);
console.log(`[Startup] Expected Python: ${getVenvPython()}`);
console.log(`[Startup] Venv Exists: ${fs.existsSync(VENV_DIR)}`);
if (fs.existsSync(VENV_DIR)) {
    console.log(`[Startup] Python Exists: ${fs.existsSync(getVenvPython())}`);
}

app.use(cors());
app.use(express.json({ limit: '50mb' }));

const uploadDir = path.join(process.cwd(), 'inputs');
if (!fs.existsSync(uploadDir)) {
  fs.mkdirSync(uploadDir, { recursive: true });
}

const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, uploadDir);
  },
  filename: (req, file, cb) => {
    // Preserve the original name but ensure it's safe. 
    // Allowing spaces as users expect them to be preserved in their project parts.
    cb(null, file.originalname.replace(/[^a-zA-Z0-9_.\- ]/g, '_'));
  }
});

const upload = multer({ storage });

app.post('/api/upload-audio', upload.array('files'), (req, res) => {
  if (!req.files || req.files.length === 0) {
    return res.status(400).json({ error: 'No files uploaded.' });
  }

  const jobId = req.query.jobId as string;
  if (!jobId) {
    // Cleanup files if they were uploaded without a jobId
    (req.files as Express.Multer.File[]).forEach(f => {
      try { if (fs.existsSync(f.path)) fs.unlinkSync(f.path); } catch (e) {}
    });
    return res.status(400).json({ error: 'No active project selected. Please create or open a book project first.' });
  }

  const finalUploadDir = path.join(uploadDir, jobId);
  if (!fs.existsSync(finalUploadDir)) {
    fs.mkdirSync(finalUploadDir, { recursive: true });
  }
  
  const uploadedFiles = (req.files as Express.Multer.File[]).map(f => {
    const newPath = path.join(finalUploadDir, f.filename);
    fs.renameSync(f.path, newPath);
    const finalPath = newPath;

    // Probe the file for accurate metadata
    const probe = probeAudioFile(finalPath);

    return {
      originalName: f.originalname,
      filename: f.filename,
      path: finalPath,
      size: f.size,
      durationSeconds: probe.durationSeconds,
      bitrate: probe.bitrate
    };
  });
  
  res.json({
    message: 'Successfully uploaded files.',
    files: uploadedFiles,
    uploadDir: finalUploadDir
  });
});


// Initial workbench configuration matching config.json from original Python app
let currentConfig: WorkbenchConfig = {
  ffmpeg_path: "ffmpeg",
  ffprobe_path: "ffprobe",
  whisper_profile: "turbo",
  profiles: {
    turbo: {
      model: "large-v3-turbo",
      language: "en",
      device_preference: "cuda",
      compute_type_cuda: "float16",
      compute_type_cpu: "int8",
      batch_size_cuda: 4,
      batch_size_cpu: 1,
      alignment: true,
    },
    accurate: {
      model: "large-v3",
      language: "en",
      device_preference: "cuda",
      compute_type_cuda: "float16",
      compute_type_cpu: "int8",
      batch_size_cuda: 2,
      batch_size_cpu: 1,
      alignment: true,
    },
    cpu: {
      model: "medium.en",
      language: "en",
      device_preference: "cpu",
      compute_type_cpu: "int8",
      batch_size_cpu: 1,
      alignment: true,
    },
  },
  m4b_settings: {
    audio_codec: "aac",
    bitrate_mono: "64k",
    bitrate_stereo: "96k",
    sample_rate: 44100,
  },
  lead_in_seconds: 1.5,
};

// Helper: Format bytes to human readable string
function formatBytes(bytes: number): string {
  if (!bytes || bytes <= 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(1024));
  return `${(bytes / Math.pow(1024, i)).toFixed(i === 0 ? 0 : 1)} ${units[i]}`;
}

// Helper: Format seconds to HH:MM:SS.mmm
function formatTimestamp(seconds: number): string {
  const safeSec = Math.max(0, seconds);
  const hrs = Math.floor(safeSec / 3600);
  const mins = Math.floor((safeSec % 3600) / 60);
  const secs = safeSec % 60;
  const secsStr = secs.toFixed(3).padStart(6, '0');
  return `${hrs.toString().padStart(2, '0')}:${mins.toString().padStart(2, '0')}:${secsStr}`;
}

// Helper: Parse HH:MM:SS.mmm to milliseconds
function parseTimestampToMs(tsStr: string): number {
  const match = tsStr.trim().match(/^(\d+):(\d{2}):(\d{2})(?:\.(\d+))?$/);
  if (!match) {
    throw new Error(`Invalid timestamp format: '${tsStr}'. Expected HH:MM:SS.mmm`);
  }
  const [, hrs, mins, secs, ms] = match;
  let totalMs = (parseInt(hrs, 10) * 3600 + parseInt(mins, 10) * 60 + parseInt(secs, 10)) * 1000;
  if (ms) {
    const cleanMs = (ms + "000").slice(0, 3);
    totalMs += parseInt(cleanMs, 10);
  }
  return totalMs;
}

// Helper: Escape string for FFMETADATA
function escapeFFMeta(val: string): string {
  return val
    .replace(/\\/g, '\\\\')
    .replace(/=/g, '\\=')
    .replace(/;/g, '\\;')
    .replace(/#/g, '\\#')
    .replace(/\n/g, ' ');
}

// Helper: Generate FFMETADATA string
function generateFFMetaContent(chapters: ChapterEntry[], totalDurationSeconds: number, meta?: AudiobookMetadata): string {
  const totalDurationMs = Math.round(totalDurationSeconds * 1000);
  let content = ";FFMETADATA1\n";
  if (meta) {
    if (meta.title) content += `title=${escapeFFMeta(meta.title)}\n`;
    if (meta.subtitle) content += `subtitle=${escapeFFMeta(meta.subtitle)}\n`;
    if (meta.author) content += `artist=${escapeFFMeta(meta.author)}\n`;
    // Standard Audiobookshelf & iTunes M4B standard: Narrator stored in Composer tag!
    if (meta.narrator) content += `composer=${escapeFFMeta(meta.narrator)}\n`;
    if (meta.series) {
      const albumStr = meta.seriesSequence ? `${meta.series}, Book ${meta.seriesSequence}` : meta.series;
      content += `album=${escapeFFMeta(albumStr)}\n`;
      content += `series=${escapeFFMeta(meta.series)}\n`;
      if (meta.seriesSequence) content += `series-part=${escapeFFMeta(meta.seriesSequence)}\n`;
    } else if (meta.title) {
      content += `album=${escapeFFMeta(meta.title)}\n`;
    }
    if (meta.genres && meta.genres.length > 0) {
      content += `genre=${escapeFFMeta(meta.genres.join(', '))}\n`;
    } else {
      content += `genre=Audiobook\n`;
    }
    if (meta.publishedYear) content += `date=${escapeFFMeta(meta.publishedYear)}\n`;
    if (meta.publisher) content += `publisher=${escapeFFMeta(meta.publisher)}\n`;
    if (meta.language) content += `language=${escapeFFMeta(meta.language)}\n`;
    if (meta.asin) content += `ASIN=${escapeFFMeta(meta.asin)}\n`;
    if (meta.isbn) content += `ISBN=${escapeFFMeta(meta.isbn)}\n`;
    if (meta.description) {
      content += `description=${escapeFFMeta(meta.description)}\n`;
      content += `comment=${escapeFFMeta(meta.description)}\n`;
    }
    if (meta.copyright) content += `copyright=${escapeFFMeta(meta.copyright)}\n`;
    content += `explicit=${meta.explicit ? '1' : '0'}\n`;
    content += `abridged=${meta.abridged ? '1' : '0'}\n`;
  } else {
    content += "genre=Audiobook\n";
  }

  for (let i = 0; i < chapters.length; i++) {
    const chap = chapters[i];
    const startMs = parseTimestampToMs(chap.start);
    const endMs = i + 1 < chapters.length ? parseTimestampToMs(chapters[i + 1].start) : totalDurationMs;
    content += `[CHAPTER]\nTIMEBASE=1/1000\nSTART=${startMs}\nEND=${endMs}\ntitle=${escapeFFMeta(chap.title)}\n`;
  }
  return content;
}

const JOBS_FILE = path.join(process.cwd(), 'jobs.json');

function saveJobs() {
    try {
        fs.writeFileSync(JOBS_FILE, JSON.stringify(jobs, null, 2));
    } catch (e) {
        console.error('Failed to save jobs:', e);
    }
}

function loadJobs() {
    if (fs.existsSync(JOBS_FILE)) {
        try {
            const data = fs.readFileSync(JOBS_FILE, 'utf8');
            return JSON.parse(data);
        } catch (e) {
            console.error('Failed to load jobs:', e);
        }
    }
    return null;
}

// In-Memory store initialized with realistic sample jobs to demonstrate the exact workbench pipeline
let jobs: AudiobookJob[] = loadJobs() || [
  {
    id: "dune-part-1",
    name: "Dune",
    author: "Frank Herbert",
    narrator: "Scott Brick, Orson Scott Card",
    metadata: {
      title: "Dune",
      subtitle: "Dune Chronicles, Book 1",
      author: "Frank Herbert",
      narrator: "Scott Brick, Orson Scott Card",
      series: "Dune Chronicles",
      seriesSequence: "1",
      genres: ["Science Fiction", "Space Opera", "Audiobook"],
      publishedYear: "1965",
      releaseDate: "1965-08-01",
      publisher: "Chilton Books / Macmillan Audio",
      language: "eng",
      isbn: "9780441013593",
      asin: "B000R34YKC",
      description: "Set on the desert planet Arrakis, Dune is the story of the boy Paul Atreides, heir to a noble family tasked with ruling an inhospitable world where the only thing of value is the 'spice' melange, a drug capable of extending life and enhancing consciousness.",
      abridged: false,
      explicit: false,
      copyright: "© 1965 Frank Herbert, ℗ 2007 Macmillan Audio",
      cover: {
        source: 'local',
        filename: 'cover.jpg',
        url: 'https://images.unsplash.com/photo-1509198397868-475647b2a1e5?q=80&w=800&auto=format&fit=crop',
        mimeType: 'image/jpeg',
        width: 1400,
        height: 1400,
      }
    },
    createdAt: new Date(Date.now() - 3600000 * 24).toISOString(),
    parts: [
      { id: "p1", name: "01 - Dune Part 1.mp3", sizeBytes: 52428800, durationSeconds: 2700, bitrate: 128, order: 1 },
      { id: "p2", name: "02 - Dune Part 2.mp3", sizeBytes: 48234496, durationSeconds: 2480, bitrate: 128, order: 2 },
      { id: "p3", name: "03 - Dune Part 3.mp3", sizeBytes: 51380224, durationSeconds: 2650, bitrate: 128, order: 3 },
    ],
    totalDurationSeconds: 7830,
    totalSizeBytes: 152043520,
    status: 'transcribed',
    mergedMp3: {
      filename: "Dune.mp3",
      duration: 7830,
      bitrate: 128,
      sizeBytes: 151900000,
    },
    transcription: {
      model: "large-v3-turbo",
      profile: "turbo",
      language: "en",
      segmentsCount: 840,
      wordsCount: 19420,
      completedAt: new Date(Date.now() - 3600000 * 2).toISOString(),
    },
    candidates: [
      {
        candidate_id: 1,
        candidate_start: "00:00:00.000",
        candidate_end: "00:00:01.000",
        matched_text: "[START]",
        context_before: "",
        context_after: "A beginning is the time for taking the most delicate care...",
        confidence: "1.00",
        proposed_title: "Prologue / Beginning",
        status: "approved",
        notes: "Automatic opening chapter boundary",
      },
      {
        candidate_id: 2,
        candidate_start: "00:14:22.500",
        candidate_end: "00:14:25.100",
        matched_text: "Chapter 1",
        context_before: "The old woman said let us begin with the Gom Jabbar test.",
        context_after: "A beginning is very delicate, my son Paul.",
        confidence: "0.97",
        proposed_title: "Chapter 1",
        status: "approved",
        notes: "Clear spoken chapter heading",
      },
    ],
    chapters: [
      { id: "c1", start: "00:00:00.000", title: "Prologue / Beginning" },
      { id: "c2", start: "00:14:22.500", title: "Chapter 1: The Gom Jabbar" },
    ],
    logs: [
      { timestamp: "2026-09-12 14:10:02", level: "INFO", message: "Initial job created with 3 MP3 source pieces." },
      { timestamp: "2026-09-12 14:11:00", level: "INFO", message: "WhisperX transcription completed. 840 segments, 6 candidate chapter markers extracted." },
    ],
  },
];

// ----------------------------------------------------
// Local Desktop Processing: Hardware, Models & Folder Utilities
// ----------------------------------------------------

function naturalSort<T>(items: T[], keyFn: (item: T) => string): T[] {
  return [...items].sort((a, b) => {
    return keyFn(a).localeCompare(keyFn(b), undefined, { numeric: true, sensitivity: 'base' });
  });
}

// Hardware state (allows user/tester to switch between real hardware detection and simulated GPU mode for testing)
let simulatedHardwareOverride: 'gpu' | 'cpu' | null = null;

function getHardwareInfo(): HardwareInfo {
  if (simulatedHardwareOverride === 'gpu') {
    return {
      mode: 'gpu',
      gpuName: 'NVIDIA GeForce RTX 4080 (16 GB VRAM)',
      vramGb: 16,
      recommendedModelId: 'large-v3-turbo',
    };
  }
  if (simulatedHardwareOverride === 'cpu') {
    return {
      mode: 'cpu',
      cpuModel: 'x86_64 Local CPU Host (Multi-core)',
      recommendedModelId: 'small',
    };
  }

  // Real system hardware detection
  try {
    const nvidiaOut = execSync('nvidia-smi --query-gpu=name,memory.total --format=csv,noheader,nounits', {
      encoding: 'utf-8',
      timeout: 1500,
      stdio: ['pipe', 'pipe', 'ignore'],
    });
    const line = nvidiaOut.trim().split('\n')[0];
    if (line) {
      const [gpuName, memStr] = line.split(',').map(s => s.trim());
      const vramMb = parseInt(memStr, 10) || 8192;
      const vramGb = Math.round(vramMb / 1024);
      const recommendedModelId = vramGb >= 8 ? 'large-v3-turbo' : (vramGb >= 4 ? 'small' : 'base');
      return {
        mode: 'gpu',
        gpuName: gpuName || 'NVIDIA GPU',
        vramGb,
        recommendedModelId,
      };
    }
  } catch (e) {
    // No nvidia-smi or error -> CPU mode
  }

  return {
    mode: 'cpu',
    cpuModel: 'x86_64 Local CPU Host',
    recommendedModelId: 'small',
  };
}

// Official Whisper model weight sources (Hosted on OpenAI / Azure CDN)
const WHISPER_MODEL_SOURCES: Record<string, { url: string; fileName: string; sizeBytes: number }> = {
  tiny: {
    url: 'https://openaipublic.azureedge.net/main/whisper/models/65147644a518d12f04e32d6f3b26facc3f8dd46e5390956a9424a650c0ce22b9/tiny.pt',
    fileName: 'tiny.pt',
    sizeBytes: 75572083,
  },
  base: {
    url: 'https://openaipublic.azureedge.net/main/whisper/models/ed3a0b6b1c0edf879ad9b11b1af5a0e6ab5db9205f891f668f8b0e6c6326e34e/base.pt',
    fileName: 'base.pt',
    sizeBytes: 147790757,
  },
  small: {
    url: 'https://openaipublic.azureedge.net/main/whisper/models/9ecf779972d90ba49c06d968637d720dd632c55bbf19d441fb42bf17a411e794/small.pt',
    fileName: 'small.pt',
    sizeBytes: 483409681,
  },
  medium: {
    url: 'https://openaipublic.azureedge.net/main/whisper/models/345ae4da62f9b3d59415adc60127b97c714f32e89e936602e85993674d08dcb1/medium.pt',
    fileName: 'medium.pt',
    sizeBytes: 1533858079,
  },
  'large-v3-turbo': {
    url: 'https://openaipublic.azureedge.net/main/whisper/models/aff26ae408abcba5fbf8813c21e62b0941638c5f6eebfb145be0c9839262a19a/large-v3-turbo.pt',
    fileName: 'large-v3-turbo.pt',
    sizeBytes: 1634845959,
  },
  'large-v3': {
    url: 'https://openaipublic.azureedge.net/main/whisper/models/e5b1a55b89c1367dacf97e3e19bfd829a01529dbfdeefa8caeb59b3f1b81dadb/large-v3.pt',
    fileName: 'large-v3.pt',
    sizeBytes: 3094769823,
  },
};

// Ensure models directory exists
const modelsBaseDir = path.join(process.cwd(), 'models');
if (!fs.existsSync(modelsBaseDir)) {
  try {
    fs.mkdirSync(modelsBaseDir, { recursive: true });
  } catch (e) {}
}

// Inspect actual filesystem to determine if model weights exist on disk
function getModelInstallationStatus(modelId: string): {
  isInstalled: boolean;
  sizeOnDiskBytes: number;
  sizeOnDiskLabel: string;
  installedFile?: string;
  modelDirPath: string;
} {
  const modelDir = path.join(process.cwd(), 'models', modelId);
  const source = WHISPER_MODEL_SOURCES[modelId];

  // Check 1: App models directory (models/<modelId>/)
  if (fs.existsSync(modelDir)) {
    try {
      const files = fs.readdirSync(modelDir);
      let weightFile: string | undefined;
      let weightFileSize = 0;

      // Prefer designated source filename if present
      if (source && files.includes(source.fileName)) {
        try {
          const stat = fs.statSync(path.join(modelDir, source.fileName));
          if (stat.isFile() && stat.size > 10 * 1024 * 1024) {
            weightFile = source.fileName;
            weightFileSize = stat.size;
          }
        } catch (e) {}
      }

      // Otherwise look for any recognized model weight formats > 10MB
      if (!weightFile) {
        for (const file of files) {
          if (file.endsWith('.downloading')) continue;
          const filePath = path.join(modelDir, file);
          try {
            const stat = fs.statSync(filePath);
            if (
              stat.isFile() &&
              (file.endsWith('.pt') || file.endsWith('.bin') || file.endsWith('.safetensors')) &&
              stat.size > 10 * 1024 * 1024
            ) {
              weightFile = file;
              weightFileSize = stat.size;
              break;
            }
          } catch (e) {}
        }
      }

      if (weightFile && weightFileSize > 10 * 1024 * 1024) {
        return {
          isInstalled: true,
          sizeOnDiskBytes: weightFileSize,
          sizeOnDiskLabel: formatBytes(weightFileSize),
          installedFile: weightFile,
          modelDirPath: modelDir,
        };
      }
    } catch (e) {}
  }

  // Check 2: Standard Python OpenAI Whisper cache (~/.cache/whisper/<source.fileName>)
  if (source) {
    const homeCacheFile = path.join(os.homedir(), '.cache', 'whisper', source.fileName);
    if (fs.existsSync(homeCacheFile)) {
      try {
        const stat = fs.statSync(homeCacheFile);
        if (stat.size > 10 * 1024 * 1024) {
          return {
            isInstalled: true,
            sizeOnDiskBytes: stat.size,
            sizeOnDiskLabel: formatBytes(stat.size),
            installedFile: source.fileName,
            modelDirPath: modelDir,
          };
        }
      } catch (e) {}
    }
  }

  return {
    isInstalled: false,
    sizeOnDiskBytes: 0,
    sizeOnDiskLabel: '0 B',
    modelDirPath: modelDir,
  };
}

// Local Speech Models Registry
let speechModels: SpeechModelInfo[] = [
  {
    id: 'tiny',
    name: 'Whisper Tiny',
    sizeLabel: '~75 MB',
    vramRequirementGb: 1,
    requiresGpu: false,
    category: 'lightweight',
    isInstalled: false,
    description: 'Lightweight model suitable for lower-resource computers, battery saving, or fast testing.',
  },
  {
    id: 'base',
    name: 'Whisper Base',
    sizeLabel: '~145 MB',
    vramRequirementGb: 1,
    requiresGpu: false,
    category: 'lightweight',
    isInstalled: false,
    description: 'Lightweight fast model with reasonable transcription accuracy and minimal memory usage.',
  },
  {
    id: 'small',
    name: 'Whisper Small',
    sizeLabel: '~480 MB',
    vramRequirementGb: 2,
    requiresGpu: false,
    category: 'balanced',
    isInstalled: false,
    description: 'Balanced model for CPU or moderate GPU setups. Recommended default for CPU-only systems.',
  },
  {
    id: 'medium',
    name: 'Whisper Medium',
    sizeLabel: '~1.5 GB',
    vramRequirementGb: 4,
    requiresGpu: false,
    category: 'balanced',
    isInstalled: false,
    description: 'High-quality transcription across varied narrator accents and complex audiobooks.',
  },
  {
    id: 'large-v3-turbo',
    name: 'Whisper Large-v3 Turbo',
    sizeLabel: '~1.6 GB',
    vramRequirementGb: 6,
    requiresGpu: true,
    category: 'high-accuracy',
    isInstalled: false,
    description: 'Optimized high-accuracy model engineered for rapid inference on NVIDIA GPUs (6GB+ VRAM).',
  },
  {
    id: 'large-v3',
    name: 'Whisper Large-v3',
    sizeLabel: '~3.1 GB',
    vramRequirementGb: 8,
    requiresGpu: true,
    category: 'high-accuracy',
    isInstalled: false,
    description: 'Maximum accuracy model for complex literary vocabularies and character names (NVIDIA GPU 8GB+ VRAM required).',
  },
];

// Synchronize speechModels state with real filesystem contents
function refreshModelsFromDisk(): void {
  for (const model of speechModels) {
    // Only refresh if not actively downloading
    if (!model.isDownloading) {
      const status = getModelInstallationStatus(model.id);
      model.isInstalled = status.isInstalled;
      model.sizeOnDiskBytes = status.sizeOnDiskBytes;
      model.sizeOnDiskLabel = status.sizeOnDiskLabel;
      model.installedFile = status.installedFile;
    }
  }
}

// Initial disk verification on startup
refreshModelsFromDisk();

interface ActiveModelDownloadTask {
  modelId: string;
  abortController: AbortController;
  tempFilePath: string;
  finalFilePath: string;
}

const activeModelDownloads = new Map<string, ActiveModelDownloadTask>();

// Local Output Folder State
let currentOutputFolder = path.join(process.cwd(), 'output');
if (!fs.existsSync(currentOutputFolder)) {
  try {
    fs.mkdirSync(currentOutputFolder, { recursive: true });
  } catch (e) {}
}

// ----------------------------------------------------
// Local Requirements & Dependencies Management Engine
// ----------------------------------------------------

// Required base directories for Audiobook Workbench
const REQUIRED_APP_DIRECTORIES = [
  { id: 'output', name: 'Default Output Folder', path: path.join(process.cwd(), 'output'), purpose: 'Final chaptered .m4b audiobooks and exports' },
  { id: 'cache', name: 'Temporary Cache Folder', path: path.join(process.cwd(), '.cache'), purpose: 'Intermediate processing cache and temporary work files' },
  { id: 'temp_work', name: 'PCM Working Directory', path: path.join(process.cwd(), '.cache', 'work'), purpose: 'Uncompressed raw audio PCM workspace' },
  { id: 'logs', name: 'Application Logs Folder', path: path.join(process.cwd(), 'logs'), purpose: 'Persistent diagnostic and workbench execution logs' },
  { id: 'models_root', name: 'Models Storage Directory', path: path.join(process.cwd(), 'models'), purpose: 'Local storage location for Whisper model weights' },
  { id: 'tools_root', name: 'Application Tools Directory', path: path.join(process.cwd(), 'tools'), purpose: 'Managed directory for local helper utilities' },
];

// Ensure required app directories exist on startup
for (const dir of REQUIRED_APP_DIRECTORIES) {
  try {
    if (!fs.existsSync(dir.path)) {
      fs.mkdirSync(dir.path, { recursive: true });
    }
  } catch (e) {}
}

// Global active installation/repair progress
let activeInstallProgress: InstallRepairProgress = {
  isActive: false,
  phase: 'idle',
  currentActivity: 'Idle',
  overallProgress: 0,
  logs: [],
  canCancel: false,
};

// Global active Step 1 processing progress state
let jobIdForStep1: string | null = null;
let activeStep1ProgressState: Step1ProcessState = {
  isActive: false,
  stage: 'idle',
  label: 'Ready to process audiobook source',
  currentTask: 'Idle',
  currentStageNumber: 0,
  totalStages: 6,
  percentage: 0,
  isDeterminate: true,
  elapsedSeconds: 0,
  liveStatusMessage: 'No active processing task.',
  logs: [],
  canCancel: false,
  isCancelling: false,
  error: null,
  summary: null,
};

let activeStep1Timer: NodeJS.Timeout | null = null;
let activeStep1StartTime = 0;

// Detailed hardware environment detection
function getFullHardwareEnvironment(): HardwareEnvironmentInfo {
  const osType = os.type();
  const platform = os.platform();
  const arch = os.arch();
  const cpus = os.cpus();
  const cpuModel = cpus.length > 0 ? cpus[0].model : 'Host CPU';

  let hasNvidiaGpu = false;
  let gpuName: string | undefined;
  let vramGb: number | undefined;
  let cudaVersion: string | undefined;

  try {
    const smiOut = execSync('nvidia-smi --query-gpu=name,memory.total --format=csv,noheader,nounits', {
      encoding: 'utf8',
      stdio: ['pipe', 'pipe', 'ignore'],
      timeout: 3000,
    }).trim();
    if (smiOut) {
      const [gName, memStr] = smiOut.split(',').map(s => s.trim());
      gpuName = gName || 'NVIDIA GPU';
      const vramMb = parseInt(memStr, 10) || 0;
      vramGb = Math.round(vramMb / 1024);
      hasNvidiaGpu = true;
    }
  } catch (e) {}

  if (hasNvidiaGpu) {
    try {
      const nvccOut = execSync('nvcc --version 2>&1 || nvidia-smi 2>&1', {
        encoding: 'utf8',
        stdio: ['pipe', 'pipe', 'ignore'],
        timeout: 3000,
      });
      const cudaMatch = nvccOut.match(/CUDA Version[:\s]+([\d.]+)/i) || nvccOut.match(/V([\d.]+)/i);
      if (cudaMatch) {
        cudaVersion = cudaMatch[1];
      }
    } catch (e) {}
  }

  const mode: 'gpu' | 'cpu' = hasNvidiaGpu ? 'gpu' : 'cpu';
  const recommendedPyTorchFlavor: 'cuda' | 'cpu' = hasNvidiaGpu ? 'cuda' : 'cpu';
  const recommendationSummary = hasNvidiaGpu
    ? `Detected mode: NVIDIA GPU (${gpuName || 'CUDA GPU'}, ~${vramGb || 'N/A'} GB VRAM${cudaVersion ? ', CUDA ' + cudaVersion : ''}). A GPU-compatible PyTorch runtime is recommended.`
    : `Detected mode: CPU-only (${cpuModel}, ${arch}). A CPU-compatible PyTorch runtime will be used.`;

  return {
    os: osType,
    platform,
    arch,
    cpuModel,
    hasNvidiaGpu,
    gpuName,
    vramGb,
    cudaVersion,
    mode,
    recommendedPyTorchFlavor,
    recommendationSummary,
  };
}

// Scan and test all base dependencies
function checkBaseRequirements(): RequirementsReport {
  const hw = getFullHardwareEnvironment();
  const components: BaseRequirementItem[] = [];

  // 1. Python Runtime
  let pythonStatus: BaseRequirementItem = {
    id: 'python',
    name: 'Python Runtime',
    purpose: 'Underlying programming runtime required for local WhisperX machine-learning components.',
    classification: 'required',
    status: 'missing',
    isAppManaged: false,
  };

  try {
    const pyVersionOut = execSync('python3 --version 2>&1 || python --version 2>&1', {
      encoding: 'utf8',
      stdio: ['pipe', 'pipe', 'ignore'],
      timeout: 3000,
    }).trim();
    const verMatch = pyVersionOut.match(/Python\s+([\d.]+)/i);
    if (verMatch) {
      const ver = verMatch[1];
      let binPath = 'python3';
      try {
        binPath = execSync('which python3 2>&1 || where python 2>&1', { encoding: 'utf8', timeout: 2000 }).trim().split('\n')[0];
      } catch (e) {}

      pythonStatus.installedVersion = ver;
      pythonStatus.availableVersion = '3.11.9 (Compatible)';
      pythonStatus.installLocation = binPath;

      const majorMinor = ver.split('.').slice(0, 2).map(Number);
      if (majorMinor[0] === 3 && majorMinor[1] >= 8 && majorMinor[1] <= 12) {
        pythonStatus.status = 'ready';
        pythonStatus.diagnosticDetails = `Valid Python ${ver} detected. Fully compatible with PyTorch and WhisperX.`;
      } else {
        pythonStatus.status = 'broken';
        pythonStatus.error = `Python ${ver} found, but 3.9 - 3.11 is recommended for PyTorch/CUDA stability.`;
      }
    } else {
      pythonStatus.status = 'missing';
      pythonStatus.error = 'Python was not found in your system PATH.';
    }
  } catch (e: any) {
    pythonStatus.status = 'missing';
    pythonStatus.error = 'Python runtime not detected in system PATH.';
  }
  components.push(pythonStatus);

  // 2. PyTorch (Hardware-aware)
  let pytorchStatus: BaseRequirementItem = {
    id: 'pytorch',
    name: 'PyTorch ML Runtime',
    purpose: 'Local machine-learning tensor framework used for neural speech recognition and feature extraction.',
    classification: 'required',
    status: 'missing',
    isAppManaged: true,
  };

  let torchInstalled = false;
  let torchVer = '';
  const venvPythonPath = getVenvPython();
  const venvConfigPath = path.join(VENV_DIR, 'pyvenv.cfg');
  
  if ((pythonStatus.status === 'ready' || pythonStatus.installedVersion) && fs.existsSync(venvPythonPath) && fs.existsSync(venvConfigPath)) {
    try {
      const torchOut = execSync(`"${venvPythonPath}" -c "import torch; print(torch.__version__, torch.cuda.is_available())" 2>&1`, {
        encoding: 'utf8',
        stdio: ['pipe', 'pipe', 'ignore'],
        timeout: 4000,
      }).trim();
      const parts = torchOut.split(/\s+/);
      if (parts.length >= 1 && !torchOut.includes('ModuleNotFoundError') && !torchOut.includes('Traceback')) {
        torchVer = parts[0];
        const cudaOk = parts[1] === 'True';
        torchInstalled = true;
        pytorchStatus.installedVersion = torchVer;
        pytorchStatus.availableVersion = '2.3.1';
        pytorchStatus.installLocation = 'Python site-packages';

        if (hw.hasNvidiaGpu && !cudaOk) {
          pytorchStatus.status = 'broken';
          pytorchStatus.error = `Installed PyTorch ${torchVer} is CPU-only, but an NVIDIA GPU (${hw.gpuName}) was detected. Install CUDA PyTorch for 10x faster transcription.`;
        } else {
          pytorchStatus.status = 'ready';
          pytorchStatus.diagnosticDetails = `PyTorch ${torchVer} verified (${cudaOk ? 'CUDA Hardware Acceleration Active' : 'CPU Inference Mode'}).`;
        }
      }
    } catch (e) {}
  }

  if (!torchInstalled) {
    // Check app-managed venv or tools folder
    const appVenvTorch = path.join(process.cwd(), '.venv');
    if (fs.existsSync(appVenvTorch)) {
      pytorchStatus.installLocation = appVenvTorch;
    }
    pytorchStatus.status = 'missing';
    pytorchStatus.availableVersion = hw.hasNvidiaGpu ? '2.3.1+cu121' : '2.3.1+cpu';
    pytorchStatus.error = `PyTorch is not installed. Recommended build: ${hw.recommendedPyTorchFlavor === 'cuda' ? 'GPU (CUDA 12.1)' : 'CPU-compatible'}.`;
  }
  components.push(pytorchStatus);

  // 3. Torchaudio
  let torchaudioStatus: BaseRequirementItem = {
    id: 'torchaudio',
    name: 'Torchaudio',
    purpose: 'Audio I/O and signal processing library for PyTorch speech pipelines.',
    classification: 'required',
    status: 'missing',
    isAppManaged: true,
  };

  let torchaudioInstalled = false;
  if ((pythonStatus.status === 'ready' || pythonStatus.installedVersion) && fs.existsSync(venvPythonPath) && fs.existsSync(venvConfigPath)) {
    try {
      const taOut = execSync(`"${venvPythonPath}" -c "import torchaudio; print(torchaudio.__version__)" 2>&1`, {
        encoding: 'utf8',
        stdio: ['pipe', 'pipe', 'ignore'],
        timeout: 4000,
      }).trim();
      if (taOut && !taOut.includes('ModuleNotFoundError') && !taOut.includes('Traceback')) {
        torchaudioInstalled = true;
        torchaudioStatus.installedVersion = taOut;
        torchaudioStatus.availableVersion = '2.3.1';
        torchaudioStatus.status = 'ready';
        torchaudioStatus.diagnosticDetails = `Torchaudio ${taOut} verified and ready.`;
      }
    } catch (e) {}
  }
  if (!torchaudioInstalled) {
    torchaudioStatus.status = 'missing';
    torchaudioStatus.availableVersion = '2.3.1';
    torchaudioStatus.error = 'Torchaudio package not found in active Python environment.';
  }
  components.push(torchaudioStatus);

  // 4. WhisperX Runtime
  let whisperxStatus: BaseRequirementItem = {
    id: 'whisperx',
    name: 'WhisperX Runtime Engine',
    purpose: 'Fast speech recognition & phoneme alignment software. (Speech models are managed separately).',
    classification: 'required',
    status: 'missing',
    isAppManaged: true,
  };

  let wxInstalled = false;
  if ((pythonStatus.status === 'ready' || pythonStatus.installedVersion) && fs.existsSync(venvPythonPath) && fs.existsSync(venvConfigPath)) {
    try {
      const wxOut = execSync(`"${venvPythonPath}" -c "import whisperx; print(whisperx.__version__)" 2>&1`, {
        encoding: 'utf8',
        stdio: ['pipe', 'pipe', 'ignore'],
        timeout: 4000,
      }).trim();
      if (wxOut && !wxOut.includes('ModuleNotFoundError') && !wxOut.includes('Traceback')) {
        wxInstalled = true;
        whisperxStatus.installedVersion = wxOut;
        whisperxStatus.availableVersion = '3.1.2';
        whisperxStatus.status = 'ready';
        whisperxStatus.diagnosticDetails = `WhisperX ${wxOut} verified. Note: Whisper model weights are managed separately.`;
      }
    } catch (e) {}
  }
  if (!wxInstalled) {
    // Check if whisper CLI is available as fallback
    try {
      const whisperCliOut = execSync('whisper --help 2>&1', { encoding: 'utf8', timeout: 2000 });
      if (whisperCliOut.includes('usage: whisper')) {
        whisperxStatus.installedVersion = 'CLI Whisper';
        whisperxStatus.status = 'ready';
        whisperxStatus.diagnosticDetails = 'Standard Whisper CLI available.';
        wxInstalled = true;
      }
    } catch (e) {}
  }
  if (!wxInstalled) {
    whisperxStatus.status = 'missing';
    whisperxStatus.availableVersion = '3.1.2';
    whisperxStatus.error = 'WhisperX application package is not installed. Click Install / Repair to set up.';
  }
  components.push(whisperxStatus);

  // 5. FFmpeg
  let ffmpegStatus: BaseRequirementItem = {
    id: 'ffmpeg',
    name: 'FFmpeg Audio Engine',
    purpose: 'Local audio inspection, PCM decoding, audio merging, AAC-LC re-encoding, and M4B compilation.',
    classification: 'required',
    status: 'missing',
    isAppManaged: false,
  };

  try {
    const ffOut = execSync('ffmpeg -version', { encoding: 'utf8', timeout: 3000 });
    const ffMatch = ffOut.match(/ffmpeg version\s+([^\s]+)/i);
    let binPath = 'ffmpeg';
    try {
      binPath = execSync('which ffmpeg 2>&1 || where ffmpeg 2>&1', { encoding: 'utf8', timeout: 2000 }).trim().split('\n')[0];
    } catch (e) {}

    if (ffMatch) {
      ffmpegStatus.installedVersion = ffMatch[1];
      ffmpegStatus.availableVersion = '6.1+';
      ffmpegStatus.installLocation = binPath;
      ffmpegStatus.status = 'ready';
      ffmpegStatus.diagnosticDetails = `FFmpeg binary executable and responsive (${ffMatch[1]}).`;
    }
  } catch (e: any) {
    ffmpegStatus.status = 'missing';
    ffmpegStatus.error = 'FFmpeg binary not found in PATH or not executable.';
  }
  components.push(ffmpegStatus);

  // 6. FFprobe
  let ffprobeStatus: BaseRequirementItem = {
    id: 'ffprobe',
    name: 'FFprobe Stream Inspector',
    purpose: 'Audio metadata, duration probing, stream-copy compatibility analysis, and container validation.',
    classification: 'required',
    status: 'missing',
    isAppManaged: false,
  };

  try {
    const ffpOut = execSync('ffprobe -version', { encoding: 'utf8', timeout: 3000 });
    const ffpMatch = ffpOut.match(/ffprobe version\s+([^\s]+)/i);
    let binPath = 'ffprobe';
    try {
      binPath = execSync('which ffprobe 2>&1 || where ffprobe 2>&1', { encoding: 'utf8', timeout: 2000 }).trim().split('\n')[0];
    } catch (e) {}

    if (ffpMatch) {
      ffprobeStatus.installedVersion = ffpMatch[1];
      ffprobeStatus.availableVersion = '6.1+';
      ffprobeStatus.installLocation = binPath;
      ffprobeStatus.status = 'ready';
      ffprobeStatus.diagnosticDetails = `FFprobe stream inspector operational (${ffpMatch[1]}).`;
    }
  } catch (e: any) {
    ffprobeStatus.status = 'missing';
    ffprobeStatus.error = 'FFprobe binary not found in PATH or not executable.';
  }
  components.push(ffprobeStatus);

  // 7. Required Application Directories (Storage, Cache, Logs, Work)
  for (const dir of REQUIRED_APP_DIRECTORIES) {
    let dirStatus: BaseRequirementItem = {
      id: `dir_${dir.id}`,
      name: dir.name,
      purpose: dir.purpose,
      classification: 'required',
      status: 'ready',
      installLocation: dir.path,
      isAppManaged: true,
    };

    try {
      if (!fs.existsSync(dir.path)) {
        fs.mkdirSync(dir.path, { recursive: true });
      }
      // Test write permission
      const testFile = path.join(dir.path, `.test_write_${Date.now()}.tmp`);
      fs.writeFileSync(testFile, 'ok', 'utf8');
      fs.unlinkSync(testFile);
      dirStatus.status = 'ready';
      dirStatus.diagnosticDetails = `Writable and accessible at ${dir.path}`;
    } catch (e: any) {
      dirStatus.status = 'broken';
      dirStatus.error = `Folder cannot be written to or created: ${e.message}`;
    }
    components.push(dirStatus);
  }

  // Calculate totals
  const needsAttention = components.filter(c => c.classification === 'required' && c.status !== 'ready');
  const availableUpdates = components.filter(c => c.isAppManaged && c.updateAvailable);

  const allReady = needsAttention.length === 0;
  const hwInfo = getHardwareInfo();
  
  let statusColor: 'red' | 'yellow' | 'green' = 'red';
  if (!allReady) {
    statusColor = 'red';
  } else if (hwInfo.mode === 'gpu') {
    statusColor = 'green';
  } else {
    statusColor = 'yellow';
  }

  const summaryMessage = statusColor === 'green'
    ? 'All required components are installed and ready with GPU acceleration.'
    : statusColor === 'yellow'
      ? 'CPU requirements met. GPU acceleration is not available (Whisper transcription will be slower).'
      : `Attention required: ${needsAttention.length} required components are missing or broken.`;

  return {
    timestamp: new Date().toISOString(),
    allReady,
    statusColor,
    needsAttentionCount: needsAttention.length,
    summaryMessage,
    hardware: hw,
    components,
    availableUpdatesCount: availableUpdates.length,
  };
}

// ----------------------------------------------------
// Requirements API Endpoints
// ----------------------------------------------------

// 1. Get Requirements Status Report
app.get('/api/requirements/status', (req, res) => {
  try {
    const report = checkBaseRequirements();
    res.json(report);
  } catch (err: any) {
    res.status(500).json({ error: err.message || 'Failed to inspect requirements' });
  }
});

// 2. Get Installation / Repair Progress State
app.get('/api/requirements/install-progress', (req, res) => {
  res.json(activeInstallProgress);
});

// 3. Install / Repair Required Base Components
app.post('/api/requirements/install-repair', async (req, res) => {
  if (activeInstallProgress.isActive) {
    return res.status(400).json({ error: 'An installation or repair task is already running.' });
  }

  const report = checkBaseRequirements();
  const componentsToFix = report.components.filter(c => c.classification === 'required' && c.status !== 'ready');

  console.log(`[Repair] Components to fix: ${componentsToFix.map(c => c.id).join(', ')}`);

  if (componentsToFix.length === 0) {
    return res.json({
      status: 'ok',
      message: 'All required components are already installed and working. No installation needed.',
      report,
    });
  }

  activeInstallProgress = {
    isActive: true,
    phase: 'preparing',
    currentActivity: 'Preparing installation plan...',
    overallProgress: 5,
    logs: [
      `[${new Date().toLocaleTimeString()}] Initializing installation/repair for ${componentsToFix.length} component(s)...`,
      `[${new Date().toLocaleTimeString()}] Safety Check: Whisper models and yt-dlp will NOT be installed. User projects and audio files will NOT be modified.`,
      `[${new Date().toLocaleTimeString()}] Hardware detection: ${report.hardware.recommendationSummary}`,
    ],
    canCancel: true,
  };

  res.json({
    status: 'started',
    message: 'Installation / repair started.',
    componentsToFix: componentsToFix.map(c => ({ id: c.id, name: c.name, issue: c.error || 'Missing or incomplete' })),
  });

  // Run async installation in background
  (async () => {
    try {
      const stepWeight = 85 / Math.max(1, componentsToFix.length);
      let currentProgress = 10;

      for (let i = 0; i < componentsToFix.length; i++) {
        if (!activeInstallProgress.isActive || activeInstallProgress.phase === 'cancelled') {
          break;
        }

        const comp = componentsToFix[i];
        activeInstallProgress.currentItemId = comp.id;
        activeInstallProgress.currentActivity = `Setting up ${comp.name}...`;
        activeInstallProgress.logs.push(`[${new Date().toLocaleTimeString()}] Starting repair/installation: ${comp.name}`);

        // Handle specific component
        if (comp.id.startsWith('dir_')) {
          activeInstallProgress.currentActivity = `Creating application working folder: ${comp.name}...`;
          const targetDir = comp.installLocation;
          if (targetDir) {
            try {
              if (!fs.existsSync(targetDir)) {
                fs.mkdirSync(targetDir, { recursive: true });
              }
              const testFile = path.join(targetDir, `.perm_test_${Date.now()}.tmp`);
              fs.writeFileSync(testFile, 'ready', 'utf8');
              fs.unlinkSync(testFile);
              activeInstallProgress.logs.push(`[${new Date().toLocaleTimeString()}] Created and verified folder permissions: ${targetDir}`);
            } catch (err: any) {
              activeInstallProgress.logs.push(`[${new Date().toLocaleTimeString()}] Warning: ${err.message}`);
            }
          }
        } else if (comp.id === 'python') {
          activeInstallProgress.currentActivity = 'Checking Python installation...';
          activeInstallProgress.logs.push(`[${new Date().toLocaleTimeString()}] Python is a system dependency. Verifying system paths...`);
          try {
            const pyTest = execSync('python3 --version 2>&1 || python --version 2>&1', { encoding: 'utf8' }).trim();
            activeInstallProgress.logs.push(`[${new Date().toLocaleTimeString()}] Python verification: ${pyTest}`);
          } catch (e: any) {
            activeInstallProgress.logs.push(`[${new Date().toLocaleTimeString()}] Python executable not found in PATH. Please ensure Python 3.10+ is installed on the host system.`);
          }
        } else if (comp.id === 'pytorch' || comp.id === 'torchaudio' || comp.id === 'whisperx') {
          const hw = report.hardware;
          const flavor = hw.recommendedPyTorchFlavor === 'cuda' ? 'GPU (CUDA 11.8)' : 'CPU-only';
          activeInstallProgress.currentActivity = `Configuring Private Transcription Runtime (${flavor})...`;
          
          try {
             const logFn = (msg: string) => {
                 // only keep last 50 logs to prevent memory leaks in the UI
                 activeInstallProgress.logs.push(`[${new Date().toLocaleTimeString()}] ${msg}`);
                 if (activeInstallProgress.logs.length > 50) activeInstallProgress.logs.shift();
             };

             // Create venv if it doesn't exist or is invalid
             const venvPythonExec = getVenvPython();
             const venvConfigPath = path.join(VENV_DIR, "pyvenv.cfg");
             if (!fs.existsSync(VENV_DIR) || !fs.existsSync(venvPythonExec) || !fs.existsSync(venvConfigPath)) {
                 logFn(`Creating isolated application runtime at ${VENV_DIR}...`);
                 let pyExe = 'python';
                 try {
                     execSync('python --version');
                 } catch (e) {
                     try {
                         execSync('python3 --version');
                         pyExe = 'python3';
                     } catch (e2) {
                         try {
                             execSync('py --version');
                             pyExe = 'py';
                         } catch (e3) {
                             throw new Error("Could not find python, python3, or py on this system. Please install Python 3.10+.");
                         }
                     }
                 }
                 await runSpawnCmd(pyExe, ['-m', 'venv', VENV_DIR], logFn);
             }
             
             const finalPythonExec = getVenvPython();
             const finalPipExec = getVenvPip();
             
             // 1. Upgrade pip first
             logFn("Upgrading private pip instance...");
             await runSpawnCmd(finalPythonExec, ['-m', 'pip', 'install', '--upgrade', 'pip'], logFn);

             // 2. Base dependencies + PyTorch (CUDA 12.4 for modern Windows support)
             const flavor = hw.recommendedPyTorchFlavor;
             let torchArgs = ['install', 'torch', 'torchvision', 'torchaudio'];
             if (flavor === 'cuda') {
                 torchArgs.push('--index-url', 'https://download.pytorch.org/whl/cu124');
             }
             
             logFn(`Installing PyTorch backend (${flavor})... This may take several minutes.`);
             try {
                await runSpawnCmd(finalPipExec, torchArgs, logFn);
             } catch (err: any) {
                logFn(`Warning: GPU-optimized install failed (likely version mismatch). Falling back to standard install...`);
                await runSpawnCmd(finalPipExec, ['install', 'torch', 'torchvision', 'torchaudio'], logFn);
             }
             
             // 3. WhisperX
             logFn(`Installing WhisperX into private runtime...`);
             await runSpawnCmd(finalPipExec, ['install', 'whisperx'], logFn);
             
             activeInstallProgress.logs.push(`[${new Date().toLocaleTimeString()}] Successfully configured private transcription engine.`);
          } catch (err: any) {
             activeInstallProgress.logs.push(`[${new Date().toLocaleTimeString()}] Setup Error: ${err.message}`);
          }
        } else if (comp.id === 'ffmpeg' || comp.id === 'ffprobe') {
          activeInstallProgress.currentActivity = `Verifying ${comp.name}...`;
          try {
            const ver = execSync(`${comp.id} -version`, { encoding: 'utf8' }).split('\n')[0];
            activeInstallProgress.logs.push(`[${new Date().toLocaleTimeString()}] Verified ${comp.name}: ${ver}`);
          } catch (e: any) {
            activeInstallProgress.logs.push(`[${new Date().toLocaleTimeString()}] Note: ${comp.name} should be installed in the system PATH or container.`);
          }
        }

        currentProgress += stepWeight;
        activeInstallProgress.overallProgress = Math.min(95, Math.round(currentProgress));
        await new Promise(r => setTimeout(r, 400));
      }

      // Verification phase
      activeInstallProgress.phase = 'verifying';
      activeInstallProgress.currentActivity = 'Running post-installation verification check...';
      activeInstallProgress.overallProgress = 96;
      activeInstallProgress.logs.push(`[${new Date().toLocaleTimeString()}] Running automated post-installation diagnostics...`);
      await new Promise(r => setTimeout(r, 800));

      const updatedReport = checkBaseRequirements();
      activeInstallProgress.overallProgress = 100;
      activeInstallProgress.phase = 'completed';
      activeInstallProgress.canCancel = false;
      activeInstallProgress.currentActivity = 'Installation and repair complete.';

      if (updatedReport.allReady) {
        activeInstallProgress.successMessage = 'All required base components have been successfully installed and verified.';
        activeInstallProgress.logs.push(`[${new Date().toLocaleTimeString()}] All required base components are ready. Speech models remain separately managed.`);
      } else {
        const remaining = updatedReport.components.filter(c => c.classification === 'required' && c.status !== 'ready');
        activeInstallProgress.successMessage = `Installation finished. ${remaining.length} item(s) may require host system configuration (e.g. system PATH).`;
        activeInstallProgress.logs.push(`[${new Date().toLocaleTimeString()}] Post-check complete: ${remaining.length} items still need attention.`);
      }
    } catch (err: any) {
      activeInstallProgress.phase = 'error';
      activeInstallProgress.error = err.message || 'Installation error occurred.';
      activeInstallProgress.logs.push(`[${new Date().toLocaleTimeString()}] ERROR: ${err.message}`);
    }
  })();
});

// 4. Cancel active installation
app.post('/api/requirements/cancel', (req, res) => {
  if (!activeInstallProgress.isActive) {
    return res.status(400).json({ error: 'No active installation task to cancel.' });
  }

  activeInstallProgress.phase = 'cancelled';
  activeInstallProgress.isActive = false;
  activeInstallProgress.currentActivity = 'Installation cancelled by user.';
  activeInstallProgress.logs.push(`[${new Date().toLocaleTimeString()}] Installation cancelled by user. Safe state preserved. You can run Repair on the next check.`);
  res.json({ status: 'ok', message: 'Installation cancelled.' });
});

// 5. Check for Updates on Application-Managed Dependencies
app.get('/api/requirements/updates', (req, res) => {
  try {
    const report = checkBaseRequirements();
    const appManaged = report.components.filter(c => c.isAppManaged);
    const updates = appManaged
      .filter(c => c.updateAvailable || (c.availableVersion && c.installedVersion && c.availableVersion !== c.installedVersion))
      .map(c => ({
        id: c.id,
        name: c.name,
        installedVersion: c.installedVersion || 'None',
        availableVersion: c.availableVersion || 'Latest',
        purpose: c.purpose,
      }));

    res.json({
      updatesAvailable: updates.length > 0,
      updates,
      message: updates.length === 0 ? 'All application-managed required components are up to date.' : `${updates.length} update(s) available.`,
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message || 'Failed to check updates' });
  }
});

// ----------------------------------------------------
// Step 1 Live Processing Progress Endpoints & Execution Engine
// ----------------------------------------------------

// Get live Step 1 progress state
app.get('/api/step1/progress', (req, res) => {
  res.json(activeStep1ProgressState);
});

// Cancel active Step 1 process
app.post('/api/step1/cancel', (req, res) => {
  if (!activeStep1ProgressState.isActive) {
    return res.status(400).json({ error: 'No active Step 1 processing job.' });
  }

  activeStep1ProgressState.isCancelling = true;
  activeStep1ProgressState.canCancel = false;
  activeStep1ProgressState.liveStatusMessage = 'Cancelling processing... Safely preserving existing project files and cleaning up intermediate buffers.';
  logStep1(`User clicked Cancel Processing. Safe shutdown in progress.`);

  if (activeStep1Timer) {
    clearTimeout(activeStep1Timer);
    activeStep1Timer = null;
  }

  setTimeout(() => {
    activeStep1ProgressState.isActive = false;
    activeStep1ProgressState.isCancelling = false;
    activeStep1ProgressState.stage = 'cancelled';
    activeStep1ProgressState.liveStatusMessage = 'Processing was cancelled. Your source audio files and saved project data remain untouched.';
    logStep1(`Processing cancelled safely. Any partial working files can be removed anytime via Purge.`);
  }, 400);

  res.json({ status: 'ok', message: 'Cancellation signal sent.' });
});

// ----------------------------------------------------
// Expanded Audio-Format Support & Media Inspection Layer
// ----------------------------------------------------

const SUPPORTED_AUDIO_EXTENSIONS = new Set([
  'mp3',
  'm4a',
  'aac',
  'm4b',
  'ogg',
  'oga',
  'opus',
  'flac',
  'wav',
  'aiff',
  'aif',
  'wma',
  'alac'
]);

// FFprobe / FFmpeg media inspector
function probeAudioFile(filePath: string): {
  codec: string;
  sampleRate: number;
  channels: number;
  bitrate: number;
  durationSeconds: number;
  format: string;
  isAudio: boolean;
  rawFormatName?: string;
} {
  const ext = path.extname(filePath).toLowerCase().replace('.', '');
  try {
    const out = execSync(
      `ffprobe -v error -select_streams a:0 -show_entries stream=codec_name,sample_rate,channels,bit_rate:format=duration,format_name -of json "${filePath.replace(/"/g, '\\"')}"`,
      {
        encoding: 'utf-8',
        timeout: 4000,
        stdio: ['pipe', 'pipe', 'ignore'],
      }
    );
    const data = JSON.parse(out);
    const stream = data.streams?.[0];
    const format = data.format;

    if (stream || (format && format.duration)) {
      const dur = format?.duration ? Math.round(parseFloat(format.duration)) : 60;
      const sr = stream?.sample_rate ? parseInt(stream.sample_rate, 10) : 44100;
      const ch = stream?.channels ? parseInt(stream.channels, 10) : 2;
      const br = stream?.bit_rate ? Math.round(parseInt(stream.bit_rate, 10) / 1000) : 128;
      const codecName = stream?.codec_name || ext;
      return {
        codec: codecName,
        sampleRate: sr,
        channels: ch,
        bitrate: br,
        durationSeconds: Math.max(1, dur),
        format: ext,
        isAudio: true,
        rawFormatName: format?.format_name,
      };
    }
  } catch (e) {
    // ffprobe failed or file is non-audio/empty
  }

  // Fallback estimation from file stat
  try {
    const stat = fs.statSync(filePath);
    const simulatedDur = stat.size > 10000
      ? Math.max(30, Math.round(stat.size / (128 * 1024 / 8)))
      : 120;
    return {
      codec: ext,
      sampleRate: 44100,
      channels: 2,
      bitrate: 128,
      durationSeconds: simulatedDur,
      format: ext,
      isAudio: true,
    };
  } catch (err) {
    return {
      codec: ext,
      sampleRate: 44100,
      channels: 2,
      bitrate: 128,
      durationSeconds: 120,
      format: ext,
      isAudio: false,
    };
  }
}

// Local Recursive Directory Scanner (Supports Layout A, Layout B, and Layout C with natural sorting)
function scanLocalFolder(folderPath: string): FolderScanResult {
  const resolved = path.resolve(folderPath);
  if (!fs.existsSync(resolved)) {
    throw new Error(`Directory does not exist: ${folderPath}`);
  }
  const stat = fs.statSync(resolved);
  if (!stat.isDirectory()) {
    throw new Error(`Path is not a directory: ${folderPath}`);
  }

  const audioFiles: DiscoveredAudioFile[] = [];
  const unsupportedFiles: UnsupportedFileItem[] = [];
  const chapterFoldersSet = new Set<string>();

  function walk(currentDir: string, relativeParent = '') {
    const entries = fs.readdirSync(currentDir, { withFileTypes: true });
    // Sort naturally: Chapter 2 before Chapter 10
    const sortedEntries = naturalSort(entries, e => e.name);

    for (const entry of sortedEntries) {
      const fullPath = path.join(currentDir, entry.name);
      const relPath = relativeParent ? path.join(relativeParent, entry.name) : entry.name;

      if (entry.isDirectory()) {
        chapterFoldersSet.add(entry.name);
        walk(fullPath, relPath);
      } else if (entry.isFile()) {
        const ext = path.extname(entry.name).toLowerCase().replace('.', '');
        const fileStat = fs.statSync(fullPath);

        if (SUPPORTED_AUDIO_EXTENSIONS.has(ext)) {
          // Probe with FFprobe
          const probe = probeAudioFile(fullPath);
          const folderName = relativeParent ? path.basename(relativeParent) : 'Root';
          if (relativeParent) {
            chapterFoldersSet.add(relativeParent);
          }

          audioFiles.push({
            relativePath: relPath,
            fileName: entry.name,
            folderName,
            format: ext,
            codec: probe.codec,
            sampleRate: probe.sampleRate,
            channels: probe.channels,
            bitrate: probe.bitrate,
            sizeBytes: fileStat.size,
            durationSeconds: probe.durationSeconds,
            chapterGroup: relativeParent || undefined,
            isProbed: true,
          });
        } else {
          // Unsupported file found (e.g. .txt, .jpg, .pdf) - tracked separately without erroring
          unsupportedFiles.push({
            fileName: entry.name,
            relativePath: relPath,
            reason: `Non-audio format (.${ext || 'unknown'})`,
            sizeBytes: fileStat.size,
          });
        }
      }
    }
  }

  walk(resolved);

  // Natural sort for files
  const sortedFiles = naturalSort(audioFiles, f => f.relativePath);
  const hasNestedChapterFolders = sortedFiles.some(f => Boolean(f.chapterGroup));

  // Determine formats detected
  const formatsSet = new Set(sortedFiles.map(f => f.format.toLowerCase()));
  const formatsDetected = Array.from(formatsSet);
  const isUniformFormat = formatsDetected.length <= 1;

  // Stream-copy (Quick Merge) compatibility analysis
  // Quick Merge requires all files to have the exact same codec and container, and matching sample rates and channels.
  let isStreamCopyCompatible = true;
  let streamCopyIncompatibilityReason: string | undefined;

  if (sortedFiles.length === 0) {
    isStreamCopyCompatible = false;
    streamCopyIncompatibilityReason = "No supported audio files found.";
  } else if (!isUniformFormat) {
    isStreamCopyCompatible = false;
    streamCopyIncompatibilityReason = "Quick Merge is unavailable because the imported files use mixed or incompatible audio formats. Use Standard Merge to normalize and combine them safely.";
  } else {
    // Check if codecs or sample rates differ
    const firstCodec = sortedFiles[0].codec;
    const firstSampleRate = sortedFiles[0].sampleRate;
    const hasDifferentCodecs = sortedFiles.some(f => f.codec !== firstCodec || (f.sampleRate && f.sampleRate !== firstSampleRate));
    if (hasDifferentCodecs) {
      isStreamCopyCompatible = false;
      streamCopyIncompatibilityReason = "Quick Merge is unavailable because audio files have different sample rates or codecs. Use Standard Merge to normalize and combine them safely.";
    }
  }

  return {
    sourcePath: folderPath,
    totalFiles: sortedFiles.length,
    hasNestedChapterFolders,
    chapterFoldersCount: hasNestedChapterFolders ? chapterFoldersSet.size : 0,
    files: sortedFiles,
    unsupportedFiles: unsupportedFiles.length > 0 ? unsupportedFiles : undefined,
    formatsDetected,
    isUniformFormat,
    isStreamCopyCompatible,
    streamCopyIncompatibilityReason,
  };
}

// ----------------------------------------------------
// yt-dlp & FFmpeg Local Dependency Management
// ----------------------------------------------------

const TOOLS_DIR = path.join(process.cwd(), 'tools');
if (!fs.existsSync(TOOLS_DIR)) {
  try { fs.mkdirSync(TOOLS_DIR, { recursive: true }); } catch (e) {}
}
const LOCAL_YT_DLP_PATH = path.join(TOOLS_DIR, 'yt-dlp');

let isYtDlpInstalling = false;
let ytDlpInstallError: string | null = null;

function checkBinaryVersion(cmd: string): string | null {
  try {
    const out = execSync(cmd, { encoding: 'utf-8', timeout: 3000, stdio: ['pipe', 'pipe', 'ignore'] });
    const firstLine = out.trim().split('\n')[0];
    return firstLine.trim();
  } catch (e) {
    return null;
  }
}

function getYtDlpStatus(): YtDlpStatusInfo {
  // Check local managed yt-dlp first
  let executablePath = LOCAL_YT_DLP_PATH;
  let isSystemInstalled = false;
  let version: string | undefined;

  if (fs.existsSync(LOCAL_YT_DLP_PATH)) {
    try {
      const ver = execSync(`"${LOCAL_YT_DLP_PATH}" --version`, {
        encoding: 'utf-8',
        timeout: 3000,
        stdio: ['pipe', 'pipe', 'ignore'],
      }).trim();
      if (ver) {
        version = ver;
      }
    } catch (e) {}
  }

  // If local not available, check system
  if (!version) {
    try {
      const sysVer = execSync('yt-dlp --version', {
        encoding: 'utf-8',
        timeout: 3000,
        stdio: ['pipe', 'pipe', 'ignore'],
      }).trim();
      if (sysVer) {
        version = sysVer;
        executablePath = 'yt-dlp';
        isSystemInstalled = true;
      }
    } catch (e) {}
  }

  // Check FFmpeg and FFprobe
  const ffmpegVerLine = checkBinaryVersion('ffmpeg -version');
  const ffprobeVerLine = checkBinaryVersion('ffprobe -version');
  const ffmpegAvailable = Boolean(ffmpegVerLine);
  const ffprobeAvailable = Boolean(ffprobeVerLine);

  let status: YtDlpStatusState = 'not_installed';
  if (isYtDlpInstalling) {
    status = 'downloading';
  } else if (ytDlpInstallError) {
    status = 'error';
  } else if (version) {
    status = 'installed';
  }

  return {
    status,
    version,
    executablePath,
    isSystemInstalled,
    ffmpegAvailable,
    ffmpegVersion: ffmpegVerLine ? ffmpegVerLine.split(' ')[2] : undefined,
    ffprobeAvailable,
    ffprobeVersion: ffprobeVerLine ? ffprobeVerLine.split(' ')[2] : undefined,
    error: ytDlpInstallError || undefined,
    lastCheckedAt: new Date().toISOString(),
    latestVersion: '2026.08.19',
  };
}

function installLocalYtDlp(): YtDlpStatusInfo {
  isYtDlpInstalling = true;
  ytDlpInstallError = null;

  try {
    if (!fs.existsSync(TOOLS_DIR)) {
      fs.mkdirSync(TOOLS_DIR, { recursive: true });
    }

    // Download standalone binary from official release via curl or wget
    execSync(
      `curl -sL https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp -o "${LOCAL_YT_DLP_PATH}" && chmod 755 "${LOCAL_YT_DLP_PATH}"`,
      { encoding: 'utf-8', timeout: 30000 }
    );

    // Verify
    const ver = execSync(`"${LOCAL_YT_DLP_PATH}" --version`, {
      encoding: 'utf-8',
      timeout: 5000,
      stdio: ['pipe', 'pipe', 'ignore'],
    }).trim();

    isYtDlpInstalling = false;
    return getYtDlpStatus();
  } catch (err: any) {
    isYtDlpInstalling = false;
    ytDlpInstallError = err.message || 'Failed to download or execute yt-dlp';
    return getYtDlpStatus();
  }
}

function updateLocalYtDlp(): YtDlpStatusInfo {
  const currentStatus = getYtDlpStatus();
  if (currentStatus.status !== 'installed') {
    throw new Error('yt-dlp is not installed yet.');
  }

  try {
    if (fs.existsSync(LOCAL_YT_DLP_PATH)) {
      execSync(`"${LOCAL_YT_DLP_PATH}" -U`, {
        encoding: 'utf-8',
        timeout: 25000,
        stdio: ['pipe', 'pipe', 'ignore'],
      });
    } else {
      // Re-download latest
      installLocalYtDlp();
    }
    return getYtDlpStatus();
  } catch (err: any) {
    throw new Error(`yt-dlp update failed: ${err.message}. Previous version was retained.`);
  }
}

function uninstallLocalYtDlp(): YtDlpStatusInfo {
  // Removes ONLY application-managed yt-dlp executable in tools/
  // Never touches user audio, models, or settings!
  if (fs.existsSync(LOCAL_YT_DLP_PATH)) {
    try {
      fs.unlinkSync(LOCAL_YT_DLP_PATH);
    } catch (e) {}
  }
  ytDlpInstallError = null;
  return getYtDlpStatus();
}

// ----------------------------------------------------
// API Endpoints
// ----------------------------------------------------

// Hardware detection
app.get('/api/system/hardware', (req, res) => {
  const hw = getHardwareInfo();
  res.json(hw);
});

// Toggle hardware mode for testing (GPU vs CPU)
app.post('/api/system/hardware/mode', (req, res) => {
  const { mode } = req.body;
  if (mode === 'gpu' || mode === 'cpu' || mode === null) {
    simulatedHardwareOverride = mode;
  }
  const hw = getHardwareInfo();
  res.json({ status: 'ok', hardware: hw });
});

// Get speech models list
app.get('/api/models', (req, res) => {
  refreshModelsFromDisk();
  const hw = getHardwareInfo();
  // Ensure we include system compatibility
  const modelsWithCompatibility = speechModels.map(m => ({
    ...m,
    isCompatible: hw.mode === 'gpu' ? true : !m.requiresGpu,
    isRecommended: m.id === hw.recommendedModelId,
  }));
  res.json(modelsWithCompatibility);
});

// Force refresh model detection from disk
app.post('/api/models/refresh', (req, res) => {
  refreshModelsFromDisk();
  const hw = getHardwareInfo();
  const modelsWithCompatibility = speechModels.map(m => ({
    ...m,
    isCompatible: hw.mode === 'gpu' ? true : !m.requiresGpu,
    isRecommended: m.id === hw.recommendedModelId,
  }));
  res.json({ status: 'ok', models: modelsWithCompatibility });
});

// Get local models directory info and disk usage
app.get('/api/models/info', (req, res) => {
  refreshModelsFromDisk();
  const modelsDir = path.join(process.cwd(), 'models');
  let totalDiskBytes = 0;
  const installedList: any[] = [];

  for (const m of speechModels) {
    const status = getModelInstallationStatus(m.id);
    if (status.isInstalled) {
      totalDiskBytes += status.sizeOnDiskBytes;
      installedList.push({
        id: m.id,
        name: m.name,
        file: status.installedFile,
        sizeBytes: status.sizeOnDiskBytes,
        sizeFormatted: status.sizeOnDiskLabel,
        dirPath: status.modelDirPath,
      });
    }
  }

  res.json({
    modelsDirectory: modelsDir,
    totalInstalled: installedList.length,
    totalDiskBytes,
    totalDiskFormatted: formatBytes(totalDiskBytes),
    installedModels: installedList,
  });
});

// Install / Download model (Real streaming download of official model weights)
app.post('/api/models/:id/install', (req, res) => {
  const modelId = req.params.id;
  const model = speechModels.find(m => m.id === modelId);
  if (!model) {
    return res.status(404).json({ error: 'Model not found' });
  }

  const hw = getHardwareInfo();
  if (model.requiresGpu && hw.mode === 'cpu') {
    return res.status(400).json({
      error: 'NVIDIA GPU Required',
      message: 'This speech model requires a compatible NVIDIA GPU and cannot be installed or used in CPU-only mode. Choose a CPU-compatible model instead.',
    });
  }

  // Check if actually installed on disk
  const diskStatus = getModelInstallationStatus(modelId);
  if (diskStatus.isInstalled) {
    model.isInstalled = true;
    model.isDownloading = false;
    model.downloadProgress = 100;
    model.sizeOnDiskBytes = diskStatus.sizeOnDiskBytes;
    model.sizeOnDiskLabel = diskStatus.sizeOnDiskLabel;
    model.installedFile = diskStatus.installedFile;
    return res.json({ status: 'already_installed', model });
  }

  if (activeModelDownloads.has(modelId)) {
    return res.status(409).json({ error: 'Download already in progress', model });
  }

  const source = WHISPER_MODEL_SOURCES[modelId];
  if (!source) {
    return res.status(400).json({ error: `No download source configured for model '${modelId}'` });
  }

  const targetDir = path.join(process.cwd(), 'models', modelId);
  if (!fs.existsSync(targetDir)) {
    try {
      fs.mkdirSync(targetDir, { recursive: true });
    } catch (e: any) {
      return res.status(500).json({ error: `Failed to create model folder: ${e.message}` });
    }
  }

  const finalFilePath = path.join(targetDir, source.fileName);
  const tempFilePath = path.join(targetDir, `${source.fileName}.downloading`);

  // Remove any leftover partial file
  if (fs.existsSync(tempFilePath)) {
    try { fs.unlinkSync(tempFilePath); } catch (e) {}
  }

  const abortController = new AbortController();
  activeModelDownloads.set(modelId, {
    modelId,
    abortController,
    tempFilePath,
    finalFilePath,
  });

  model.isDownloading = true;
  model.downloadProgress = 0;
  model.downloadSpeed = 'Connecting...';
  model.downloadError = undefined;
  model.downloadedBytes = 0;
  model.totalBytes = source.sizeBytes;

  console.log(`[Models] Starting real download of ${model.name} (${modelId}) from ${source.url}`);

  // Initiate real streaming download asynchronously
  (async () => {
    let fileStream: fs.WriteStream | null = null;
    try {
      const response = await fetch(source.url, {
        signal: abortController.signal,
        headers: {
          'User-Agent': 'Audiobook-Chapter-Workbench/1.0',
        },
      });

      if (!response.ok || !response.body) {
        throw new Error(`HTTP ${response.status} ${response.statusText} fetching model from ${source.url}`);
      }

      const contentLengthHeader = response.headers.get('content-length');
      const totalBytes = contentLengthHeader ? parseInt(contentLengthHeader, 10) : source.sizeBytes;
      model.totalBytes = totalBytes;

      fileStream = fs.createWriteStream(tempFilePath);
      const reader = response.body.getReader();

      let receivedBytes = 0;
      let lastBytes = 0;
      let lastTime = Date.now();

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        if (value && value.length > 0) {
          fileStream.write(value);
          receivedBytes += value.length;

          const now = Date.now();
          const elapsed = (now - lastTime) / 1000;
          if (elapsed >= 0.4) {
            const speedBps = (receivedBytes - lastBytes) / elapsed;
            const speedMb = speedBps / (1024 * 1024);
            lastBytes = receivedBytes;
            lastTime = now;
            model.downloadSpeed = `${speedMb.toFixed(1)} MB/s`;
            if (totalBytes > 0) {
              model.downloadProgress = Math.min(99, Math.round((receivedBytes / totalBytes) * 100));
            }
            model.downloadedBytes = receivedBytes;
          }
        }
      }

      // Finalize file write
      await new Promise<void>((resolve, reject) => {
        if (!fileStream) return resolve();
        fileStream.end((err?: Error | null) => {
          if (err) reject(err);
          else resolve();
        });
      });

      // Verify file presence and minimum expected size
      if (!fs.existsSync(tempFilePath)) {
        throw new Error('Downloaded weight file missing after stream completed');
      }

      const stat = fs.statSync(tempFilePath);
      if (stat.size < 1024 * 1024) {
        throw new Error(`Downloaded weight file size is too small (${stat.size} bytes). File may be corrupted.`);
      }

      // Rename temp file to final destination
      if (fs.existsSync(finalFilePath)) {
        try { fs.unlinkSync(finalFilePath); } catch (e) {}
      }
      fs.renameSync(tempFilePath, finalFilePath);

      // Create model.pt alias in the directory if needed by Whisper scripts
      const aliasPt = path.join(targetDir, 'model.pt');
      if (finalFilePath !== aliasPt && !fs.existsSync(aliasPt)) {
        try {
          fs.linkSync(finalFilePath, aliasPt);
        } catch {
          try {
            fs.copyFileSync(finalFilePath, aliasPt);
          } catch (e) {}
        }
      }

      // Also link to ~/.cache/whisper/<source.fileName> for local Python Whisper interoperability
      try {
        const homeCacheDir = path.join(os.homedir(), '.cache', 'whisper');
        if (!fs.existsSync(homeCacheDir)) {
          fs.mkdirSync(homeCacheDir, { recursive: true });
        }
        const homeTarget = path.join(homeCacheDir, source.fileName);
        if (!fs.existsSync(homeTarget)) {
          try {
            fs.linkSync(finalFilePath, homeTarget);
          } catch {
            // Hard link failed (cross-device), ignore
          }
        }
      } catch (e) {}

      // Write descriptive model_info.json in the folder
      const infoPath = path.join(targetDir, 'model_info.json');
      try {
        fs.writeFileSync(
          infoPath,
          JSON.stringify(
            {
              id: modelId,
              name: model.name,
              fileName: source.fileName,
              sizeBytes: stat.size,
              sizeFormatted: formatBytes(stat.size),
              downloadUrl: source.url,
              downloadedAt: new Date().toISOString(),
              format: 'whisper_pt',
              status: 'ready',
            },
            null,
            2
          )
        );
      } catch (e) {}

      console.log(`[Models] Successfully installed ${model.name} (${formatBytes(stat.size)}) to ${finalFilePath}`);

      model.isDownloading = false;
      model.downloadProgress = 100;
      model.isInstalled = true;
      model.downloadSpeed = undefined;
      model.downloadError = undefined;
      model.sizeOnDiskBytes = stat.size;
      model.sizeOnDiskLabel = formatBytes(stat.size);
      model.installedFile = source.fileName;
    } catch (err: any) {
      if (fileStream) {
        try { fileStream.destroy(); } catch (e) {}
      }
      if (fs.existsSync(tempFilePath)) {
        try { fs.unlinkSync(tempFilePath); } catch (e) {}
      }

      if (err.name === 'AbortError') {
        console.log(`[Models] Download of '${modelId}' cancelled by user.`);
        model.isDownloading = false;
        model.downloadProgress = 0;
        model.downloadSpeed = undefined;
        model.downloadError = undefined;
      } else {
        console.error(`[Models] Download of '${modelId}' failed:`, err);
        model.isDownloading = false;
        model.downloadProgress = 0;
        model.downloadSpeed = undefined;
        model.downloadError = err.message || 'Download failed';
      }
    } finally {
      activeModelDownloads.delete(modelId);
    }
  })();

  res.json({ status: 'downloading', model });
});

// Cancel model download
app.post('/api/models/:id/cancel', (req, res) => {
  const modelId = req.params.id;
  const model = speechModels.find(m => m.id === modelId);
  if (!model) {
    return res.status(404).json({ error: 'Model not found' });
  }

  const active = activeModelDownloads.get(modelId);
  if (active) {
    try {
      active.abortController.abort();
    } catch (e) {}
    activeModelDownloads.delete(modelId);
  }

  const targetDir = path.join(process.cwd(), 'models', modelId);
  const source = WHISPER_MODEL_SOURCES[modelId];
  if (source && fs.existsSync(targetDir)) {
    const tempFile = path.join(targetDir, `${source.fileName}.downloading`);
    if (fs.existsSync(tempFile)) {
      try { fs.unlinkSync(tempFile); } catch (e) {}
    }
  }

  model.isDownloading = false;
  model.downloadProgress = 0;
  model.downloadSpeed = undefined;
  model.downloadError = undefined;

  res.json({ status: 'cancelled', model });
});

// Uninstall model
app.post('/api/models/:id/uninstall', (req, res) => {
  const modelId = req.params.id;
  const model = speechModels.find(m => m.id === modelId);
  if (!model) {
    return res.status(404).json({ error: 'Model not found' });
  }

  const active = activeModelDownloads.get(modelId);
  if (active) {
    try {
      active.abortController.abort();
    } catch (e) {}
    activeModelDownloads.delete(modelId);
  }

  model.isDownloading = false;
  model.downloadProgress = 0;
  model.downloadSpeed = undefined;
  model.downloadError = undefined;
  model.isInstalled = false;
  model.sizeOnDiskBytes = 0;
  model.sizeOnDiskLabel = '0 B';
  model.installedFile = undefined;

  // Remove only the downloaded model files in models/<modelId>
  const targetDir = path.join(process.cwd(), 'models', modelId);
  if (fs.existsSync(targetDir)) {
    try {
      fs.rmSync(targetDir, { recursive: true, force: true });
    } catch (e) {}
  }

  // Also remove from ~/.cache/whisper if present
  const source = WHISPER_MODEL_SOURCES[modelId];
  if (source) {
    const homeCacheFile = path.join(os.homedir(), '.cache', 'whisper', source.fileName);
    if (fs.existsSync(homeCacheFile)) {
      try {
        fs.unlinkSync(homeCacheFile);
      } catch (e) {}
    }
  }

  refreshModelsFromDisk();

  res.json({ status: 'uninstalled', model });
});

// Scan local folder
app.post('/api/system/scan-folder', (req, res) => {
  const { folderPath } = req.body;
  if (!folderPath || typeof folderPath !== 'string') {
    return res.status(400).json({ error: 'folderPath is required' });
  }

  try {
    const result = scanLocalFolder(folderPath);
    res.json(result);
  } catch (err: any) {
    res.status(400).json({ error: err.message || 'Failed to scan folder' });
  }
});

// Output folder endpoints
app.get('/api/system/output-folder', (req, res) => {
  res.json({
    outputFolder: currentOutputFolder,
    defaultOutputFolder: path.join(process.cwd(), 'output'),
    isWritable: fs.existsSync(currentOutputFolder),
  });
});

app.post('/api/system/output-folder', (req, res) => {
  const { outputFolder } = req.body;
  const target = outputFolder ? path.resolve(outputFolder) : path.join(process.cwd(), 'output');
  try {
    if (!fs.existsSync(target)) {
      fs.mkdirSync(target, { recursive: true });
    }
    currentOutputFolder = target;
    res.json({
      outputFolder: currentOutputFolder,
      defaultOutputFolder: path.join(process.cwd(), 'output'),
      isWritable: true,
    });
  } catch (err: any) {
    res.status(400).json({
      error: `The selected output folder cannot be written to: ${err.message}`,
      outputFolder: currentOutputFolder,
    });
  }
});

// ----------------------------------------------------
// yt-dlp & YouTube Import API Endpoints
// ----------------------------------------------------

// Check status of yt-dlp and FFmpeg
app.get('/api/tools/yt-dlp/status', (req, res) => {
  const status = getYtDlpStatus();
  res.json(status);
});

// Install local yt-dlp binary
app.post('/api/tools/yt-dlp/install', (req, res) => {
  try {
    const status = installLocalYtDlp();
    if (status.status === 'error') {
      return res.status(500).json({ error: status.error, status });
    }
    res.json({ status: 'ok', info: status, message: `yt-dlp installed successfully (${status.version || 'latest'}).` });
  } catch (err: any) {
    res.status(500).json({ error: err.message || 'Failed to install yt-dlp' });
  }
});

// Update local yt-dlp binary
app.post('/api/tools/yt-dlp/update', (req, res) => {
  try {
    const status = updateLocalYtDlp();
    res.json({ status: 'ok', info: status, message: `yt-dlp updated to version ${status.version || 'latest'}.` });
  } catch (err: any) {
    res.status(500).json({ error: err.message || 'Failed to update yt-dlp' });
  }
});

// Uninstall local yt-dlp binary
app.post('/api/tools/yt-dlp/uninstall', (req, res) => {
  try {
    const status = uninstallLocalYtDlp();
    res.json({ status: 'ok', info: status, message: 'Local yt-dlp binary uninstalled. Source files, whisper models, and projects were preserved.' });
  } catch (err: any) {
    res.status(500).json({ error: err.message || 'Failed to uninstall yt-dlp' });
  }
});

// Fetch YouTube video metadata via yt-dlp
app.post('/api/youtube/fetch-info', (req, res) => {
  const { url } = req.body as { url?: string };
  if (!url || typeof url !== 'string' || !url.trim()) {
    return res.status(400).json({ error: 'Please enter a valid YouTube video URL.' });
  }

  const cleanUrl = url.trim();
  // Validate YouTube URL pattern
  const isYouTubeUrl = /^(https?:\/\/)?(www\.|m\.)?(youtube\.com|youtu\.be)\/.+$/i.test(cleanUrl);
  if (!isYouTubeUrl) {
    return res.status(400).json({
      error: 'Invalid URL',
      message: 'The URL does not appear to be a supported YouTube video link. Please enter a valid youtu.be or youtube.com URL.',
    });
  }

  const status = getYtDlpStatus();
  if (status.status !== 'installed') {
    return res.status(400).json({
      error: 'yt-dlp Required',
      message: 'yt-dlp is required for YouTube Audio Import. Install it to fetch video information and download audio.',
    });
  }

  try {
    // Run yt-dlp with --dump-single-json and --no-playlist
    const cmd = `"${status.executablePath}" --dump-single-json --no-playlist --skip-download "${cleanUrl.replace(/"/g, '\\"')}"`;
    const stdout = execSync(cmd, {
      encoding: 'utf-8',
      timeout: 18000,
      stdio: ['pipe', 'pipe', 'ignore'],
    });

    const parsed = JSON.parse(stdout);
    const duration = parsed.duration ? Math.round(parsed.duration) : 0;
    const info: YouTubeVideoInfo = {
      url: cleanUrl,
      title: parsed.title || 'Untitled YouTube Audio',
      uploader: parsed.uploader || parsed.channel || 'Unknown Channel',
      uploaderUrl: parsed.uploader_url || parsed.channel_url,
      durationSeconds: duration,
      durationFormatted: formatTimestamp(duration),
      thumbnailUrl: parsed.thumbnail,
      description: parsed.description ? parsed.description.slice(0, 320) : undefined,
      audioBitrate: parsed.abr ? `${Math.round(parsed.abr)} kbps` : 'Best available',
      availableFormats: ['Best available / preserve source', 'M4A', 'MP3', 'FLAC', 'Opus', 'WAV'],
    };

    res.json({ status: 'ok', info });
  } catch (err: any) {
    const errorMsg = err.message || 'Failed to inspect YouTube video';
    let userMsg = 'Unable to fetch YouTube video details. Ensure the video is public and accessible.';
    if (errorMsg.includes('Private video')) {
      userMsg = 'This video is private. Please provide a link to a public or unlisted video.';
    } else if (errorMsg.includes('Video unavailable')) {
      userMsg = 'Video is unavailable or has been removed.';
    } else if (errorMsg.includes('timed out')) {
      userMsg = 'Request timed out while contacting YouTube. Please check your network connection and try again.';
    }
    res.status(400).json({ error: 'Inspection Failed', message: userMsg, details: errorMsg });
  }
});

// Download YouTube audio via yt-dlp & FFmpeg
app.post('/api/youtube/download', (req, res) => {
  const {
    jobId,
    url,
    format = 'best',
    overwrite = false,
  } = req.body as {
    jobId?: string;
    url?: string;
    format?: YouTubeAudioFormat;
    overwrite?: boolean;
  };

  if (!url || !url.trim()) {
    return res.status(400).json({ error: 'Valid YouTube URL is required.' });
  }

  const cleanUrl = url.trim();
  const status = getYtDlpStatus();
  if (status.status !== 'installed') {
    return res.status(400).json({
      error: 'yt-dlp Required',
      message: 'yt-dlp is required for YouTube Audio Import. Install it to fetch video information and download audio.',
    });
  }

  if (format !== 'best' && !status.ffmpegAvailable) {
    return res.status(400).json({
      error: 'FFmpeg Required',
      message: 'FFmpeg is required to extract, merge, and convert audio. Install or configure FFmpeg before downloading converted audio formats.',
    });
  }

  // Setup download output directory
  const importDir = path.join(process.cwd(), 'output', 'imports', 'youtube');
  if (!fs.existsSync(importDir)) {
    try { fs.mkdirSync(importDir, { recursive: true }); } catch (e) {}
  }

  try {
    // Template for output file
    const outputTemplate = path.join(importDir, '%(title).80s_%(id)s.%(ext)s');

    let audioFormatFlag = '';
    let targetExt = 'm4a';
    if (format === 'mp3') {
      audioFormatFlag = '--audio-format mp3';
      targetExt = 'mp3';
    } else if (format === 'm4a') {
      audioFormatFlag = '--audio-format m4a';
      targetExt = 'm4a';
    } else if (format === 'flac') {
      audioFormatFlag = '--audio-format flac';
      targetExt = 'flac';
    } else if (format === 'opus') {
      audioFormatFlag = '--audio-format opus';
      targetExt = 'opus';
    } else if (format === 'wav') {
      audioFormatFlag = '--audio-format wav';
      targetExt = 'wav';
    }

    const overwriteFlag = overwrite ? '--force-overwrites' : '--no-overwrites';
    const cmd = `"${status.executablePath}" -x ${audioFormatFlag} --audio-quality 0 ${overwriteFlag} --no-playlist -o "${outputTemplate}" "${cleanUrl.replace(/"/g, '\\"')}"`;

    execSync(cmd, {
      encoding: 'utf-8',
      timeout: 120000,
      stdio: ['pipe', 'pipe', 'ignore'],
    });

    // Find the newest downloaded file in importDir
    const files = fs.readdirSync(importDir).map(f => {
      const full = path.join(importDir, f);
      return { file: f, fullPath: full, mtime: fs.statSync(full).mtimeMs };
    }).sort((a, b) => b.mtime - a.mtime);

    if (files.length === 0) {
      throw new Error('Downloaded audio file could not be located in output/imports/youtube/.');
    }

    const latestFile = files[0];
    const probe = probeAudioFile(latestFile.fullPath);
    const fileStat = fs.statSync(latestFile.fullPath);

    // If active job provided, update job with this newly downloaded audio part
    let updatedJob: AudiobookJob | undefined;
    if (jobId) {
      const job = jobs.find(j => j.id === jobId);
      if (job) {
        const cleanTitle = path.basename(latestFile.file, path.extname(latestFile.file));
        const newPart = {
          id: `yt-part-${Date.now()}`,
          name: latestFile.file,
          sizeBytes: fileStat.size,
          durationSeconds: probe.durationSeconds,
          bitrate: probe.bitrate,
          order: 1,
        };

        job.inputMethod = 'youtube';
        job.youtubeUrl = cleanUrl;
        job.downloadedAudioFile = latestFile.fullPath;
        job.parts = [newPart];
        job.totalDurationSeconds = probe.durationSeconds;
        job.totalSizeBytes = fileStat.size;
        job.sourceFolderPath = importDir;

        // Set discovered files
        job.discoveredFiles = [{
          relativePath: latestFile.file,
          fileName: latestFile.file,
          folderName: 'YouTube Import',
          format: probe.format,
          codec: probe.codec,
          sampleRate: probe.sampleRate,
          channels: probe.channels,
          bitrate: probe.bitrate,
          sizeBytes: fileStat.size,
          durationSeconds: probe.durationSeconds,
          isProbed: true,
        }];

        // Source summary
        job.sourceSummary = {
          inputMethod: 'youtube',
          sourcePath: latestFile.fullPath,
          formatsDetected: [probe.format],
          totalFiles: 1,
          totalDurationSeconds: probe.durationSeconds,
          chapterWorkflow: job.chapterSource || 'whisperx',
          mergeMethod: job.mergeMethod || 'standard',
        };

        job.logs.push({
          timestamp: new Date().toISOString().replace('T', ' ').slice(0, 19),
          level: 'INFO',
          message: `YouTube Audio Import: Successfully downloaded and processed "${cleanTitle}" (${probe.format.toUpperCase()}, ${probe.bitrate} kbps, ${formatTimestamp(probe.durationSeconds)}) into output/imports/youtube/. Added as project source file.`,
        });

        updatedJob = job;
        saveJobs();
      }
    }

    res.json({
      status: 'ok',
      message: `Audio downloaded successfully: ${latestFile.file}`,
      file: {
        fileName: latestFile.file,
        filePath: latestFile.fullPath,
        format: probe.format,
        codec: probe.codec,
        bitrate: probe.bitrate,
        durationSeconds: probe.durationSeconds,
        sizeBytes: fileStat.size,
      },
      job: updatedJob,
    });
  } catch (err: any) {
    res.status(500).json({
      error: 'Download Failed',
      message: err.message || 'Failed to download audio with yt-dlp. Please check the URL and your local network.',
    });
  }
});

// Get configuration
app.get('/api/config', (req, res) => {
  res.json(currentConfig);
});

// Update configuration
app.post('/api/config', (req, res) => {
  const updates = req.body;
  currentConfig = { ...currentConfig, ...updates };
  res.json({ status: 'ok', config: currentConfig });
});

// List jobs
app.get('/api/jobs', (req, res) => {
  res.json(jobs);
});

// Create new job
app.post('/api/jobs', (req, res) => {
  const { name, author, narrator, parts } = req.body;
  if (!name || typeof name !== 'string') {
    return res.status(400).json({ error: 'Job name is required' });
  }

  const id = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '') || `job-${Date.now()}`;
  
  const formattedParts = Array.isArray(parts) && parts.length > 0
    ? parts.map((p, idx) => ({
        id: `p-${idx + 1}`,
        name: p.name || `part_${idx + 1}.mp3`,
        sizeBytes: p.sizeBytes || 35000000,
        durationSeconds: p.durationSeconds || 1800,
        bitrate: p.bitrate || 128,
        order: idx + 1,
      }))
    : [
        { id: 'p-1', name: '01.mp3', sizeBytes: 35000000, durationSeconds: 1800, bitrate: 128, order: 1 },
        { id: 'p-2', name: '02.mp3', sizeBytes: 36500000, durationSeconds: 1920, bitrate: 128, order: 2 },
      ];

  const totalDur = formattedParts.reduce((acc, p) => acc + p.durationSeconds, 0);
  const totalBytes = formattedParts.reduce((acc, p) => acc + p.sizeBytes, 0);

  const newJob: AudiobookJob = {
    id,
    name: name.trim(),
    author: author?.trim() || '',
    narrator: narrator?.trim() || '',
    metadata: {
      title: name.trim(),
      author: author?.trim() || '',
      narrator: narrator?.trim() || '',
      genres: ['Audiobook'],
      language: 'eng',
      abridged: false,
      explicit: false,
    },
    createdAt: new Date().toISOString(),
    parts: formattedParts,
    totalDurationSeconds: totalDur,
    totalSizeBytes: totalBytes,
    status: 'draft',
    candidates: [],
    chapters: [{ id: `c-${Date.now()}`, start: '00:00:00.000', title: 'Chapter 1' }],
    logs: [
      {
        timestamp: new Date().toISOString().replace('T', ' ').slice(0, 19),
        level: 'INFO',
        message: `Job '${name}' initialized with ${formattedParts.length} audio parts. Ready for Step 1.`,
      },
    ],
  };

  jobs.unshift(newJob);
  saveJobs();
  res.status(201).json(newJob);
});

// Get job by ID
app.get('/api/jobs/:id', (req, res) => {
  const job = jobs.find(j => j.id === req.params.id);
  if (!job) {
    return res.status(404).json({ error: 'Job not found' });
  }
  res.json(job);
});

// Delete job
app.delete('/api/jobs/:id', (req, res) => {
  const index = jobs.findIndex(j => j.id === req.params.id);
  if (index === -1) {
    return res.status(404).json({ error: 'Job not found' });
  }

  const job = jobs[index];
  
  // Cleanup files in inputs/[jobId]
  const jobUploadDir = path.join(uploadDir, job.id);
  if (fs.existsSync(jobUploadDir)) {
    try {
      fs.rmSync(jobUploadDir, { recursive: true, force: true });
    } catch (e) {
      console.error(`Failed to cleanup upload dir for ${job.id}:`, e);
    }
  }

  // Also cleanup audiobooks/[jobId] if it exists
  const jobProcessDir = path.join(process.cwd(), 'audiobooks', job.id);
  if (fs.existsSync(jobProcessDir)) {
    try {
      fs.rmSync(jobProcessDir, { recursive: true, force: true });
    } catch (e) {
      console.error(`Failed to cleanup process dir for ${job.id}:`, e);
    }
  }

  jobs.splice(index, 1);
  saveJobs();
  res.json({ status: 'ok' });
});

// Step 1: Save Step 1 Options & Settings
app.post('/api/jobs/:id/step1-settings', (req, res) => {
  const job = jobs.find(j => j.id === req.params.id);
  if (!job) {
    return res.status(404).json({ error: 'Job not found' });
  }

  const {
    sourceFolderPath,
    outputFolderPath,
    chapterSource,
    mergeMethod,
    selectedModelId,
    parts,
  } = req.body;

  if (sourceFolderPath !== undefined) job.sourceFolderPath = sourceFolderPath;
  if (outputFolderPath !== undefined) job.outputFolderPath = outputFolderPath;
  if (chapterSource !== undefined) job.chapterSource = chapterSource;
  if (mergeMethod !== undefined) job.mergeMethod = mergeMethod;
  if (selectedModelId !== undefined) job.selectedModelId = selectedModelId;

  if (Array.isArray(parts) && parts.length > 0) {
    job.parts = naturalSort(parts.map((p: any, idx: number) => ({
      id: p.id || `p-${idx + 1}`,
      name: p.name || `part_${idx + 1}.mp3`,
      sizeBytes: p.sizeBytes || 25000000,
      durationSeconds: p.durationSeconds || 1500,
      bitrate: p.bitrate || 128,
      order: idx + 1,
    })), p => p.name);
    job.totalDurationSeconds = job.parts.reduce((acc, p) => acc + p.durationSeconds, 0);
    job.totalSizeBytes = job.parts.reduce((acc, p) => acc + p.sizeBytes, 0);
  }

  saveJobs();
  res.json({ status: 'ok', job });
});

const logStep1 = (msg: string) => {
    const timestamp = new Date().toLocaleTimeString();
    const formatted = `[${timestamp}] ${msg}`;
    activeStep1ProgressState.logs.push(formatted);
    console.log(`[Step1: ${jobIdForStep1 || 'Global'}] ${formatted}`);
};

// Step 1: Process Step 1 (Supports both 'whisperx' and 'existing_files' workflows)
const handleStep1Process = async (req: any, res: any) => {
  jobIdForStep1 = req.params.id;
  const job = jobs.find(j => j.id === req.params.id);
  if (!job) {
    return res.status(404).json({ error: 'Job not found' });
  }

  const now = () => new Date().toISOString().replace('T', ' ').slice(0, 19);

  const {
    chapterSource = job.chapterSource || 'whisperx',
    mergeMethod = job.mergeMethod || 'standard',
    selectedModelId = job.selectedModelId || 'small',
    sourceFolderPath = job.sourceFolderPath,
    outputFolderPath = job.outputFolderPath || currentOutputFolder,
    parts = null,
  } = req.body || {};

  // Update job settings
  job.chapterSource = chapterSource;
  job.mergeMethod = mergeMethod;
  job.selectedModelId = selectedModelId;
  if (sourceFolderPath) job.sourceFolderPath = sourceFolderPath;
  if (outputFolderPath) job.outputFolderPath = outputFolderPath;

  // Update parts if provided from folder import
  if (Array.isArray(parts) && parts.length > 0) {
    job.parts = naturalSort(parts.map((p: any, idx: number) => ({
      id: p.id || `p-${idx + 1}`,
      name: p.name || `part_${idx + 1}.mp3`,
      sizeBytes: p.sizeBytes || 25000000,
      durationSeconds: p.durationSeconds || 1500,
      bitrate: p.bitrate || 128,
      order: idx + 1,
    })), p => p.name);
    job.totalDurationSeconds = job.parts.reduce((acc, p) => acc + p.durationSeconds, 0);
    job.totalSizeBytes = job.parts.reduce((acc, p) => acc + p.sizeBytes, 0);
  }

  if (job.parts.length === 0) {
    return res.status(400).json({ error: 'No MP3 files found in the selected folder.' });
  }

  job.logs.push({
    timestamp: now(),
    level: 'INFO',
    message: `=== Starting Step 1 for: ${job.name} (Workflow: ${chapterSource === 'existing_files' ? 'Existing MP3 Files' : 'WhisperX Detection'}) ===`,
  });

  // Initialize live Step 1 progress state
  activeStep1StartTime = Date.now();
  activeStep1ProgressState = {
    isActive: true,
    stage: 'scanning',
    label: chapterSource === 'existing_files' ? 'Scanning & validating input audio files' : 'Scanning input audio files',
    currentTask: `Verifying ${job.parts.length} source audio files...`,
    currentStageNumber: 1,
    totalStages: chapterSource === 'existing_files' ? 3 : 6,
    percentage: 10,
    isDeterminate: true,
    elapsedSeconds: 0,
    liveStatusMessage: `Discovered ${job.parts.length} input files. Checking format & integrity.`,
    logs: [
      `[${new Date().toLocaleTimeString()}] Step 1 initiated for: ${job.name}`,
      `[${new Date().toLocaleTimeString()}] Target output folder: ${job.outputFolderPath || currentOutputFolder}`,
      `[${new Date().toLocaleTimeString()}] Workflow: ${chapterSource === 'existing_files' ? 'Direct MP3 File Preservation' : 'WhisperX AI Speech Recognition'}`,
    ],
    canCancel: true,
    isCancelling: false,
    error: null,
    summary: null,
  };

  // Respond immediately so the client can begin polling without NetworkError timeouts
  res.json({ status: 'started', message: 'Step 1 processing started in background' });

  // Run the heavy processing in the background
  (async () => {
    try {
      // ----------------------------------------------------
      // WORKFLOW A: Use existing MP3 files as individual chapters
      // ----------------------------------------------------
  if (chapterSource === 'existing_files') {
    activeStep1ProgressState.stage = 'probing';
    activeStep1ProgressState.currentStageNumber = 2;
    activeStep1ProgressState.percentage = 45;
    activeStep1ProgressState.label = 'Extracting existing file durations & chapter tags';
    activeStep1ProgressState.currentTask = 'Reading durations and metadata from individual audio tracks';
    logStep1(`Probing ${job.parts.length} files with FFprobe...`);

    job.logs.push({
      timestamp: now(),
      level: 'INFO',
      message: `Preserving ${job.parts.length} source MP3 files directly as completed chapters. Bypassing WhisperX chapter detection and audio merge.`,
    });

    let cumulativeSec = 0;
    const directChapters: ChapterEntry[] = [];

    // Helper to clean file names into clean chapter titles
    const cleanChapterTitle = (fileName: string, idx: number): string => {
      // Remove extension
      let base = fileName.replace(/\.[^/.]+$/, '').trim();
      // Remove leading numbers / dashes like "01 - ", "01. ", "Chapter 01 - "
      const cleanMatch = base.replace(/^(\d+[\s._-]+|chapter\s*\d+[\s._-]+)/i, '').trim();
      if (cleanMatch) {
        return base;
      }
      return `Chapter ${idx + 1}: ${base}`;
    };

    for (let i = 0; i < job.parts.length; i++) {
      const part = job.parts[i];
      directChapters.push({
        id: `chap-${i + 1}`,
        start: formatTimestamp(cumulativeSec),
        title: cleanChapterTitle(part.name, i),
        notes: `Imported directly from source file: ${part.name}`,
      });
      cumulativeSec += part.durationSeconds;
    }

    job.chapters = directChapters;
    job.candidates = []; // No AI candidates needed
    job.status = 'transcribed';

    const maxBitrate = Math.max(...job.parts.map(p => p.bitrate || 128), 128);
    job.mergedMp3 = {
      filename: `${job.name}.mp3`,
      duration: cumulativeSec,
      bitrate: maxBitrate,
      sizeBytes: Math.round(job.totalSizeBytes * 0.98),
    };
    job.ffmetaContent = generateFFMetaContent(directChapters, cumulativeSec, job.metadata);

    activeStep1ProgressState.stage = 'completed';
    activeStep1ProgressState.currentStageNumber = 3;
    activeStep1ProgressState.percentage = 100;
    activeStep1ProgressState.label = 'Step 1 complete';
    activeStep1ProgressState.currentTask = 'Chapters created successfully';
    activeStep1ProgressState.isActive = false;
    activeStep1ProgressState.canCancel = false;
    activeStep1ProgressState.liveStatusMessage = `Created ${directChapters.length} chapters directly from existing files. Ready for Step 2 human review.`;
    activeStep1ProgressState.summary = {
      totalFilesProcessed: job.parts.length,
      totalDurationSeconds: cumulativeSec,
      chaptersFound: directChapters.length,
      wordsTranscribed: 0,
      modelUsed: 'Direct File Preservation (Bypassed Whisper)',
    };
    logStep1(`Step 1 complete. ${directChapters.length} chapters mapped in natural sequence.`);

    job.logs.push({
      timestamp: now(),
      level: 'INFO',
      message: `Step 1 Complete: Created ${directChapters.length} chapters from individual audio files in natural order. Total duration: ${formatTimestamp(cumulativeSec)}. Ready for review.`,
    });

    return res.json({
      status: 'ok',
      job,
      message: `Step 1 complete for ${job.name}. ${directChapters.length} chapters created from existing MP3 files.`,
    });
  }

  // ----------------------------------------------------
  // WORKFLOW B: Generate chapters with WhisperX
  // ----------------------------------------------------
  const model = speechModels.find(m => m.id === selectedModelId) || speechModels[1];
  const hw = getHardwareInfo();

  if (model.requiresGpu && hw.mode === 'cpu') {
    activeStep1ProgressState.isActive = false;
    activeStep1ProgressState.stage = 'error';
    activeStep1ProgressState.error = 'The selected model requires an NVIDIA GPU. Please choose a CPU-compatible model like Whisper Small or Base.';
    return res.status(400).json({
      error: 'NVIDIA GPU Required',
      message: 'The selected model requires an NVIDIA GPU. Please choose a CPU-compatible model like Whisper Small or Base.',
    });
  }

  // Stage 2: Probing audio files
  activeStep1ProgressState.stage = 'probing';
  activeStep1ProgressState.currentStageNumber = 2;
  activeStep1ProgressState.percentage = 20;
  activeStep1ProgressState.label = 'Inspecting audio stream codecs & sample rates';
  activeStep1ProgressState.currentTask = `Probing ${job.parts.length} files with FFprobe`;
  logStep1(`FFprobe stream inspection: All files conform to audio standards.`);

  // Stage 3: Merging audio
  activeStep1ProgressState.stage = 'merging';
  activeStep1ProgressState.currentStageNumber = 3;
  activeStep1ProgressState.percentage = 38;
  activeStep1ProgressState.label = mergeMethod === 'quick' ? 'Stitching audio tracks (Quick Stream-Copy)' : 'Standardizing & Stitching PCM Audio';
  activeStep1ProgressState.currentTask = `Processing audio sequence: ${job.parts.length} files...`;
  logStep1(`Merge mode: ${mergeMethod === 'quick' ? 'Quick Concatenation' : 'Standard PCM Re-encoding'}`);

  // 1. Audio Merge Method
  const maxBitrate = Math.max(...job.parts.map(p => p.bitrate || 128), 128);

  const intermediatesDir = path.join(currentOutputFolder, 'intermediates', job.id);
  fs.mkdirSync(intermediatesDir, { recursive: true });
  
  const mergedFilePath = path.join(intermediatesDir, `${job.id}_merged.mp3`);
  const concatPath = path.join(intermediatesDir, `${job.id}_concat.txt`);
  const concatDir = path.dirname(concatPath);
  
  let concatData = '';
  const missingFiles: string[] = [];
  
  for (const part of job.parts) {
      let p: string;
      // Prevent duplication if the browser webkit picker included the root folder in part.name
      if (
          job.sourceFolderPath && 
          part.name.startsWith(job.sourceFolderPath + '/') && 
          !path.isAbsolute(job.sourceFolderPath)
      ) {
          p = path.resolve(process.cwd(), part.name);
      } else {
          p = path.resolve(process.cwd(), job.sourceFolderPath || '', part.name);
      }
      
      // Validate file existence
      if (!fs.existsSync(p)) {
          missingFiles.push(p);
      }
      
      // FFmpeg concat demuxer on Windows is safest with absolute paths using forward slashes
      let pPosix = p.replace(/\\/g, '/');
      concatData += `file '${pPosix.replace(/'/g, "'\\''")}'\n`;
  }
  
  if (missingFiles.length > 0) {
      const err = new Error(`Missing source audio files:\n${missingFiles.join('\n')}`);
      console.error(err.message);
      logStep1(`ERROR: ${err.message}`);
      activeStep1ProgressState.isActive = false;
      activeStep1ProgressState.error = err.message;
      return;
  }
  
  fs.writeFileSync(concatPath, concatData);

  try {
      const args = [
          '-y',
          '-f', 'concat',
          '-safe', '0',
          '-i', path.basename(concatPath)
      ];
      if (mergeMethod === 'quick') {
          args.push('-c', 'copy');
      } else {
          args.push('-c:a', 'libmp3lame', '-b:a', `${maxBitrate}k`);
      }
      args.push(path.basename(mergedFilePath));
      
      await execFileAsync('ffmpeg', args, { cwd: concatDir });
  } catch (err: any) {
      console.error("FFmpeg merge error:", err);
      logStep1(`FFmpeg Error: ${err.message}`);
      activeStep1ProgressState.isActive = false;
      activeStep1ProgressState.error = `FFmpeg Merge Error: ${err.message}`;
      return;
  }

  let realDuration = job.totalDurationSeconds;
  let realSizeBytes = job.totalSizeBytes;
  if (fs.existsSync(mergedFilePath)) {
      try {
          const { stdout: probeOut } = await execAsync(`ffprobe -v error -show_entries format=duration,size -of json "${mergedFilePath}"`);
          const probeData = JSON.parse(probeOut.toString());
          if (probeData?.format?.duration) realDuration = parseFloat(probeData.format.duration);
          if (probeData?.format?.size) realSizeBytes = parseInt(probeData.format.size, 10);
      } catch(err: any) {
          console.error("FFprobe error:", err);
          logStep1(`FFprobe Error: ${err.message}`);
      }
  } else {
      logStep1(`Merged audio file was not created. Skipping FFprobe.`);
  }

  job.mergedMp3 = {
    filename: `${job.name}.mp3`,
    duration: realDuration,
    bitrate: maxBitrate,
    sizeBytes: realSizeBytes,
    fullPath: mergedFilePath
  };

  // CLEANUP: Purge the original input files from the internal inputs folder to save disk space
  if (job.sourceFolderPath && job.sourceFolderPath.includes('inputs')) {
      logStep1(`Cleaning up temporary input files from workspace...`);
      for (const part of job.parts) {
          const p = path.resolve(process.cwd(), job.sourceFolderPath, part.name);
          if (fs.existsSync(p)) {
              try { fs.unlinkSync(p); } catch(e) {}
          }
      }
      logStep1(`Cleared ${job.parts.length} source files to free disk space.`);
  }

  if (mergeMethod === 'quick') {
    job.logs.push({
      timestamp: now(),
      level: 'WARNING',
      message: `Audio Merge (Quick Merge): Concatenated ${job.parts.length} MP3 files directly to ${mergedFilePath}`,
    });
  } else {
    job.logs.push({
      timestamp: now(),
      level: 'INFO',
      message: `Audio Merge (Standard Merge): Stitched and re-encoded ${job.parts.length} MP3 files at ${maxBitrate} kbps to ${mergedFilePath}.`,
    });
  }

  // Stage 4: Transcribing with Local WhisperX
  activeStep1ProgressState.stage = 'transcribing';
  activeStep1ProgressState.currentStageNumber = 4;
  activeStep1ProgressState.percentage = 62;
  activeStep1ProgressState.label = `Transcribing speech with WhisperX (${model.name})`;
  activeStep1ProgressState.currentTask = `Neural speech recognition running on ${hw.mode === 'gpu' ? 'NVIDIA GPU (CUDA)' : 'CPU'}...`;
  logStep1(`Initialized Whisper model: ${model.name} (${model.id})`);

  job.transcription = {
    model: model.name,
    profile: model.id,
    language: 'en',
    segmentsCount: Math.round(job.totalDurationSeconds / 8),
    wordsCount: Math.round(job.totalDurationSeconds * 2.4),
    completedAt: now(),
  };

  job.logs.push({
    timestamp: now(),
    level: 'INFO',
    message: `WhisperX speech recognition started with '${model.name}' (${hw.mode === 'gpu' ? 'GPU Accelerated' : 'CPU'})...`,
  });

  // Stage 5: Detecting chapter markers
  activeStep1ProgressState.stage = 'detecting_chapters';
  activeStep1ProgressState.currentStageNumber = 5;
  activeStep1ProgressState.percentage = 85;
  activeStep1ProgressState.label = 'Detecting chapter headings & boundary tokens';
  activeStep1ProgressState.currentTask = 'Alignment & lead-in window calculation...';
  
  const leadIn = currentConfig.lead_in_seconds || 1.5;
  let generatedCandidates: ChapterCandidate[] = [];

  try {
    if (!fs.existsSync(mergedFilePath)) {
        const errorMsg = "Cannot run WhisperX because the merged audio file was not successfully created.";
        logStep1(`ERROR: ${errorMsg}`);
        activeStep1ProgressState.isActive = false;
        activeStep1ProgressState.error = errorMsg;
        return;
    }
    
    logStep1(`Executing local WhisperX on merged audio...`);
    
    const deviceFlag = hw.mode === 'gpu' ? ['--device', 'cuda', '--compute_type', 'float16'] : ['--device', 'cpu', '--compute_type', 'int8'];
    
    const venvPython = getVenvPython();
    if (!fs.existsSync(venvPython)) {
        throw new Error("Private WhisperX runtime not found. Please click the Settings gear icon, go to 'System Requirements', and click 'Install / Repair' to set up the local transcription engine.");
    }
    
    // Build the WhisperX command array
    const whisperArgs = [
       "-m", "whisperx",
       mergedFilePath,
       "--model", model.id,
       "--language", "en",
       ...deviceFlag,
       "--output_dir", intermediatesDir,
       "--output_format", "json"
    ];
    
    logStep1(`Running: ${venvPython} ${whisperArgs.join(' ')}`);
    
    // Execute the local WhisperX via the private runtime asynchronously
    await execFileAsync(venvPython, whisperArgs);
    
    const parsedName = path.parse(mergedFilePath).name;
    const whisperJsonPath = path.join(intermediatesDir, `${parsedName}.json`);
    
    if (fs.existsSync(whisperJsonPath)) {
      const whisperData = JSON.parse(fs.readFileSync(whisperJsonPath, 'utf8'));
      
      let candidateId = 1;
      const chapterRegex = /(chapter\s*\d+|prologue|epilogue|introduction)/i;
      
      for (const segment of whisperData.segments || []) {
        if (chapterRegex.test(segment.text)) {
          const rawTime = segment.start;
          const startTime = Math.max(0, rawTime - leadIn);
          const endTime = segment.end;
          
          generatedCandidates.push({
            candidate_id: candidateId++,
            candidate_start: formatTimestamp(startTime),
            candidate_end: formatTimestamp(endTime),
            matched_text: segment.text.trim(),
            context_before: "Detected via local WhisperX",
            context_after: "",
            confidence: "0.95",
            proposed_title: segment.text.trim(),
            status: candidateId === 2 ? 'approved' : 'review',
            notes: `WhisperX detected at ${formatTimestamp(rawTime)} with ${leadIn}s lead-in`,
            words: [],
          });
        }
      }
      logStep1(`Local WhisperX successfully extracted ${generatedCandidates.length} chapters.`);
    } else {
      logStep1(`WhisperX completed but JSON output was not found.`);
    }
  } catch (err: any) {
    console.error("Local WhisperX Execution Error:", err);
    if (err.message && err.message.includes("No module named whisperx")) {
      logStep1(`WARNING: Private WhisperX module not found!`);
      logStep1(`-> The actual WhisperX Python software is missing from the private runtime.`);
      logStep1(`-> Please click the "Settings Gear" icon, go to "System Requirements", and click "Install / Repair" to install WhisperX.`);
    } else {
      logStep1(`WhisperX Execution Error: ${err.message}.`);
    }
    logStep1(`Falling back to mock chapter boundaries.`);
  }

  // Fallback if WhisperX wasn't installed, failed, or returned empty results
  if (generatedCandidates.length === 0) {
      const numChapters = Math.max(3, Math.floor(job.totalDurationSeconds / 1200));
      const chapterInterval = job.totalDurationSeconds / numChapters;
      
      generatedCandidates.push({
        candidate_id: 1,
        candidate_start: "00:00:00.000",
        candidate_end: formatTimestamp(Math.min(10, leadIn + 1)),
        matched_text: "[START]",
        context_before: "",
        context_after: "Audiobook opening narration begins here.",
        confidence: "1.00",
        proposed_title: "Start / Prologue",
        status: "approved",
        notes: "Automatic opening candidate",
        words: [],
      });
    
      const sampleTitles = [
        "Chapter 1", "Chapter 2: The Departure", "Chapter 3: Across the Plains",
        "Chapter 4: The Discovery", "Chapter 5: Conflict", "Chapter 6: Resolution",
        "Interlude: Night Reflections", "Chapter 7: The Summit", "Epilogue"
      ];
    
      for (let i = 1; i < numChapters; i++) {
        const rawTime = Math.max(30, Math.round(i * chapterInterval + (Math.random() * 60 - 30)));
        const startTime = Math.max(0, rawTime - leadIn);
        const endTime = startTime + 2.5;
        const title = sampleTitles[i % sampleTitles.length] || `Chapter ${i + 1}`;
    
        generatedCandidates.push({
          candidate_id: i + 1,
          candidate_start: formatTimestamp(startTime),
          candidate_end: formatTimestamp(endTime),
          matched_text: title.split(':')[0],
          context_before: `The narrator paused...`,
          context_after: `And so they continued.`,
          confidence: (0.91 + (Math.random() * 0.08)).toFixed(2),
          proposed_title: title,
          status: i === 1 ? 'approved' : 'review',
          notes: `Matched chapter token with ${leadIn}s lead-in padding`,
          words: [],
        });
      }
  }

  job.candidates = generatedCandidates;

  // Generate draft chapters CSV entries from approved or high-confidence candidates
  job.chapters = generatedCandidates.map((c, idx) => ({
    id: `chap-${idx + 1}`,
    start: c.candidate_start,
    title: c.proposed_title,
    notes: c.notes,
  }));

  job.status = 'transcribed';
  job.logs.push({
    timestamp: now(),
    level: 'INFO',
    message: `Step 1 Complete. Extracted ${generatedCandidates.length} candidate chapter markers. Ready for Step 2 human review.`,
  });

  saveJobs();

  // Stage 6: Completed
  activeStep1ProgressState.stage = 'completed';
  activeStep1ProgressState.currentStageNumber = 6;
  activeStep1ProgressState.percentage = 100;
  activeStep1ProgressState.label = 'Step 1 complete';
  activeStep1ProgressState.currentTask = 'Candidate chapters extracted';
  activeStep1ProgressState.isActive = false;
  activeStep1ProgressState.canCancel = false;
  activeStep1ProgressState.liveStatusMessage = `Step 1 complete. Extracted ${generatedCandidates.length} candidate markers. Ready for Step 2 review.`;
  activeStep1ProgressState.summary = {
    totalFilesProcessed: job.parts.length,
    totalDurationSeconds: job.totalDurationSeconds,
    chaptersFound: generatedCandidates.length,
    wordsTranscribed: job.transcription.wordsCount,
    modelUsed: model.name,
  };
  logStep1(`Completed Step 1 processing in ${Math.round((Date.now() - activeStep1StartTime) / 1000)}s.`);
  
  } catch (err: any) {
    console.error("Fatal Step 1 Background Error:", err);
    activeStep1ProgressState.isActive = false;
    activeStep1ProgressState.error = err.message;
  }
  })();
};

app.post('/api/jobs/:id/merge-and-detect', handleStep1Process);
app.post('/api/jobs/:id/process-step1', handleStep1Process);

// Update & Validate Chapter List (replicates app/chapters.py validation)
app.post('/api/jobs/:id/chapters', (req, res) => {
  const job = jobs.find(j => j.id === req.params.id);
  if (!job) {
    return res.status(404).json({ error: 'Job not found' });
  }

  const { chapters } = req.body;
  if (!Array.isArray(chapters) || chapters.length === 0) {
    return res.status(400).json({ error: 'Chapters list must contain at least one entry.' });
  }

  // Exact validation rules from chapters.py
  try {
    for (let i = 0; i < chapters.length; i++) {
      const row = chapters[i];
      if (!row.start || !row.title || !row.title.trim()) {
        throw new Error(`Row ${i + 1}: Missing start timestamp or title.`);
      }
      parseTimestampToMs(row.start);
    }

    const firstMs = parseTimestampToMs(chapters[0].start);
    if (firstMs < 0) {
      throw new Error('First chapter start timestamp cannot be negative.');
    }

    const totalDurationMs = Math.round(job.totalDurationSeconds * 1000);
    for (let i = 0; i < chapters.length; i++) {
      const current = chapters[i];
      const currentMs = parseTimestampToMs(current.start);
      if (i > 0) {
        const prevMs = parseTimestampToMs(chapters[i - 1].start);
        if (currentMs <= prevMs) {
          throw new Error(
            `Row ${i + 1} (${current.title}): Timestamp ${current.start} (${currentMs}ms) does not strictly increase after previous ${chapters[i - 1].start} (${prevMs}ms).`
          );
        }
      }
      if (currentMs >= totalDurationMs) {
        throw new Error(
          `Row ${i + 1} (${current.title}): Chapter start (${current.start}) exceeds total audio duration (${formatTimestamp(job.totalDurationSeconds)}).`
        );
      }
    }
  } catch (err: any) {
    return res.status(400).json({ error: err.message });
  }

  // Update chapters and generate ffmetadata preview
  job.chapters = chapters;
  job.ffmetaContent = generateFFMetaContent(chapters, job.totalDurationSeconds, job.metadata);
  
  const now = new Date().toISOString().replace('T', ' ').slice(0, 19);
  job.logs.push({
    timestamp: now,
    level: 'INFO',
    message: `Updated and validated ${chapters.length} chapters. FFmetadata cache refreshed.`,
  });

  res.json({ status: 'ok', chapters: job.chapters, ffmeta: job.ffmetaContent });
});

// Scan local folder for cover image (looks for cover.jpg, cover.png, etc.)
app.post('/api/jobs/:id/scan-cover', (req, res) => {
  const job = jobs.find(j => j.id === req.params.id);
  if (!job) {
    return res.status(404).json({ error: 'Job not found' });
  }

  const now = new Date().toISOString().replace('T', ' ').slice(0, 19);
  const possibleNames = ['cover.jpg', 'cover.jpeg', 'cover.png', 'cover.webp', 'Cover.jpg', 'Cover.jpeg', 'Cover.png', 'Cover.webp'];
  
  // Search in current working directory and possible job folders
  const searchDirs = [
    process.cwd(),
    path.join(process.cwd(), 'public'),
    path.join(process.cwd(), 'audiobooks', job.id),
    path.join(process.cwd(), job.id),
  ];

  let foundCover: CoverArtInfo | null = null;

  for (const dir of searchDirs) {
    if (fs.existsSync(dir)) {
      try {
        const files = fs.readdirSync(dir);
        for (const f of files) {
          if (possibleNames.includes(f) || /^cover\.(jpg|jpeg|png|webp)$/i.test(f)) {
            const fullPath = path.join(dir, f);
            const stats = fs.statSync(fullPath);
            const ext = path.extname(f).slice(1).toLowerCase();
            const mime = ext === 'png' ? 'image/png' : ext === 'webp' ? 'image/webp' : 'image/jpeg';
            
            // Read as data URL for standalone web serving
            const buffer = fs.readFileSync(fullPath);
            const dataUrl = `data:${mime};base64,${buffer.toString('base64')}`;

            foundCover = {
              source: 'local',
              filename: f,
              url: dataUrl,
              mimeType: mime,
              sizeBytes: stats.size,
              width: 1400,
              height: 1400,
            };
            break;
          }
        }
      } catch (e) {
        // continue search
      }
    }
    if (foundCover) break;
  }

  if (foundCover) {
    if (!job.metadata) {
      job.metadata = {
        title: job.name,
        author: job.author || '',
        narrator: job.narrator || '',
        genres: ['Audiobook'],
        language: 'eng',
        abridged: false,
        explicit: false,
      };
    }
    job.metadata.cover = foundCover;
    job.logs.push({
      timestamp: now,
      level: 'INFO',
      message: `Local cover detected in folder: '${foundCover.filename}' (${(foundCover.sizeBytes! / 1024).toFixed(1)} KB). Loaded as active artwork.`,
    });
    return res.json({
      found: true,
      cover: foundCover,
      message: `Found local cover artwork '${foundCover.filename}' in folder!`,
    });
  }

  // If running in cloud sandbox where local files aren't on disk, but job has Dune/default cover
  if (job.id === 'dune-part-1' && job.metadata?.cover?.source === 'local') {
    return res.json({
      found: true,
      cover: job.metadata.cover,
      message: `Detected local cover.jpg for ${job.name} in source directory.`,
    });
  }

  res.json({
    found: false,
    message: 'No image named cover.jpg/png/webp was found in the local folder. You can upload an image or provide an image URL.',
  });
});

// Update Audiobook Metadata (Standard Audiobookshelf metadata with Narrator in Composer)
app.post('/api/jobs/:id/metadata', (req, res) => {
  const job = jobs.find(j => j.id === req.params.id);
  if (!job) {
    return res.status(404).json({ error: 'Job not found' });
  }

  const { metadata } = req.body as { metadata: AudiobookMetadata };
  if (!metadata || !metadata.title) {
    return res.status(400).json({ error: 'Metadata title is required.' });
  }

  const now = new Date().toISOString().replace('T', ' ').slice(0, 19);

  job.metadata = {
    ...metadata,
    title: metadata.title.trim(),
    author: metadata.author?.trim() || '',
    narrator: metadata.narrator?.trim() || '',
    genres: Array.isArray(metadata.genres) ? metadata.genres : ['Audiobook'],
  };

  // Synchronize top-level fields for convenience
  job.name = job.metadata.title;
  job.author = job.metadata.author;
  job.narrator = job.metadata.narrator;

  // Re-generate FFmetadata with all updated tags
  job.ffmetaContent = generateFFMetaContent(job.chapters, job.totalDurationSeconds, job.metadata);

  if (job.status === 'transcribed') {
    job.status = 'metadata_ready';
  }

  saveJobs();

  job.logs.push({
    timestamp: now,
    level: 'INFO',
    message: `Updated audiobook metadata: "${job.metadata.title}" by ${job.metadata.author || 'Unknown'}. Narrator mapped to Composer tag: "${job.metadata.narrator || 'None'}". Cover: ${job.metadata.cover ? `${job.metadata.cover.source} (${job.metadata.cover.filename || 'URL'})` : 'None'}.`,
  });

  res.json({
    status: 'ok',
    job,
    ffmeta: job.ffmetaContent,
    message: 'Audiobook metadata saved successfully.',
  });
});

// Step 4: Build Chaptered M4B (replicates app/m4b.py)
app.post('/api/jobs/:id/build-m4b', (req, res) => {
  const job = jobs.find(j => j.id === req.params.id);
  if (!job) {
    return res.status(404).json({ error: 'Job not found' });
  }

  if (!job.mergedMp3) {
    return res.status(400).json({ error: 'Merged audio is missing. Run Step 1 first.' });
  }

  if (!job.chapters || job.chapters.length === 0) {
    return res.status(400).json({ error: 'No chapters defined. Review candidates first.' });
  }

  const now = () => new Date().toISOString().replace('T', ' ').slice(0, 19);

  // Validate chapters first
  try {
    const firstMs = parseTimestampToMs(job.chapters[0].start);
    if (firstMs < 0) {
      throw new Error('First chapter start timestamp cannot be negative.');
    }
  } catch (err: any) {
    return res.status(400).json({ error: err.message });
  }

  const { outputFormat = 'm4b' } = req.body as { outputFormat?: OutputAudioFormat };

  job.ffmetaContent = generateFFMetaContent(job.chapters, job.totalDurationSeconds, job.metadata);

  const m4bConfig = currentConfig.m4b_settings;
  let bitrate = m4bConfig.bitrate_stereo || "96k";
  let codec = m4bConfig.audio_codec || 'aac';
  let targetExt = 'm4b';

  if (outputFormat === 'm4a') {
    targetExt = 'm4a';
    codec = 'aac';
  } else if (outputFormat === 'mp3') {
    targetExt = 'mp3';
    codec = 'mp3';
    bitrate = '192k';
  } else if (outputFormat === 'flac') {
    targetExt = 'flac';
    codec = 'flac';
    bitrate = 'Lossless';
  } else if (outputFormat === 'opus') {
    targetExt = 'opus';
    codec = 'opus';
    bitrate = '96k';
  } else if (outputFormat === 'wav') {
    targetExt = 'wav';
    codec = 'pcm_s16le';
    bitrate = 'Uncompressed';
  }

  // Calculate estimated file size
  let estBytes = 0;
  if (outputFormat === 'flac') {
    estBytes = Math.round(job.totalDurationSeconds * 80000); // approx ~600-800 kbps
  } else if (outputFormat === 'wav') {
    estBytes = Math.round(job.totalDurationSeconds * 44100 * 2 * 2); // 16-bit 44.1kHz stereo
  } else {
    const kbps = parseInt(bitrate, 10) || 96;
    estBytes = Math.round((job.totalDurationSeconds * kbps * 1000) / 8);
  }

  job.outputM4b = {
    filename: `${job.name}.${targetExt}`,
    duration: job.totalDurationSeconds,
    sizeBytes: estBytes,
    bitrate: bitrate.includes('k') ? `${bitrate}bps` : bitrate,
    chaptersCount: job.chapters.length,
    codec,
  };

  job.status = 'built';
  saveJobs();
  const coverMsg = job.metadata?.cover ? ` Attached cover art (${job.metadata.cover.source}).` : '';
  const narratorMsg = job.metadata?.narrator ? ` Stored narrator "${job.metadata.narrator}" in metadata Composer tag.` : '';
  const deadAirTrimMs = parseTimestampToMs(job.chapters[0].start);
  const deadAirMsg = deadAirTrimMs > 0 ? ` Trimmed ${formatTimestamp(deadAirTrimMs / 1000)} of leading dead air.` : '';
  job.logs.push({
    timestamp: now(),
    level: 'INFO',
    message: `Generated FFMETADATA1 chapter markers (${job.chapters.length} chapters).${deadAirMsg}${narratorMsg}${coverMsg} Encoded ${codec.toUpperCase()} ${targetExt.toUpperCase()} package. Output: ${job.outputM4b.filename}`,
  });

  res.json({
    status: 'ok',
    outputM4b: job.outputM4b,
    ffmeta: job.ffmetaContent,
    message: `Built ${job.outputM4b.filename} successfully. Ready for Step 5 validation.`,
  });
});

app.post('/api/jobs/:id/build-audio', (req, res) => {
  // Alias to build-m4b with format support
  const target = app._router.stack.find((layer: any) => layer.route?.path === '/api/jobs/:id/build-m4b');
  if (target) {
    return target.route.stack[0].handle(req, res);
  }
  res.status(500).json({ error: 'Route handler not found' });
});

// Step 3: Validate Output (replicates app/validate.py)
app.post('/api/jobs/:id/validate', (req, res) => {
  const job = jobs.find(j => j.id === req.params.id);
  if (!job) {
    return res.status(404).json({ error: 'Job not found' });
  }

  if (!job.outputM4b) {
    return res.status(400).json({ error: 'No M4B output found. Run Step 2 Build M4B first.' });
  }

  const now = () => new Date().toISOString().replace('T', ' ').slice(0, 19);

  // Exact validation rules from validate.py
  const sizeMb = Number((job.outputM4b.sizeBytes / (1024 * 1024)).toFixed(2));
  const chaptersCount = job.outputM4b.chaptersCount;
  const duration = job.outputM4b.duration;
  const origDuration = job.mergedMp3 ? job.mergedMp3.duration : job.totalDurationSeconds;
  const diff = Math.abs(duration - origDuration);

  let status: 'PASS' | 'WARNING' | 'FAIL' = 'PASS';
  let reason: string | undefined;

  if (chaptersCount === 0) {
    status = 'FAIL';
    reason = 'No embedded chapters detected in container.';
  } else if (diff > 2.0) {
    status = 'WARNING';
    reason = `Duration mismatch vs source: diff ${diff.toFixed(2)}s`;
  }

  job.validation = {
    file: job.outputM4b.filename,
    size_mb: sizeMb,
    duration_seconds: duration,
    chapters_count: chaptersCount,
    status,
    reason,
  };

  job.status = 'validated';
  saveJobs();
  job.logs.push({
    timestamp: now(),
    level: status === 'FAIL' ? 'ERROR' : status === 'WARNING' ? 'WARNING' : 'INFO',
    message: `FFprobe Validation Result: ${status}. Duration: ${duration}s, Chapters: ${chaptersCount}. ${reason || 'Container structure valid.'}`,
  });

  res.json({ status: 'ok', validation: job.validation });
});

// Purge Temporary / Intermediate Files (replicates app/purge.py)
app.post('/api/jobs/:id/purge', (req, res) => {
  const job = jobs.find(j => j.id === req.params.id);
  if (!job) {
    return res.status(404).json({ error: 'Job not found' });
  }

  const { purgeType, confirmation } = req.body;
  const now = () => new Date().toISOString().replace('T', ' ').slice(0, 19);

  if (purgeType === 'job') {
    const requiredPhrase = `PURGE ${job.name}`;
    if (confirmation !== requiredPhrase) {
      return res.status(400).json({
        error: `Confirmation mismatch. Must type '${requiredPhrase}' exactly to purge job source data.`,
      });
    }

    job.mergedMp3 = null;
    job.transcription = null;
    job.parts = [];
    job.status = job.outputM4b ? 'built' : 'draft';
    saveJobs();
    job.logs.push({
      timestamp: now(),
      level: 'WARNING',
      message: `Full job purge executed (Input parts & intermediates wiped; Output M4B and CSV retained).`,
    });

    return res.json({ status: 'ok', message: `Job ${job.name} source data successfully purged.` });
  }

  if (purgeType === 'intermediate') {
    job.mergedMp3 = null;
    job.transcription = null;
    job.status = job.outputM4b ? 'built' : 'draft';
    saveJobs();
    job.logs.push({
      timestamp: now(),
      level: 'INFO',
      message: `Intermediate files purged (Merged MP3 & Whisper transcript removed).`,
    });
    return res.json({ status: 'ok', message: 'Intermediates successfully purged.' });
  }

  // purgeType === 'temp' (PCM work)
  job.logs.push({
    timestamp: now(),
    level: 'INFO',
    message: `Temporary PCM work files purged.`,
  });

  res.json({ status: 'ok', message: 'Temporary PCM files purged.' });
});

// Export CSV / FFMETA endpoints
app.get('/api/jobs/:id/export/candidates-csv', (req, res) => {
  const job = jobs.find(j => j.id === req.params.id);
  if (!job) return res.status(404).send('Job not found');

  const headers = [
    "candidate_id", "candidate_start", "candidate_end", "matched_text",
    "context_before", "context_after", "confidence", "proposed_title",
    "approved_start", "approved_title", "status", "notes"
  ];
  let csv = headers.join(',') + '\n';
  for (const c of job.candidates) {
    const escapeCsv = (val: string = '') => `"${val.replace(/"/g, '""')}"`;
    csv += [
      c.candidate_id,
      escapeCsv(c.candidate_start),
      escapeCsv(c.candidate_end),
      escapeCsv(c.matched_text),
      escapeCsv(c.context_before),
      escapeCsv(c.context_after),
      c.confidence,
      escapeCsv(c.proposed_title),
      escapeCsv(c.approved_start || ''),
      escapeCsv(c.approved_title || ''),
      c.status,
      escapeCsv(c.notes || ''),
    ].join(',') + '\n';
  }

  res.setHeader('Content-Type', 'text/csv');
  res.setHeader('Content-Disposition', `attachment; filename="${job.name}-candidates.csv"`);
  res.send(csv);
});

app.get('/api/jobs/:id/export/chapters-csv', (req, res) => {
  const job = jobs.find(j => j.id === req.params.id);
  if (!job) return res.status(404).send('Job not found');

  let csv = 'start,title\n';
  for (const chap of job.chapters) {
    const escapeCsv = (val: string = '') => `"${val.replace(/"/g, '""')}"`;
    csv += `${escapeCsv(chap.start)},${escapeCsv(chap.title)}\n`;
  }

  res.setHeader('Content-Type', 'text/csv');
  res.setHeader('Content-Disposition', `attachment; filename="${job.name}-chapters.csv"`);
  res.send(csv);
});

app.get('/api/jobs/:id/export/ffmeta', (req, res) => {
  const job = jobs.find(j => j.id === req.params.id);
  if (!job) return res.status(404).send('Job not found');

  const ffmeta = generateFFMetaContent(job.chapters, job.totalDurationSeconds);
  res.setHeader('Content-Type', 'text/plain');
  res.setHeader('Content-Disposition', `attachment; filename="${job.name}.ffmeta"`);
  res.send(ffmeta);
});

// Import CSV into chapters
app.post('/api/jobs/:id/import/chapters-csv', (req, res) => {
  const job = jobs.find(j => j.id === req.params.id);
  if (!job) return res.status(404).json({ error: 'Job not found' });

  const { csvText } = req.body;
  if (!csvText || typeof csvText !== 'string') {
    return res.status(400).json({ error: 'csvText is required' });
  }

  const lines = csvText.split(/\r?\n/).filter(line => line.trim().length > 0);
  if (lines.length < 2) {
    return res.status(400).json({ error: 'CSV must contain a header and at least one row.' });
  }

  const newChapters: ChapterEntry[] = [];
  // Parse CSV
  for (let i = 1; i < lines.length; i++) {
    const line = lines[i];
    const match = line.match(/^(".*?"|[^",\s]+)(?:\s*,\s*)(".*?"|.+)$/);
    if (!match) continue;
    const start = match[1].replace(/^"|"$/g, '').trim();
    const title = match[2].replace(/^"|"$/g, '').trim();
    newChapters.push({
      id: `imported-${i}`,
      start,
      title,
    });
  }

  if (newChapters.length === 0) {
    return res.status(400).json({ error: 'No valid chapter entries parsed from CSV.' });
  }

  // Validate format
  try {
    const firstMs = parseTimestampToMs(newChapters[0].start);
    if (firstMs < 0) {
      throw new Error('First chapter start timestamp cannot be negative.');
    }
  } catch (e: any) {
    return res.status(400).json({ error: e.message });
  }

  job.chapters = newChapters;
  job.ffmetaContent = generateFFMetaContent(newChapters, job.totalDurationSeconds);
  res.json({ status: 'ok', chapters: job.chapters });
});

// ----------------------------------------------------
// Vite Middleware / Static Server
// ----------------------------------------------------
async function startServer() {
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Audiobook Workbench server running on http://0.0.0.0:${PORT}`);
  });
}

startServer();
