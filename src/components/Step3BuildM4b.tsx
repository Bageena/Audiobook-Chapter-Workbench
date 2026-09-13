import React from 'react';
import { AudiobookJob, WorkbenchConfig } from '../types';
import { Package, Download, Play, CheckCircle2, FileCode2, Sliders, ArrowRight, ShieldCheck } from 'lucide-react';

interface Step3Props {
  job: AudiobookJob;
  config: WorkbenchConfig;
  onBuildM4b: () => Promise<void>;
  isBuilding: boolean;
  onNextStep: () => void;
}

export const Step3BuildM4b: React.FC<Step3Props> = ({
  job,
  config,
  onBuildM4b,
  isBuilding,
  onNextStep,
}) => {
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

  return (
    <div className="space-y-6">
      {/* Header Banner */}
      <div className="bg-white rounded-xl p-5 border border-stone-200/80 shadow-xs">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div>
            <div className="flex items-center space-x-2">
              <span className="inline-flex items-center justify-center w-6 h-6 rounded-full bg-amber-100 text-amber-800 text-xs font-bold">
                3
              </span>
              <h2 className="text-lg font-bold text-stone-900">
                Step 3: Build Chaptered M4B Audiobook
              </h2>
            </div>
            <p className="text-sm text-stone-600 mt-1 max-w-3xl">
              Validates chapter timings, compiles the standardized <code>;FFMETADATA1</code> metadata tree with 1/1000 millisecond timebases,
              and packages the audio into an AAC-LC .m4b container with <code>+faststart</code> streaming atoms.
            </p>
          </div>

          <div className="flex items-center space-x-3">
            <button
              id="btn-build-m4b"
              onClick={onBuildM4b}
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
                  <span>Encoding M4B Container...</span>
                </>
              ) : (
                <>
                  <Package className="w-4 h-4" />
                  <span>{job.outputM4b ? 'Re-build M4B Package' : 'Build M4B Package'}</span>
                </>
              )}
            </button>

            {job.outputM4b && (
              <button
                onClick={onNextStep}
                className="flex items-center space-x-1.5 px-4 py-2.5 rounded-lg text-sm font-semibold bg-stone-900 hover:bg-stone-800 text-stone-100 transition-colors cursor-pointer"
              >
                <span>Validate Output</span>
                <ArrowRight className="w-4 h-4" />
              </button>
            )}
          </div>
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
                  FFMetadata Structure ({job.chapters.length} chapters)
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

            <div className="flex-1 bg-stone-900 p-4 overflow-y-auto text-xs font-mono text-stone-300">
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
                    Proceed to Step 4 Verification →
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
                <span className="text-stone-500">Stereo Target Bitrate:</span>
                <span className="font-mono text-stone-800">{m4bConfig.bitrate_stereo}</span>
              </div>
              <div className="flex justify-between py-1 border-b border-stone-100">
                <span className="text-stone-500">Mono Target Bitrate:</span>
                <span className="font-mono text-stone-800">{m4bConfig.bitrate_mono}</span>
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

          {/* Safety note */}
          <div className="bg-stone-50 rounded-xl p-4 border border-stone-200 text-xs text-stone-600 flex items-start space-x-2">
            <ShieldCheck className="w-4 h-4 text-amber-600 shrink-0 mt-0.5" />
            <span>
              All chapter metadata is embedded strictly into MP4 atoms (<code>covr</code>, <code>chpl</code>, and <code>nero</code>) so it is compatible with Apple Books, Audible, Smart AudioBook Player, and VLC.
            </span>
          </div>
        </div>
      </div>
    </div>
  );
};
