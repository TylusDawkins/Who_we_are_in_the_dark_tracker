import { createSignal, createMemo, createEffect, onMount, batch, Show, For } from "solid-js";
import "./App.css";

    // ---------- Utilities ----------
    const uid = () => Math.random().toString(36).slice(2) + Date.now().toString(36);
    const clamp = (n) => (Number.isFinite(n) && n >= 0 ? n : 0);
    const fmt = (t) => {
      if (t === Infinity) return "∞";
      if (t === 0) return "0";
      const r = Math.round(t * 10) / 10;
      return `${r}s`;
    };

    // Moved inside component to avoid disposal warnings

    // ---------- Components ----------
    function Bar(props) {
      const capped = Math.min(props.value ?? 0, 10);
      const w = Math.min(100, (capped / 10) * 100);
      const fillClass = props.variant === "active" ? "bg-indigo-600" : "bg-emerald-600";
      return (
        <div class="h-2 rounded bg-slate-800 overflow-hidden" title={props.label}>
          <div class={fillClass} style={{ width: `${w}%`, height: "100%" }} />
        </div>
      );
    }

    function App() {
      const [now, setNow] = createSignal(0);
      const [units, setUnits] = createSignal([]);
      const [log, setLog] = createSignal([]);
      const [autoAdvance, setAutoAdvance] = createSignal(false);
      const [separateRecovery, setSeparateRecovery] = createSignal(false);
      const [selectedId, setSelectedId] = createSignal(null);

      const [nameInput, setNameInput] = createSignal("");
      const [roleInput, setRoleInput] = createSignal("Player");
      const [initiativeInput, setInitiativeInput] = createSignal(0);
      const [actionDuration, setActionDuration] = createSignal(3);
      const [recoveryDuration, setRecoveryDuration] = createSignal(3);

      let advanceTimer = null;
      let isAdvancing = false;

      const readyIds = createMemo(() => units().filter(u => u.active <= 0 && u.passive <= 0).map(u => u.id));

      const currentId = createMemo(() => {
        const rids = readyIds();
        if (rids.length === 0) return null;
        const ready = units().filter(u => rids.includes(u.id));
        ready.sort((a, b) => a.addedAt - b.addedAt);
        return ready[0]?.id ?? null;
      });

      createEffect(() => {
        // If nothing is selected, prefer the current ready id
        if (!selectedId() && currentId()) setSelectedId(currentId());
      });

      function pushLog(entry, customNow)    {
        const stamp = `${(customNow ?? now()).toFixed(1)}s`;
        setLog(prev => [`[${stamp}] ${entry}`, ...(prev || [])].slice(0, 400));
      }

      function addUnit(name, role, initiative) {
        const nm = (name || "").trim();
        if (!nm) return;
        const u = { id: uid(), name: nm, role, initiative: initiative || 0, active: 0, passive: 0, addedAt: Date.now() };
        setUnits(prev => [...(prev || []), u]);
        setNameInput("");
        setRoleInput("Player");
        pushLog(`${role} “${u.name}” joined the battle.`);
      }

      function removeUnit(id) {
        const u = units().find(x => x.id === id);
        setUnits(prev => (prev || []).filter(x => x.id !== id));
        if (u) pushLog(`${u.role} “${u.name}” was removed.`);
      }

      function step(delta) {
        if (!(delta > 0)) return;
        setNow(n => n + delta);
        setUnits(prev => {
          const next = (prev || []).map(u => ({ ...u }));
          for (const u of next) {
            if (u.passive > 0) {
              u.passive = clamp(u.passive - delta);
            } else if (u.active > 0) {
              u.active = clamp(u.active - delta);
            }
          }
          return next;
        });
      }

      function advanceTime() {
        const list = units();
        if (list.length === 0) return;
        if (isAdvancing) return;
        const alreadyReady = list.some(u => u.active <= 0 && u.passive <= 0);
        if (alreadyReady) return;
        isAdvancing = true;
        advanceTimer = setInterval(() => {
          step(1);
          const anyReady = units().some(u => u.active <= 0 && u.passive <= 0);
          const noneLeft = units().length === 0;
          if (anyReady || noneLeft) {
            clearInterval(advanceTimer);
            advanceTimer = null;
            isAdvancing = false;
          }
        }, 250);
      }

      function applyAction() {
        const id = selectedId() || currentId();
        if (!id) return;
        const list = units();
        const u = list.find(x => x.id === id);
        if (!u) return;
        const isReady = u.active <= 0 && u.passive <= 0;
        if (!isReady) return; // enforce rule: only ready units can act

        const pas = Math.max(0, Number(actionDuration()));
        const act = Math.max(0, Number(separateRecovery() ? recoveryDuration() : pas));

        setUnits(prev => (prev || []).map(x => x.id === id ? { ...x, passive: pas, active: act } : x));

        const note = separateRecovery()
          ? `${u.name} starts action (${fmt(pas)} cast), recovery ${fmt(act)}.`
          : `${u.name} starts action for ${fmt(pas)} (recovery = ${fmt(act)}).`;
        pushLog(note);

        if (autoAdvance()) queueMicrotask(advanceTime);
      }

      function cancelCast(id) {
        const u = units().find(x => x.id === id);
        setUnits(prev => (prev || []).map(x => x.id === id ? { ...x, passive: 0 } : x));
        if (u) pushLog(`${u.name} cancels their action.`);
      }

      function resetAll() {
        if (!confirm("Reset battle state?")) return;
        batch(() => {
          setNow(0);
          setUnits([]);
          setLog([]);
          setSelectedId(null);
          setNameInput("");
          setRoleInput("Player");
          setActionDuration(3);
          setRecoveryDuration(3);
          setInitiativeInput(0);
        });
      }

      function resetActionDefaults() {
        setActionDuration(3);
        setRecoveryDuration(3);
      }

      // Auto-advance whenever toggled on and nobody is ready
      createEffect(() => {
        if (!autoAdvance()) return;
        if (units().length === 0) return;
        const anyReady = units().some(u => u.active <= 0 && u.passive <= 0);
        if (!anyReady) advanceTime();
      });

      const sorted = createMemo(() => {
        const copy = [...units()];
        copy.sort((a, b) => {
          const ar = a.active <= 0 && a.passive <= 0 ? -1 : 0;
          const br = b.active <= 0 && b.passive <= 0 ? -1 : 0;
          if (ar !== br) return br - ar; // ready first
          const an = Math.min(a.active > 0 ? a.active : Infinity, a.passive > 0 ? a.passive : Infinity);
          const bn = Math.min(b.active > 0 ? b.active : Infinity, b.passive > 0 ? b.passive : Infinity);
          if (an !== bn) return an - bn;
          return a.addedAt - b.addedAt;
        });
        return copy;
      });

      const current = createMemo(() => units().find(u => u.id === (selectedId() || currentId())));

      return (
        <div class="min-h-screen">
          <header class="sticky top-0 z-10 backdrop-blur bg-slate-950/70 border-b border-slate-800">
            <div class="max-w-6xl mx-auto px-4 py-3 flex items-center gap-4">
              <div class="text-xl font-semibold tracking-tight">ATB Combat Tracker — Solid.js</div>
              <div class="ml-auto flex items-center gap-4 text-sm">
                <div class="px-2 py-1 rounded bg-slate-800/60 border border-slate-700">Time: {now().toFixed(1)}s</div>
                <label class="inline-flex items-center gap-2 cursor-pointer select-none">
                  <input type="checkbox" class="size-4 accent-indigo-500" checked={autoAdvance()} onInput={e => setAutoAdvance(e.currentTarget.checked)} />
                  <span class="text-slate-300">Auto‑advance</span>
                </label>
                <button onClick={advanceTime} class="px-3 py-1.5 rounded bg-indigo-600 hover:bg-indigo-500 active:bg-indigo-700 transition border border-indigo-400/30 shadow-sm">Advance to next ready</button>
                <button onClick={() => step(1)} class="px-3 py-1.5 rounded bg-slate-600 hover:bg-slate-500 active:bg-slate-700 transition border border-slate-400/30 shadow-sm">+1s</button>
                <button onClick={() => step(0.5)} class="px-3 py-1.5 rounded bg-slate-600 hover:bg-slate-500 active:bg-slate-700 transition border border-slate-400/30 shadow-sm">+0.5s</button>
                <button onClick={resetAll} class="px-3 py-1.5 rounded border border-rose-400/30 hover:bg-rose-500/10 text-rose-300">Reset</button>
              </div>
            </div>
          </header>

          <main class="max-w-6xl mx-auto p-4 grid md:grid-cols-3 gap-4">
            {/* Left: Roster & Controls */}     
            <section class="md:col-span-2">
              <div class="grid sm:grid-cols-4 gap-3 mb-4">
                <input placeholder="Name" value={nameInput()} onInput={e => setNameInput(e.currentTarget.value)} class="sm:col-span-2 px-3 py-2 rounded border border-slate-700 bg-slate-900 placeholder:text-slate-500" />
                <select value={roleInput()} onInput={e => setRoleInput(e.currentTarget.value)} class="px-3 py-2 rounded border border-slate-700 bg-slate-900">
                  <option>Player</option>
                  <option>Enemy</option>
                </select>
                <div class="flex gap-2">
                  <input type="number" placeholder="Initiative" value={initiativeInput()} onInput={e => setInitiativeInput(Number(e.currentTarget.value) || 0)} class="px-3 py-2 rounded border border-slate-700 bg-slate-900 placeholder:text-slate-500" min="0" step="1" />
                  <button onClick={() => addUnit(nameInput(), roleInput(), initiativeInput())} class="px-3 py-2 rounded bg-emerald-600 hover:bg-emerald-500 active:bg-emerald-700 transition border border-emerald-400/30">Add</button>
                </div>
              </div>

              <div class="overflow-hidden rounded-2xl border border-slate-800 shadow">
                <table class="w-full text-sm">
                  <thead class="bg-slate-900/60 text-slate-300">
                    <tr>
                      <th class="text-left px-3 py-2">Unit</th>
                      <th class="text-left px-3 py-2">Role</th>
                      <th class="text-left px-3 py-2">Active (to next)</th>
                      <th class="text-left px-3 py-2">Passive (to resolve)</th>
                      <th class="text-left px-3 py-2">Status</th>
                      <th class="text-right px-3 py-2">Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    <Show when={sorted().length > 0} fallback={<tr><td colSpan="6" class="px-3 py-8 text-center text-slate-500">No units yet. Add a Player or an Enemy above.</td></tr>}>
                      <For each={sorted()}>
                        {(u) => {
                          const ready = u.active <= 0 && u.passive <= 0;
                          const status = ready
                            ? "Ready"
                            : u.passive > 0 && u.active > 0
                              ? `Casting… resolves in ${fmt(u.passive)}, resting for ${fmt(u.active)}`
                              : u.passive > 0
                                ? `Casting… resolves in ${fmt(u.passive)}`
                                : `Recovering… ready in ${fmt(u.active)}`;
                          const isSelected = (selectedId() || currentId()) === u.id;
                                                      return (
                              <tr class={isSelected ? "bg-slate-900/50" : ""}>
                                <td class="px-3 py-2">
                                  <button onClick={() => setSelectedId(u.id)} class={`text-left font-medium ${isSelected ? "text-indigo-300" : "text-slate-100"}`} title="Select as current">{u.name}</button>
                                </td>
                                <td class="px-3 py-2 text-slate-300">{u.role}</td>
                                <td class="px-3 py-2"><Bar value={u.active} label={fmt(u.active)} variant="active" /></td>
                                <td class="px-3 py-2"><Bar value={u.passive} label={fmt(u.passive)} variant="passive" /></td>
                                <td class="px-3 py-2 text-slate-300">{status}</td>
                              <td class="px-3 py-2 text-right">
                                <div class="inline-flex gap-2">
                                  {u.passive > 0 && (
                                    <button onClick={() => cancelCast(u.id)} class="px-2 py-1 rounded border border-amber-400/30 text-amber-300 hover:bg-amber-500/10">Cancel</button>
                                  )}
                                  <button onClick={() => removeUnit(u.id)} class="px-2 py-1 rounded border border-rose-400/30 text-rose-300 hover:bg-rose-500/10">Remove</button>
                                </div>
                              </td>
                            </tr>
                          );
                        }}
                      </For>
                    </Show>
                  </tbody>
                </table>
              </div>
            </section>

            {/* <!-- Right: Turn Panel & Log --> */}
            <aside class="space-y-4">
              <div class="rounded-2xl border border-slate-800 p-4 bg-slate-900/40">
                <h2 class="text-lg font-semibold mb-2">Turn Panel</h2>
                <Show when={current()} fallback={<div class="text-slate-400 text-sm">No one is ready yet.<div class="mt-2"><button onClick={advanceTime} class="px-3 py-2 rounded border border-slate-700 hover:bg-slate-800">Advance to next ready</button></div></div>}>
                  <div class="space-y-3">
                    <div class="text-lg text-slate-300 current-unit-header">Current ready unit:</div>
                    <div class="px-3 py-2 rounded-xl bg-slate-900 border border-slate-800 flex items-center justify-between">
                      <div>
                        <div class="current-unit-name">{current().name}</div>
                        <div class="text-xs text-slate-400">{current().role}</div>
                      </div>
                      <div class="text-xs text-slate-400">active {fmt(current().active)} · passive {fmt(current().passive)}</div>
                    </div>

                    <div class="grid gap-2 time-inputs">
                      <label class="text-sm text-slate-300">Action duration (passive time)</label>
                      <input type="number" step="0.1" min="0" value={actionDuration()} onInput={e => setActionDuration(Number(e.currentTarget.value))} class="px-3 py-2 rounded border border-slate-700 bg-slate-900" />

                      <label class="inline-flex items-center gap-2 text-sm text-slate-300 mt-1">
                        <input type="checkbox" class="size-4 accent-indigo-500" checked={separateRecovery()} onInput={e => setSeparateRecovery(e.currentTarget.checked)} />
                        Use separate recovery (active) time
                      </label>

                      <label class="text-sm text-slate-300">Recovery time (active time)</label>
                      <input type="number" step="0.1" min="0" value={recoveryDuration()} onInput={e => setRecoveryDuration(Number(e.currentTarget.value))} class="px-3 py-2 rounded border border-slate-700 bg-slate-900" />

                      <div class="flex gap-2 mt-2">
                        <button onClick={applyAction} class="flex-1 px-3 py-2 rounded bg-indigo-600 hover:bg-indigo-500 active:bg-indigo-700 transition border border-indigo-400/30">Apply action to {current()?.name}</button>
                        <button onClick={resetActionDefaults} class="px-3 py-2 rounded border border-slate-600 hover:bg-slate-700 transition text-slate-300" title="Reset to default values">↺</button>
                      </div>
                    </div>
                  </div>
                </Show>
              </div>

              <div class="rounded-2xl border border-slate-800 p-4 bg-slate-900/40">
                <h2 class="text-lg font-semibold mb-2">Event Log</h2>
                <div class="space-y-2 max-h-80 overflow-auto pr-1">
                  <Show when={(log() || []).length > 0} fallback={<div class="text-slate-500 text-sm">Events will appear here.</div>}>
                    <For each={log()}>{(l) => <div class="text-xs text-slate-300 border-l-2 border-slate-700 pl-2">{l}</div>}</For>
                  </Show>
                </div>
              </div>
            </aside>
          </main>

          <footer class="max-w-6xl mx-auto p-4 text-center text-xs text-slate-500">
            Active = cooldown until next turn · Passive = cast time until action resolves · Data persists in your browser.
          </footer>
        </div>
      );
    }

    export default App;