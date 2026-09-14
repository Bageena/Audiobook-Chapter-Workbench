import React, { useState, useEffect } from 'react';
import { AudiobookJob } from '../types';
import { Headphones, Plus, Settings, Trash2, BookOpen, Terminal, Wrench, AlertCircle } from 'lucide-react';

interface HeaderProps {
  jobs: AudiobookJob[];
  currentJob: AudiobookJob | null;
  onSelectJob: (jobId: string) => void;
  onOpenNewJob: () => void;
  onOpenSettings: () => void;
  onOpenPurge: () => void;
  onOpenRequirements: () => void;
  onToggleLogs: () => void;
  showLogs: boolean;
}

export const Header: React.FC<HeaderProps> = ({
  jobs,
  currentJob,
  onSelectJob,
  onOpenNewJob,
  onOpenSettings,
  onOpenPurge,
  onOpenRequirements,
  onToggleLogs,
  showLogs,
}) => {
  const [hasRequirementsWarning, setHasRequirementsWarning] = useState<boolean>(false);

  // Check requirements health on load
  useEffect(() => {
    let isMounted = true;
    const checkRequirementsHealth = async () => {
      try {
        const res = await fetch('/api/requirements/status');
        if (res.ok && isMounted) {
          const data = await res.json();
          setHasRequirementsWarning(!data.allReady);
        }
      } catch (e) {}
    };

    checkRequirementsHealth();
    const timer = setInterval(checkRequirementsHealth, 10000);
    return () => {
      isMounted = false;
      clearInterval(timer);
    };
  }, []);
  return (
    <header className="bg-stone-900 text-stone-100 border-b border-stone-800 sticky top-0 z-30 shadow-md">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-16 flex items-center justify-between">
        {/* Logo & Title */}
        <div className="flex items-center space-x-3">
          <div className="w-10 h-10 rounded-lg bg-amber-600/90 text-white flex items-center justify-center shadow-inner">
            <Headphones className="w-5 h-5 text-white" />
          </div>
          <div>
            <div className="flex items-center space-x-2">
              <span className="font-bold text-lg tracking-tight text-stone-50">
                Audiobook Workbench
              </span>
              <span className="text-xs px-2 py-0.5 rounded bg-stone-800 text-stone-300 font-mono">
                v1.3.0-desktop
              </span>
            </div>
            <p className="text-xs text-stone-400 hidden sm:block">
              Multi-format audio • YouTube import • WhisperX AI detection • M4B & chaptered audio compiler
            </p>
          </div>
        </div>

        {/* Center: Active Job Selector */}
        <div className="flex items-center space-x-2">
          <div className="flex items-center bg-stone-800/80 rounded-lg border border-stone-700/60 p-1">
            <BookOpen className="w-4 h-4 text-stone-400 ml-2" />
            <select
              id="job-select-dropdown"
              value={currentJob?.id || ''}
              onChange={(e) => onSelectJob(e.target.value)}
              className="bg-transparent text-sm text-stone-100 font-medium px-2 py-1 focus:outline-none cursor-pointer"
            >
              {jobs.map((j) => (
                <option key={j.id} value={j.id} className="bg-stone-900 text-stone-100">
                  {j.name} ({j.parts.length} parts)
                </option>
              ))}
            </select>
          </div>

          <button
            id="btn-new-job"
            onClick={onOpenNewJob}
            className="flex items-center space-x-1.5 px-3 py-1.5 text-xs font-semibold rounded-lg bg-amber-600 hover:bg-amber-500 text-white transition-colors cursor-pointer"
            title="Create new audiobook job"
          >
            <Plus className="w-3.5 h-3.5" />
            <span className="hidden md:inline">Add Book</span>
          </button>
        </div>

        {/* Right actions: Requirements, Purge, Settings, Logs toggle */}
        <div className="flex items-center space-x-2 ml-4 sm:ml-6">
          <button
            id="btn-open-requirements"
            onClick={onOpenRequirements}
            className={`flex items-center space-x-1.5 px-2.5 py-1.5 text-xs rounded-lg border transition-colors cursor-pointer relative ${
              hasRequirementsWarning
                ? 'border-amber-500 bg-amber-950/40 text-amber-300 hover:bg-amber-900/50'
                : 'border-stone-700 text-stone-300 hover:bg-stone-800 hover:text-stone-100'
            }`}
            title="Check, install, repair, or update required local components."
          >
            <Wrench className="w-3.5 h-3.5" />
            <span className="hidden sm:inline">Requirements</span>
            {hasRequirementsWarning ? (
              <span className="flex h-2 w-2 relative -mr-0.5">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-amber-400 opacity-75"></span>
                <span className="relative inline-flex rounded-full h-2 w-2 bg-amber-500"></span>
              </span>
            ) : (
              <span className="flex h-2 w-2 relative -mr-0.5">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
                <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500"></span>
              </span>
            )}
          </button>

          <button
            id="btn-open-purge"
            onClick={onOpenPurge}
            disabled={!currentJob}
            className="flex items-center space-x-1.5 px-2.5 py-1.5 text-xs rounded-lg border border-stone-700 text-stone-300 hover:bg-stone-800 hover:text-red-400 transition-colors disabled:opacity-40 cursor-pointer"
            title="Purge Temporary / Intermediate Files (05 - Purge)"
          >
            <Trash2 className="w-3.5 h-3.5" />
            <span className="hidden sm:inline">Purge</span>
          </button>

          <button
            id="btn-open-settings"
            onClick={onOpenSettings}
            className="flex items-center space-x-1.5 px-2.5 py-1.5 text-xs rounded-lg border border-stone-700 text-stone-300 hover:bg-stone-800 hover:text-stone-100 transition-colors cursor-pointer"
            title="Workbench Configuration (config.json)"
          >
            <Settings className="w-3.5 h-3.5" />
            <span className="hidden sm:inline">Config</span>
          </button>

          <button
            id="btn-toggle-terminal"
            onClick={onToggleLogs}
            className={`flex items-center space-x-1 px-2.5 py-1.5 text-xs rounded-lg border transition-colors cursor-pointer ${
              showLogs
                ? 'bg-stone-800 border-amber-500 text-amber-400'
                : 'border-stone-700 text-stone-400 hover:bg-stone-800 hover:text-stone-200'
            }`}
            title="Toggle workbench terminal output logs"
          >
            <Terminal className="w-3.5 h-3.5" />
            <span className="hidden md:inline">Logs</span>
          </button>
        </div>
      </div>
    </header>
  );
};
