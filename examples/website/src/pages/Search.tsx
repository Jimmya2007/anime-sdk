import { useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import * as api from '../api';

const PROVIDERS = [
  'megaplay',
  'allmanga',
  'animeparadise',
  'anikoto',
  'gogoanime',
  'goyabu',
  'mangadex',
  'weebcentral',
  'mangapill',
];

export default function Search() {
  const navigate = useNavigate();
  const [sp, setSp] = useSearchParams();

  const provider = sp.get('provider') || PROVIDERS[0];
  const initialQ = sp.get('q') || '';

  const [input, setInput] = useState(initialQ);

  const { data, isFetching, isError, error } = useQuery<api.SearchResult[]>({
    queryKey: ['search', provider, initialQ],
    queryFn: () => api.search(provider, initialQ),
    enabled: !!initialQ,
  });

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    setSp((prev) => {
      const next = new URLSearchParams(prev);
      next.set('provider', provider);
      next.set('q', input);
      return next;
    });
  };

  const setProvider = (p: string) =>
    setSp((prev) => {
      const next = new URLSearchParams(prev);
      next.set('provider', p);
      return next;
    });

  const goEpisodes = (result: api.SearchResult) =>
    navigate(
      `/episodes?provider=${provider}&mid=${encodeURIComponent(result.id)}&title=${encodeURIComponent(result.title)}&type=${result.catalogType}`,
    );

  return (
    <div className="px-4">
      <div className="mt-5 mb-4 flex flex-wrap gap-1.5">
        {PROVIDERS.map((p) => (
          <button
            key={p}
            onClick={() => setProvider(p)}
            className={`border px-3 py-1.5 text-[10px] tracking-widest uppercase transition-colors ${p === provider ? 'border-[#555] bg-[#111] text-white' : 'border-[#222] text-[#444] hover:border-[#3a3a3a] hover:text-[#777]'}`}
          >
            {p === 'megaplay' ? '⛤ ' : ''}
            {p}
            {p === 'megaplay' ? ' ⛤' : ''}
          </button>
        ))}
      </div>

      <form onSubmit={submit} className="flex gap-2">
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="search title..."
          className="flex-1 border border-[#2a2a2a] bg-transparent px-3 py-2 text-sm placeholder-[#2a2a2a] outline-none focus:border-[#444]"
        />
        <button
          type="submit"
          className="border border-[#2a2a2a] px-5 py-2 text-xs text-[#777] transition-colors hover:border-[#555] hover:text-[#bbb]"
        >
          SEARCH
        </button>
      </form>

      {isFetching && <p className="mt-6 px-1 text-xs text-[#333]">fetching...</p>}
      {isError && <p className="mt-6 px-1 text-xs text-red-900">{String(error)}</p>}

      {data && (
        <div className="mt-6 border-t border-[#1a1a1a]">
          <div className="px-1 py-2 text-xs tracking-widest text-[#444]">
            RESULTS <span className="text-[#333]">({data.length})</span>
          </div>
          {data.map((r) => (
            <button
              key={r.id}
              onClick={() => goEpisodes(r)}
              className="group flex w-full items-center justify-between gap-4 border-b border-[#141414] px-2 py-2.5 text-left transition-colors hover:bg-[#111]"
            >
              <span className="flex-1 truncate text-[#bbb] transition-colors group-hover:text-white">
                {r.title}
              </span>
              {r.availableLanguages && r.availableLanguages.length > 0 && (
                <span className="flex shrink-0 gap-1">
                  {r.availableLanguages.map((l) => (
                    <span
                      key={l}
                      className="border border-[#222] px-1.5 py-0.5 text-[10px] tracking-widest text-[#555]"
                    >
                      {l}
                    </span>
                  ))}
                </span>
              )}
              <span className="shrink-0 text-xs text-[#333]">{r.catalogType}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
