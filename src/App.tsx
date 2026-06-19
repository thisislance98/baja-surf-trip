import { useState, useEffect, useCallback } from 'react';
import AgentChat from './components/AgentChat';
import MapPanel from './components/MapPanel';
import ItineraryPanel from './components/ItineraryPanel';
import PlaceListPanel from './components/PlaceListPanel';
import { Waves, Map, Calendar, List, MessageSquare } from 'lucide-react';

export interface ItineraryItem {
  id: string;
  date: string;
  time: string;
  title: string;
  notes: string;
  location: string;
  category: 'surf' | 'food' | 'fun' | 'ride';
}

export interface MapPin {
  id: string;
  title: string;
  lat: number;
  lng: number;
  category: 'surf' | 'dining' | 'tourist';
  description: string;
  difficulty?: string;
  priceRange?: string;
  rating?: number;
}

export interface MapCommand {
  lat: number;
  lng: number;
  zoom: number;
  label: string;
}

type PanelView = 'map' | 'itinerary' | 'list';
type MobileTab = 'chat' | 'map' | 'itinerary' | 'list';

export default function App() {
  const [itinerary, setItinerary] = useState<ItineraryItem[]>([]);
  const [pins, setPins] = useState<MapPin[]>([]);
  const [mapCommand, setMapCommand] = useState<MapCommand | null>(null);
  const [panelView, setPanelView] = useState<PanelView>('map');
  const [mobileTab, setMobileTab] = useState<MobileTab>('chat');

  useEffect(() => {
    fetch('/api/itinerary').then(r => r.json()).then(d => setItinerary(d.items || [])).catch(() => {});
    fetch('/api/pins').then(r => r.json()).then(d => setPins(d.pins || [])).catch(() => {});
  }, []);

  const handleSideEffect = useCallback((effect: any) => {
    if (effect.type === 'itinerary_change') {
      fetch('/api/itinerary').then(r => r.json()).then(d => setItinerary(d.items || [])).catch(() => {});
    }
    if (effect.type === 'map_pin_added' && effect.pin) {
      setPins(prev => [...prev.filter(p => p.id !== effect.pin.id), effect.pin]);
    }
    if (effect.type === 'map_navigate') {
      setMapCommand({ lat: effect.lat, lng: effect.lng, zoom: effect.zoom || 12, label: effect.label || '' });
      setPanelView('map');
      setMobileTab('map');
    }
  }, []);

  const handleFlyTo = useCallback((pin: MapPin) => {
    setMapCommand({ lat: pin.lat, lng: pin.lng, zoom: 15, label: pin.title });
    setPanelView('map');
    setMobileTab('map');
  }, []);

  const rightPanel = (
    <div className="flex flex-col flex-1 h-full overflow-hidden">
      {/* Panel switcher — desktop only */}
      <div className="hidden sm:flex items-center gap-1 px-4 py-3 border-b border-white/10 bg-black/10 shrink-0">
        {([
          { id: 'map', icon: <Map className="w-3.5 h-3.5" />, label: 'Map' },
          { id: 'itinerary', icon: <Calendar className="w-3.5 h-3.5" />, label: 'Itinerary', badge: itinerary.length },
          { id: 'list', icon: <List className="w-3.5 h-3.5" />, label: 'Places', badge: pins.length },
        ] as const).map(tab => (
          <button
            key={tab.id}
            onClick={() => setPanelView(tab.id)}
            className={`flex items-center gap-2 px-4 py-2 rounded-lg text-xs font-semibold transition-all ${
              panelView === tab.id
                ? 'bg-white/15 text-white'
                : 'text-white/50 hover:text-white/80 hover:bg-white/5'
            }`}
          >
            {tab.icon}
            {tab.label}
            {'badge' in tab && tab.badge > 0 && (
              <span className={`text-white text-[10px] font-bold px-1.5 py-0.5 rounded-full leading-none ${tab.id === 'itinerary' ? 'bg-[#e8552d]' : 'bg-white/20'}`}>
                {tab.badge}
              </span>
            )}
          </button>
        ))}
      </div>

      <div className="flex-1 overflow-hidden">
        {panelView === 'map' ? (
          <MapPanel pins={pins} mapCommand={mapCommand} onCommandConsumed={() => setMapCommand(null)} onSwitchToItinerary={() => setPanelView('itinerary')} />
        ) : panelView === 'list' ? (
          <PlaceListPanel pins={pins} onFlyTo={handleFlyTo} />
        ) : (
          <ItineraryPanel items={itinerary} onRefresh={() => fetch('/api/itinerary').then(r => r.json()).then(d => setItinerary(d.items || []))} />
        )}
      </div>
    </div>
  );

  return (
    <div className="flex flex-col sm:flex-row h-screen h-[100dvh] bg-[#0a3d47] overflow-hidden">

      {/* ── DESKTOP: side-by-side layout ── */}
      {/* Left: Chat */}
      <div className="hidden sm:flex flex-col w-[420px] shrink-0 h-full border-r border-white/10">
        <div className="flex items-center gap-3 px-5 py-4 border-b border-white/10 bg-black/20 shrink-0">
          <div className="p-2 bg-[#e8552d] rounded-xl">
            <Waves className="w-5 h-5 text-white" />
          </div>
          <div>
            <h1 className="text-sm font-bold text-white tracking-tight">Baja Surf Concierge</h1>
            <p className="text-[11px] text-white/50 font-mono">Cerritos & Cabo · Jun 19–24 · 3 travelers</p>
          </div>
        </div>
        <AgentChat itinerary={itinerary} pins={pins} onSideEffect={handleSideEffect} />
      </div>

      {/* Right panels */}
      <div className="hidden sm:flex flex-col flex-1 h-full overflow-hidden">
        {rightPanel}
      </div>

      {/* ── MOBILE: tab-based full-screen layout ── */}
      {/* Mobile header */}
      <div className="sm:hidden flex items-center gap-3 px-4 py-3 border-b border-white/10 bg-black/20 shrink-0">
        <div className="p-1.5 bg-[#e8552d] rounded-lg">
          <Waves className="w-4 h-4 text-white" />
        </div>
        <div className="flex-1 min-w-0">
          <h1 className="text-sm font-bold text-white leading-none">Baja Surf Concierge</h1>
          <p className="text-[10px] text-white/50 font-mono mt-0.5">Cerritos & Cabo · Jun 19–24</p>
        </div>
      </div>

      {/* Mobile tab content */}
      <div className="sm:hidden flex-1 overflow-hidden flex flex-col">
        {mobileTab === 'chat' && (
          <AgentChat itinerary={itinerary} pins={pins} onSideEffect={handleSideEffect} />
        )}
        {mobileTab === 'map' && (
          <MapPanel pins={pins} mapCommand={mapCommand} onCommandConsumed={() => setMapCommand(null)} onSwitchToItinerary={() => { setPanelView('itinerary'); setMobileTab('itinerary'); }} />
        )}
        {mobileTab === 'itinerary' && (
          <ItineraryPanel items={itinerary} onRefresh={() => fetch('/api/itinerary').then(r => r.json()).then(d => setItinerary(d.items || []))} />
        )}
        {mobileTab === 'list' && (
          <PlaceListPanel pins={pins} onFlyTo={handleFlyTo} />
        )}
      </div>

      {/* Mobile bottom tab bar */}
      <nav className="sm:hidden flex items-stretch border-t border-white/15 bg-black/30 shrink-0 safe-area-bottom">
        {([
          { id: 'chat',      icon: MessageSquare, label: 'Chat' },
          { id: 'map',       icon: Map,           label: 'Map' },
          { id: 'itinerary', icon: Calendar,      label: 'Schedule', badge: itinerary.length },
          { id: 'list',      icon: List,          label: 'Places',   badge: pins.length },
        ] as const).map(tab => {
          const Icon = tab.icon;
          const active = mobileTab === tab.id;
          return (
            <button
              key={tab.id}
              onClick={() => setMobileTab(tab.id)}
              className={`flex-1 flex flex-col items-center justify-center gap-1 py-2.5 relative transition-colors ${
                active ? 'text-white' : 'text-white/40'
              }`}
            >
              <div className="relative">
                <Icon className="w-5 h-5" />
                {'badge' in tab && tab.badge > 0 && (
                  <span className="absolute -top-1.5 -right-2 bg-[#e8552d] text-white text-[9px] font-bold w-4 h-4 rounded-full flex items-center justify-center leading-none">
                    {tab.badge > 9 ? '9+' : tab.badge}
                  </span>
                )}
              </div>
              <span className="text-[10px] font-medium">{tab.label}</span>
              {active && <span className="absolute top-0 inset-x-0 h-0.5 bg-[#e8552d] rounded-b-full" />}
            </button>
          );
        })}
      </nav>
    </div>
  );
}
