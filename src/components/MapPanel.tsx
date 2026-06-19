import { useEffect, useState } from 'react';
import { APIProvider, Map as GoogleMap, AdvancedMarker, Pin, InfoWindow } from '@vis.gl/react-google-maps';
import { Waves, Utensils, MapPin, Star, Navigation, RefreshCw } from 'lucide-react';
import type { MapPin as MapPinType, MapCommand } from '../App';

const MAPS_KEY = (import.meta as any).env?.VITE_GOOGLE_MAPS_KEY || '';

interface MapPanelProps {
  pins: MapPinType[];
  mapCommand: MapCommand | null;
  onCommandConsumed: () => void;
  onSwitchToItinerary: () => void;
}

const CAT_COLOR: Record<string, string> = {
  surf: '#3b82f6',
  dining: '#f97316',
  tourist: '#a855f7',
};

export default function MapPanel({ pins, mapCommand, onCommandConsumed, onSwitchToItinerary }: MapPanelProps) {
  const [center, setCenter] = useState({ lat: 23.10, lng: -110.035 });
  const [zoom, setZoom] = useState(10);
  const [activePin, setActivePin] = useState<MapPinType | null>(null);
  const [mapType, setMapType] = useState<'roadmap' | 'satellite' | 'hybrid'>('roadmap');
  const [filterCat, setFilterCat] = useState<'all' | 'surf' | 'dining' | 'tourist'>('all');
  const [navLabel, setNavLabel] = useState('');

  // Respond to agent map navigation commands
  useEffect(() => {
    if (mapCommand) {
      setCenter({ lat: mapCommand.lat, lng: mapCommand.lng });
      setZoom(mapCommand.zoom || 12);
      if (mapCommand.label) setNavLabel(mapCommand.label);
      onCommandConsumed();
      setTimeout(() => setNavLabel(''), 4000);
    }
  }, [mapCommand, onCommandConsumed]);

  const visiblePins = filterCat === 'all' ? pins : pins.filter(p => p.category === filterCat);

  return (
    <div className="flex flex-col h-full">

      {/* Controls bar */}
      <div className="flex items-center gap-2 px-4 py-2.5 border-b border-white/8 bg-black/10 shrink-0 flex-wrap">
        {/* Category filter */}
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

        {/* Map type */}
        <div className="flex gap-0.5 bg-white/5 rounded-lg p-0.5">
          {(['roadmap', 'satellite', 'hybrid'] as const).map(t => (
            <button
              key={t}
              onClick={() => setMapType(t)}
              className={`px-2.5 py-1 rounded-md text-[11px] font-medium capitalize transition-all ${
                mapType === t
                  ? 'bg-white/15 text-white'
                  : 'text-white/40 hover:text-white/70'
              }`}
            >
              {t === 'roadmap' ? 'Map' : t === 'satellite' ? 'Sat' : 'Hybrid'}
            </button>
          ))}
        </div>

        {/* Pin count */}
        <span className="text-[11px] text-white/30 ml-auto">
          {visiblePins.length} pins
        </span>
      </div>

      {/* Navigation toast */}
      {navLabel && (
        <div className="absolute top-24 left-1/2 -translate-x-1/2 z-50 bg-[#0a3d47] border border-[#56b4c4]/40 text-white text-xs font-medium px-4 py-2 rounded-full shadow-xl flex items-center gap-2">
          <Navigation className="w-3.5 h-3.5 text-[#56b4c4]" />
          Navigating to {navLabel}
        </div>
      )}

      {/* Map */}
      <div className="flex-1 relative">
        {MAPS_KEY ? (
          <APIProvider apiKey={MAPS_KEY} version="weekly">
            <GoogleMap
              center={center}
              zoom={zoom}
              mapId="baja-surf-trip"
              mapTypeId={mapType}
              onCameraChanged={ev => {
                setCenter(ev.detail.center);
                setZoom(ev.detail.zoom);
              }}
              style={{ width: '100%', height: '100%' }}
              gestureHandling="cooperative"
            >
              {visiblePins.map(pin => (
                <AdvancedMarker
                  key={pin.id}
                  position={{ lat: pin.lat, lng: pin.lng }}
                  title={pin.title}
                  onClick={() => setActivePin(activePin?.id === pin.id ? null : pin)}
                >
                  <Pin
                    background={activePin?.id === pin.id ? '#e8552d' : (CAT_COLOR[pin.category] || '#666')}
                    glyphColor="#fff"
                    scale={activePin?.id === pin.id ? 1.3 : 1}
                  />
                </AdvancedMarker>
              ))}

              {activePin && (
                <InfoWindow
                  position={{ lat: activePin.lat, lng: activePin.lng }}
                  onCloseClick={() => setActivePin(null)}
                >
                  <div className="text-sm text-gray-900 max-w-[220px]">
                    <p className="font-bold text-sm mb-1">{activePin.title}</p>
                    <p className="text-xs text-gray-600 mb-1.5">{activePin.description}</p>
                    <div className="flex items-center gap-3 text-[11px]">
                      {activePin.rating && (
                        <span className="flex items-center gap-1 text-amber-600 font-semibold">
                          <Star className="w-3 h-3 fill-amber-500" /> {activePin.rating}
                        </span>
                      )}
                      {activePin.priceRange && <span className="text-gray-500">{activePin.priceRange}</span>}
                    </div>
                    <a
                      href={`https://www.google.com/maps/search/?api=1&query=${activePin.lat},${activePin.lng}`}
                      target="_blank"
                      rel="noreferrer"
                      className="mt-2 inline-flex items-center gap-1 text-[11px] text-blue-600 hover:underline font-medium"
                    >
                      Open in Google Maps →
                    </a>
                  </div>
                </InfoWindow>
              )}
            </GoogleMap>
          </APIProvider>
        ) : (
          <FallbackMap pins={visiblePins} activePin={activePin} onPinClick={setActivePin} />
        )}
      </div>

      {/* Pin list strip */}
      <div className="flex gap-2 px-3 py-2.5 overflow-x-auto border-t border-white/8 bg-black/15 shrink-0">
        {visiblePins.slice(0, 12).map(pin => (
          <button
            key={pin.id}
            onClick={() => {
              setActivePin(pin);
              setCenter({ lat: pin.lat, lng: pin.lng });
              setZoom(14);
            }}
            className={`shrink-0 flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-[11px] font-medium transition-all border ${
              activePin?.id === pin.id
                ? 'bg-[#e8552d] border-[#e8552d] text-white'
                : 'bg-white/5 border-white/8 text-white/60 hover:text-white/90 hover:bg-white/10'
            }`}
          >
            <PinIcon category={pin.category} size={3} />
            {pin.title}
          </button>
        ))}
      </div>
    </div>
  );
}

function PinIcon({ category, size = 4 }: { category: string; size?: number }) {
  const cls = `w-${size} h-${size}`;
  if (category === 'surf') return <Waves className={cls} />;
  if (category === 'dining') return <Utensils className={cls} />;
  return <MapPin className={cls} />;
}

// Fallback SVG map when no Google Maps key
function FallbackMap({ pins, activePin, onPinClick }: { pins: MapPinType[]; activePin: MapPinType | null; onPinClick: (p: MapPinType | null) => void }) {
  const toXY = (lat: number, lng: number) => {
    const x = ((lng - (-110.30)) / ((-109.60) - (-110.30))) * 80 + 10;
    const y = 92 - ((lat - 22.80) / (23.40 - 22.80)) * 80;
    return { x: Math.max(5, Math.min(95, x)), y: Math.max(5, Math.min(95, y)) };
  };

  return (
    <div className="relative w-full h-full bg-[#1a4f5e] overflow-hidden">
      {/* Grid */}
      <svg className="absolute inset-0 w-full h-full opacity-10" preserveAspectRatio="none">
        {[1,2,3,4,5].map(i => (
          <g key={i}>
            <line x1={`${i * 16.6}%`} y1="0" x2={`${i * 16.6}%`} y2="100%" stroke="white" strokeWidth="0.5" />
            <line x1="0" y1={`${i * 16.6}%`} x2="100%" y2={`${i * 16.6}%`} stroke="white" strokeWidth="0.5" />
          </g>
        ))}
      </svg>

      {/* Coastline */}
      <svg className="absolute inset-0 w-full h-full" viewBox="0 0 100 100" preserveAspectRatio="none">
        <path d="M 12 5 Q 15 25 22 45 T 35 75 T 60 92 L 68 93 L 75 90 T 85 85 T 90 70 L 100 100 L 0 100 Z"
          fill="rgba(56,180,196,0.08)" stroke="rgba(86,180,196,0.3)" strokeWidth="0.8" />
        <path d="M 16 5 C 20 30 30 50 48 76 C 55 85 62 90 65 92" fill="none" stroke="rgba(242,169,59,0.4)" strokeWidth="0.6" strokeDasharray="2,2" />
      </svg>

      {/* Labels */}
      <div className="absolute top-4 left-4 text-[10px] font-mono text-white/40 font-bold">CERRITOS 23.32°N</div>
      <div className="absolute bottom-8 right-6 text-[10px] font-mono text-white/40 font-bold">CABO 22.88°N</div>

      {/* Pins */}
      {pins.map(pin => {
        const { x, y } = toXY(pin.lat, pin.lng);
        const isActive = activePin?.id === pin.id;
        return (
          <div
            key={pin.id}
            style={{ left: `${x}%`, top: `${y}%` }}
            className="absolute -translate-x-1/2 -translate-y-1/2 cursor-pointer group z-10"
            onClick={() => onPinClick(isActive ? null : pin)}
          >
            <div className={`w-7 h-7 rounded-full flex items-center justify-center transition-all border-2 shadow-lg ${
              isActive
                ? 'bg-[#e8552d] border-white scale-125'
                : pin.category === 'surf'
                  ? 'bg-blue-600 border-blue-400 hover:scale-110'
                  : pin.category === 'dining'
                    ? 'bg-orange-600 border-orange-400 hover:scale-110'
                    : 'bg-purple-600 border-purple-400 hover:scale-110'
            }`}>
              <PinIcon category={pin.category} size={3} />
            </div>
            {isActive && (
              <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 bg-[#0a3d47] border border-white/20 rounded-xl px-3 py-2 min-w-[140px] shadow-xl text-white">
                <p className="text-[11px] font-bold">{pin.title}</p>
                <p className="text-[10px] text-white/60 mt-0.5">{pin.description?.slice(0, 60)}</p>
              </div>
            )}
          </div>
        );
      })}

      {/* No key notice */}
      <div className="absolute bottom-4 left-4 right-4 bg-black/40 rounded-xl px-3 py-2 text-[10px] text-white/50 text-center">
        Set GOOGLE_MAPS_PLATFORM_KEY in .env for live Google Maps
      </div>
    </div>
  );
}
