import { useEffect, useRef, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import Hls from 'hls.js';
import * as api from '../api';

function Player({
  stream,
  subtitles,
}: {
  stream: api.VideoStream;
  /** Subtitle tracks to render — the caller hands these in so the selector can
   *  reflect what the SDK actually advertised for this unit (via `/tracks` and
   *  falling back to `stream.subtitles`). */
  subtitles: api.SubtitleTrack[];
}) {
  const ref = useRef<HTMLVideoElement>(null);
  const [playerError, setPlayerError] = useState<string | null>(null);
  const [hlsSubTracks, setHlsSubTracks] = useState<{ id: number; name: string; lang: string }[]>(
    [],
  );
  // -1 = off; 0..N-1 = external <track>; 1000+i = HLS track i (kept distinct so the
  // two source sets don't collide).
  const [activeSub, setActiveSub] = useState<number>(-1);
  const hlsRef = useRef<Hls | undefined>(undefined);
  const externalSubs = subtitles;

  useEffect(() => {
    const v = ref.current;
    if (!v) return;
    setPlayerError(null);
    setHlsSubTracks([]);
    setActiveSub(externalSubs.length > 0 ? 0 : -1);

    let hls: Hls | undefined;
    if (stream.isHLS) {
      if (Hls.isSupported()) {
        hls = new Hls({ enableWorker: false });
        hls.subtitleDisplay = true;
        hls.on(Hls.Events.ERROR, (_, d) => {
          if (d.fatal) setPlayerError(`HLS error: ${d.details}`);
        });
        hls.on(Hls.Events.SUBTITLE_TRACKS_UPDATED, (_, d) => {
          const tracks = (d.subtitleTracks ?? []).map((t: any) => ({
            id: t.id,
            name: t.name ?? t.lang ?? `Track ${t.id}`,
            lang: t.lang ?? '',
          }));
          setHlsSubTracks(tracks);
          // Only auto-enable an HLS track if we don't already have an external one.
          if (tracks.length > 0 && externalSubs.length === 0) {
            hls!.subtitleTrack = 0;
            setActiveSub(1000);
          } else {
            hls!.subtitleTrack = -1;
          }
        });
        hls.loadSource(stream.sourceUrl);
        hls.attachMedia(v);
        hlsRef.current = hls;
        v.play().catch(() => {});
      } else if (v.canPlayType('application/vnd.apple.mpegurl')) {
        v.src = stream.sourceUrl;
        v.play().catch(() => {});
      } else {
        setPlayerError('HLS not supported in this browser');
      }
    } else {
      v.src = stream.sourceUrl;
      v.play().catch(() => {});
    }

    return () => {
      hls?.destroy();
      hlsRef.current = undefined;
      v.src = '';
    };
  }, [stream.sourceUrl, stream.isHLS, externalSubs.length]);

  // Apply external-track selection imperatively: <track default> alone doesn't
  // reliably enable a track across browsers, and toggling needs runtime control.
  useEffect(() => {
    const v = ref.current;
    if (!v) return;
    const textTracks = v.textTracks;
    for (let i = 0; i < textTracks.length; i++) {
      textTracks[i].mode = activeSub === i ? 'showing' : 'disabled';
    }
  }, [activeSub, externalSubs.length]);

  const selectSub = (key: number) => {
    setActiveSub(key);
    if (hlsRef.current) {
      hlsRef.current.subtitleTrack = key >= 1000 ? key - 1000 : -1;
    }
  };

  const hasSubtitleUI = hlsSubTracks.length > 0 || externalSubs.length > 0;

  if (playerError) {
    return (
      <div className="flex aspect-video items-center justify-center border border-[#1e1e1e] bg-[#0d0d0d]">
        <p className="text-xs text-[#444]">{playerError}</p>
      </div>
    );
  }

  return (
    <div>
      <video
        ref={ref}
        controls
        crossOrigin="anonymous"
        className="aspect-video w-full border border-[#1e1e1e] bg-black"
      >
        {externalSubs.map((s, i) => (
          <track
            key={`${stream.sourceUrl}-${i}`}
            kind="subtitles"
            src={s.url}
            srcLang={s.language}
            label={s.label}
          />
        ))}
      </video>
      {hasSubtitleUI && (
        <div className="flex flex-wrap items-center gap-2 border-b border-[#1a1a1a] px-1 py-2">
          <span className="text-xs tracking-widest text-[#999]">SUB</span>
          <button
            onClick={() => selectSub(-1)}
            className={`text-xs transition-colors ${activeSub === -1 ? 'text-white' : 'text-[#444] hover:text-[#888]'}`}
          >
            off
          </button>
          {externalSubs.map((s, i) => (
            <button
              key={`ext-${i}`}
              onClick={() => selectSub(i)}
              className={`text-xs transition-colors ${activeSub === i ? 'text-white' : 'text-[#444] hover:text-[#888]'}`}
            >
              {s.label}
            </button>
          ))}
          {hlsSubTracks.map((t) => (
            <button
              key={`hls-${t.id}`}
              onClick={() => selectSub(1000 + t.id)}
              className={`text-xs transition-colors ${activeSub === 1000 + t.id ? 'text-white' : 'text-[#444] hover:text-[#888]'}`}
            >
              {t.name}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function MangaReader({ pages }: { pages: api.MangaStream }) {
  return (
    <div className="flex flex-col items-center gap-4 bg-black">
      {pages.imageUrls.map((url, i) => (
        <img
          key={i}
          src={url}
          alt={`Page ${i + 1}`}
          className="min-h-64 max-w-full"
          loading="lazy"
        />
      ))}
    </div>
  );
}

export default function Stream() {
  const navigate = useNavigate();
  const [sp] = useSearchParams();

  const provider = sp.get('provider') || '';
  const unitId = sp.get('uid') || '';
  const title = sp.get('title') || '';
  const mediaId = sp.get('mid') || '';
  const epLabel = sp.get('ep') || '';
  const type = sp.get('type') || 'ANIME';

  const isManga = type === 'MANGA';
  const unitLabel = isManga ? 'CHAPTERS' : 'EPISODES';
  const unitPrefix = isManga ? 'Chapter' : 'EP';

  // Language lives in component state — never in the URL. The episode list is
  // language-agnostic; only the playback resolution needs a language pick.
  const [lang, setLang] = useState<api.Lang>('sub');
  const [activeIdx, setActiveIdx] = useState(0);
  const [showEpisodes, setShowEpisodes] = useState(false);

  // Episode list — language-agnostic, one call. Each episode advertises its
  // own `availableLanguages`; we use the current episode's list to decide
  // which LANG buttons make sense.
  const { data: episodes } = useQuery<api.Episode[]>({
    queryKey: ['content', provider, mediaId],
    queryFn: () => api.content(provider, mediaId),
    enabled: !!(provider && mediaId),
    staleTime: 5 * 60 * 1000,
  });

  const currentEpNum = epLabel ? parseFloat(epLabel.replace(/^[A-Z]+\.0*/i, '')) : null;
  const currentIdx = episodes?.findIndex((e) => e.number === currentEpNum) ?? -1;
  const currentEpisode = currentIdx >= 0 ? episodes![currentIdx] : null;
  const availableLangs = currentEpisode?.availableLanguages ?? ['sub'];

  // If our current `lang` isn't one this episode supports, drop to the first
  // language that *is* supported.
  useEffect(() => {
    if (availableLangs.length > 0 && !availableLangs.includes(lang)) {
      setLang(availableLangs[0]);
    }
  }, [availableLangs, lang]);

  const { data, isFetching, isError, error } = useQuery<api.ResolvedStream>({
    queryKey: ['stream', provider, unitId, lang],
    queryFn: () => api.stream(provider, unitId, lang),
    enabled: !!(provider && unitId),
  });

  const streams = data?.type === 'video' ? (data.streams ?? []) : [];
  const active = streams[activeIdx] ?? null;
  const subtitles = active?.subtitles ?? [];

  const prevEp = currentIdx > 0 ? episodes![currentIdx - 1] : null;
  const nextEp =
    currentIdx >= 0 && currentIdx < (episodes?.length ?? 0) - 1 ? episodes![currentIdx + 1] : null;

  const goEpisode = (ep: api.Episode) =>
    navigate(
      `/stream?provider=${provider}&uid=${encodeURIComponent(ep.id)}` +
        `&title=${encodeURIComponent(title)}&ep=${encodeURIComponent(`${unitPrefix}.${String(ep.number).padStart(3, '0')}`)}&mid=${encodeURIComponent(mediaId)}&type=${type}`,
    );

  // Reset active source when stream changes
  useEffect(() => {
    setActiveIdx(0);
  }, [unitId, lang]);

  return (
    <div className="px-4">
      <div className="mt-5 mb-5">
        {isFetching && (
          <div className="flex aspect-video items-center justify-center border border-[#1e1e1e] bg-[#0d0d0d]">
            <p className="text-xs tracking-widest text-[#333]">
              resolving {isManga ? 'pages' : 'stream'}...
            </p>
          </div>
        )}
        {isError && (
          <div className="flex aspect-video items-center justify-center border border-[#1e1e1e] bg-[#0d0d0d]">
            <p className="text-xs text-red-900">{String(error)}</p>
          </div>
        )}
        {data?.type === 'video' && active && (
          <Player key={active.sourceUrl} stream={active} subtitles={subtitles} />
        )}
        {data?.type === 'manga' && data.pages && <MangaReader pages={data.pages} />}
      </div>

      {/* Language toggle — only the translations this specific episode actually
          has. The episode list is one language-agnostic call; switching here
          only re-resolves the playback stream, never the episode list. */}
      {availableLangs.length > 1 && (
        <div className="flex items-center gap-2 border-t border-[#1a1a1a] px-1 py-2">
          <span className="text-xs tracking-widest text-[#444]">LANG</span>
          {availableLangs.map((l) => (
            <button
              key={l}
              onClick={() => setLang(l)}
              className={`text-xs tracking-widest transition-colors ${
                lang === l ? 'text-white' : 'text-[#444] hover:text-[#888]'
              }`}
            >
              {l}
            </button>
          ))}
        </div>
      )}

      {/* Episode navigation */}
      {episodes && (
        <div className="mb-0 border-t border-[#1a1a1a]">
          <div className="flex items-center justify-between px-1 py-2">
            <button
              onClick={() => setShowEpisodes((v) => !v)}
              className="text-xs tracking-widest text-[#444] transition-colors hover:text-[#777]"
            >
              {unitLabel} <span className="text-[#333]">({episodes.length})</span>{' '}
              {showEpisodes ? '▲' : '▼'}
            </button>
            <div className="flex gap-3">
              <button
                disabled={!prevEp}
                onClick={() => prevEp && goEpisode(prevEp)}
                className="text-xs text-[#444] transition-colors hover:text-[#aaa] disabled:cursor-default disabled:text-[#252525]"
              >
                ← PREV
              </button>
              <button
                disabled={!nextEp}
                onClick={() => nextEp && goEpisode(nextEp)}
                className="text-xs text-[#444] transition-colors hover:text-[#aaa] disabled:cursor-default disabled:text-[#252525]"
              >
                NEXT →
              </button>
            </div>
          </div>

          {showEpisodes && (
            <div className="max-h-64 overflow-y-auto border-t border-[#141414]">
              {episodes.map((ep) => {
                const isCurrent = ep.number === currentEpNum;
                return (
                  <button
                    key={ep.id}
                    onClick={() => goEpisode(ep)}
                    className={`flex w-full items-center justify-between border-b border-[#0f0f0f] px-2 py-2 text-left transition-colors hover:bg-[#111] ${isCurrent ? 'bg-[#0f0f0f]' : ''}`}
                  >
                    <span
                      className={`mr-4 shrink-0 text-xs ${isCurrent ? 'text-white' : 'text-[#444]'}`}
                    >
                      {unitPrefix}.{String(ep.number).padStart(3, '0')}
                    </span>
                    <span
                      className={`flex-1 truncate text-xs ${isCurrent ? 'text-[#bbb]' : 'text-[#333]'}`}
                    >
                      {ep.title}
                    </span>
                  </button>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* Source selector */}
      {streams.length > 0 && (
        <div className="border-t border-[#1a1a1a]">
          <div className="px-1 py-2 text-xs tracking-widest text-[#444]">
            SOURCES <span className="text-[#333]">({streams.length})</span>
          </div>
          {streams.map((s, i) => (
            <button
              key={i}
              onClick={() => setActiveIdx(i)}
              className={`group flex w-full items-start gap-3 border-b border-[#141414] px-2 py-3 text-left transition-colors hover:bg-[#111] ${i === activeIdx ? 'bg-[#0f0f0f]' : ''}`}
            >
              <span
                className={`mt-0.5 shrink-0 text-xs ${i === activeIdx ? 'text-white' : 'text-[#333]'}`}
              >
                {i === activeIdx ? '●' : '○'}
              </span>
              <div className="min-w-0 flex-1">
                <div className="mb-1 text-xs text-[#555]">
                  [{s.isHLS ? 'HLS' : 'MP4'}] {s.quality}
                  {s.language ? `  ${s.language}` : ''}
                </div>
                <div
                  className={`text-xs leading-relaxed break-all ${i === activeIdx ? 'text-[#4a9eff]' : 'text-[#333] group-hover:text-[#555]'}`}
                >
                  {s.sourceUrl}
                </div>
              </div>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
