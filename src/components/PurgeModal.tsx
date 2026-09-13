import React, { useState } from 'react';
import { AudiobookJob } from '../types';
import { Trash2, AlertTriangle, Check, ShieldAlert } from 'lucide-react';

interface PurgeModalProps {
  job: AudiobookJob;
  onClose: () => void;
  onPurge: (purgeType: 'temp' | 'intermediate' | 'job', confirmation?: string) => Promise<void>;
}

export const PurgeModal: React.FC<PurgeModalProps> = ({ job, onClose, onPurge }) => {
  const [purgeType, setPurgeType] = useState<'temp' | 'intermediate' | 'job'>('temp');
  const [confirmationInput, setConfirmationInput] = useState('');
  const [isPurging, setIsPurging] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const requiredPhrase = `PURGE ${job.name}`;

  const handleExecutePurge = async () => {
    setErrorMsg(null);
    if (purgeType === 'job' && confirmationInput.trim() !== requiredPhrase) {
      setErrorMsg(`You must type '${requiredPhrase}' exactly to confirm.`);
      return;
    }

    setIsPurging(true);
    try {
      await onPurge(purgeType, confirmationInput.trim());
      onClose();
    } catch (e: any) {
      setErrorMsg(e.message || 'Failed to execute purge.');
    } finally {
      setIsPurging(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-stone-900/60 backdrop-blur-xs flex items-center justify-center p-4 z-50">
      <div className="bg-white rounded-xl max-w-lg w-full p-6 shadow-xl border border-stone-200 space-y-5">
        <div className="flex items-center justify-between">
          <div className="flex items-center space-x-2 text-stone-900 font-bold text-base">
            <Trash2 className="w-5 h-5 text-red-600" />
            <span>Disk Cleanup & Purging</span>
          </div>
          <button
            onClick={onClose}
            className="text-stone-400 hover:text-stone-600 text-lg cursor-pointer"
          >
            ✕
          </button>
        </div>

        <p className="text-xs text-stone-600">
          Raw audio processing and Whisper transcription generate large working files. Use this tool to reclaim disk space safely.
        </p>

        {/* Purge Type Radio Selector */}
        <div className="space-y-3 text-xs">
          <label className={`block p-3 rounded-lg border cursor-pointer transition-all ${
            purgeType === 'temp' ? 'border-amber-500 bg-amber-50/40' : 'border-stone-200 hover:bg-stone-50'
          }`}>
            <div className="flex items-center space-x-2">
              <input
                type="radio"
                name="purgeType"
                checked={purgeType === 'temp'}
                onChange={() => setPurgeType('temp')}
                className="text-amber-600 focus:ring-amber-500"
              />
              <span className="font-semibold text-stone-900">
                Option 1: Temporary PCM work files only
              </span>
            </div>
            <p className="text-stone-500 text-[11px] mt-1 ml-5">
              Removes leftover uncompressed PCM files from failed/interrupted jobs.
            </p>
          </label>

          <label className={`block p-3 rounded-lg border cursor-pointer transition-all ${
            purgeType === 'intermediate' ? 'border-amber-500 bg-amber-50/40' : 'border-stone-200 hover:bg-stone-50'
          }`}>
            <div className="flex items-center space-x-2">
              <input
                type="radio"
                name="purgeType"
                checked={purgeType === 'intermediate'}
                onChange={() => setPurgeType('intermediate')}
                className="text-amber-600 focus:ring-amber-500"
              />
              <span className="font-semibold text-stone-900">
                Option 2: Intermediates (Merged MP3 + Whisper JSON)
              </span>
            </div>
            <p className="text-stone-500 text-[11px] mt-1 ml-5">
              Removes the working CBR MP3 in <code>Merge/</code> and Whisper transcription JSON.
            </p>
          </label>

          <label className={`block p-3 rounded-lg border cursor-pointer transition-all ${
            purgeType === 'job' ? 'border-red-500 bg-red-50/40' : 'border-stone-200 hover:bg-stone-50'
          }`}>
            <div className="flex items-center space-x-2">
              <input
                type="radio"
                name="purgeType"
                checked={purgeType === 'job'}
                onChange={() => setPurgeType('job')}
                className="text-red-600 focus:ring-red-500"
              />
              <span className="font-semibold text-red-900">
                Option 3: All job source data (Input + Intermediates)
              </span>
            </div>
            <p className="text-stone-500 text-[11px] mt-1 ml-5">
              Removes original files in <code>Input/</code> and intermediates. Keeps <code>Output/</code> .m4b and CSVs.
            </p>
          </label>
        </div>

        {/* Confirmation phrase for Option 3 */}
        {purgeType === 'job' && (
          <div className="p-3 bg-red-50 rounded-lg border border-red-200 space-y-2 text-xs text-red-800">
            <div className="flex items-center space-x-1.5 font-semibold">
              <ShieldAlert className="w-4 h-4 text-red-600" />
              <span>Destructive Action Confirmation</span>
            </div>
            <p className="text-[11px]">
              Type <strong className="font-mono">{requiredPhrase}</strong> below to confirm permanent deletion of input files:
            </p>
            <input
              type="text"
              value={confirmationInput}
              onChange={(e) => setConfirmationInput(e.target.value)}
              placeholder={requiredPhrase}
              className="w-full px-3 py-1.5 border border-red-300 rounded font-mono text-xs bg-white text-stone-900"
            />
          </div>
        )}

        {errorMsg && (
          <div className="p-2 rounded bg-red-100 text-red-700 text-xs font-medium">
            {errorMsg}
          </div>
        )}

        {/* Preservation Guarantee */}
        <p className="text-[11px] text-stone-500 italic">
          * Your generated .m4b files in Output/ and CSV files are never deleted by the purge tool.
        </p>

        <div className="flex justify-end space-x-2 pt-2">
          <button
            onClick={onClose}
            className="px-3 py-1.5 rounded text-xs border border-stone-300 text-stone-700 hover:bg-stone-50 cursor-pointer"
          >
            Cancel
          </button>
          <button
            onClick={handleExecutePurge}
            disabled={isPurging}
            className={`px-4 py-1.5 rounded text-xs font-semibold text-white transition-colors cursor-pointer ${
              purgeType === 'job'
                ? 'bg-red-600 hover:bg-red-500'
                : 'bg-amber-600 hover:bg-amber-500'
            }`}
          >
            {isPurging ? 'Purging...' : 'Execute Purge'}
          </button>
        </div>
      </div>
    </div>
  );
};
