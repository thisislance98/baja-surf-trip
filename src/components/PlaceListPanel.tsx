import { useState, useEffect } from 'react';
import { Waves, Utensils, MapPin, Star, ExternalLink, ChevronDown, ChevronUp, Loader2 } from 'lucide-react';
import type { MapPin as MapPinType } from '../App';

interface PlaceDetails {
  title: string;
  type: string;
  description: string;
  rating?: number;
  reviewCount?: string;
  address: string;
  phone: string;
  website: string;
  imageUrl: string | null;
  attributes: Record<string, string>;
  reviews: { source: string; title: string; snippet: string; link: string }[];
}

const CAT_COLOR: Record<string, string> = {
  surf: 'bg-blue-500/20 text-blue-300 border-blue-500/30',
  dining: 'bg-orange-500/20 text-orange-300 border-orange-500/30',
  tourist: 'bg-purple-500/20 text-purple-300 border-purple-500/30',
};

const CAT_BADGE: Record<string, string> = {
  surf: 'bg-blue-500/15 text-blue-300',
  dining: 'bg-orange-500/15 text-orange-300',
  tourist: 'bg-purple-500/15 text-purple-300',
};

function PinIcon({ category }: { category: string }) {
  if (category === 'surf') return <Waves className="w-4 h-4" />;
  if (category === 'dining') return <Utensils className="w-4 h-4" />;
  return <MapPin className="w-4 h-4" />;
}

function StarRating({ rating }: { rating: number }) {
  return (
    <span className="flex items-center gap-1 text-amber-400 font-semibold text-[13px]">
      <Star className="w-3.5 h-3.5 fill-amber-400" />
      {rating.toFixed(1)}
    </span>
  );
}

function PlaceCard({ pin, onFlyTo }: { pin: MapPinType; onFlyTo: (pin: MapPinType) => void }) {
  const [details, setDetails] = useState<PlaceDetails | null>(null);
  const [loading, setLoading] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const [fetched, setFetched] = useState(false);

  const load = async () => {
    if (fetched) return;
    setLoading(true);
    setFetched(true);
    try {
      const q = `${pin.title} ${pin.category === 'dining' ? 'restaurant' : ''} Baja California Mexico`;
      const r = await fetch(`/api/place-details?q=${encodeURIComponent(q)}`);
      const data = await r.json();
      setDetails(data);
    } catch {}
    setLoading(false);
  };

  const toggle = () => {
    if (!expanded && !fetched) load();
    setExpanded(e => !e);
  };

  return (
    <div className="bg-white/5 border border-white/8 rounded-2xl overflow-hidden">
      {/* Card header — always visible */}
      <div className="flex gap-3 p-4">
        {/* Photo or placeholder */}
        <div className="shrink-0 w-20 h-20 rounded-xl overflow-hidden bg-white/8 flex items-center justify-center">
          {details?.imageUrl ? (
            <img src={details.imageUrl} alt={pin.title} className="w-full h-full object-cover" />
          ) : (
            <div className={`w-full h-full flex items-center justify-center ${CAT_COLOR[pin.category] || 'text-white/30'}`}>
              <PinIcon category={pin.category} />
            </div>
          )}
        </div>

        <div className="flex-1 min-w-0">
          <div className="flex items-start justify-between gap-2">
            <h3 className="text-white font-semibold text-[14px] leading-tight">{pin.title}</h3>
            <span className={`shrink-0 text-[10px] font-semibold px-2 py-0.5 rounded-full ${CAT_BADGE[pin.category] || 'bg-white/10 text-white/50'}`}>
              {pin.category}
            </span>
          </div>

          <div className="flex items-center gap-3 mt-1.5 flex-wrap">
            {(pin.rating || details?.rating) && (
              <StarRating rating={(pin.rating || details?.rating)!} />
            )}
            {details?.reviewCount && (
              <span className="text-white/40 text-[11px]">{details.reviewCount} reviews</span>
            )}
            {pin.priceRange && (
              <span className="text-white/50 text-[11px] font-mono">{pin.priceRange}</span>
            )}
          </div>

          <p className="text-white/60 text-[12px] mt-1.5 leading-relaxed line-clamp-2">
            {pin.description}
          </p>
        </div>
      </div>

      {/* Action row */}
      <div className="flex items-center gap-2 px-4 pb-3">
        <button
          onClick={() => onFlyTo(pin)}
          className="flex items-center gap-1.5 px-3 py-1.5 bg-white/8 hover:bg-white/12 border border-white/10 rounded-lg text-[11px] text-white/70 hover:text-white transition-all"
        >
          <MapPin className="w-3 h-3" />
          Show on map
        </button>

        {details?.website && (
          <a
            href={details.website}
            target="_blank"
            rel="noreferrer"
            className="flex items-center gap-1.5 px-3 py-1.5 bg-white/8 hover:bg-white/12 border border-white/10 rounded-lg text-[11px] text-white/70 hover:text-white transition-all"
          >
            <ExternalLink className="w-3 h-3" />
            Website
          </a>
        )}

        <a
          href={`https://www.google.com/maps/search/?api=1&query=${pin.lat},${pin.lng}`}
          target="_blank"
          rel="noreferrer"
          className="flex items-center gap-1.5 px-3 py-1.5 bg-white/8 hover:bg-white/12 border border-white/10 rounded-lg text-[11px] text-white/70 hover:text-white transition-all"
        >
          <ExternalLink className="w-3 h-3" />
          Google Maps
        </a>

        <button
          onClick={toggle}
          className="ml-auto flex items-center gap-1 text-[11px] text-white/40 hover:text-white/70 transition-colors"
        >
          {loading ? (
            <Loader2 className="w-3.5 h-3.5 animate-spin" />
          ) : expanded ? (
            <ChevronUp className="w-3.5 h-3.5" />
          ) : (
            <ChevronDown className="w-3.5 h-3.5" />
          )}
          {expanded ? 'Less' : 'More'}
        </button>
      </div>

      {/* Expanded details */}
      {expanded && (
        <div className="border-t border-white/8 px-4 py-3 space-y-3">
          {details?.description && details.description !== pin.description && (
            <p className="text-white/70 text-[12px] leading-relaxed">{details.description}</p>
          )}

          {details?.address && (
            <p className="text-white/50 text-[11px]">📍 {details.address}</p>
          )}
          {details?.phone && (
            <p className="text-white/50 text-[11px]">📞 {details.phone}</p>
          )}

          {Object.keys(details?.attributes || {}).length > 0 && (
            <div className="flex flex-wrap gap-1.5">
              {Object.entries(details!.attributes).slice(0, 6).map(([k, v]) => (
                <span key={k} className="text-[10px] bg-white/6 border border-white/8 rounded-md px-2 py-0.5 text-white/50">
                  {k}: {v}
                </span>
              ))}
            </div>
          )}

          {details?.reviews && details.reviews.length > 0 && (
            <div className="space-y-2 pt-1">
              <p className="text-[11px] text-white/40 font-semibold uppercase tracking-wide">Reviews & mentions</p>
              {details.reviews.map((rev, i) => (
                <a
                  key={i}
                  href={rev.link}
                  target="_blank"
                  rel="noreferrer"
                  className="block bg-white/4 hover:bg-white/8 border border-white/6 rounded-xl p-3 transition-colors"
                >
                  <p className="text-[11px] text-white/40 mb-0.5">{rev.source}</p>
                  <p className="text-[12px] text-white/80 font-medium line-clamp-1">{rev.title}</p>
                  <p className="text-[11px] text-white/55 mt-0.5 leading-relaxed line-clamp-3">{rev.snippet}</p>
                </a>
              ))}
            </div>
          )}

          {!loading && !details && (
            <p className="text-white/30 text-[12px]">No additional details found.</p>
          )}
        </div>
      )}
    </div>
  );
}

interface PlaceListPanelProps {
  pins: MapPinType[];
  onFlyTo: (pin: MapPinType) => void;
}

export default function PlaceListPanel({ pins, onFlyTo }: PlaceListPanelProps) {
  const [filterCat, setFilterCat] = useState<'all' | 'surf' | 'dining' | 'tourist'>('all');

  const visible = filterCat === 'all' ? pins : pins.filter(p => p.category === filterCat);

  return (
    <div className="flex flex-col h-full">
      {/* Filter bar */}
      <div className="flex items-center gap-2 px-4 py-2.5 border-b border-white/8 bg-black/10 shrink-0">
        <div className="flex gap-0.5 bg-white/5 rounded-lg p-0.5">
          {(['all', 'surf', 'dining', 'tourist'] as const).map(cat => (
            <button
              key={cat}
              onClick={() => setFilterCat(cat)}
              className={`px-2.5 py-1 rounded-md text-[11px] font-medium capitalize transition-all ${
                filterCat === cat
                  ? 'bg-white/15 text-white'
                  : 'text-white/40 hover:text-white/70'
              }`}
            >
              {cat}
            </button>
          ))}
        </div>
        <span className="text-[11px] text-white/30 ml-auto">{visible.length} places</span>
      </div>

      {/* Cards */}
      <div className="flex-1 overflow-y-auto p-4 space-y-3">
        {visible.length === 0 ? (
          <div className="flex items-center justify-center h-40 text-white/30 text-sm">
            No places yet — ask the AI to add some!
          </div>
        ) : (
          visible.map(pin => (
            <PlaceCard key={pin.id} pin={pin} onFlyTo={onFlyTo} />
          ))
        )}
      </div>
    </div>
  );
}
