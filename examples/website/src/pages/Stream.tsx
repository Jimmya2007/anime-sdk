import { useEffect, useRef, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import Hls from 'hls.js';
import * as api from '../api';

function Player({ stream }: { stream: api.VideoStream }) {
  const ref = useRef<HTMLVideoElement>(null);
  const [playerError, setPlayerError] = useState<string | null>(null);

  useEffect(() => {
    const v = ref.current;
    if (!v) return;
    setPlayerError(null);

    let hls: Hls | undefined;
    if (stream.isHLS) {
      if (Hls.isSupported()) {
        hls = new Hls({ enableWorker: false });
        hls.on(Hls.Events.ERROR, (_, d) => {
          if (d.fatal) setPlayerError(`HLS error: ${d.details}`);
        });
        hls.loadSource(stream.sourceUrl);
        hls.attachMedia(v);
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
      v.src = '';
    };
  }, [stream.sourceUrl, stream.isHLS]);

  if (playerError) {
    return (
      <div className="flex aspect-video items-center justify-center border border-[#1e1e1e] bg-[#0d0d0d]">
        <p className="text-xs text-[#444]">{playerError}</p>
      </div>
    );
  }

  return (
    <video ref={ref} controls className="aspect-video w-full border border-[#1e1e1e] bg-black" />
  );
}

export default function Stream() {
  const navigate = useNavigate();
  const [sp] = useSearchParams();

  const provider = sp.get('provider') || '';
  const unitId = sp.get('uid') || '';
  const lang = (sp.get('lang') as api.Lang) || 'sub';
  const title = sp.get('title') || '';
  const mediaId = sp.get('mid') || '';
  const epLabel = sp.get('ep') || '';

  const [activeIdx, setActiveIdx] = useState(0);
  const [showEpisodes, setShowEpisodes] = useState(false);

  const { data, isFetching, isError, error } = useQuery<api.ResolvedStream>({
    queryKey: ['stream', provider, unitId, lang],
    queryFn: () => api.stream(provider, unitId, lang),
    enabled: !!(provider && unitId),
  });

  // Episode list — reuse cache from /episodes if already loaded
  const { data: episodes } = useQuery<api.Episode[]>({
    queryKey: ['content', provider, mediaId, lang],
    queryFn: () => api.content(provider, mediaId, lang),
    enabled: !!(provider && mediaId),
    staleTime: 5 * 60 * 1000,
  });

  const streams = data?.type === 'video' ? (data.streams ?? []) : [];
  const active = streams[activeIdx] ?? null;

  // Find current episode index for prev/next
  const currentEpNum = epLabel ? parseFloat(epLabel.replace(/^EP\.0*/i, '')) : null;
  const currentIdx = episodes?.findIndex((e) => e.number === currentEpNum) ?? -1;
  const prevEp = currentIdx > 0 ? episodes![currentIdx - 1] : null;
  const nextEp =
    currentIdx >= 0 && currentIdx < (episodes?.length ?? 0) - 1 ? episodes![currentIdx + 1] : null;

  const goEpisode = (ep: api.Episode) =>
    navigate(
      `/stream?provider=${provider}&uid=${encodeURIComponent(ep.id)}&lang=${lang}` +
        `&title=${encodeURIComponent(title)}&ep=${encodeURIComponent(`EP.${String(ep.number).padStart(3, '0')}`)}&mid=${encodeURIComponent(mediaId)}`,
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
            <p className="text-xs tracking-widest text-[#333]">resolving stream...</p>
          </div>
        )}
        {isError && (
          <div className="flex aspect-video items-center justify-center border border-[#1e1e1e] bg-[#0d0d0d]">
            <p className="text-xs text-red-900">{String(error)}</p>
          </div>
        )}
        {active && <Player key={active.sourceUrl} stream={active} />}
      </div>

      {/* Episode navigation */}
      {episodes && (
        <div className="mb-0 border-t border-[#1a1a1a]">
          <div className="flex items-center justify-between px-1 py-2">
            <button
              onClick={() => setShowEpisodes((v) => !v)}
              className="text-xs tracking-widest text-[#444] transition-colors hover:text-[#777]"
            >
              EPISODES <span className="text-[#333]">({episodes.length})</span>{' '}
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
                      EP.{String(ep.number).padStart(3, '0')}
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
