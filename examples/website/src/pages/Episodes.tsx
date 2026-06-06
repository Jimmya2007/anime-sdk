import { useNavigate, useSearchParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import * as api from '../api';

export default function Episodes() {
  const navigate = useNavigate();
  const [sp] = useSearchParams();

  const provider = sp.get('provider') || '';
  const mediaId = sp.get('mid') || '';
  const title = sp.get('title') || mediaId;
  const lang = (sp.get('lang') as api.Lang) || 'sub';

  const { data, isFetching, isError, error } = useQuery<api.Episode[]>({
    queryKey: ['content', provider, mediaId, lang],
    queryFn: () => api.content(provider, mediaId, lang),
    enabled: !!(provider && mediaId),
  });

  const goStream = (ep: api.Episode) =>
    navigate(
      `/stream?provider=${provider}&uid=${encodeURIComponent(ep.id)}&lang=${lang}` +
        `&title=${encodeURIComponent(title)}&ep=${encodeURIComponent(`EP.${String(ep.number).padStart(3, '0')}`)}&mid=${encodeURIComponent(mediaId)}`,
    );

  return (
    <div className="px-4">
      <div className="mt-5 mb-4">
        <h1 className="text-base tracking-wide text-white">{title}</h1>
        {data && <p className="mt-0.5 text-xs text-[#444]">{data.length} episodes</p>}
      </div>

      {isFetching && <p className="px-1 text-xs text-[#333]">fetching...</p>}
      {isError && <p className="px-1 text-xs text-red-900">{String(error)}</p>}

      {data && (
        <div className="border-t border-[#1a1a1a]">
          {data.map((ep) => (
            <button
              key={ep.id}
              onClick={() => goStream(ep)}
              className="group flex w-full items-center justify-between border-b border-[#141414] px-2 py-2.5 text-left transition-colors hover:bg-[#111]"
            >
              <span className="mr-4 shrink-0 text-[#555]">
                EP.{String(ep.number).padStart(3, '0')}
              </span>
              <span className="flex-1 truncate text-[#aaa] transition-colors group-hover:text-white">
                {ep.title}
              </span>
              <span className="ml-4 shrink-0 text-xs text-[#333]">{ep.language}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
