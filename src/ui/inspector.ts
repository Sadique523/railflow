import { city } from '../data/cities';
import { doubleCost, km } from '../sim/network';
import { ON_TIME_MIN } from '../sim/train';
import type { Game } from '../sim/game';
import { fmt, h } from './dom';

export type Selection =
  | { kind: 'city'; id: string }
  | { kind: 'train'; id: string }
  | { kind: 'track'; id: string };

export interface InspectorHost {
  game: Game;
  select(sel: Selection | null): void;
  startTrack(from: string): void;
  newTrain(from: string): void;
  follow(trainId: string | null): void;
  following: string | null;
}

/** Right-hand panel describing the current selection. */
export class Inspector {
  el: HTMLElement;
  private panel: HTMLElement;
  private sel: Selection | null = null;
  private held = false;
  private lastHtml = '';

  constructor(private host: InspectorHost) {
    this.panel = h('div', { class: 'panel', style: 'display:flex;flex-direction:column;min-height:0;max-height:inherit' });
    this.el = h('div', { class: 'side right shadow', style: 'display:none' }, this.panel);
    this.el.addEventListener('pointerdown', () => (this.held = true));
    window.addEventListener('pointerup', () => setTimeout(() => (this.held = false), 0));
  }

  show(sel: Selection | null) {
    this.sel = sel;
    this.el.style.display = sel ? '' : 'none';
    this.lastHtml = '';
    this.refresh();
  }

  refresh() {
    if (!this.sel || this.held) return;
    const g = this.host.game;
    let content: HTMLElement[] | null = null;
    if (this.sel.kind === 'city') content = this.city(this.sel.id);
    else if (this.sel.kind === 'train') {
      if (!g.trains.has(this.sel.id)) return this.host.select(null);
      content = this.train(this.sel.id);
    } else {
      if (!g.net.edges.has(this.sel.id)) return this.host.select(null);
      content = this.track(this.sel.id);
    }
    const probe = h('div', null, content);
    if (probe.innerHTML === this.lastHtml) return;
    this.lastHtml = probe.innerHTML;
    const scrollEl = this.panel.querySelector('.scroll');
    const scroll = scrollEl?.scrollTop ?? 0;
    this.panel.replaceChildren(...content);
    const ns = this.panel.querySelector('.scroll');
    if (ns) ns.scrollTop = scroll;
  }

  private header(title: string, sub: string, accent?: string) {
    return h('header', null,
      accent ? h('span', { style: `width:6px;align-self:stretch;background:${accent}` }) : null,
      h('div', null, h('h2', null, title), h('div', { class: 'sub' }, sub)),
      h('button', { class: 'x', title: 'Close (Esc)', onclick: () => this.host.select(null) }, '×'),
    );
  }

  private city(id: string): HTMLElement[] {
    const g = this.host.game;
    const c = city(id);
    const st = g.stations.get(id)!;
    const byDest = new Map<string, { n: number; oldest: number }>();
    for (const grp of st.waiting) {
      const e = byDest.get(grp.dest) ?? { n: 0, oldest: grp.spawn };
      e.n += grp.count;
      e.oldest = Math.min(e.oldest, grp.spawn);
      byDest.set(grp.dest, e);
    }
    const dests = [...byDest.entries()].sort((a, b) => b[1].n - a[1].n);
    const trains = [...g.trains.values()].filter((t) => t.cfg.stops.includes(id));
    const connected = g.net.isConnected(id);
    const links = g.net.adj.get(id)?.length ?? 0;
    return [
      this.header(c.name, `${id} · ${c.pop >= 1 ? `${c.pop}M people` : `${Math.round(c.pop * 1000)}K people`}`),
      h('div', { class: 'scroll' },
        h('div', { class: 'section' },
          h('div', { class: 'kv' },
            h('span', null, 'Status'), h('span', null, connected ? `${links} line${links > 1 ? 's' : ''}` : 'Not connected'),
            h('span', null, 'Waiting'), h('span', null, fmt.int(g.waitingAt(id))),
            h('span', null, 'Demand'), h('span', null, st.demandMult > 1 ? 'Festival rush ×2' : 'Normal'),
          ),
        ),
        h('div', { class: 'section' },
          h('div', { class: 'lbl' }, 'Waiting by destination'),
          dests.length
            ? h('div', { class: 'list' }, dests.slice(0, 8).map(([d, v]) =>
              h('div', { class: 'row' }, city(d).name, h('span', { class: 'r' }, `${fmt.int(v.n)} · ${fmt.dur(g.time - v.oldest)}`))))
            : h('div', { class: 'empty' }, trains.length ? 'Platforms are clear.' : 'Passengers appear once a train serves this station.'),
        ),
        h('div', { class: 'section' },
          h('div', { class: 'lbl' }, 'Services'),
          trains.length
            ? h('div', { class: 'list' }, trains.map((t) =>
              h('div', { class: 'row click', onclick: () => this.host.select({ kind: 'train', id: t.cfg.id }) },
                h('span', { class: 'sw', style: `background:${t.type.accent}` }),
                h('span', null, `${t.cfg.number} ${t.cfg.name}`),
              )))
            : h('div', { class: 'empty' }, 'No trains call here yet.'),
        ),
        h('div', { class: 'btnrow' },
          h('button', { class: 'btn', onclick: () => this.host.startTrack(id) }, 'Build track'),
          h('button', { class: 'btn', disabled: !connected, onclick: () => this.host.newTrain(id) }, 'New train'),
        ),
      ),
    ];
  }

  private train(id: string): HTMLElement[] {
    const g = this.host.game;
    const t = g.trains.get(id)!;
    const load = t.load;
    const pct = (load / t.seats) * 100;
    const maxPct = (t.capacity / t.seats) * 100;
    const scale = Math.max(100, maxPct);
    let status: HTMLElement;
    const late = t.state === 'running' ? Math.max(0, g.time - t.schedArr) : t.delay;
    if (t.holding) status = h('span', { class: 'badge hold' }, 'Held at signal');
    else if (late > ON_TIME_MIN) status = h('span', { class: 'badge late' }, `+${Math.round(late)} min late`);
    else status = h('span', { class: 'badge ok' }, 'On time');
    const stops = t.dirStops;
    const cur = t.state === 'dwelling' ? Math.min(t.nextStop, stops.length) - 1 : t.nextStop;
    const doing = t.state === 'dwelling'
      ? `At ${city(t.path[t.stopIdx[Math.max(0, Math.min(t.nextStop, t.stopIdx.length) - 1)]]).name}, departs ${fmt.clock(t.dwellUntil)}`
      : `To ${city(t.nextStopId()).name}, due ${fmt.clock(t.schedArr)}`;
    const following = this.host.following === id;
    return [
      this.header(`${t.cfg.number}`, t.cfg.name, t.type.accent),
      h('div', { class: 'scroll' },
        h('div', { class: 'section' },
          h('div', { style: 'display:flex;gap:8px;align-items:center;margin-bottom:10px' }, status,
            h('span', { style: 'font-size:12px;color:var(--ink-2)' }, doing)),
          h('div', { class: 'kv' },
            h('span', null, 'Type'), h('span', null, `${t.type.short} · ${t.cfg.coaches} coaches`),
            h('span', null, 'Speed'), h('span', null, `${Math.round(t.v * 5 * 60)} km/h`),
          ),
        ),
        h('div', { class: 'section' },
          h('div', { class: 'lbl', style: 'justify-content:space-between' }, 'Load', h('span', null, `${fmt.int(load)} / ${fmt.int(t.seats)} seats`)),
          h('div', { class: 'loadbar' },
            h('i', { class: pct > 100 ? 'over' : '', style: `width:${Math.min(100, (pct / scale) * 100)}%` }),
            maxPct > 100 ? h('span', { class: 'seat', style: `left:${(100 / scale) * 100}%` }) : null,
          ),
        ),
        h('div', { class: 'section' },
          h('div', { class: 'lbl' }, 'Stops'),
          h('ul', { class: 'stops' }, stops.map((s, i) =>
            h('li', { class: `${i === 0 || i === stops.length - 1 ? 'end' : ''}${i === cur ? ' cur' : ''}` },
              h('span', { class: 'idx' }, i + 1), h('span', null, city(s).name), h('span', { class: 'code' }, s)))),
        ),
        h('div', { class: 'btnrow' },
          h('button', { class: 'btn', onclick: () => this.host.follow(following ? null : id) }, following ? 'Stop following' : 'Follow'),
          h('button', {
            class: 'btn danger',
            onclick: () => {
              if (confirm(`Withdraw ${t.cfg.number}? You get 40% of its price back.`)) {
                g.removeTrain(id);
                this.host.select(null);
              }
            },
          }, 'Withdraw'),
        ),
      ),
    ];
  }

  private track(id: string): HTMLElement[] {
    const g = this.host.game;
    const e = g.net.edges.get(id)!;
    const users = g.trainsUsingEdge(id);
    const cost = doubleCost(e);
    return [
      this.header(`${city(e.a).name} – ${city(e.b).name}`, `${e.a} – ${e.b} · ${Math.round(km(e.length))} km`),
      h('div', { class: 'scroll' },
        h('div', { class: 'section' },
          h('div', { class: 'kv' },
            h('span', null, 'Line'), h('span', null, e.tracks === 2 ? 'Double track' : 'Single track'),
            h('span', null, 'Signal blocks'), h('span', null, `${e.blocks}${e.tracks === 1 && e.blocks > 1 ? ` · ${e.blocks - 1} crossing loop${e.blocks > 2 ? 's' : ''}` : ''}`),
            h('span', null, 'Condition'), h('span', null, e.speedFactor < 1 ? `Restricted ${Math.round(e.speedFactor * 100)}%` : 'Normal'),
            h('span', null, 'Occupied'), h('span', null, e.occupants.size ? `${e.occupants.size} train${e.occupants.size > 1 ? 's' : ''}` : 'Clear'),
          ),
          e.tracks === 1 ? h('p', { class: 'hint' }, 'On a single line opposing trains can only cross at loops, so one of them waits. ', h('b', null, 'Doubling'), ' lets them pass freely and lets trains follow closely.') : null,
        ),
        h('div', { class: 'section' },
          h('div', { class: 'lbl' }, 'Trains using this line'),
          users.length
            ? h('div', { class: 'list' }, users.map((t) =>
              h('div', { class: 'row click', onclick: () => this.host.select({ kind: 'train', id: t.cfg.id }) },
                h('span', { class: 'sw', style: `background:${t.type.accent}` }), `${t.cfg.number} ${t.cfg.name}`)))
            : h('div', { class: 'empty' }, 'None'),
        ),
        h('div', { class: 'btnrow' },
          h('button', {
            class: 'btn', disabled: e.tracks === 2 || cost > g.funds,
            onclick: () => g.upgradeTrack(id),
          }, e.tracks === 2 ? 'Double line' : `Double · ${fmt.cr(cost)}`),
          h('button', {
            class: 'btn danger', disabled: users.length > 0, title: users.length ? 'Trains still use this line' : '',
            onclick: () => { if (g.removeTrack(id)) this.host.select(null); },
          }, 'Remove'),
        ),
      ),
    ];
  }
}
