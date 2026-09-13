import React, { useState } from 'react';
import { AudiobookJob, WorkbenchConfig, OutputAudioFormat } from '../types';
import { Package, Download, FileCode2, Sliders, ArrowRight, ShieldCheck, Image, Mic, User, CheckCircle2 } from 'lucide-react';

interface Step4Props {
  job: AudiobookJob;
  config: WorkbenchConfig;
  onBuildM4b: (format?: OutputAudioFormat) => Promise<void>;
  isBuilding: boolean;
  onNextStep: () => void;
}

export const Step4BuildM4b: React.FC<Step4Props> = ({
  job,
  config,
  onBuildM4b,
  isBuilding,
  onNextStep,
}) => {
  const [selectedFormat, setSelectedFormat] = useState<OutputAudioFormat>('m4b');

  const formatSec = (seconds: number) => {
    const h = Math.floor(seconds / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    const s = Math.floor(seconds % 60);
    if (h > 0) return `${h}h ${m}m ${s}s`;
    return `${m}m ${s}s`;
  };

  const formatBytes = (bytes: number) => {
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  };

  const m4bConfig = config.m4b_settings;
  const meta = job.metadata;

  return (
    <div className="space-y-6">
      {/* Header Banner */}
      <div className="bg-white rounded-xl p-5 border border-stone-200/80 shadow-xs">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div>
            <div className="flex items-center space-x-2">
              <span className="inline-flex items-center justify-center w-6 h-6 rounded-full bg-amber-100 text-amber-800 text-xs font-bold">
                4
              </span>
              <h2 className="text-lg font-bold text-stone-900">
                Step 4: Build Chaptered Audio Package
              </h2>
            </div>
            <p className="text-sm text-stone-600 mt-1 max-w-3xl">
              Validates chapter timings, compiles the standardized <code>;FFMETADATA1</code> metadata tree with 1/1000 millisecond timebases,
              embeds Audiobookshelf metadata (with <strong>Narrator mapped to Composer</strong> and attached cover art), and packages the audio into your chosen format.
            </p>
          </div>

          <div className="flex items-center space-x-3">
            <button
              id="btn-build-m4b"
              onClick={() => onBuildM4b(selectedFormat)}
              disabled={isBuilding || !job.mergedMp3 || job.chapters.length === 0}
              className={`flex items-center space-x-2 px-5 py-2.5 rounded-lg text-sm font-semibold text-white shadow-sm transition-all cursor-pointer ${
                isBuilding
                  ? 'bg-stone-400 cursor-not-allowed'
                  : 'bg-amber-600 hover:bg-amber-500 active:scale-98'
              }`}
            >
              {isBuilding ? (
                <>
                  <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                  <span>Encoding {selectedFormat.toUpperCase()} Package...</span>
                </>
              ) : (
                <>
                  <Package className="w-4 h-4" />
                  <span>{job.outputM4b ? `Re-build ${selectedFormat.toUpperCase()}` : `Build ${selectedFormat.toUpperCase()} Package`}</span>
                </>
              )}
            </button>

            {job.outputM4b && (
              <button
                onClick={onNextStep}
                className="flex items-center space-x-1.5 px-4 py-2.5 rounded-lg text-sm font-semibold bg-stone-900 hover:bg-stone-800 text-stone-100 transition-colors cursor-pointer"
              >
                <span>Validate Output (Step 5)</span>
                <ArrowRight className="w-4 h-4" />
              </button>
            )}
          </div>
        </div>
      </div>

      {/* Output Format Selector Card */}
      <div className="bg-white rounded-xl p-5 border border-stone-200/80 shadow-xs space-y-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center space-x-2">
            <Sliders className="w-4 h-4 text-amber-600" />
            <h3 className="font-bold text-sm text-stone-900">Output Audio Format</h3>
          </div>
          <span className="text-xs text-stone-500 font-mono">
            Active: <strong className="text-amber-800 uppercase">{selectedFormat}</strong>
          </span>
        </div>

        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-6 gap-2.5">
          {[
            { id: 'm4b', name: 'M4B Audiobook', tag: 'Standard', desc: 'AAC-LC chaptered audiobook (Apple Books, Audiobookshelf)' },
            { id: 'm4a', name: 'M4A Audio', tag: 'AAC-LC', desc: 'MPEG-4 AAC with embedded chapter markers' },
            { id: 'mp3', name: 'MP3 CBR', tag: 'Universal', desc: 'ID3v2 chapter frames (192 kbps CBR)' },
            { id: 'flac', name: 'FLAC', tag: 'Lossless', desc: 'Vorbis comments chapter metadata' },
            { id: 'opus', name: 'Opus', tag: 'High-Eff', desc: 'Ogg Opus container at 96 kbps' },
            { id: 'wav', name: 'WAV PCM', tag: 'Uncompressed', desc: '16-bit 44.1kHz stereo PCM master' },
          ].map((fmt) => (
            <button
              key={fmt.id}
              type="button"
              onClick={() => setSelectedFormat(fmt.id as OutputAudioFormat)}
              className={`p-3 rounded-xl border text-left transition-all cursor-pointer ${
                selectedFormat === fmt.id
                  ? 'border-amber-500 bg-amber-50/70 shadow-2xs ring-1 ring-amber-500/50'
                  : 'border-stone-200 hover:border-stone-300 bg-stone-50/40'
              }`}
            >
              <div className="flex items-center justify-between mb-1">
                <span className="font-bold text-xs text-stone-900 uppercase font-mono">{fmt.id}</span>
                <span className={`text-[10px] px-1.5 py-0.2 rounded font-medium ${
                  selectedFormat === fmt.id ? 'bg-amber-200 text-amber-900' : 'bg-stone-200 text-stone-600'
                }`}>
                  {fmt.tag}
                </span>
              </div>
              <div className="text-xs font-semibold text-stone-800">{fmt.name}</div>
              <p className="text-[10px] text-stone-500 mt-1 leading-snug">{fmt.desc}</p>
            </button>
          ))}
        </div>
      </div>

      {/* Grid: FFMetadata Preview & Encoder Specs */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        {/* Left Col (7 cols): FFMetadata File Viewer */}
        <div className="lg:col-span-7 space-y-4">
          <div className="bg-white rounded-xl border border-stone-200/80 shadow-xs overflow-hidden flex flex-col h-[650px]">
            <div className="p-4 border-b border-stone-200 bg-stone-50/70 flex items-center justify-between">
              <div className="flex items-center space-x-2">
                <FileCode2 className="w-4 h-4 text-amber-600" />
                <h3 className="font-semibold text-sm text-stone-800">
                  FFMetadata Structure ({job.chapters.length} chapters & tags)
                </h3>
              </div>
              <a
                href={`/api/jobs/${job.id}/export/ffmeta`}
                download
                className="flex items-center space-x-1 px-2.5 py-1 text-xs rounded border border-stone-300 bg-white text-stone-700 hover:bg-stone-50 font-medium"
                title="Download .ffmeta file"
              >
                <Download className="w-3.5 h-3.5 text-stone-500" />
                <span>.ffmeta</span>
              </a>
            </div>

            <div className="flex-1 bg-stone-100 border border-stone-200 rounded-lg p-4 overflow-y-auto text-xs font-mono text-stone-800">
              <pre className="whitespace-pre-wrap leading-relaxed">
                {job.ffmetaContent ||
                  `;FFMETADATA1\ngenre=Audiobook\n` +
                    job.chapters
                      .map((c, i) => {
                        return `[CHAPTER]\nTIMEBASE=1/1000\nSTART=...\nEND=...\ntitle=${c.title}\n`;
                      })
                      .join('')}
              </pre>
            </div>
          </div>
        </div>

        {/* Right Col (5 cols): Encoding Specifications & Target Output */}
        <div className="lg:col-span-5 space-y-6">
          {/* Target M4B File Card */}
          <div className="bg-white rounded-xl p-5 border border-stone-200/80 shadow-xs">
            <h3 className="font-semibold text-sm text-stone-900 mb-3 flex items-center space-x-2">
              <Package className="w-4 h-4 text-amber-600" />
              <span>Target M4B Package</span>
            </h3>

            {job.outputM4b ? (
              <div className="p-4 bg-emerald-50/60 rounded-xl border border-emerald-200/80 space-y-3">
                <div className="flex items-center justify-between">
                  <span className="font-bold text-emerald-900 font-mono text-sm">
                    Output/{job.outputM4b.filename}
                  </span>
                  <span className="px-2 py-0.5 rounded bg-emerald-200/70 text-emerald-800 text-xs font-semibold">
                    Built
                  </span>
                </div>

                <div className="grid grid-cols-2 gap-2 text-xs text-stone-600 font-mono pt-2 border-t border-emerald-200/60">
                  <div>
                    <span className="text-stone-400">Duration:</span> {formatSec(job.outputM4b.duration)}
                  </div>
                  <div>
                    <span className="text-stone-400">Size:</span> {formatBytes(job.outputM4b.sizeBytes)}
                  </div>
                  <div>
                    <span className="text-stone-400">Chapters:</span> {job.outputM4b.chaptersCount}
                  </div>
                  <div>
                    <span className="text-stone-400">Bitrate:</span> {job.outputM4b.bitrate}
                  </div>
                </div>

                <div className="pt-2">
                  <button
                    onClick={onNextStep}
                    className="w-full py-2 bg-emerald-700 hover:bg-emerald-600 text-white font-semibold rounded-lg text-xs transition-colors cursor-pointer"
                  >
                    Proceed to Step 5 Verification →
                  </button>
                </div>
              </div>
            ) : (
              <div className="p-6 text-center border-2 border-dashed border-stone-200 rounded-xl text-stone-400 text-xs space-y-2">
                <Package className="w-8 h-8 mx-auto text-stone-300" />
                <p>M4B container has not been built yet.</p>
                <p className="text-[11px] text-stone-400">
                  Click the "Build M4B Package" button to compile.
                </p>
              </div>
            )}
          </div>

          {/* Metadata & Cover Injection Summary */}
          <div className="bg-white rounded-xl p-5 border border-stone-200/80 shadow-xs space-y-3">
            <h3 className="font-semibold text-sm text-stone-900 flex items-center space-x-2">
              <ShieldCheck className="w-4 h-4 text-amber-700" />
              <span>Audiobook Metadata Summary</span>
            </h3>

            <div className="space-y-2 text-xs">
              <div className="flex justify-between py-1 border-b border-stone-100">
                <span className="text-stone-500">Title:</span>
                <span className="font-medium text-stone-900 truncate max-w-[200px]">{meta?.title || job.name}</span>
              </div>
              <div className="flex justify-between py-1 border-b border-stone-100">
                <span className="text-stone-500">Author (Artist):</span>
                <span className="font-medium text-stone-900">{meta?.author || job.author || 'None'}</span>
              </div>
              <div className="flex justify-between py-1 border-b border-stone-100">
                <span className="text-stone-500 flex items-center space-x-1">
                  <Mic className="w-3 h-3 text-amber-700" />
                  <span>Narrator (Composer):</span>
                </span>
                <span className="font-semibold text-amber-900 font-mono text-[11px] bg-amber-50 px-1 rounded">
                  {meta?.narrator || job.narrator || 'None'}
                </span>
              </div>
              <div className="flex justify-between py-1 border-b border-stone-100">
                <span className="text-stone-500">Series:</span>
                <span className="font-medium text-stone-900">
                  {meta?.series ? `${meta.series}${meta.seriesSequence ? ` #${meta.seriesSequence}` : ''}` : 'Standalone'}
                </span>
              </div>
              <div className="flex justify-between py-1 border-b border-stone-100">
                <span className="text-stone-500 flex items-center space-x-1">
                  <Image className="w-3 h-3 text-stone-400" />
                  <span>Cover Artwork:</span>
                </span>
                <span className={`font-semibold ${meta?.cover ? 'text-emerald-700' : 'text-stone-400'}`}>
                  {meta?.cover ? `Embedded (${meta.cover.source})` : 'None (Optional)'}
                </span>
              </div>
              {meta?.cover?.url && (
                <div className="flex items-center space-x-3 pt-2">
                  <img
                    src={meta.cover.url}
                    alt="Cover preview"
                    className="w-12 h-12 rounded object-cover border border-stone-200 shadow-xs"
                  />
                  <div className="text-[11px] text-stone-500">
                    <p className="font-medium text-stone-800 truncate max-w-[180px]">{meta.cover.filename || 'Cover'}</p>
                    <p>{meta.cover.width ? `${meta.cover.width}×${meta.cover.height}px` : 'Image ready'}</p>
                  </div>
                </div>
              )}
            </div>
          </div>

          {/* Codec & Compression Specs */}
          <div className="bg-white rounded-xl p-5 border border-stone-200/80 shadow-xs space-y-3">
            <h3 className="font-semibold text-sm text-stone-900 flex items-center space-x-2">
              <Sliders className="w-4 h-4 text-stone-700" />
              <span>Audio Specs & Flags</span>
            </h3>

            <div className="space-y-2 text-xs">
              <div className="flex justify-between py-1 border-b border-stone-100">
                <span className="text-stone-500">Audio Codec:</span>
                <span className="font-mono text-stone-800 uppercase">{m4bConfig.audio_codec} (AAC-LC)</span>
              </div>
              <div className="flex justify-between py-1 border-b border-stone-100">
                <span className="text-stone-500">Target Bitrate:</span>
                <span className="font-mono text-stone-800">{m4bConfig.bitrate_stereo}</span>
              </div>
              <div className="flex justify-between py-1 border-b border-stone-100">
                <span className="text-stone-500">Sample Rate:</span>
                <span className="font-mono text-stone-800">{m4bConfig.sample_rate} Hz</span>
              </div>
              <div className="flex justify-between py-1">
                <span className="text-stone-500">FastStart Atom:</span>
                <span className="text-emerald-700 font-semibold font-mono">+faststart (seekable)</span>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
