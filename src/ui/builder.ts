import { CITIES, city } from '../data/cities';
import { PAX_CLASSES, PAX_CLASS_INFO, TRAIN_TYPES, TRAIN_TYPE_BY_ID, TrainType, isFreight, trainCapacity, trainSeats } from '../data/trainTypes';
import { COMMODITY_INFO } from '../data/freight';
import { RESEARCH_BY_ID } from '../data/research';
import { km } from '../sim/network';
import { Train } from '../sim/train';
import type { Game } from '../sim/game';
import { fmt, h } from './dom';

export interface BuilderHost {
  game: Game;
  close(): void;
  onRoute(path: string[] | null, stops: string[]): void;
  onBuilt(trainId: string): void;
}

/** The "New train" panel: pick a preset, a formation and a list of stops. */
export class TrainBuilder {
  el: HTMLElement;
  typeId = 'mail';
  coaches = TRAIN_TYPE_BY_ID.get('mail')!.defaultCoaches;
  stops: string[] = [];
  private body: HTMLElement;
  private summary!: HTMLElement;
  private footer: HTMLElement;
  private preview!: HTMLElement;
  private coachVal!: HTMLElement;
  private error = '';

  constructor(private host: BuilderHost) {
    this.body = h('div', { class: 'scroll compact' });
    this.footer = h('div', { class: 'foot-cta' });
    this.el = h('div', { class: 'side left shadow' },
      h('div', { class: 'panel', style: 'display:flex;flex-direction:column;min-height:0;max-height:inherit' },
        h('header', null,
          h('div', null, h('h2', null, 'New train'), h('div', { class: 'sub' }, 'Pick a rake, set its formation and route')),
          h('button', { class: 'x', title: 'Close (Esc)', onclick: () => this.host.close() }, '×'),
        ),
        this.body,
        this.footer,
      ),
    );
  }

  open(firstStop?: string) {
    this.stops = firstStop ? [firstStop] : [];
    this.error = '';
    this.render();
  }

  get type() {
    return TRAIN_TYPE_BY_ID.get(this.typeId)!;
  }

  addStop(id: string) {
    if (this.stops[this.stops.length - 1] === id) return;
    if (!this.host.game.net.isConnected(id)) {
      this.error = `${city(id).name} has no track yet — build track to it first.`;
      this.render();
      return;
    }
    this.stops.push(id);
    this.error = '';
    this.render();
  }

  private routeChanged() {
    const info = this.host.game.routeInfo(this.stops, this.typeId);
    this.host.onRoute(info.ok ? info.path! : null, this.stops);
  }

  render() {
    if (!this.host.game.isResearched(this.type.research)) {
      this.typeId = 'mail';
      this.coaches = this.type.defaultCoaches;
    }
    const t = this.type;
    const scroll = this.body.scrollTop;
    this.body.replaceChildren(
      this.typeSection(),
      h('div', { class: 'section' },
        h('div', { class: 'lbl' }, h('span', { class: 'n' }, '02'), 'Formation'),
        this.formation(),
        h('p', { class: 'blurb' }, isFreight(t)
          ? `${t.minCoaches}–${t.maxCoaches} wagons · ${t.seatsPerCoach} t each`
          : `${t.minCoaches}–${t.maxCoaches} coaches · ${t.seatsPerCoach} seats each${t.standingFactor > 1 ? ` · standing up to ${Math.round(t.standingFactor * 100)}%` : ''}`),
      ),
      h('div', { class: 'section' },
        h('div', { class: 'lbl' }, h('span', { class: 'n' }, '03'), 'Route'),
        this.routeList(),
      ),
      (this.summary = h('div', { class: 'section' })),
    );
    this.renderSummary();
    this.body.scrollTop = scroll;
    this.routeChanged();
  }

  private typeSection() {
    const g = this.host.game;
    const card = (t: TrainType) => {
      const locked = !g.isResearched(t.research);
      return h('button', {
        class: `type${t.id === this.typeId ? ' on' : ''}${locked ? ' locked' : ''}`,
        disabled: locked,
        title: locked ? `Unlocked by research: ${RESEARCH_BY_ID.get(t.research!)!.name}` : '',
        onclick: () => {
          this.typeId = t.id;
          this.coaches = t.defaultCoaches;
          this.render();
        },
      },
      h('span', { class: 'stripe', style: `background:${t.accent}` }),
      h('span', { class: 'nm' }, t.name),
      h('span', { class: 'price' }, locked ? `🔒 ${RESEARCH_BY_ID.get(t.research!)!.name}` : fmt.cr(g.trainPrice(t, t.defaultCoaches))),
      h('span', { class: 'meta' }, `${t.cruiseKmh} km/h · `, classTags(t)),
      );
    };
    const list = h('div', { class: 'types' },
      h('div', { class: 'group' }, 'Passenger'), TRAIN_TYPES.filter((t) => !isFreight(t)).map(card),
      h('div', { class: 'group' }, 'Freight'), TRAIN_TYPES.filter(isFreight).map(card),
    );
    return h('div', { class: 'section' },
      h('div', { class: 'lbl' }, h('span', { class: 'n' }, '01'), 'Train type'),
      list,
      h('p', { class: 'blurb' }, this.type.blurb),
    );
  }

  private formation() {
    const t = this.type;
    this.coachVal = h('span', { class: 'val' }, this.coaches);
    this.preview = h('div', { class: 'preview' });
    const input = h('input', {
      type: 'range', min: t.minCoaches, max: t.maxCoaches, value: this.coaches,
      oninput: (e: Event) => {
        this.coaches = Number((e.target as HTMLInputElement).value);
        this.coachVal.textContent = String(this.coaches);
        this.drawPreview();
        this.renderSummary();
      },
    });
    this.drawPreview();
    return h('div', null, h('div', { class: 'slider-row' }, input, this.coachVal), this.preview);
  }

  private drawPreview() {
    const c = this.type.accent;
    const p = () => h('i', { class: 'p', style: `background:${this.type.nose === 'flat' ? c : '#fff'};border-bottom-color:${c}` });
    this.preview.replaceChildren(
      p(),
      ...Array.from({ length: this.coaches }, () => h('i', { style: `border-bottom-color:${c}` })),
      p(),
    );
  }

  private routeList() {
    const g = this.host.game;
    const items = this.stops.map((id, i) =>
      h('li', { class: i === 0 || i === this.stops.length - 1 ? 'end' : '' },
        h('span', { class: 'idx' }, i + 1),
        h('span', null, city(id).name),
        h('span', { class: 'code' }, id),
        h('span', { class: 'act' },
          h('button', { title: 'Move up', disabled: i === 0, onclick: () => this.move(i, -1) }, '↑'),
          h('button', { title: 'Move down', disabled: i === this.stops.length - 1, onclick: () => this.move(i, 1) }, '↓'),
          h('button', { title: 'Remove', onclick: () => { this.stops.splice(i, 1); this.render(); } }, '×'),
        ),
      ),
    );
    const connected = CITIES.filter((c) => g.net.isConnected(c.id)).sort((a, b) => a.name.localeCompare(b.name));
    const select = h('select', {
      onchange: (e: Event) => {
        const v = (e.target as HTMLSelectElement).value;
        if (v) this.addStop(v);
      },
    },
    h('option', { value: '' }, connected.length ? '+ Add stop…' : 'No stations on the network yet'),
    connected.map((c) => h('option', { value: c.id }, `${c.name} (${c.id})`)),
    );
    return h('div', null,
      items.length ? h('ul', { class: 'stops' }, items) : null,
      select,
      h('p', { class: 'hint' }, 'Or ', h('b', null, 'click stations on the map'), ' to add them in order. Trains run back and forth between the first and last stop.'),
      this.error ? h('div', { class: 'err' }, this.error) : null,
    );
  }

  private move(i: number, d: number) {
    const j = i + d;
    [this.stops[i], this.stops[j]] = [this.stops[j], this.stops[i]];
    this.render();
  }

  private renderSummary() {
    const g = this.host.game;
    const t = this.type;
    const info = g.routeInfo(this.stops, t.id);
    const cost = g.trainPrice(t, this.coaches);
    const licence = g.techTerms(t).costMult;
    const rows: (string | HTMLElement)[] = [];
    let slowLine = 0;
    if (info.ok) {
      const probe = new Train({ id: 'probe', number: '', name: '', typeId: t.id, coaches: this.coaches, stops: this.stops });
      probe.speedMult = g.techTerms(t).speedMult;
      probe.buildPath(g.net);
      for (let i = 1; i < probe.path.length; i++) {
        const e = g.net.edge(probe.path[i - 1], probe.path[i])!;
        if (e.kmh < t.cruiseKmh) slowLine = slowLine ? Math.min(slowLine, e.kmh) : e.kmh;
      }
      rows.push(
        h('span', null, 'Route'), h('span', null, `${city(this.stops[0]).name} → ${city(this.stops[this.stops.length - 1]).name}`),
        h('span', null, 'Distance'), h('span', null, `${fmt.int(km(info.length!))} km`),
        h('span', null, 'Journey'), h('span', null, `${fmt.dur(probe.journeyTime(g.net))} · avg ${Math.round(probe.serviceKmh)} km/h`),
      );
    }
    const opDay = (t.opCostPerHour + t.opCostPerCoachHour * this.coaches) * 24;
    rows.push(
      ...(isFreight(t)
        ? [h('span', null, 'Capacity'), h('span', null, `${fmt.int(trainCapacity(t, this.coaches))} t`)]
        : [h('span', null, 'Seats / max load'), h('span', null, `${fmt.int(trainSeats(t, this.coaches))} / ${fmt.int(trainCapacity(t, this.coaches))}`)]),
      h('span', null, 'Running cost'), h('span', null, `${fmt.cr(opDay)} / day`),
      h('span', null, 'Purchase'), h('span', { class: cost > g.funds ? 'neg' : '' }, `${fmt.cr(cost)}${licence > 1 ? ` (licence +${Math.round((licence - 1) * 100)}%)` : ''}`),
    );
    const reason = !info.ok ? info.reason : cost > g.funds ? 'Not enough funds' : '';
    const btn = h('button', {
      class: 'cta y',
      disabled: !!reason,
      onclick: () => {
        const name = `${city(this.stops[0]).name} – ${city(this.stops[this.stops.length - 1]).name} ${t.short}`;
        const res = g.addTrain({ name, typeId: t.id, coaches: this.coaches, stops: [...this.stops] });
        if (typeof res === 'string') {
          this.error = res;
          this.render();
        } else this.host.onBuilt(res.cfg.id);
      },
    }, reason ? reason : `Build train · ${fmt.cr(cost)}`);
    this.summary.replaceChildren(
      h('div', { class: 'lbl' }, h('span', { class: 'n' }, '04'), 'Summary'),
      h('div', { class: 'kv' }, rows),
      slowLine ? h('p', { class: 'hint' }, `Parts of this route are only ${slowLine} km/h, so this ${t.cruiseKmh} km/h train will be held back. `, h('b', null, 'Upgrade the lines'), ' to get its full speed.') : '',
    );
    this.footer.replaceChildren(btn);
  }
}

/** Small coloured tags for the passenger classes or commodities a train type carries. */
function classTags(t: TrainType): HTMLElement {
  if (t.cargo) {
    return h('span', { class: 'cls-tags' }, t.cargo.map((c) =>
      h('span', { class: 'cls', style: `--c:${COMMODITY_INFO[c].color}` }, COMMODITY_INFO[c].name)));
  }
  return h('span', { class: 'cls-tags' }, PAX_CLASSES.filter((c) => t.fares[c] !== undefined).map((c) =>
    h('span', { class: 'cls', style: `--c:${PAX_CLASS_INFO[c].color}` }, PAX_CLASS_INFO[c].name)));
}
