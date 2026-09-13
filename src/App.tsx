import React, { useState, useEffect } from 'react';
import {
  AudiobookJob,
  WorkbenchConfig,
  ChapterEntry,
  AudiobookMetadata,
  ChapterSourceType,
  AudioMergeMethodType,
} from './types';
import { Header } from './components/Header';
import { Step1MergeDetect } from './components/Step1MergeDetect';
import { Step2ChapterReview } from './components/Step2ChapterReview';
import { Step3Metadata } from './components/Step3Metadata';
import { Step4BuildM4b } from './components/Step4BuildM4b';
import { Step5Validate } from './components/Step5Validate';
import { PurgeModal } from './components/PurgeModal';
import { ConfigModal } from './components/ConfigModal';
import { NewJobModal } from './components/NewJobModal';
import { RequirementsModal } from './components/RequirementsModal';
import { LogsDrawer } from './components/LogsDrawer';
import { CheckCircle2, Clock, HardDrive, AlertCircle } from 'lucide-react';

export default function App() {
  const [jobs, setJobs] = useState<AudiobookJob[]>([]);
  const [currentJobId, setCurrentJobId] = useState<string>('');
  const [config, setConfig] = useState<WorkbenchConfig | null>(null);
  const [activeStep, setActiveStep] = useState<1 | 2 | 3 | 4 | 5>(1);

  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [isProcessingStep1, setIsProcessingStep1] = useState<boolean>(false);
  const [isBuildingM4b, setIsBuildingM4b] = useState<boolean>(false);
  const [isValidating, setIsValidating] = useState<boolean>(false);

  // Modals
  const [showPurgeModal, setShowPurgeModal] = useState<boolean>(false);
  const [showConfigModal, setShowConfigModal] = useState<boolean>(false);
  const [showNewJobModal, setShowNewJobModal] = useState<boolean>(false);
  const [showRequirementsModal, setShowRequirementsModal] = useState<boolean>(false);
  const [showLogsDrawer, setShowLogsDrawer] = useState<boolean>(false);

  // Initial fetch
  useEffect(() => {
    async function loadInitialData() {
      try {
        const [jobsRes, cfgRes] = await Promise.all([
          fetch('/api/jobs'),
          fetch('/api/config'),
        ]);
        const jobsData = await jobsRes.json();
        const cfgData = await cfgRes.json();
        setJobs(jobsData);
        setConfig(cfgData);
        if (jobsData.length > 0) {
          setCurrentJobId(jobsData[0].id);
          // Determine starting step based on job state
          if (jobsData[0].status === 'draft') {
            setActiveStep(1);
          } else if (jobsData[0].status === 'transcribed' || jobsData[0].status === 'merged') {
            setActiveStep(2);
          } else if (jobsData[0].status === 'metadata_ready') {
            setActiveStep(4);
          } else if (jobsData[0].status === 'built') {
            setActiveStep(4);
          } else if (jobsData[0].status === 'validated') {
            setActiveStep(5);
          }
        }
      } catch (err) {
        console.error('Failed to load initial data:', err);
      } finally {
        setIsLoading(false);
      }
    }
    loadInitialData();
  }, []);

  const currentJob = jobs.find((j) => j.id === currentJobId) || null;

  // Refresh current job from server
  const refreshCurrentJob = async (jobId: string) => {
    try {
      const res = await fetch(`/api/jobs/${jobId}`);
      if (res.ok) {
        const updated = await res.json();
        setJobs((prev) => prev.map((j) => (j.id === jobId ? updated : j)));
      }
    } catch (err) {
      console.error('Failed to refresh job:', err);
    }
  };

  // Step 1 Handler
  const handleRunStep1 = async (options?: {
    chapterSource?: ChapterSourceType;
    mergeMethod?: AudioMergeMethodType;
    selectedModelId?: string;
    sourceFolderPath?: string;
    outputFolderPath?: string;
    parts?: any[];
  }) => {
    if (!currentJob) return;
    setIsProcessingStep1(true);
    try {
      const res = await fetch(`/api/jobs/${currentJob.id}/process-step1`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(options || {}),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || data.message || 'Step 1 failed');
      await refreshCurrentJob(currentJob.id);
      setActiveStep(2);
    } catch (err: any) {
      alert(`Step 1 Error: ${err.message}`);
    } finally {
      setIsProcessingStep1(false);
    }
  };

  const handleUpdateJobSettings = async (settings: Partial<AudiobookJob>) => {
    if (!currentJob) return;
    try {
      await fetch(`/api/jobs/${currentJob.id}/step1-settings`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(settings),
      });
      await refreshCurrentJob(currentJob.id);
    } catch (err) {
      console.error('Failed to update job settings:', err);
    }
  };

  // Step 2 Handler
  const handleSaveChapters = async (chapters: ChapterEntry[]) => {
    if (!currentJob) return;
    const res = await fetch(`/api/jobs/${currentJob.id}/chapters`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chapters }),
    });
    const data = await res.json();
    if (!res.ok) {
      throw new Error(data.error || 'Failed to save chapters');
    }
    await refreshCurrentJob(currentJob.id);
  };

  // Step 3 Handler: Audiobook Metadata & Cover Art
  const handleSaveMetadata = async (metadata: AudiobookMetadata) => {
    if (!currentJob) return;
    const res = await fetch(`/api/jobs/${currentJob.id}/metadata`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ metadata }),
    });
    const data = await res.json();
    if (!res.ok) {
      throw new Error(data.error || 'Failed to save metadata');
    }
    await refreshCurrentJob(currentJob.id);
  };

  // Step 4 Handler: Build Chaptered Audio Package (M4B, M4A, MP3, FLAC, Opus, WAV)
  const handleBuildM4b = async (outputFormat: string = 'm4b') => {
    if (!currentJob) return;
    setIsBuildingM4b(true);
    try {
      const res = await fetch(`/api/jobs/${currentJob.id}/build-m4b`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ outputFormat }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Build failed');
      await refreshCurrentJob(currentJob.id);
      setActiveStep(5);
    } catch (err: any) {
      alert(`Build Error: ${err.message}`);
    } finally {
      setIsBuildingM4b(false);
    }
  };

  // Step 5 Handler: Validate Output
  const handleValidate = async () => {
    if (!currentJob) return;
    setIsValidating(true);
    try {
      const res = await fetch(`/api/jobs/${currentJob.id}/validate`, {
        method: 'POST',
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Validation failed');
      await refreshCurrentJob(currentJob.id);
    } catch (err: any) {
      alert(`Validation Error: ${err.message}`);
    } finally {
      setIsValidating(false);
    }
  };

  // Purge Handler
  const handlePurge = async (purgeType: 'temp' | 'intermediate' | 'job', confirmation?: string) => {
    if (!currentJob) return;
    const res = await fetch(`/api/jobs/${currentJob.id}/purge`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ purgeType, confirmation }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Purge failed');
    await refreshCurrentJob(currentJob.id);
    alert(data.message);
  };

  // Config Update Handler
  const handleSaveConfig = async (newConfig: WorkbenchConfig) => {
    const res = await fetch('/api/config', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(newConfig),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Config update failed');
    setConfig(data.config);
  };

  // Create Job Handler
  const handleCreateJob = async (jobData: any) => {
    const res = await fetch('/api/jobs', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(jobData),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Create job failed');
    setJobs((prev) => [data, ...prev]);
    setCurrentJobId(data.id);
    setActiveStep(1);
  };

  const formatDuration = (sec: number) => {
    const h = Math.floor(sec / 3600);
    const m = Math.floor((sec % 3600) / 60);
    const s = Math.floor(sec % 60);
    if (h > 0) return `${h}h ${m}m ${s}s`;
    return `${m}m ${s}s`;
  };

  if (isLoading || !config) {
    return (
      <div className="min-h-screen bg-stone-100 flex items-center justify-center p-4">
        <div className="text-center space-y-3">
          <div className="w-8 h-8 border-4 border-amber-600 border-t-transparent rounded-full animate-spin mx-auto" />
          <p className="text-stone-600 text-sm font-medium">
            Starting Audiobook Chapter Workbench...
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-stone-100 flex flex-col font-sans">
      {/* Top Header */}
      <Header
        jobs={jobs}
        currentJob={currentJob}
        onSelectJob={(id) => {
          setCurrentJobId(id);
          const job = jobs.find((j) => j.id === id);
          if (job) {
            if (job.status === 'draft') setActiveStep(1);
            else if (job.status === 'transcribed') setActiveStep(2);
            else if (job.status === 'metadata_ready') setActiveStep(3);
            else if (job.status === 'built') setActiveStep(4);
            else if (job.status === 'validated') setActiveStep(5);
          }
        }}
        onOpenNewJob={() => setShowNewJobModal(true)}
        onOpenSettings={() => setShowConfigModal(true)}
        onOpenPurge={() => setShowPurgeModal(true)}
        onOpenRequirements={() => setShowRequirementsModal(true)}
        onToggleLogs={() => setShowLogsDrawer(!showLogsDrawer)}
        showLogs={showLogsDrawer}
      />

      {/* Main Workspace */}
      <main className="flex-1 max-w-7xl w-full mx-auto px-4 sm:px-6 lg:px-8 py-6 space-y-6">
        {currentJob ? (
          <>
            {/* Book Meta & Step Progress Navigation */}
            <div className="bg-white rounded-xl p-5 border border-stone-200/80 shadow-xs space-y-4">
              <div className="flex flex-col md:flex-row md:items-center justify-between gap-3 border-b border-stone-100 pb-4">
                <div>
                  <div className="flex items-center space-x-2">
                    <h1 className="text-xl font-bold text-stone-900 tracking-tight">
                      {currentJob.name}
                    </h1>
                    <span className="px-2 py-0.5 rounded text-xs font-mono font-semibold bg-stone-100 text-stone-700 uppercase border border-stone-200">
                      {currentJob.status}
                    </span>
                  </div>
                  {(currentJob.author || currentJob.narrator) && (
                    <p className="text-xs text-stone-500 mt-0.5">
                      {currentJob.author && <span>By {currentJob.author}</span>}
                      {currentJob.author && currentJob.narrator && <span> • </span>}
                      {currentJob.narrator && <span>Narrated by {currentJob.narrator}</span>}
                    </p>
                  )}
                </div>

                <div className="flex items-center space-x-4 text-xs font-mono text-stone-600">
                  <span className="flex items-center space-x-1.5">
                    <Clock className="w-3.5 h-3.5 text-stone-400" />
                    <span>{formatDuration(currentJob.totalDurationSeconds)}</span>
                  </span>
                  <span>•</span>
                  <span>{currentJob.parts.length} source parts</span>
                  <span>•</span>
                  <span className="flex items-center space-x-1.5">
                    <HardDrive className="w-3.5 h-3.5 text-stone-400" />
                    <span>{(currentJob.totalSizeBytes / (1024 * 1024)).toFixed(1)} MB</span>
                  </span>
                </div>
              </div>

              {/* 5 Step Pipeline Navigation Tabs */}
              <nav aria-label="Workbench Steps" className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-2">
                {[
                  { step: 1, label: '1. Merge & Detect', desc: 'Decode PCM & transcribe' },
                  { step: 2, label: '2. Review Chapters', desc: 'Audit candidates & edit CSV' },
                  { step: 3, label: '3. Metadata & Cover', desc: 'Audiobookshelf tags & cover art' },
                  { step: 4, label: '4. Build M4B', desc: 'Compile FFmetadata & AAC audio' },
                  { step: 5, label: '5. Validate Output', desc: 'FFprobe container check' },
                ].map((item) => {
                  const isActive = activeStep === item.step;
                  const isCompleted =
                    (item.step === 1 && currentJob.status !== 'draft') ||
                    (item.step === 2 && currentJob.chapters.length > 0 && currentJob.status !== 'draft') ||
                    (item.step === 3 && (!!currentJob.metadata || currentJob.status === 'metadata_ready' || currentJob.status === 'built' || currentJob.status === 'validated')) ||
                    (item.step === 4 && (currentJob.status === 'built' || currentJob.status === 'validated')) ||
                    (item.step === 5 && currentJob.status === 'validated');

                  return (
                    <button
                      key={item.step}
                      id={`tab-step-${item.step}`}
                      onClick={() => setActiveStep(item.step as 1 | 2 | 3 | 4 | 5)}
                      className={`p-3 rounded-lg text-left transition-all cursor-pointer border ${
                        isActive
                          ? 'bg-amber-50/70 border-amber-400 ring-1 ring-amber-400/40'
                          : 'bg-stone-50 border-stone-200/80 hover:bg-stone-100/70'
                      }`}
                    >
                      <div className="flex items-center justify-between">
                        <span
                          className={`text-xs font-bold ${
                            isActive ? 'text-amber-900' : 'text-stone-800'
                          }`}
                        >
                          {item.label}
                        </span>
                        {isCompleted && (
                          <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600" />
                        )}
                      </div>
                      <p className="text-[11px] text-stone-500 mt-0.5 truncate">
                        {item.desc}
                      </p>
                    </button>
                  );
                })}
              </nav>
            </div>

            {/* Active Step Content */}
            {activeStep === 1 && (
              <Step1MergeDetect
                job={currentJob}
                config={config}
                onRunStep1={handleRunStep1}
                isRunning={isProcessingStep1}
                onNextStep={() => setActiveStep(2)}
                onUpdateJobSettings={handleUpdateJobSettings}
              />
            )}

            {activeStep === 2 && (
              <Step2ChapterReview
                job={currentJob}
                leadInSeconds={config.lead_in_seconds}
                onSaveChapters={handleSaveChapters}
                onNextStep={() => setActiveStep(3)}
              />
            )}

            {activeStep === 3 && (
              <Step3Metadata
                job={currentJob}
                onSaveMetadata={handleSaveMetadata}
                onNextStep={() => setActiveStep(4)}
              />
            )}

            {activeStep === 4 && (
              <Step4BuildM4b
                job={currentJob}
                config={config}
                onBuildM4b={handleBuildM4b}
                isBuilding={isBuildingM4b}
                onNextStep={() => setActiveStep(5)}
              />
            )}

            {activeStep === 5 && (
              <Step5Validate
                job={currentJob}
                onValidate={handleValidate}
                isValidating={isValidating}
              />
            )}
          </>
        ) : (
          <div className="bg-white rounded-xl p-12 text-center border border-stone-200 shadow-xs space-y-4">
            <h2 className="text-lg font-bold text-stone-900">No Audiobooks Available</h2>
            <p className="text-xs text-stone-500 max-w-sm mx-auto">
              Click the button below to add your first multi-part audiobook job.
            </p>
            <button
              onClick={() => setShowNewJobModal(true)}
              className="px-4 py-2 bg-amber-600 hover:bg-amber-500 text-white text-xs font-semibold rounded-lg cursor-pointer"
            >
              Add New Audiobook
            </button>
          </div>
        )}
      </main>

      {/* Logs / Console Bottom Drawer */}
      <LogsDrawer
        logs={currentJob?.logs || []}
        isOpen={showLogsDrawer}
        onClose={() => setShowLogsDrawer(false)}
      />

      {/* Modals */}
      {showPurgeModal && currentJob && (
        <PurgeModal
          job={currentJob}
          onClose={() => setShowPurgeModal(false)}
          onPurge={handlePurge}
        />
      )}

      {showConfigModal && (
        <ConfigModal
          config={config}
          onClose={() => setShowConfigModal(false)}
          onSaveConfig={handleSaveConfig}
        />
      )}

      {showNewJobModal && (
        <NewJobModal
          onClose={() => setShowNewJobModal(false)}
          onCreateJob={handleCreateJob}
        />
      )}

      {showRequirementsModal && (
        <RequirementsModal
          onClose={() => setShowRequirementsModal(false)}
        />
      )}
    </div>
  );
}
