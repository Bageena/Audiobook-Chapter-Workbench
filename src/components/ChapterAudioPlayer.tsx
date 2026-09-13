import React, { useRef, useState, useEffect, useMemo } from 'react';
import { AlignedWord } from '../types';
import { buildAlignedWords, formatTimestamp } from '../utils/wordAlignment';
import {
  Play,
  Pause,
  Square,
  Volume2,
  VolumeX,
  RotateCcw,
  RotateCw,
  Upload,
  Radio,
  FileAudio,
  Sparkles,
  Info,
  CheckCircle2,
  Clock,
  Pin
} from 'lucide-react';

export interface ActiveAudioTrack {
  id: string;
  chapterIndex?: number;
  title: string;
  start: string; // HH:MM:SS.mmm
  seconds: number;
  snippetText?: string;
  contextBefore?: string;
  matchedText?: string;
  contextAfter?: string;
  words?: AlignedWord[];
  sourceType: 'chapter' | 'candidate';
}

interface ChapterAudioPlayerProps {
  activeTrack: ActiveAudioTrack | null;
  isPlaying: boolean;
  onPlay: (track: ActiveAudioTrack) => void;
  onPause: () => void;
  onStop: () => void;
  onWordClick?: (timestamp: string, word: string, seconds: number) => void;
  totalDurationSeconds: number;
}

export const ChapterAudioPlayer: React.FC<ChapterAudioPlayerProps> = ({
  activeTrack,
  isPlaying,
  onPlay,
  onPause,
  onStop,
  onWordClick,
  totalDurationSeconds,
}) => {
  const [audioFile, setAudioFile] = useState<File | null>(null);
  const [audioUrl, setAudioUrl] = useState<string | null>(null);
  const [currentTime, setCurrentTime] = useState<number>(0);
  const [duration, setDuration] = useState<number>(totalDurationSeconds || 60);
  const [volume, setVolume] = useState<number>(0.9);
  const [isMuted, setIsMuted] = useState<boolean>(false);
  const [useSynthesizer, setUseSynthesizer] = useState<boolean>(true);
  const [lastClickedWord, setLastClickedWord] = useState<{ word: string; timestamp: string } | null>(null);

  const audioRef = useRef<HTMLAudioElement | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const synthUtteranceRef = useRef<SpeechSynthesisUtterance | null>(null);
  const synthTimerRef = useRef<any>(null);

  // Helper: Format seconds to HH:MM:SS
  const formatSec = (s: number): string => {
    const safe = Math.max(0, s);
    const hrs = Math.floor(safe / 3600);
    const mins = Math.floor((safe % 3600) / 60);
    const secs = Math.floor(safe % 60);
    return `${hrs.toString().padStart(2, '0')}:${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
  };

  // Play audio chime using Web Audio API for auditory feedback on clicks
  const playWordChime = (pitch: number = 740) => {
    try {
      const AudioContext = window.AudioContext || (window as any).webkitAudioContext;
      if (!AudioContext) return;
      const ctx = new AudioContext();
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();

      osc.type = 'sine';
      osc.frequency.setValueAtTime(pitch, ctx.currentTime);
      osc.frequency.exponentialRampToValueAtTime(pitch * 1.25, ctx.currentTime + 0.1);

      gain.gain.setValueAtTime(0.08 * (isMuted ? 0 : volume), ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.2);

      osc.connect(gain);
      gain.connect(ctx.destination);

      osc.start();
      osc.stop(ctx.currentTime + 0.2);
    } catch {
      // AudioContext policy
    }
  };

  // Build aligned clickable words for the active track
  const alignedWordsData = useMemo(() => {
    if (!activeTrack) return null;
    if (activeTrack.words && activeTrack.words.length > 0) {
      return {
        words: activeTrack.words,
        matchedStartIndex: 0,
        matchedEndIndex: activeTrack.words.length - 1,
      };
    }

    const before = activeTrack.contextBefore || '';
    const matched = activeTrack.matchedText || activeTrack.title || '';
    const after = activeTrack.contextAfter || '';

    if (!before && !after && activeTrack.snippetText) {
      // Parse snippetText if context parts aren't broken down
      return buildAlignedWords('', activeTrack.snippetText, '', activeTrack.seconds);
    }

    return buildAlignedWords(before, matched, after, activeTrack.seconds);
  }, [activeTrack]);

  // Clean up Object URL and SpeechSynthesis
  useEffect(() => {
    return () => {
      if (audioUrl) URL.revokeObjectURL(audioUrl);
      if ('speechSynthesis' in window) {
        window.speechSynthesis.cancel();
      }
      if (synthTimerRef.current) clearInterval(synthTimerRef.current);
    };
  }, [audioUrl]);

  // Handle user uploading local audiobook MP3
  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      if (audioUrl) URL.revokeObjectURL(audioUrl);
      const url = URL.createObjectURL(file);
      setAudioFile(file);
      setAudioUrl(url);
      setUseSynthesizer(false);

      if (activeTrack) {
        setTimeout(() => {
          if (audioRef.current) {
            audioRef.current.currentTime = activeTrack.seconds;
            audioRef.current.play().catch(() => {});
          }
        }, 150);
      }
    }
  };

  // Synchronize playback when activeTrack or isPlaying changes
  useEffect(() => {
    if (!activeTrack) {
      if (isPlaying) onStop();
      return;
    }

    // Mode 1: Real audio file attached
    if (audioUrl && !useSynthesizer && audioRef.current) {
      const audio = audioRef.current;
      audio.volume = isMuted ? 0 : volume;

      if (isPlaying) {
        audio.currentTime = activeTrack.seconds;
        setCurrentTime(activeTrack.seconds);
        audio.play().catch((e) => {
          console.warn('Playback error:', e);
        });
      } else {
        audio.pause();
      }
      return;
    }

    // Mode 2: Web Speech Synthesis + Sound Chime Narrator Preview
    if ('speechSynthesis' in window) {
      window.speechSynthesis.cancel();
      if (synthTimerRef.current) clearInterval(synthTimerRef.current);

      if (isPlaying) {
        playWordChime(587.33);
        setCurrentTime(activeTrack.seconds);

        const textToSay =
          activeTrack.snippetText ||
          `Now playing ${activeTrack.title} at ${activeTrack.start}. Chapter marker starts here.`;

        const utterance = new SpeechSynthesisUtterance(textToSay);
        utterance.rate = 1.0;
        utterance.pitch = 1.0;
        utterance.volume = isMuted ? 0 : volume;

        const voices = window.speechSynthesis.getVoices();
        const engVoice =
          voices.find(
            (v) =>
              v.lang.startsWith('en') &&
              (v.name.includes('Natural') ||
                v.name.includes('Google') ||
                v.name.includes('Samantha') ||
                v.name.includes('Daniel'))
          ) || voices.find((v) => v.lang.startsWith('en'));
        if (engVoice) utterance.voice = engVoice;

        utterance.onend = () => {
          if (synthTimerRef.current) clearInterval(synthTimerRef.current);
          onPause();
        };

        utterance.onerror = () => {
          if (synthTimerRef.current) clearInterval(synthTimerRef.current);
          onPause();
        };

        synthUtteranceRef.current = utterance;
        window.speechSynthesis.speak(utterance);

        const startTime = Date.now();
        synthTimerRef.current = setInterval(() => {
          const elapsed = (Date.now() - startTime) / 1000;
          setCurrentTime(activeTrack.seconds + elapsed);
        }, 200);
      } else {
        window.speechSynthesis.cancel();
      }
    }
  }, [activeTrack?.id, activeTrack?.start, isPlaying, audioUrl, useSynthesizer]);

  // Audio element events
  const handleTimeUpdate = () => {
    if (audioRef.current) {
      setCurrentTime(audioRef.current.currentTime);
    }
  };

  const handleLoadedMetadata = () => {
    if (audioRef.current) {
      setDuration(audioRef.current.duration || totalDurationSeconds);
      if (activeTrack) {
        audioRef.current.currentTime = activeTrack.seconds;
        setCurrentTime(activeTrack.seconds);
      }
    }
  };

  // Nudge playback -5s or +5s
  const handleSeekOffset = (offset: number) => {
    const nextTime = Math.max(0, currentTime + offset);
    setCurrentTime(nextTime);
    if (audioRef.current && audioUrl && !useSynthesizer) {
      audioRef.current.currentTime = nextTime;
    }
  };

  // Word Click Handler: snaps chapter timestamp to this clicked word!
  const handleWordClicked = (wordItem: AlignedWord) => {
    playWordChime(880);
    setCurrentTime(wordItem.startSeconds);
    setLastClickedWord({
      word: wordItem.word,
      timestamp: wordItem.start,
    });

    if (audioRef.current && audioUrl && !useSynthesizer) {
      audioRef.current.currentTime = wordItem.startSeconds;
      if (!isPlaying) {
        audioRef.current.play().catch(() => {});
      }
    }

    if (onWordClick) {
      onWordClick(wordItem.start, wordItem.word, wordItem.startSeconds);
    }
  };

  if (!activeTrack) {
    return (
      <div className="bg-stone-50 border border-stone-200/80 rounded-xl p-3 text-stone-500 text-xs flex flex-wrap items-center justify-between gap-3 shadow-2xs">
        <div className="flex items-center space-x-2">
          <Radio className="w-4 h-4 text-stone-400" />
          <span>
            Audio Audition Bar: Click any <strong className="text-stone-700">Listen ▶</strong> button in the table or candidates list. You can then click any word to snap the timestamp!
          </span>
        </div>
        <div className="flex items-center space-x-2">
          <input
            type="file"
            ref={fileInputRef}
            accept="audio/*"
            onChange={handleFileChange}
            className="hidden"
          />
          <button
            onClick={() => fileInputRef.current?.click()}
            className="flex items-center space-x-1.5 px-2.5 py-1 rounded bg-white border border-stone-300 text-stone-700 hover:bg-stone-100 text-[11px] font-medium shadow-2xs cursor-pointer"
            title="Attach your local audiobook MP3/M4B file to hear the actual narrator voice"
          >
            <Upload className="w-3.5 h-3.5 text-stone-500" />
            <span>Load Local MP3 for Real Audio</span>
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="bg-stone-900 text-stone-100 rounded-xl p-4 shadow-md border border-stone-800 space-y-3">
      {/* Hidden Audio Element for actual files */}
      {audioUrl && (
        <audio
          ref={audioRef}
          src={audioUrl}
          onTimeUpdate={handleTimeUpdate}
          onLoadedMetadata={handleLoadedMetadata}
          onEnded={() => onPause()}
        />
      )}

      {/* Track Header & Mode Badges */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b border-stone-800 pb-2.5 text-xs">
        <div className="flex items-center space-x-3">
          <div
            className={`w-8 h-8 rounded-lg flex items-center justify-center ${
              isPlaying
                ? 'bg-amber-500 text-stone-950 animate-pulse'
                : 'bg-stone-800 text-stone-300'
            }`}
          >
            <Volume2 className="w-4 h-4" />
          </div>

          <div>
            <div className="flex items-center space-x-2">
              <span className="font-bold text-amber-400 text-sm tracking-tight">
                {activeTrack.title}
              </span>
              <span className="font-mono bg-stone-800 text-stone-300 px-1.5 py-0.5 rounded text-[11px] font-semibold border border-stone-700">
                {activeTrack.start}
              </span>
            </div>
            <p className="text-[11px] text-stone-400 mt-0.5">
              {activeTrack.sourceType === 'candidate' ? 'Detected Candidate Mark' : 'Active Chapter Track'}
            </p>
          </div>
        </div>

        {/* Playback Mode Controls */}
        <div className="flex items-center space-x-2 text-xs">
          {audioFile ? (
            <div className="flex items-center space-x-1.5 bg-emerald-950/80 text-emerald-400 px-2.5 py-1 rounded border border-emerald-800 text-[11px]">
              <FileAudio className="w-3.5 h-3.5 shrink-0" />
              <span className="truncate max-w-[140px]" title={audioFile.name}>
                {audioFile.name}
              </span>
              <button
                onClick={() => setUseSynthesizer(!useSynthesizer)}
                className="ml-1 text-[10px] underline text-stone-400 hover:text-white cursor-pointer"
              >
                {useSynthesizer ? 'Switch to MP3' : 'Switch to Voice'}
              </button>
            </div>
          ) : (
            <div className="flex items-center space-x-1.5 bg-stone-800/90 text-amber-300 px-2.5 py-1 rounded border border-stone-700 text-[11px]">
              <Sparkles className="w-3.5 h-3.5 text-amber-400 shrink-0" />
              <span>Narrator Speech & Chime</span>
            </div>
          )}

          <input
            type="file"
            ref={fileInputRef}
            accept="audio/*"
            onChange={handleFileChange}
            className="hidden"
          />
          <button
            onClick={() => fileInputRef.current?.click()}
            className="flex items-center space-x-1 px-2 py-1 rounded bg-stone-800 hover:bg-stone-700 text-stone-300 text-[11px] border border-stone-700 cursor-pointer"
            title="Upload actual audiobook MP3 to listen directly to the narrator"
          >
            <Upload className="w-3 h-3 text-stone-400" />
            <span>{audioFile ? 'Change MP3' : 'Use MP3 File'}</span>
          </button>
        </div>
      </div>

      {/* Interactive Transcribe / Word Alignment Section (Click any word to update timestamp) */}
      <div className="bg-stone-950/90 rounded-lg p-3 border border-stone-800 text-xs space-y-2">
        <div className="flex items-center justify-between text-[11px] text-stone-400 border-b border-stone-800/80 pb-1.5">
          <div className="flex items-center space-x-1.5 text-amber-400 font-semibold">
            <Sparkles className="w-3.5 h-3.5" />
            <span>Interactive Transcription Window</span>
          </div>

          <div className="flex items-center space-x-2">
            {lastClickedWord && (
              <span className="text-emerald-400 bg-emerald-950/80 px-2 py-0.5 rounded border border-emerald-800 flex items-center space-x-1 text-[10px] animate-fadeIn">
                <CheckCircle2 className="w-3 h-3" />
                <span>
                  Snapped to <strong>"{lastClickedWord.word}"</strong> ({lastClickedWord.timestamp})
                </span>
              </span>
            )}
            <span className="text-stone-400 text-[10px] hidden sm:inline">
              👆 Click any word to snap chapter start to that timestamp
            </span>
          </div>
        </div>

        {/* Word Chips Flow */}
        <div className="flex flex-wrap gap-1 leading-relaxed max-h-40 overflow-y-auto pr-1 py-1">
          {alignedWordsData && alignedWordsData.words.length > 0 ? (
            alignedWordsData.words.map((w, idx) => {
              const isMatchedWord =
                idx >= alignedWordsData.matchedStartIndex && idx <= alignedWordsData.matchedEndIndex;
              const isSelectedWord = lastClickedWord?.timestamp === w.start;

              return (
                <button
                  key={`${w.start}-${idx}`}
                  type="button"
                  onClick={() => handleWordClicked(w)}
                  className={`group relative inline-flex items-center px-1.5 py-0.5 rounded text-[11px] font-sans transition-all cursor-pointer ${
                    isSelectedWord
                      ? 'bg-emerald-500 text-stone-950 font-bold ring-2 ring-emerald-300 scale-105 shadow-xs'
                      : isMatchedWord
                      ? 'bg-amber-500/20 text-amber-300 border border-amber-500/40 hover:bg-amber-400 hover:text-stone-950 font-medium'
                      : 'bg-stone-800/80 text-stone-300 hover:bg-stone-700 hover:text-white border border-transparent'
                  }`}
                  title={`Click to set timestamp to ${w.start}`}
                >
                  <span>{w.word}</span>

                  {/* Micro timestamp popup on hover */}
                  <span className="absolute -top-7 left-1/2 -translate-x-1/2 hidden group-hover:flex items-center space-x-1 bg-stone-950 text-amber-300 text-[9px] font-mono px-1.5 py-0.5 rounded shadow-lg border border-stone-700 whitespace-nowrap z-20 pointer-events-none">
                    <Clock className="w-2.5 h-2.5" />
                    <span>{w.start}</span>
                  </span>
                </button>
              );
            })
          ) : (
            <div className="text-stone-500 text-[11px] italic">
              {activeTrack.snippetText || 'No transcription segment available.'}
            </div>
          )}
        </div>
      </div>

      {/* Main Transport & Timeline Controls */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pt-1">
        {/* Play / Pause / Seek Buttons */}
        <div className="flex items-center space-x-2">
          <button
            id="btn-player-seek-back"
            onClick={() => handleSeekOffset(-5)}
            className="p-1.5 rounded-lg bg-stone-800 hover:bg-stone-700 text-stone-300 cursor-pointer transition-colors"
            title="Rewind 5 seconds"
          >
            <RotateCcw className="w-4 h-4" />
          </button>

          <button
            id="btn-player-toggle-play"
            onClick={() => {
              if (isPlaying) onPause();
              else onPlay(activeTrack);
            }}
            className="px-4 py-2 rounded-lg bg-amber-500 hover:bg-amber-400 text-stone-950 font-bold flex items-center space-x-1.5 shadow-sm transition-transform active:scale-95 cursor-pointer"
            title={isPlaying ? 'Pause Chapter Preview' : 'Play Chapter Preview'}
          >
            {isPlaying ? (
              <>
                <Pause className="w-4 h-4 fill-stone-950" />
                <span className="text-xs">Pause</span>
              </>
            ) : (
              <>
                <Play className="w-4 h-4 fill-stone-950" />
                <span className="text-xs">Play</span>
              </>
            )}
          </button>

          <button
            id="btn-player-seek-fwd"
            onClick={() => handleSeekOffset(5)}
            className="p-1.5 rounded-lg bg-stone-800 hover:bg-stone-700 text-stone-300 cursor-pointer transition-colors"
            title="Forward 5 seconds"
          >
            <RotateCw className="w-4 h-4" />
          </button>

          <button
            id="btn-player-stop"
            onClick={onStop}
            className="p-1.5 rounded-lg bg-stone-800 hover:bg-stone-700 text-stone-400 hover:text-red-400 cursor-pointer transition-colors"
            title="Stop & Dismiss Player"
          >
            <Square className="w-4 h-4" />
          </button>
        </div>

        {/* Timestamp Scrubber & Display */}
        <div className="flex-1 flex items-center space-x-3 px-2">
          <span className="font-mono text-xs text-amber-400 font-medium">
            {formatSec(currentTime)}
          </span>

          <div className="flex-1 relative flex items-center">
            <input
              type="range"
              min={Math.max(0, activeTrack.seconds - 30)}
              max={activeTrack.seconds + 60}
              step="0.5"
              value={currentTime}
              onChange={(e) => {
                const val = parseFloat(e.target.value);
                setCurrentTime(val);
                if (audioRef.current && audioUrl && !useSynthesizer) {
                  audioRef.current.currentTime = val;
                }
              }}
              className="w-full h-1.5 bg-stone-800 rounded-lg appearance-none cursor-pointer accent-amber-500"
            />
          </div>

          <span className="font-mono text-xs text-stone-500">
            {formatSec(activeTrack.seconds + 60)}
          </span>
        </div>

        {/* Volume Controls */}
        <div className="flex items-center space-x-2">
          <button
            onClick={() => setIsMuted(!isMuted)}
            className="p-1 text-stone-400 hover:text-stone-200 cursor-pointer"
            title={isMuted ? 'Unmute' : 'Mute'}
          >
            {isMuted ? <VolumeX className="w-4 h-4" /> : <Volume2 className="w-4 h-4" />}
          </button>
          <input
            type="range"
            min="0"
            max="1"
            step="0.05"
            value={isMuted ? 0 : volume}
            onChange={(e) => {
              const val = parseFloat(e.target.value);
              setVolume(val);
              setIsMuted(false);
              if (audioRef.current) audioRef.current.volume = val;
            }}
            className="w-16 h-1.5 bg-stone-800 rounded-lg appearance-none cursor-pointer accent-amber-500"
            title="Volume"
          />
        </div>
      </div>
    </div>
  );
};
