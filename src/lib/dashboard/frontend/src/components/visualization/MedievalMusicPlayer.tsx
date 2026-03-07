/**
 * MedievalMusicPlayer Component
 *
 * A medieval-themed music player that plays local Bardcore MP3 tracks.
 * Uses parchment styling to match the medieval village aesthetic.
 *
 * Features:
 * - HTML5 Audio API for local MP3 playback
 * - Track selection with medieval styling
 * - Volume control
 * - Toggle expand/collapse
 * - Keyboard shortcut (M key) to toggle
 *
 * @module components/visualization/MedievalMusicPlayer
 */

import { useState, useEffect, useCallback, useRef, memo } from "react";

// =============================================================================
// Configuration
// =============================================================================

/**
 * Medieval music configuration with local MP3 files
 */
export const MEDIEVAL_MUSIC_CONFIG = {
  /** Bardcore tracks - local MP3 files in public/audio */
  tracks: [
    {
      title: "Pumped Up Kicks (Medieval)",
      artist: "Hildegard von Blingin'",
      src: "/audio/bardcore-pumped-up-kicks.mp3",
    },
    {
      title: "Bad Guy (Medieval)",
      artist: "Hildegard von Blingin'",
      src: "/audio/bardcore-bad-guy.mp3",
    },
    {
      title: "Jolene (Medieval)",
      artist: "Hildegard von Blingin'",
      src: "/audio/bardcore-jolene.mp3",
    },
  ],
} as const;

// =============================================================================
// Types
// =============================================================================

export interface MedievalMusicPlayerProps {
  /** Initial visibility state */
  initialExpanded?: boolean;
}

// =============================================================================
// Component
// =============================================================================

/**
 * MedievalMusicPlayer - Medieval-styled inline music player
 *
 * Plays local Bardcore MP3 tracks using HTML5 Audio API.
 * Press M key to toggle visibility.
 *
 * @example
 * <MedievalMusicPlayer initialExpanded={false} />
 */
export const MedievalMusicPlayer = memo(function MedievalMusicPlayer({
  initialExpanded = false,
}: MedievalMusicPlayerProps): JSX.Element {
  const [isExpanded, setIsExpanded] = useState(initialExpanded);
  const [currentTrack, setCurrentTrack] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const [volume, setVolume] = useState(0.5);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const audioRef = useRef<HTMLAudioElement | null>(null);

  // Initialize audio element
  useEffect(() => {
    const audio = new Audio();
    audio.volume = volume;
    audio.loop = false;
    audioRef.current = audio;

    // Event listeners
    const handleEnded = () => {
      // Auto-advance to next track
      setCurrentTrack((prev) => (prev + 1) % MEDIEVAL_MUSIC_CONFIG.tracks.length);
    };

    const handleTimeUpdate = () => {
      setCurrentTime(audio.currentTime);
    };

    const handleLoadedMetadata = () => {
      setDuration(audio.duration);
    };

    audio.addEventListener("ended", handleEnded);
    audio.addEventListener("timeupdate", handleTimeUpdate);
    audio.addEventListener("loadedmetadata", handleLoadedMetadata);

    return () => {
      audio.removeEventListener("ended", handleEnded);
      audio.removeEventListener("timeupdate", handleTimeUpdate);
      audio.removeEventListener("loadedmetadata", handleLoadedMetadata);
      audio.pause();
      audioRef.current = null;
    };
  }, []);

  // Update audio source when track changes
  useEffect(() => {
    if (!audioRef.current) return;
    const track = MEDIEVAL_MUSIC_CONFIG.tracks[currentTrack];
    audioRef.current.src = track.src;
    audioRef.current.load();
    if (isPlaying) {
      audioRef.current.play().catch(() => {
        // Autoplay blocked - user needs to interact first
        setIsPlaying(false);
      });
    }
  }, [currentTrack]);

  // Update volume
  useEffect(() => {
    if (audioRef.current) {
      audioRef.current.volume = volume;
    }
  }, [volume]);

  // Keyboard shortcut handler
  const handleKeyDown = useCallback((event: KeyboardEvent) => {
    if (
      event.target instanceof HTMLInputElement ||
      event.target instanceof HTMLTextAreaElement ||
      event.target instanceof HTMLSelectElement
    ) {
      return;
    }

    if (event.key.toLowerCase() === "m" && !event.ctrlKey && !event.metaKey && !event.altKey) {
      setIsExpanded((prev) => !prev);
    }
  }, []);

  useEffect(() => {
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [handleKeyDown]);

  const track = MEDIEVAL_MUSIC_CONFIG.tracks[currentTrack];

  const handlePlayPause = () => {
    if (!audioRef.current) return;
    if (isPlaying) {
      audioRef.current.pause();
      setIsPlaying(false);
    } else {
      audioRef.current.play().catch(() => {
        // Autoplay blocked
      });
      setIsPlaying(true);
    }
  };

  const handleNextTrack = () => {
    setCurrentTrack((prev) => (prev + 1) % MEDIEVAL_MUSIC_CONFIG.tracks.length);
    setIsPlaying(true);
  };

  const handlePrevTrack = () => {
    setCurrentTrack((prev) => (prev - 1 + MEDIEVAL_MUSIC_CONFIG.tracks.length) % MEDIEVAL_MUSIC_CONFIG.tracks.length);
    setIsPlaying(true);
  };

  const handleSeek = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (!audioRef.current) return;
    const time = parseFloat(e.target.value);
    audioRef.current.currentTime = time;
    setCurrentTime(time);
  };

  const formatTime = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${mins}:${secs.toString().padStart(2, "0")}`;
  };

  return (
    <div className="relative z-10">
      {/* Toggle button */}
      <button
        onClick={() => setIsExpanded(!isExpanded)}
        className="medieval-button px-3 py-2 text-sm flex items-center gap-2"
        title="Toggle music panel (M)"
      >
        <span className="text-lg">{isPlaying ? "🎶" : "🎵"}</span>
        <span className="hidden sm:inline">Bard</span>
        <span className="text-gray-400 text-xs ml-1">[M]</span>
      </button>

      {/* Expanded panel with inline player */}
      {isExpanded && (
        <div className="mt-2 medieval-panel p-4 w-72 relative">
          <div className="medieval-seal" style={{ top: -8, left: -8 }} />

          <h3 className="medieval-header text-sm mb-3 relative z-10">
            {isPlaying ? "🎶" : "🎵"} Bardcore Melodies
          </h3>

          {/* Now Playing Info */}
          <div className="relative z-10 mb-3 text-center">
            <div className="text-sm font-semibold truncate" style={{ color: "#3d2914" }}>
              {track.title}
            </div>
            <div className="text-xs" style={{ color: "#6b4423" }}>
              {track.artist}
            </div>
          </div>

          {/* Progress bar */}
          <div className="relative z-10 mb-2">
            <input
              type="range"
              min="0"
              max={duration || 100}
              value={currentTime}
              onChange={handleSeek}
              className="w-full medieval-slider"
              style={{ height: "4px" }}
            />
            <div className="flex justify-between text-xs mt-1" style={{ color: "#6b4423" }}>
              <span>{formatTime(currentTime)}</span>
              <span>{formatTime(duration)}</span>
            </div>
          </div>

          {/* Transport controls */}
          <div className="flex items-center justify-center gap-3 mb-3 relative z-10">
            <button
              onClick={handlePrevTrack}
              className="medieval-button px-3 py-2 text-sm"
              title="Previous track"
            >
              ⏮
            </button>
            <button
              onClick={handlePlayPause}
              className="medieval-button px-4 py-2 text-lg"
              title={isPlaying ? "Pause" : "Play"}
            >
              {isPlaying ? "⏸" : "▶"}
            </button>
            <button
              onClick={handleNextTrack}
              className="medieval-button px-3 py-2 text-sm"
              title="Next track"
            >
              ⏭
            </button>
          </div>

          {/* Volume control */}
          <div className="relative z-10 mb-3 flex items-center gap-2">
            <span className="text-xs" style={{ color: "#6b4423" }}>🔈</span>
            <input
              type="range"
              min="0"
              max="1"
              step="0.05"
              value={volume}
              onChange={(e) => setVolume(parseFloat(e.target.value))}
              className="flex-1 medieval-slider"
              style={{ height: "4px" }}
            />
            <span className="text-xs" style={{ color: "#6b4423" }}>🔊</span>
          </div>

          {/* Track list */}
          <div className="space-y-1 relative z-10">
            {MEDIEVAL_MUSIC_CONFIG.tracks.map((t, index) => (
              <button
                key={index}
                onClick={() => { setCurrentTrack(index); setIsPlaying(true); }}
                className="block w-full text-left text-xs p-2 rounded transition-all"
                style={{
                  borderBottom: "1px dashed #8b4513",
                  background: index === currentTrack ? "rgba(139, 69, 19, 0.2)" : "transparent",
                  cursor: "pointer",
                }}
              >
                <div className="flex items-center gap-2">
                  <span className="text-amber-600">
                    {index === currentTrack && isPlaying ? "♫" : "♪"}
                  </span>
                  <div className="flex-1 truncate">
                    <span className="font-semibold" style={{ color: "#3d2914" }}>
                      {t.title}
                    </span>
                  </div>
                </div>
              </button>
            ))}
          </div>

          <div className="mt-3 text-xs medieval-text-muted italic relative z-10">
            Hear ye the bard&apos;s melodies whilst ye toil
          </div>
        </div>
      )}
    </div>
  );
});

export default MedievalMusicPlayer;
