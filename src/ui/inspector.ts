import { city } from '../data/cities';
import { km } from '../sim/network';
import { LINE_CLASSES, RESEARCH, RESEARCH_BY_ID, WORKS_SPEED, lineClass } from '../data/research';
import { PAX_CLASSES, PAX_CLASS_INFO, TRAIN_TYPES } from '../data/trainTypes';
import { COMMODITY_INFO, cityFreight } from '../data/freight';
import { DFC } from '../data/research';
import { lineLoad } from '../render/tracks';
import { ON_TIME_MIN } from '../sim/train';
import type { Game } from '../sim/game';
import type { Bucket } from '../sim/ledger';
import type { Train } from '../sim/train';
import { fmt, h, svg } from './dom';

export type Selection =
  | { kind: 'city'; id: string }
  | { kind: 'train'; id: string }
  | { kind: 'track'; id: string }
  | { kind: 'finance' }
  | { kind: 'research' };

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
    if (this.sel.kind === 'finance') content = this.finance();
    else if (this.sel.kind === 'research') content = this.researchView();
    else if (this.sel.kind === 'city') content = this.city(this.sel.id);
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
            ...PAX_CLASSES.flatMap((cls) => {
              const n = st.waiting.reduce((s, grp) => s + (grp.cls === cls ? grp.count : 0), 0);
              return n ? [h('span', null, `· ${PAX_CLASS_INFO[cls].name}`), h('span', null, fmt.int(n))] : [];
            }),
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
        this.cityFreight(id),
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

  private cityFreight(id: string): HTMLElement | string {
    const g = this.host.game;
    const st = g.stations.get(id)!;
    const { loads, receives } = cityFreight(id);
    if (!loads.length && !receives.length) return '';
    const names = (cs: typeof loads) => cs.map((c) => COMMODITY_INFO[c].name).join(', ');
    return h('div', { class: 'section' },
      h('div', { class: 'lbl' }, 'Freight'),
      h('div', { class: 'kv' },
        loads.length ? h('span', null, 'Loads') : '', loads.length ? h('span', null, names(loads)) : '',
        receives.length ? h('span', null, 'Receives') : '', receives.length ? h('span', null, names(receives)) : '',
      ),
      st.cargo.length
        ? h('div', { class: 'list', style: 'margin-top:8px' }, [...st.cargo].sort((a, b) => b.tons - a.tons).slice(0, 6).map((c) =>
          h('div', { class: 'row' }, h('span', { class: 'sw', style: `background:${COMMODITY_INFO[c.commodity].color}` }),
            `${COMMODITY_INFO[c.commodity].name} → ${city(c.dest).name}`, h('span', { class: 'r' }, `${fmt.int(c.tons)} t`))))
        : h('p', { class: 'hint' }, loads.length ? 'Run a goods train from here to a station that receives these to start earning freight.' : 'Bring freight here from the stations that load it.'),
    );
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
            h('span', null, 'Type'), h('span', null, `${t.type.short} · ${t.cfg.coaches} ${t.freight ? 'wagons' : 'coaches'}`),
            h('span', null, 'Carries'), h('span', null, t.freight
              ? t.type.cargo!.map((c) => COMMODITY_INFO[c].name).join(', ')
              : PAX_CLASSES.filter((c) => t.carries(c)).map((c) => PAX_CLASS_INFO[c].name).join(', ')),
            h('span', null, 'Speed'), h('span', null, `${Math.round(km(t.v) * 60)} km/h`),
            h('span', null, 'Average speed'), h('span', null, `${Math.round(t.serviceKmh)} km/h`),
          ),
        ),
        h('div', { class: 'section' },
          h('div', { class: 'lbl', style: 'justify-content:space-between' }, 'Load', h('span', null, t.freight ? `${fmt.int(load)} / ${fmt.int(t.capacity)} t` : `${fmt.int(load)} / ${fmt.int(t.seats)} seats`)),
          h('div', { class: 'loadbar' },
            h('i', { class: pct > 100 ? 'over' : '', style: `width:${Math.min(100, (pct / scale) * 100)}%` }),
            maxPct > 100 ? h('span', { class: 'seat', style: `left:${(100 / scale) * 100}%` }) : null,
          ),
          t.freight && t.cargo.length ? h('div', { class: 'list', style: 'margin-top:8px' }, t.cargo.map((c) =>
            h('div', { class: 'row' }, h('span', { class: 'sw', style: `background:${COMMODITY_INFO[c.commodity].color}` }),
              `${COMMODITY_INFO[c.commodity].name} → ${city(c.dest).name}`, h('span', { class: 'r' }, `${fmt.int(c.tons)} t`)))) : '',
          t.freight && !t.cargo.length ? h('p', { class: 'hint' }, 'Running empty. Coal and ore trains usually come back empty; containers fill both ways.') : '',
        ),
        this.trainMoney(t),
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

  private trainMoney(t: Train): HTMLElement {
    const g = this.host.game;
    const day = t.money.window(g.time, 24);
    const income = day.fares + day.freight;
    const profit = income + day.running;
    const young = g.time - t.money.since < 24 * 60;
    return h('div', { class: 'section' },
      h('div', { class: 'lbl', style: 'justify-content:space-between' },
        young ? 'Earnings since entering service' : 'Earnings · last 24 h',
        h('span', { class: profit >= 0 ? 'pos' : 'neg' }, fmt.money(profit, true))),
      h('div', { class: 'kv' },
        h('span', null, t.freight ? 'Freight charges' : 'Fares collected'), h('span', { class: 'pos' }, fmt.money(income, true)),
        h('span', null, 'Running costs'), h('span', { class: 'neg' }, fmt.money(day.running)),
        h('span', null, 'Costs per hour'), h('span', null, fmt.money(t.runningCostPerHour)),
        h('span', null, 'This run so far'), h('span', null, fmt.money(t.tripFares, true)),
        h('span', null, 'Last full run'), h('span', null, t.lastTripFares === null ? '—' : fmt.money(t.lastTripFares, true)),
      ),
      profit < 0 && g.time - t.money.since > 6 * 60
        ? h('p', { class: 'hint' }, 'This train costs more to run than it earns. Fewer coaches, a cheaper type or a busier route would help.')
        : null,
    );
  }

  private finance(): HTMLElement[] {
    const g = this.host.game;
    const L = g.ledger;
    const day = L.window(g.time, 24);
    const operating = day.fares + day.freight + day.running + day.upkeep;
    const invested = day.track + day.trains + day.research;
    const net = operating + invested + day.sales;
    const rate = L.operatingRate(g.time);
    const runningNow = [...g.trains.values()].reduce((s, t) => s + t.runningCostPerHour, 0);
    const trains = [...g.trains.values()]
      .map((t) => {
        const w = t.money.window(g.time, 24);
        return { t, fares: w.fares + w.freight, running: w.running, profit: w.fares + w.freight + w.running };
      })
      .sort((a, b) => b.profit - a.profit);
    const sign = (n: number) => (n >= 0 ? 'pos' : 'neg');

    return [
      this.header('Money', `Day ${fmt.day(g.time)} · balance ${fmt.money(g.funds)}`),
      h('div', { class: 'scroll' },
        h('div', { class: 'section' },
          h('div', { class: 'money-hero' },
            h('div', null, h('div', { class: 'lbl' }, 'Profit per hour'), h('div', { class: `big ${sign(rate)}` }, `${fmt.money(rate, true)}`), h('div', { class: 'note' }, 'fares and freight minus running costs and upkeep, last 6 h')),
            h('div', null, h('div', { class: 'lbl' }, 'Balance'), h('div', { class: `big ${g.funds < 0 ? 'neg' : ''}` }, fmt.money(g.funds))),
          ),
          h('p', { class: 'hint' },
            g.trains.size
              ? rate >= 0
                ? 'Income is covering your running costs. Spend the surplus on track, trains and research.'
                : 'Running costs are outpacing income, so your balance will slowly fall. See which trains are losing money below.'
              : 'You are not earning anything yet. Lay track and run a passenger or goods train to start earning.'),
        ),
        h('div', { class: 'section' },
          h('div', { class: 'lbl' }, 'Last 24 hours, by hour'),
          chart(L.series(g.time, 24)),
          h('div', { class: 'legend' }, h('span', null, h('i', { class: 'pos' }), 'Passenger fares'), h('span', null, h('i', { class: 'frt' }), 'Freight'), h('span', null, h('i', { class: 'neg' }), 'Running costs')),
        ),
        h('div', { class: 'section' },
          h('div', { class: 'lbl' }, 'Last 24 hours'),
          h('div', { class: 'kv' },
            h('span', null, 'Passenger fares'), h('span', { class: 'pos' }, fmt.money(day.fares, true)),
            h('span', null, 'Freight'), h('span', { class: 'pos' }, fmt.money(day.freight, true)),
            h('span', null, 'Running costs'), h('span', { class: 'neg' }, fmt.money(day.running)),
            h('span', null, 'Track upkeep'), h('span', { class: 'neg' }, fmt.money(day.upkeep)),
            h('span', null, 'Operating profit'), h('span', { class: `strong ${sign(operating)}` }, fmt.money(operating, true)),
            h('span', null, 'Track built & upgraded'), h('span', null, fmt.money(day.track)),
            h('span', null, 'Trains bought'), h('span', null, fmt.money(day.trains)),
            h('span', null, 'Research'), h('span', null, fmt.money(day.research)),
            day.sales ? h('span', null, 'Sold / removed') : null, day.sales ? h('span', null, fmt.money(day.sales, true)) : null,
            h('span', null, 'Net change'), h('span', { class: `strong ${sign(net)}` }, fmt.money(net, true)),
          ),
        ),
        h('div', { class: 'section' },
          h('div', { class: 'lbl', style: 'justify-content:space-between' }, 'Profit by train · 24 h', h('span', null, `costs ${fmt.money(runningNow)}/h`)),
          trains.length
            ? h('div', { class: 'list' }, trains.map(({ t, fares, running, profit }) =>
              h('div', { class: 'row click two', onclick: () => this.host.select({ kind: 'train', id: t.cfg.id }) },
                h('span', { class: 'sw', style: `background:${t.type.accent}` }),
                h('div', null,
                  h('div', null, `${t.cfg.number} ${t.cfg.name}`),
                  h('div', { class: 'meta' }, `${t.freight ? 'freight' : 'fares'} ${fmt.money(fares)} · running ${fmt.money(-running)}`)),
                h('span', { class: `r ${sign(profit)}` }, fmt.money(profit, true)))))
            : h('div', { class: 'empty' }, 'No trains in service.'),
        ),
        h('div', { class: 'section' },
          h('div', { class: 'lbl' }, 'How money works'),
          h('ul', { class: 'explain' },
            h('li', null, h('b', null, 'Fares'), ' are paid when passengers get off: more for longer trips and premium trains. You will see ', h('b', { class: 'pos' }, '+₹'), ' pop up at the station.'),
            h('li', null, h('b', null, 'Freight'), ' pays when cargo is unloaded, by tonne and distance. It earns far more than general-class passengers, as on the real Indian Railways, but slow goods trains hold up passenger trains on shared lines.'),
            h('li', null, h('b', null, 'Running costs'), ' are charged every minute a train is in service, full or empty. Each coach adds to it.'),
            h('li', null, h('b', null, 'Track upkeep'), ' is charged for every km you own, more for double and faster lines. Lines nobody uses still cost money.'),
            h('li', null, h('b', null, 'Track and trains'), ' are one-off purchases. Removing them refunds part of the price.'),
          ),
        ),
        h('div', { class: 'section' },
          h('div', { class: 'lbl' }, 'All time'),
          h('div', { class: 'kv' },
            h('span', null, 'Passenger fares'), h('span', { class: 'pos' }, fmt.money(L.total.fares, true)),
            h('span', null, 'Freight'), h('span', { class: 'pos' }, fmt.money(L.total.freight, true)),
            h('span', null, 'Running costs'), h('span', { class: 'neg' }, fmt.money(L.total.running)),
            h('span', null, 'Upkeep'), h('span', { class: 'neg' }, fmt.money(L.total.upkeep)),
            h('span', null, 'Invested'), h('span', null, fmt.money(L.total.track + L.total.trains + L.total.research)),
          ),
        ),
      ),
    ];
  }

  private track(id: string): HTMLElement[] {
    const g = this.host.game;
    const e = g.net.edges.get(id)!;
    const users = g.trainsUsingEdge(id);
    const cls = lineClass(e.kmh);
    const up = g.upgradeInfo(id);
    const dfc = g.dfcInfo(id);
    const dbl = g.doubleInfo(id);
    const w = e.works;
    const div = w || users.length ? g.diversions(id) : null;
    const pct = w ? Math.min(100, ((g.time - w.start) / (w.end - w.start)) * 100) : 0;
    const days = (hours: number) => (hours >= 24 ? `${(hours / 24).toFixed(1)} days` : `${Math.round(hours)} h`);
    return [
      this.header(`${city(e.a).name} – ${city(e.b).name}`, `${e.a} – ${e.b} · ${Math.round(km(e.length))} km`),
      h('div', { class: 'scroll' },
        h('div', { class: 'section' },
          h('div', { class: 'kv' },
            h('span', null, 'Line'), h('span', null, e.tracks === 2 ? 'Double track' : 'Single track'),
            h('span', null, 'Line speed'), h('span', null, h('i', { class: 'linesw', style: `background:${cls.color}` }), `${cls.kmh} km/h · ${cls.name}`),
            h('span', null, 'Signal blocks'), h('span', null, `${e.blocks}${e.tracks === 1 && e.blocks > 1 ? ` · ${e.blocks - 1} crossing loop${e.blocks > 2 ? 's' : ''}` : ''}`),
            h('span', null, 'Condition'), h('span', null, e.speedFactor < 1 ? `Restricted ${Math.round(e.speedFactor * 100)}%` : 'Normal'),
            h('span', null, 'Occupied'), h('span', null, e.occupants.size ? `${e.occupants.size} train${e.occupants.size > 1 ? 's' : ''}` : 'Clear'),
            h('span', null, 'Freight corridor'), h('span', null, e.dfc ? 'Yes, freight runs separately' : 'No'),
            h('span', null, 'Traffic'), h('span', { class: lineLoad(e) > 0.75 ? 'neg' : '' }, `${lineLoad(e) > 0.75 ? 'Congested' : lineLoad(e) > 0.45 ? 'Busy' : 'Light'} · ${Math.round(e.util * 100)}% of blocks in use${e.held >= 1 ? ` · trains held ${Math.round(e.held)} min/h` : ''}`),
            h('span', null, 'Upkeep'), h('span', null, `${fmt.money(km(e.length) * (cls.upkeepPerKmDay * (e.tracks === 2 ? 1.6 : 1) + (e.dfc ? DFC.upkeepPerKmDay : 0)))} / day`),
          ),
        ),
        w ? h('div', { class: 'section works' },
          h('div', { class: 'lbl', style: 'justify-content:space-between' },
            w.kind === 'upgrade' ? `Works: upgrading to ${w.toKmh} km/h` : w.kind === 'dfc' ? 'Works: freight corridor' : 'Works: doubling the line',
            h('span', null, `done ${fmt.clock(w.end)} day ${fmt.day(w.end)}`)),
          h('div', { class: 'loadbar works-bar' }, h('i', { style: `width:${pct}%` })),
          w.kind === 'dfc' ? h('p', { class: 'hint' }, 'Built alongside the running line, so traffic keeps moving normally.') : h('p', { class: 'hint' }, `Trains are limited to ${Math.round(e.kmh * WORKS_SPEED)} km/h through the site`,
            w.kind === 'upgrade' && e.tracks === 2 ? ' and share one track while the other is relaid.' : '.',
            !users.length ? ' All trains are diverting via other lines.'
              : div && div.stuck.length ? h('b', { class: 'neg' }, ` ${div.stuck.length} train${div.stuck.length > 1 ? 's have' : ' has'} no other way round.`)
                : ` ${users.length} train${users.length > 1 ? 's' : ''} still run through: the way round is even slower.`),
        ) : null,
        e.tracks === 1 && !w ? h('p', { class: 'hint' }, 'On a single line opposing trains can only cross at loops, so one of them waits. ', h('b', null, 'Doubling'), ' lets them pass freely and lets trains follow closely.') : null,
        h('div', { class: 'section' },
          h('div', { class: 'lbl' }, 'Trains using this line'),
          users.length
            ? h('div', { class: 'list' }, users.map((t) =>
              h('div', { class: 'row click', onclick: () => this.host.select({ kind: 'train', id: t.cfg.id }) },
                h('span', { class: 'sw', style: `background:${t.type.accent}` }), `${t.cfg.number} ${t.cfg.name}`,
                div?.stuck.includes(t) && w ? h('span', { class: 'r neg' }, 'no diversion') : null)))
            : h('div', { class: 'empty' }, 'None'),
        ),
        !w && (up.toKmh || dbl.cost || !e.dfc) ? h('div', { class: 'section' },
          h('div', { class: 'lbl' }, 'Improve this line'),
          div && div.users.length
            ? h('p', { class: 'hint', style: 'margin:0 0 8px' }, 'Works slow the line for days. ',
              div.stuck.length
                ? h('b', { class: 'neg' }, `${div.stuck.length} of ${div.users.length} trains here have no diversion.`)
                : h('b', { class: 'pos' }, 'Every train here can divert.'),
              div.stuck.length ? ' Build another route first, or accept the delays.' : '')
            : null,
          up.toKmh ? h('button', {
            class: 'btn wide', disabled: !up.ok, title: up.reason ?? '',
            onclick: () => g.upgradeLine(id),
          }, up.ok ? `Upgrade to ${up.toKmh} km/h · ${fmt.cr(up.cost!)} · ${days(up.hours!)}` : `${up.toKmh} km/h: ${up.reason}`) : null,
          dbl.cost !== undefined && e.tracks === 1 ? h('button', {
            class: 'btn wide', disabled: !dbl.ok, title: dbl.reason ?? '',
            onclick: () => g.upgradeTrack(id),
          }, dbl.ok ? `Double the line · ${fmt.cr(dbl.cost!)} · ${days(dbl.hours!)}` : `Double: ${dbl.reason}`) : null,
          !e.dfc ? h('button', {
            class: 'btn wide', disabled: !dfc.ok, title: dfc.reason ?? '',
            onclick: () => g.buildDfc(id),
          }, dfc.ok ? `Build freight corridor alongside · ${fmt.cr(dfc.cost!)} · ${days(dfc.hours!)}, no disruption` : `Freight corridor: ${dfc.reason}`) : null,
        ) : null,
        h('div', { class: 'btnrow' },
          h('button', {
            class: 'btn danger', disabled: users.length > 0, title: users.length ? 'Trains still use this line' : '',
            onclick: () => { if (g.removeTrack(id)) this.host.select(null); },
          }, 'Remove line'),
        ),
      ),
    ];
  }

  private researchView(): HTMLElement[] {
    const g = this.host.game;
    const a = g.research.active;
    const unlockedTypes = TRAIN_TYPES.filter((t) => g.isResearched(t.research)).map((t) => t.short).join(', ');
    const fastest = LINE_CLASSES.filter((c) => g.isResearched(c.research)).pop()!;
    return [
      this.header('Research', `${g.research.done.size} of ${RESEARCH.length} projects done`),
      h('div', { class: 'scroll' },
        h('div', { class: 'section' },
          h('div', { class: 'kv' },
            h('span', null, 'Trains'), h('span', null, unlockedTypes),
            h('span', null, 'Fastest line'), h('span', null, `${fastest.kmh} km/h`),
            h('span', null, 'Safety'), h('span', { class: g.research.done.has('kavach') ? 'pos' : '' }, g.research.done.has('kavach') ? 'Kavach fitted' : 'No train protection'),
          ),
          h('p', { class: 'hint' }, 'One project at a time. Faster trains need faster track: research both, then upgrade your lines.'),
        ),
        h('div', { class: 'section' },
          h('div', { class: 'research' }, RESEARCH.map((r) => {
            const done = g.research.done.has(r.id);
            const running = a?.id === r.id;
            const chk = g.canResearch(r.id);
            const blocked = r.requires.some((q) => !g.research.done.has(q));
            const pct = running ? Math.min(100, ((g.time - a!.start) / (a!.end - a!.start)) * 100) : 0;
            return h('div', { class: `rcard${done ? ' done' : running ? ' running' : blocked ? ' blocked' : ''}` },
              h('div', { class: 'top' },
                h('b', null, r.name),
                h('span', { class: 'st' }, done ? 'Done' : running ? `${Math.round(pct)}%` : `${fmt.cr(r.cost)} · ${r.hours} h`)),
              h('div', { class: 'blurb' }, r.blurb),
              h('div', { class: 'unl' }, 'Unlocks: ', h('b', null, r.unlocks)),
              r.requires.length ? h('div', { class: 'req' }, `Needs ${r.requires.map((q) => RESEARCH_BY_ID.get(q)!.name).join(' + ')}`) : null,
              running ? h('div', { class: 'loadbar' }, h('i', { style: `width:${pct}%` })) : null,
              running ? h('div', { class: 'req' }, `Ready ${fmt.clock(a!.end)}, day ${fmt.day(a!.end)}`) : null,
              !done && !running ? h('button', {
                class: 'btn', disabled: !chk.ok, title: chk.reason ?? '',
                onclick: () => g.startResearch(r.id),
              }, chk.ok ? `Start · ${fmt.cr(r.cost)}` : chk.reason!) : null,
            );
          })),
        ),
      ),
    ];
  }
}

/** Hourly bars: fares and freight above the line, running costs below it. */
function chart(series: Bucket[]): HTMLElement {
  const W = 336;
  const H = 104;
  const up = Math.max(0.01, ...series.map((b) => b.fares + b.freight));
  const down = Math.max(0.01, ...series.map((b) => -b.running));
  const base = Math.round(Math.min(H - 18, Math.max(18, (H * up) / (up + down))));
  const bw = W / series.length;
  const bars = series.map((b, i) => {
    const x = (i * bw + 1).toFixed(1);
    const w = (bw - 2).toFixed(1);
    const hu = (b.fares / up) * (base - 2);
    const hf = (b.freight / up) * (base - 2);
    const hd = (-b.running / down) * (H - base - 2);
    return `<rect x="${x}" y="${(base - hu).toFixed(1)}" width="${w}" height="${hu.toFixed(1)}" fill="var(--green)"/>`
      + `<rect x="${x}" y="${(base - hu - hf).toFixed(1)}" width="${w}" height="${hf.toFixed(1)}" fill="var(--freight)"/>`
      + `<rect x="${x}" y="${base}" width="${w}" height="${hd.toFixed(1)}" fill="var(--red)" opacity=".75"/>`;
  }).join('');
  const el = h('div', { class: 'chart' });
  el.append(svg(`<svg viewBox="0 0 ${W} ${H}" width="100%" height="${H}" preserveAspectRatio="none">${bars}<line x1="0" x2="${W}" y1="${base}" y2="${base}" stroke="var(--ink)" stroke-width="1"/></svg>`));
  el.append(h('div', { class: 'axis' }, h('span', null, '24 h ago'), h('span', null, 'now')));
  return el;
}
