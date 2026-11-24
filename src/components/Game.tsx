"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { sfx } from "@/game/audio";
import { BattleSession, type EndInfo, type HudSnap } from "@/game/battle";
import { Engine } from "@/game/engine";
import { STARTER_SPECS, buildSpell, randomSpec, type Difficulty, type ElementId, type SpellDef, type SpellSpec, type SpellType } from "@/game/elements";
import { LabScene, type LabConfig } from "@/game/lab";
import type { InputManager } from "@/game/input";
import {
  addScore,
  clearScores,
  loadLoadout,
  loadName,
  loadScores,
  loadSettings,
  loadSpells,
  qualifiesForTable,
  renameScore,
  saveLoadout,
  saveName,
  saveSettings,
  saveSpells,
  type ScoreEntry,
  type Settings,
} from "@/game/storage";
import BattleHUD from "./BattleHUD";
import BookPanel from "./BookPanel";
import LabPanel from "./LabPanel";
import Menu from "./Menu";
import TouchControls from "./TouchControls";
import { createMatch, joinMatch, leaveMatch, newPeerId, pollMatch, startMatch, syncAsGuest, syncAsHost, type MatchInfo } from "@/game/net";

type Screen = "menu" | "lab" | "book" | "loadout" | "battle";
type Notice = { text: string; kind: "good" | "bad" | "info"; n: number };

const clampTemp = (v: number) => Math.max(-100, Math.min(100, v));

function autoPick(spells: SpellDef[]): string[] {
  const power = (s: SpellDef) => (s.type === "wall" ? s.wallHp * 0.4 : s.damage);
  const by = (t: SpellDef["type"]) => spells.filter((s) => s.type === t).sort((a, b) => power(b) - power(a));
  const chosen: SpellDef[] = [];
  const add = (s?: SpellDef) => {
    if (s && !chosen.includes(s) && chosen.length < 5) chosen.push(s);
  };
  const balls = by("ball");
  add(balls[0]);
  // prefer a second ball with a different element for counter-play
  add(balls.find((b) => !chosen.some((c) => c.elements[0] === b.elements[0])) ?? balls[1]);
  add(by("slash")[0]);
  add(by("wall")[0]);
  for (const s of [...balls, ...by("slash"), ...by("wall")].sort((a, b) => power(b) - power(a))) add(s);
  return chosen.map((s) => s.id);
}

export default function Game() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const dmgRef = useRef<HTMLDivElement>(null);
  const engineRef = useRef<Engine | null>(null);
  const labRef = useRef<LabScene | null>(null);
  const sessionRef = useRef<BattleSession | null>(null);
  const lastRun = useRef<{ ids: string[]; diff: Difficulty; online?: { host: boolean; opponentLoadout: SpellDef[]; opponentName: string } } | null>(null);
  const peerId = useRef("");
  const matchSeq = useRef(0);
  const startedOnline = useRef(false);
  const entryDate = useRef<number | null>(null);

  const [screen, setScreen] = useState<Screen>("menu");
  const [spells, setSpells] = useState<SpellDef[]>([]);
  const [loadoutIds, setLoadoutIds] = useState<string[]>([]);
  const [settings, setSettings] = useState<Settings>({ muted: false, difficulty: "adept", sensitivity: 1, musicVolume: 0.8 });
  const [scores, setScores] = useState<ScoreEntry[]>([]);
  const [config, setConfig] = useState<LabConfig>({ picks: [], temp: 0, type: "ball" });
  const [notice, setNotice] = useState<Notice | null>(null);
  const [hud, setHud] = useState<HudSnap | null>(null);
  const [end, setEnd] = useState<EndInfo | null>(null);
  const [rank, setRank] = useState<number | null>(null);
  const [name, setName] = useState("Wizard");
  const [touch, setTouch] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [glError, setGlError] = useState(false);
  const [pvpDialog, setPvpDialog] = useState(false);
  const [onlineRole, setOnlineRole] = useState<"host" | "guest" | null>(null);
  const [joinCode, setJoinCode] = useState("");
  const [matchRoom, setMatchRoom] = useState<MatchInfo | null>(null);
  const [matchError, setMatchError] = useState("");

  // latest-value refs so long-lived callbacks never go stale
  const live = useRef({ spells, config, screen, settings, touch, name, end });
  useEffect(() => {
    live.current = { spells, config, screen, settings, touch, name, end };
  }, [spells, config, screen, settings, touch, name, end]);

  const notify = useCallback((text: string, kind: Notice["kind"] = "info") => {
    setNotice((p) => ({ text, kind, n: (p?.n ?? 0) + 1 }));
  }, []);

  // ---- lab actions -----------------------------------------------------------
  const pick = useCallback((e: ElementId) => {
    sfx.resume();
    sfx.pick(e);
    labRef.current?.pickBurst(e);
    setConfig((c) => ({ ...c, picks: [...c.picks, e].slice(-2) }));
  }, []);

  const forgeSpec = useCallback(
    (spec: SpellSpec) => {
      const def = buildSpell(spec);
      const cur = live.current.spells;
      if (cur.some((s) => s.id === def.id)) {
        notify("Already in your Magic Book — change the type or cross a temperature band.", "bad");
        sfx.deny();
        return false;
      }
      const next = [...cur, def];
      live.current.spells = next;
      setSpells(next);
      saveSpells(next);
      sfx.resume();
      sfx.forge();
      labRef.current?.forgeBurst(def.colors[0], def.colors[1]);
      notify(`Forged ${def.name}! (${next.length}/10)${next.length === 10 ? " — Battle mode unlocked!" : ""}`, "good");
      return true;
    },
    [notify],
  );

  const forge = useCallback(() => {
    const c = live.current.config;
    if (!c.picks.length) {
      notify("Pick an element first — click a source or a button.", "bad");
      sfx.deny();
      return;
    }
    forgeSpec({ a: c.picks[0], b: c.picks[1] ?? c.picks[0], temp: c.temp, type: c.type });
  }, [forgeSpec, notify]);

  const surprise = useCallback(() => {
    const have = new Set(live.current.spells.map((s) => s.id));
    for (let i = 0; i < 80; i++) {
      const spec = randomSpec();
      const def = buildSpell(spec);
      if (!have.has(def.id)) {
        setConfig({ picks: spec.a === spec.b ? [spec.a] : [spec.a, spec.b], temp: spec.temp, type: spec.type });
        forgeSpec(spec);
        return;
      }
    }
    notify("Your book is overflowing with spells!", "info");
  }, [forgeSpec, notify]);

  const quickForge = useCallback(() => {
    const cur = [...live.current.spells];
    const have = new Set(cur.map((s) => s.id));
    const add = (spec: SpellSpec) => {
      const d = buildSpell(spec);
      if (!have.has(d.id)) {
        have.add(d.id);
        cur.push(d);
      }
    };
    for (const s of STARTER_SPECS) if (cur.length < 10) add(s);
    let guard = 0;
    while (cur.length < 10 && guard++ < 200) add(randomSpec());
    live.current.spells = cur;
    setSpells(cur);
    saveSpells(cur);
    sfx.resume();
    sfx.forge();
    notify(`Your book now holds ${cur.length} spells.`, "good");
  }, [notify]);

  const setTemp = useCallback((v: number) => setConfig((c) => ({ ...c, temp: clampTemp(v) })), []);
  const setType = useCallback((t: SpellType) => {
    sfx.ui();
    setConfig((c) => ({ ...c, type: t }));
  }, []);

  const handlers = useRef({ pick, forge, wheel: (d: number) => setTemp(live.current.config.temp + d * 5) });
  useEffect(() => {
    handlers.current = { pick, forge, wheel: (d: number) => setTemp(live.current.config.temp + d * 5) };
  }, [pick, forge, setTemp]);

  // ---- battle flow -------------------------------------------------------------
  const leaveBattle = useCallback(() => {
    if (matchRoom && peerId.current) void leaveMatch(peerId.current, matchRoom.code).catch(() => undefined);
    setMatchRoom(null); setOnlineRole(null); startedOnline.current = false;
    sessionRef.current?.dispose();
    sessionRef.current = null;
    const e = engineRef.current;
    const lab = labRef.current;
    if (e && lab) e.setScene(lab);
    setHud(null);
    setEnd(null);
    setRank(null);
  }, [matchRoom]);

  const handleEnd = useCallback((info: EndInfo) => {
    setEnd(info);
    entryDate.current = null;
    if (lastRun.current?.online) {
      setRank(null);
      return;
    }
    if (qualifiesForTable(info.score)) {
      const entry: ScoreEntry = { name: live.current.name || "Wizard", score: info.score, result: info.result, difficulty: info.difficulty, date: Date.now() };
      const list = addScore(entry);
      entryDate.current = entry.date;
      setScores(list);
      const idx = list.findIndex((s) => s.date === entry.date);
      setRank(idx >= 0 ? idx + 1 : null);
    } else setRank(null);
  }, []);

  const startBattle = useCallback(
    (ids: string[], diff: Difficulty, online?: { host: boolean; opponentLoadout: SpellDef[]; opponentName: string }) => {
      const engine = engineRef.current;
      const canvas = canvasRef.current;
      const layer = dmgRef.current;
      if (!engine || !canvas || !layer) return;
      const defs = ids.map((id) => live.current.spells.find((s) => s.id === id)).filter(Boolean) as SpellDef[];
      if (defs.length !== 5) return;
      sessionRef.current?.dispose();
      sfx.resume();
      sfx.battleMusic();
      lastRun.current = { ids, diff, online };
      const session = new BattleSession(engine, {
        loadout: defs,
        difficulty: diff,
        damageLayer: layer,
        inputEl: canvas,
        touch: live.current.touch,
        sensitivity: live.current.settings.sensitivity,
        onEnd: handleEnd,
        online,
      });
      sessionRef.current = session;
      if (!live.current.touch) session.input.requestLock(); // called inside a click/key gesture
      if (window.location.search.includes("debug")) (window as unknown as { __arcana?: BattleSession }).__arcana = session;
      engine.setScene(session);
      setEnd(null);
      setRank(null);
      setHud(session.snapshot());
      setScreen("battle");
    },
    [handleEnd],
  );

  const restart = useCallback(() => {
    const r = lastRun.current;
    if (r) startBattle(r.ids, r.diff, r.online);
  }, [startBattle]);

  const goScreen = useCallback(
    (s: Screen) => {
      if (live.current.screen === "battle" && s !== "battle") leaveBattle();
      sfx.menuMusic(s === "menu");
      setScreen(s);
    },
    [leaveBattle],
  );

  const openLoadout = useCallback(() => {
    const cur = live.current.spells;
    if (cur.length < 10) {
      notify(`Forge ${10 - cur.length} more unique spells to unlock battle mode.`, "bad");
      sfx.deny();
      goScreen("lab");
      return;
    }
    const saved = loadLoadout().filter((id) => cur.some((s) => s.id === id)).slice(0, 5);
    setLoadoutIds(saved.length === 5 ? saved : autoPick(cur));
    goScreen("loadout");
  }, [goScreen, notify]);

  const toggleLoadout = useCallback((id: string) => {
    setLoadoutIds((cur) => {
      if (cur.includes(id)) {
        sfx.ui();
        return cur.filter((x) => x !== id);
      }
      if (cur.length >= 5) {
        sfx.deny();
        return cur;
      }
      sfx.select();
      return [...cur, id];
    });
  }, []);

  const beginDuel = useCallback(() => {
    saveLoadout(loadoutIds);
    saveSettings(live.current.settings);
    if (!onlineRole) { startBattle(loadoutIds, live.current.settings.difficulty); return; }
    const run = async () => {
      setMatchError("");
      try {
        const peer = peerId.current || (peerId.current = newPeerId());
        const selectedSpells = loadoutIds.map((id) => live.current.spells.find((spell) => spell.id === id)).filter(Boolean) as SpellDef[];
        if (selectedSpells.length !== 5) throw new Error("Choose five available spells before starting the duel.");
        const room = onlineRole === "host" ? await createMatch(peer, selectedSpells) : await joinMatch(peer, joinCode, selectedSpells);
        setMatchRoom(room); startedOnline.current = false;
      } catch (e) { setMatchError(e instanceof Error ? e.message : "Could not create the duel."); }
    };
    void run();
  }, [joinCode, loadoutIds, onlineRole, startBattle]);

  const openPvp = useCallback(() => {
    if (live.current.spells.length < 10) {
      notify(`Forge ${10 - live.current.spells.length} more spells to unlock player duels.`, "bad");
      goScreen("lab");
      return;
    }
    setPvpDialog(true); setMatchError("");
  }, [goScreen, notify]);

  const toggleMute = useCallback(() => {
    setSettings((s) => {
      const n = { ...s, muted: !s.muted };
      sfx.setMuted(n.muted);
      saveSettings(n);
      return n;
    });
  }, []);

  const changeMusicVolume = useCallback((volume: number) => {
    setSettings((s) => {
      const n = { ...s, musicVolume: volume };
      sfx.setMusicVolume(volume);
      saveSettings(n);
      return n;
    });
  }, []);

  const deleteSpell = useCallback((id: string) => {
    const next = live.current.spells.filter((s) => s.id !== id);
    live.current.spells = next;
    setSpells(next);
    saveSpells(next);
    setLoadoutIds((l) => l.filter((x) => x !== id));
    sfx.ui();
  }, []);

  // ---- mount: engine + lab -----------------------------------------------------------
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    peerId.current = newPeerId();
    setSpells(loadSpells());
    setLoadoutIds(loadLoadout());
    setScores(loadScores());
    const st = loadSettings();
    setSettings(st);
    sfx.setMuted(st.muted);
    sfx.setMusicVolume(st.musicVolume);
    setName(loadName());
    setTouch(window.matchMedia?.("(pointer: coarse)").matches ?? false);

    let engine: Engine;
    try {
      engine = new Engine(canvas);
    } catch {
      requestAnimationFrame(() => setGlError(true));
      return;
    }
    const lab = new LabScene(engine, canvas, {
      onPick: (e) => handlers.current.pick(e),
      onCrystal: () => handlers.current.forge(),
      onWheel: (d) => handlers.current.wheel(d),
    });
    engineRef.current = engine;
    labRef.current = lab;
    engine.setScene(lab);
    engine.start();
    const readyFrame = requestAnimationFrame(() => setLoaded(true));

    const onTouch = () => setTouch(true);
    window.addEventListener("touchstart", onTouch, { once: true, passive: true });
    const onFirst = () => {
      sfx.resume();
      sfx.menuMusic(live.current.screen === "menu");
    };
    window.addEventListener("pointerdown", onFirst, { once: true });
    window.addEventListener("keydown", onFirst, { once: true });
    return () => {
      cancelAnimationFrame(readyFrame);
      window.removeEventListener("touchstart", onTouch);
      window.removeEventListener("pointerdown", onFirst);
      window.removeEventListener("keydown", onFirst);
      sessionRef.current?.dispose();
      sessionRef.current = null;
      lab.dispose();
      engine.dispose();
      engineRef.current = null;
      labRef.current = null;
      sfx.menuMusic(false);
    };
  }, []);

  useEffect(() => {
    if (!matchRoom || screen !== "loadout") return;
    let busy = false;
    const id = setInterval(async () => {
      if (busy) return;
      busy = true;
      try {
        const status = await pollMatch(matchRoom.peer, matchRoom.code);
        setMatchError("");
        if (status.state !== matchRoom.state) setMatchRoom(status);
        if (status.host && status.state === "ready") {
          const started = await startMatch(status.peer, status.code);
          setMatchRoom(started);
        } else if (status.state === "active" && !startedOnline.current) {
          const opponentLoadout = status.opponentLoadout ?? [];
          if (opponentLoadout.length !== 5) throw new Error("The other player’s spell loadout is incomplete.");
          startedOnline.current = true;
          const localIds = loadLoadout().filter((id) => live.current.spells.some((s) => s.id === id)).slice(0, 5);
          startBattle(localIds.length === 5 ? localIds : autoPick(live.current.spells), live.current.settings.difficulty, {
            host: status.host, opponentLoadout, opponentName: "Rival",
          });
        }
      } catch (e) { setMatchError(e instanceof Error ? e.message : "Connection to the duel room was lost."); }
      finally { busy = false; }
    }, 650);
    return () => clearInterval(id);
  }, [matchRoom, screen, startBattle]);

  useEffect(() => {
    if (!matchRoom || screen !== "battle") return;
    let busy = false;
    const id = setInterval(async () => {
      const session = sessionRef.current;
      if (!session || busy) return;
      busy = true;
      try {
        if (matchRoom.host) {
          const status = await syncAsHost(matchRoom.peer, matchRoom.code, session.networkState());
          setMatchError("");
          if (status.input && status.input.seq > matchSeq.current) {
            matchSeq.current = status.input.seq;
            session.setRemoteInput(status.input);
          }
        } else {
          const input = session.networkInput();
          const status = await syncAsGuest(matchRoom.peer, matchRoom.code, input.intent, input.yaw, input.pitch, ++matchSeq.current);
          setMatchError("");
          if (status.snapshot) session.applyNetworkState(status.snapshot);
        }
      } catch (e) {
        const session = sessionRef.current;
        if (session && session.phase !== "over") {
          session.pause();
          setMatchError(e instanceof Error ? e.message : "The connection to your rival was lost.");
        }
      }
      finally { busy = false; }
    }, 120);
    return () => clearInterval(id);
  }, [matchRoom, screen]);

  useEffect(() => {
    const lab = labRef.current;
    if (!lab) return;
    const syncLabView = () => {
      lab.interactive = screen === "lab";
      const portrait = window.innerWidth < 820 || window.innerHeight > window.innerWidth;
      if (screen === "lab") lab.setViewShift(portrait ? 0 : 2.3, portrait ? -3.1 : 0);
      else lab.setViewShift(0, 0);
    };
    syncLabView();
    window.addEventListener("resize", syncLabView);
    return () => window.removeEventListener("resize", syncLabView);
  }, [screen, loaded]);

  useEffect(() => {
    labRef.current?.setConfig(config);
  }, [config, loaded]);

  useEffect(() => {
    if (screen !== "battle") return;
    const id = setInterval(() => {
      const s = sessionRef.current;
      if (s) setHud(s.snapshot());
    }, 50);
    return () => clearInterval(id);
  }, [screen]);

  // ---- global keys ----------------------------------------------------------------------
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA") && (t as HTMLInputElement).type !== "range") return;
      const s = live.current.screen;
      if (e.code === "KeyM" && !e.repeat) {
        toggleMute();
        return;
      }
      const sess = sessionRef.current;
      if (s === "battle" && sess) {
        if (!lastRun.current?.online && e.code === "KeyR" && (sess.phase === "over" || sess.phase === "paused") && !e.repeat) restart();
        else if (!lastRun.current?.online && e.code === "Enter" && sess.phase === "over" && document.activeElement === document.body && !e.repeat) restart();
        else if ((e.code === "Escape" || e.code === "KeyP") && sess.phase === "paused" && !e.repeat) setTimeout(() => sess.resume(), 0);
      } else if (s === "lab" && !e.repeat) {
        if (e.code === "KeyQ") setTemp(live.current.config.temp - 5);
        else if (e.code === "KeyE") setTemp(live.current.config.temp + 5);
        else if (e.code === "Digit1") setType("ball");
        else if (e.code === "Digit2") setType("slash");
        else if (e.code === "Digit3") setType("wall");
        else if (e.code === "Enter" && (t === null || t === document.body)) forge();
        else if (e.code === "Escape") goScreen("menu");
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [restart, toggleMute, setTemp, setType, forge, goScreen]);

  const getInput = useCallback((): InputManager | null => sessionRef.current?.input ?? null, []);

  const onName = useCallback((n: string) => {
    setName(n);
    saveName(n);
    if (entryDate.current !== null) setScores(renameScore(entryDate.current, n));
  }, []);

  const pauseNow = useCallback(() => sessionRef.current?.pause(), []);
  const resumeNow = useCallback(() => sessionRef.current?.resume(), []);
  const selectSlot = useCallback((i: number) => {
    sessionRef.current?.input.queueSelect(i);
  }, []);

  return (
    <div className={`game-root screen-${screen}`}>
      <canvas ref={canvasRef} className="game-canvas" />
      <div ref={dmgRef} className="dmg-layer" />

      {screen === "menu" && (
        <Menu
          spellCount={spells.length}
          scores={scores}
          muted={settings.muted}
          musicVolume={settings.musicVolume}
          touch={touch}
          onLab={() => {
            sfx.resume();
            sfx.ui();
            goScreen("lab");
          }}
          onBook={() => {
            sfx.resume();
            sfx.ui();
            goScreen("book");
          }}
          onDuel={() => {
            sfx.resume();
            sfx.ui();
            openLoadout();
          }}
          onPvp={openPvp}
          onMute={toggleMute}
          onMusicVolume={changeMusicVolume}
          onClearScores={() => {
            clearScores();
            setScores([]);
          }}
        />
      )}

      {screen === "lab" && (
        <LabPanel
          config={config}
          spells={spells}
          notice={notice}
          onPick={pick}
          onClear={(slot) =>
            setConfig((c) => {
              const picks = c.picks.filter((_, i) => i !== slot);
              return { ...c, picks };
            })
          }
          onTemp={setTemp}
          onType={setType}
          onForge={forge}
          onSurprise={surprise}
          onBook={() => goScreen("book")}
          onBack={() => goScreen("menu")}
        />
      )}

      {(screen === "book" || screen === "loadout") && (
        <>
          <BookPanel
            mode={screen === "loadout" ? "loadout" : "browse"}
            spells={spells}
            loadout={loadoutIds}
            difficulty={settings.difficulty}
            onToggle={toggleLoadout}
            onAuto={() => setLoadoutIds(autoPick(spells))}
            onDifficulty={(d) => {
              sfx.ui();
              setSettings((s) => ({ ...s, difficulty: d }));
            }}
            onDelete={deleteSpell}
            onQuickForge={quickForge}
            onLab={() => goScreen("lab")}
            onBack={() => {
              if (matchRoom) void leaveMatch(matchRoom.peer, matchRoom.code).catch(() => undefined);
              setMatchRoom(null); setOnlineRole(null); startedOnline.current = false; goScreen("menu");
            }}
            onFight={beginDuel}
          />
          {notice && screen === "book" && (
            <div key={notice.n} className={`float-notice ${notice.kind}`}>
              {notice.text}
            </div>
          )}
        </>
      )}

      {screen === "battle" && (
        <>
          {touch && <TouchControls getInput={getInput} />}
          <BattleHUD
            hud={hud}
            touch={touch}
            musicVolume={settings.musicVolume}
            onMusicVolume={changeMusicVolume}
            online={!!matchRoom}
            onlineHost={!!matchRoom?.host}
            end={end}
            rank={rank}
            name={name}
            scores={scores}
            onName={onName}
            onPause={pauseNow}
            onResume={resumeNow}
            onRestart={restart}
            onQuit={() => goScreen("menu")}
            onLoadout={openLoadout}
            onSelect={selectSlot}
          />
          {matchError && matchRoom && <div className="overlay"><div className="modal panel"><h2>Connection interrupted</h2><p className="hint error">{matchError}</p><div className="modal-btns"><button className="btn gold" onClick={() => goScreen("menu")}>Return to menu</button></div></div></div>}
        </>
      )}

      {matchError && screen === "loadout" && !matchRoom && <div className="overlay"><div className="modal panel"><h2>Could not connect</h2><p className="hint error">{matchError}</p><div className="modal-btns"><button className="btn gold" onClick={() => setMatchError("")}>Close</button></div></div></div>}

      {pvpDialog && screen === "menu" && (
        <div className="overlay">
          <div className="modal panel pvp-modal">
            <h2>Duel a Player</h2>
            <p className="hint">Choose five spells in your loadout. Share the room code with your rival.</p>
            <div className="modal-btns">
              <button className="btn gold big" onClick={() => { setOnlineRole("host"); setPvpDialog(false); setMatchRoom(null); goScreen("loadout"); }}>Create a room</button>
              <label className="room-entry">Room code<input value={joinCode} maxLength={8} autoCapitalize="characters" autoComplete="off" spellCheck={false} onChange={(e) => setJoinCode(e.target.value.toUpperCase().replace(/[^A-HJ-NP-Z2-9]/g, ""))} placeholder="8-CHARACTER CODE" /></label>
              <button className="btn big" disabled={joinCode.length !== 8} onClick={() => { setOnlineRole("guest"); setPvpDialog(false); setMatchRoom(null); goScreen("loadout"); }}>Join room</button>
              <button className="btn ghost" onClick={() => setPvpDialog(false)}>Cancel</button>
            </div>
            {matchError && <p className="hint error">{matchError}</p>}
          </div>
        </div>
      )}

      {matchRoom && screen === "loadout" && (
        <div className="overlay">
          <div className="modal panel pvp-modal">
            <h2>{matchRoom.host ? "Duel room" : "Joining duel"}</h2>
            <p className="hint">Share this room code with your rival:</p>
            <div className="room-code">{matchRoom.code}</div>
            <button className="btn sm" onClick={() => void navigator.clipboard.writeText(matchRoom.code).then(() => notify("Room code copied.", "good")).catch(() => notify("Select the room code above and copy it.", "bad"))}>Copy room code</button>
            <p className="hint">{matchRoom.state === "waiting" ? "Waiting for a player to join…" : matchRoom.state === "ready" ? "Rival joined. Starting duel…" : "Connecting to the arena…"}</p>
            {matchError && <p className="hint error">{matchError}</p>}
            <button className="btn ghost" onClick={() => { void leaveMatch(matchRoom.peer, matchRoom.code).catch(() => undefined); setMatchRoom(null); setOnlineRole(null); startedOnline.current = false; }}>Cancel</button>
          </div>
        </div>
      )}

      {!loaded && !glError && <div className="loading">Summoning the arena…</div>}
      {glError && <div className="loading">WebGL is unavailable in this browser, so the arcane arts cannot be rendered.</div>}
    </div>
  );
}
