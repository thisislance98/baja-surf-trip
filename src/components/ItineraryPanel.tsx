import { Waves, Utensils, Car, Smile, Trash2, RefreshCw, MapPin } from 'lucide-react';
import type { ItineraryItem } from '../App';

const DATES = [
  { date: '2026-06-19', label: 'Fri Jun 19', sub: 'Arrival Day' },
  { date: '2026-06-20', label: 'Sat Jun 20', sub: 'First Surf' },
  { date: '2026-06-21', label: 'Sun Jun 21', sub: 'Cabo Day' },
  { date: '2026-06-22', label: 'Mon Jun 22', sub: 'Adventure' },
  { date: '2026-06-23', label: 'Tue Jun 23', sub: 'Todos Santos' },
  { date: '2026-06-24', label: 'Wed Jun 24', sub: 'Departure' },
];

const CAT_STYLE: Record<string, { bg: string; text: string; icon: React.ReactNode; label: string }> = {
  surf: { bg: 'bg-blue-500/15', text: 'text-blue-400', icon: <Waves className="w-3 h-3" />, label: 'Surf' },
  food: { bg: 'bg-orange-500/15', text: 'text-orange-400', icon: <Utensils className="w-3 h-3" />, label: 'Food' },
  fun:  { bg: 'bg-purple-500/15', text: 'text-purple-400', icon: <Smile className="w-3 h-3" />, label: 'Fun' },
  ride: { bg: 'bg-emerald-500/15', text: 'text-emerald-400', icon: <Car className="w-3 h-3" />, label: 'Ride' },
};

interface ItineraryPanelProps {
  items: ItineraryItem[];
  onRefresh: () => void;
}

export default function ItineraryPanel({ items, onRefresh }: ItineraryPanelProps) {
  const byDate = (date: string) =>
    items
      .filter(i => i.date === date)
      .sort((a, b) => a.time.localeCompare(b.time));

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between px-5 py-3 border-b border-white/8 bg-black/10 shrink-0">
        <div>
          <h2 className="text-sm font-bold text-white">Trip Schedule</h2>
          <p className="text-[11px] text-white/40">Jun 19–24, 2026 · Cerritos & Cabo</p>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-[11px] text-white/30">{items.length} activities</span>
          <button
            onClick={onRefresh}
            className="p-1.5 text-white/30 hover:text-white/70 transition-colors"
            title="Refresh"
          >
            <RefreshCw className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

      {/* Days */}
      <div className="flex-1 overflow-y-auto px-4 py-4 space-y-6">
        {DATES.map(({ date, label, sub }) => {
          const dayItems = byDate(date);
          return (
            <div key={date}>
              <div className="flex items-baseline gap-2 mb-2.5">
                <span className="text-xs font-bold text-white/80">{label}</span>
                <span className="text-[11px] text-white/30">{sub}</span>
                {dayItems.length > 0 && (
                  <span className="ml-auto text-[10px] text-white/25">{dayItems.length} items</span>
                )}
              </div>

              {dayItems.length === 0 ? (
                <div className="pl-3 border-l border-white/8 py-1">
                  <p className="text-[11px] text-white/20 italic">Nothing planned — ask the agent to add something</p>
                </div>
              ) : (
                <div className="space-y-2 pl-3 border-l border-white/10">
                  {dayItems.map(item => {
                    const cat = CAT_STYLE[item.category] || CAT_STYLE.fun;
                    return (
                      <div
                        key={item.id}
                        className="bg-white/4 hover:bg-white/7 border border-white/8 rounded-xl px-3.5 py-3 transition-all group relative"
                      >
                        <div className="flex items-start gap-2.5">
                          <div className={`shrink-0 p-1.5 rounded-lg ${cat.bg} ${cat.text} mt-0.5`}>
                            {cat.icon}
                          </div>
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2">
                              <span className="text-[10px] font-mono text-white/40">{item.time}</span>
                              <span className={`text-[10px] font-medium ${cat.text}`}>{cat.label}</span>
                            </div>
                            <p className="text-[13px] font-semibold text-white/90 mt-0.5 leading-tight">{item.title}</p>
                            {item.location && (
                              <p className="flex items-center gap-1 text-[11px] text-white/40 mt-1">
                                <MapPin className="w-2.5 h-2.5 shrink-0" />
                                {item.location}
                              </p>
                            )}
                            {item.notes && (
                              <p className="text-[11px] text-white/50 mt-1 leading-relaxed line-clamp-2">{item.notes}</p>
                            )}
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          );
        })}

        {/* Items not matching known dates */}
        {(() => {
          const knownDates = DATES.map(d => d.date);
          const extra = items.filter(i => !knownDates.includes(i.date));
          if (!extra.length) return null;
          return (
            <div>
              <div className="flex items-baseline gap-2 mb-2.5">
                <span className="text-xs font-bold text-white/80">Other</span>
              </div>
              <div className="space-y-2 pl-3 border-l border-white/10">
                {extra.map(item => {
                  const cat = CAT_STYLE[item.category] || CAT_STYLE.fun;
                  return (
                    <div key={item.id} className="bg-white/4 border border-white/8 rounded-xl px-3.5 py-3">
                      <div className="flex items-start gap-2.5">
                        <div className={`shrink-0 p-1.5 rounded-lg ${cat.bg} ${cat.text} mt-0.5`}>{cat.icon}</div>
                        <div>
                          <div className="flex items-center gap-2">
                            <span className="text-[10px] font-mono text-white/40">{item.date} · {item.time}</span>
                          </div>
                          <p className="text-[13px] font-semibold text-white/90 mt-0.5">{item.title}</p>
                          {item.location && <p className="text-[11px] text-white/40 mt-0.5">{item.location}</p>}
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          );
        })()}

        <div className="pb-4 text-center">
          <p className="text-[11px] text-white/20">Ask the concierge to add, update, or remove activities</p>
        </div>
      </div>
    </div>
  );
}
