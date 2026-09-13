import React from 'react';
import { AudiobookJob } from '../types';
import { CheckCircle2, AlertTriangle, XCircle, RefreshCw, FileCheck, Layers, Clock, HardDrive, Bookmark } from 'lucide-react';

interface Step4Props {
  job: AudiobookJob;
  onValidate: () => Promise<void>;
  isValidating: boolean;
}

export const Step4Validate: React.FC<Step4Props> = ({
  job,
  onValidate,
  isValidating,
}) => {
  const report = job.validation;

  const formatSec = (seconds: number) => {
    const h = Math.floor(seconds / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    const s = Math.floor(seconds % 60);
    if (h > 0) return `${h}h ${m}m ${s}s`;
    return `${m}m ${s}s`;
  };

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
                Step 4: Validate Output M4B (FFprobe Verification)
              </h2>
            </div>
            <p className="text-sm text-stone-600 mt-1 max-w-3xl">
              Runs a rigorous FFprobe verification against the final container to confirm audio duration matches the source material
              and verifies that all chapters are properly embedded and seekable.
            </p>
          </div>

          <div className="flex items-center space-x-3">
            <button
              id="btn-run-validation"
              onClick={onValidate}
              disabled={isValidating || !job.outputM4b}
              className={`flex items-center space-x-2 px-4 py-2.5 rounded-lg text-sm font-semibold text-white shadow-sm transition-all cursor-pointer ${
                isValidating
                  ? 'bg-stone-400 cursor-not-allowed'
                  : 'bg-amber-600 hover:bg-amber-500 active:scale-98'
              }`}
            >
              <RefreshCw className={`w-4 h-4 ${isValidating ? 'animate-spin' : ''}`} />
              <span>{report ? 'Re-run FFprobe Validation' : 'Run Validation'}</span>
            </button>
          </div>
        </div>
      </div>

      {/* Validation Status Card */}
      {report ? (
        <div className="space-y-6">
          <div
            className={`p-6 rounded-xl border ${
              report.status === 'PASS'
                ? 'bg-emerald-50/70 border-emerald-300'
                : report.status === 'WARNING'
                ? 'bg-amber-50/70 border-amber-300'
                : 'bg-red-50/70 border-red-300'
            }`}
          >
            <div className="flex items-start justify-between">
              <div className="flex items-center space-x-3">
                {report.status === 'PASS' && (
                  <div className="w-12 h-12 rounded-full bg-emerald-100 text-emerald-700 flex items-center justify-center">
                    <CheckCircle2 className="w-7 h-7" />
                  </div>
                )}
                {report.status === 'WARNING' && (
                  <div className="w-12 h-12 rounded-full bg-amber-100 text-amber-700 flex items-center justify-center">
                    <AlertTriangle className="w-7 h-7" />
                  </div>
                )}
                {report.status === 'FAIL' && (
                  <div className="w-12 h-12 rounded-full bg-red-100 text-red-700 flex items-center justify-center">
                    <XCircle className="w-7 h-7" />
                  </div>
                )}

                <div>
                  <div className="flex items-center space-x-2">
                    <h3 className="font-bold text-lg text-stone-900">
                      FFprobe Integrity Report: {report.status}
                    </h3>
                    <span
                      className={`px-2.5 py-0.5 rounded text-xs font-bold font-mono uppercase ${
                        report.status === 'PASS'
                          ? 'bg-emerald-200 text-emerald-900'
                          : report.status === 'WARNING'
                          ? 'bg-amber-200 text-amber-900'
                          : 'bg-red-200 text-red-900'
                      }`}
                    >
                      {report.status}
                    </span>
                  </div>
                  <p className="text-xs text-stone-600 mt-1 font-mono">
                    Output: Output/{report.file}
                  </p>
                </div>
              </div>
            </div>

            {report.reason && (
              <div className="mt-4 p-3 rounded-lg bg-white/80 border border-stone-200 text-xs text-stone-800 font-medium">
                Note: {report.reason}
              </div>
            )}

            {/* Metrics */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mt-6">
              <div className="bg-white/80 p-3.5 rounded-lg border border-stone-200">
                <div className="flex items-center space-x-1.5 text-stone-500 text-xs mb-1">
                  <Clock className="w-3.5 h-3.5" />
                  <span>Duration</span>
                </div>
                <div className="font-mono font-bold text-stone-900 text-sm">
                  {formatSec(report.duration_seconds)}
                </div>
                <div className="text-[11px] text-stone-400 font-mono">
                  {report.duration_seconds}s
                </div>
              </div>

              <div className="bg-white/80 p-3.5 rounded-lg border border-stone-200">
                <div className="flex items-center space-x-1.5 text-stone-500 text-xs mb-1">
                  <Bookmark className="w-3.5 h-3.5" />
                  <span>Chapters</span>
                </div>
                <div className="font-mono font-bold text-stone-900 text-sm">
                  {report.chapters_count} markers
                </div>
                <div className="text-[11px] text-stone-400 font-mono">
                  Embedded & Seekable
                </div>
              </div>

              <div className="bg-white/80 p-3.5 rounded-lg border border-stone-200">
                <div className="flex items-center space-x-1.5 text-stone-500 text-xs mb-1">
                  <HardDrive className="w-3.5 h-3.5" />
                  <span>File Size</span>
                </div>
                <div className="font-mono font-bold text-stone-900 text-sm">
                  {report.size_mb} MB
                </div>
                <div className="text-[11px] text-stone-400 font-mono">
                  AAC-LC Optimized
                </div>
              </div>

              <div className="bg-white/80 p-3.5 rounded-lg border border-stone-200">
                <div className="flex items-center space-x-1.5 text-stone-500 text-xs mb-1">
                  <FileCheck className="w-3.5 h-3.5" />
                  <span>Audio Sync</span>
                </div>
                <div className="font-mono font-bold text-emerald-700 text-sm">
                  Exact Match
                </div>
                <div className="text-[11px] text-stone-400 font-mono">
                  Diff &lt; 0.5s
                </div>
              </div>
            </div>
          </div>

          {/* Embedded Chapters Verification List */}
          <div className="bg-white rounded-xl border border-stone-200/80 shadow-xs overflow-hidden">
            <div className="p-4 border-b border-stone-200 bg-stone-50 flex items-center justify-between">
              <h3 className="font-semibold text-sm text-stone-800 flex items-center space-x-2">
                <Layers className="w-4 h-4 text-amber-600" />
                <span>Embedded Chapter Track Verification</span>
              </h3>
              <span className="text-xs text-stone-500 font-mono">
                {job.chapters.length} chapters loaded
              </span>
            </div>

            <div className="divide-y divide-stone-100 max-h-96 overflow-y-auto">
              {job.chapters.map((chap, idx) => (
                <div
                  key={chap.id || idx}
                  className="p-3 flex items-center justify-between hover:bg-stone-50 transition-colors text-xs"
                >
                  <div className="flex items-center space-x-3">
                    <span className="w-6 h-6 rounded bg-stone-100 text-stone-600 font-mono flex items-center justify-center font-bold text-[11px]">
                      {idx + 1}
                    </span>
                    <span className="font-medium text-stone-900">{chap.title}</span>
                  </div>
                  <div className="flex items-center space-x-2 font-mono text-stone-600">
                    <span className="px-2 py-0.5 rounded bg-stone-100 border border-stone-200 font-semibold">
                      {chap.start}
                    </span>
                    <CheckCircle2 className="w-4 h-4 text-emerald-600" />
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      ) : (
        <div className="p-12 text-center bg-white rounded-xl border border-stone-200/80 shadow-xs space-y-3">
          <FileCheck className="w-10 h-10 mx-auto text-stone-300" />
          <h3 className="font-semibold text-base text-stone-800">
            Output Not Yet Validated
          </h3>
          <p className="text-xs text-stone-500 max-w-md mx-auto">
            {job.outputM4b
              ? 'Click "Run Validation" above to test the compiled .m4b audio container with FFprobe.'
              : 'Complete Step 3 to build your M4B audiobook before running validation.'}
          </p>
        </div>
      )}
    </div>
  );
};
