import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import {
  Activity, AlertCircle, ArrowRight, CheckCircle2, ChevronRight, CircleDot,
  Clock3, FileCode2, GitBranch, Github, Layers3, Loader2, PackageCheck,
  RefreshCw, Rocket, ScrollText, Server, Settings2, ShieldCheck, Terminal,
  UploadCloud, XCircle, Zap, Search, Boxes, Gauge, GitCommit, BarChart3, Bell, Menu, ChevronDown,
  Users, UserPlus, KeyRound, Globe2, History, UserCog
} from "lucide-react";
import {
  getPanelState, inspectSource, startRelease, getReleaseRun,
  getReleaseHandoff, login, getAccessState, createPanelUser,
  updatePanelUser, createAccessGroup, updateAccessGroup, getControlState,
  controlRelease, getChannelsState, saveReleaseChannel, reviewChannelAccess,
  getAuditState, getRepositoryStatus, getPortalMonitor
} from "@/lib/panel.server";

export const Route = createFileRoute("/")({ component: Index });

type Tab = "overview" | "releases" | "base" | "engine" | "activity" | "channels" | "portal" | "repositories" | "monitoring" | "audit" | "access" | "settings";
type ReleaseType = "base" | "engine";

const EMPTY = { releases: [], channels: [] };

function Index() {
  const [session, setSession] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState<Tab>("overview");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [masterConnected, setMasterConnected] = useState(false);
  const [data, setData] = useState<any>({ base: EMPTY, engine: EMPTY });
  const [busy, setBusy] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");

  const [version, setVersion] = useState("");
  const [channel, setChannel] = useState("stable");
  const [notes, setNotes] = useState("");
  const [changelogTemplate, setChangelogTemplate] = useState<"base_deployment_log" | "update_changelog">("base_deployment_log");
  const [changelogDraft, setChangelogDraft] = useState("");
  const [files, setFiles] = useState<any[]>([]);
  const [commits, setCommits] = useState<any[]>([]);
  const [components, setComponents] = useState<string[]>([]);
  const [minBase, setMinBase] = useState("1.0.0");
  const [protocol, setProtocol] = useState("1");

  const [run, setRun] = useState<any>(null);
  const [runRepo, setRunRepo] = useState("");
  const [runVersion, setRunVersion] = useState("");
  const [runChannel, setRunChannel] = useState("stable");
  const [handoff, setHandoff] = useState<any>(null);
  const [reviewOpen, setReviewOpen] = useState(false);
  const [baseline, setBaseline] = useState<any>(null);

  const availableChannels = useMemo(() => {
    const all = [...(data.base.channels || []), ...(data.engine.channels || [])];
    return [...new Set(all.map((x: any) => String(x).trim().toLowerCase()).filter(Boolean))];
  }, [data]);

  const load = async (s = session, silent = false) => {
    if (!s) return;
    if (!silent) setLoading(true);
    setError("");
    try {
      const [base, engine] = await Promise.all([
        getPanelState({ data: { token: s.token, type: "base", channel } }),
        getPanelState({ data: { token: s.token, type: "engine", channel } }),
      ]);
      setData({ base, engine });
      setMasterConnected(true);
      if (!channel && base.selectedChannel) setChannel(base.selectedChannel);
    } catch (x: any) {
      setMasterConnected(false);
      setError(x.message || "Unable to connect to License Master.");
    } finally {
      if (!silent) setLoading(false);
    }
  };

  useEffect(() => {
    try {
      const raw = localStorage.getItem("orbitfs_panel_user");
      const token = localStorage.getItem("orbitfs_panel_session");
      if (raw && token) {
        const s = { ...JSON.parse(raw), token };
        setSession(s);
        load(s);
      } else setLoading(false);
    } catch {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (session) load(session, true);
  }, [channel]);

  useEffect(() => {
    if (!run?.id || !runRepo || !session) return;
    if (["success", "failure", "cancelled", "skipped"].includes(String(run.conclusion || ""))) return;
    let stopped = false;
    const poll = async () => {
      try {
        const r = await getReleaseRun({ data: { token: session.token, repo: runRepo, runId: run.id } });
        if (stopped) return;
        setRun({ ...r.run, jobs: r.jobs || [] });
        if (["success", "failure", "cancelled", "skipped"].includes(String(r.run?.conclusion || ""))) {
          await load(session, true);
        }
      } catch {}
    };
    poll();
    const timer = setInterval(poll, 3000);
    return () => { stopped = true; clearInterval(timer); };
  }, [run?.id, runRepo, session?.token]);

  useEffect(() => {
    if (!run?.id || !runRepo || !session || !runVersion) return;
    if (["success", "failure", "cancelled", "skipped"].includes(String(run.conclusion || ""))) return;
    let stopped = false;
    const poll = async () => {
      try {
        const type: ReleaseType = runRepo === "lucaskerim123/V1-vercel-base" ? "base" : "engine";
        const r = await getReleaseHandoff({
          data: { token: session.token, type, version: runVersion, channel: runChannel }
        });
        if (!stopped && r.release) setHandoff(r.release);
      } catch {}
    };
    poll();
    const timer = setInterval(poll, 5000);
    return () => { stopped = true; clearInterval(timer); };
  }, [run?.id, runRepo, session?.token, runVersion, runChannel]);

  const stats = useMemo(() => {
    const all = [...(data.base.releases || []), ...(data.engine.releases || [])];
    return {
      candidates: all.filter((r: any) => r.review_status === "pending").length,
      validationFailed: all.filter((r: any) => r.manifest?.validation?.status === "failed").length,
      ready: all.filter((r: any) => r.review_status === "approved" && r.status !== "published").length,
      published: all.filter((r: any) => r.status === "published").length,
    };
  }, [data]);

  const signOut = () => {
    localStorage.removeItem("orbitfs_panel_session");
    localStorage.removeItem("orbitfs_panel_user");
    setSession(null);
    setData({ base: EMPTY, engine: EMPTY });
    setRun(null); setRunRepo(""); setHandoff(null); setBaseline(null);
  };

  const inspect = async (type: ReleaseType) => {
    setBusy("inspect");
    setError(""); setNotice("");
    try {
      const current = data[type].releases?.filter((r: any) => r.review_status === "approved" && r.source_sha)
        .sort((a: any, b: any) => new Date(b.published_at || b.created_at || 0).getTime() - new Date(a.published_at || a.created_at || 0).getTime())[0]?.source_sha;
      const r = await inspectSource({ data: { token: session.token, type, from: current, channel } });
      setFiles(r.files || []);
      setCommits(r.commits || []);
      setBaseline({ ...(r.baseline || {}), repo: r.repo, ref: r.ref, head: r.head, baseBaseline: r.baseBaseline || null });
      if (type === "engine" && r.baseBaseline?.version) setMinBase(String(r.baseBaseline.version));
      setChangelogTemplate(type === "base" ? "base_deployment_log" : "update_changelog");
      setChangelogDraft(buildChangelog(type, {
        version,
        channel,
        files: r.files || [],
        commits: r.commits || [],
        notes,
        components,
        minBase,
        protocol,
        repo: r.repo,
        ref: r.ref,
        head: r.head,
      }));
      setReviewOpen(true);
      setNotice(`${r.repo}@${r.ref} resolved at ${r.head.slice(0, 8)} · ${r.files.length} changed files detected.`);
    } catch (x: any) {
      setError(x.message || "Unable to inspect source.");
    } finally { setBusy(""); }
  };

  const start = async (type: ReleaseType) => {
    setBusy("start"); setError(""); setNotice("");
    try {
      const r = await startRelease({
        data: { token: session.token, type, version, channel, notes: changelogDraft, files, components,
          minimumBaseVersion: minBase, protocol, changelogTemplate }
      });
      setReviewOpen(false);
      setRun(r.runId ? { id: r.runId, status: "queued", conclusion: null, name: `${type === "base" ? "Base" : "Engine"} release` } : null);
      setRunRepo(r.repo); setRunVersion(version); setRunChannel(channel); setHandoff(null);
      setNotice(r.runId ? `Release sent · GitHub workflow run #${r.runId} started.` : "Release sent to GitHub. Waiting for the workflow run to appear.");
      try { await load(session, true); } catch {}
      setTab(type === "base" ? "base" : "engine");
    } catch (x: any) {
      setError(x.message || "Unable to start release.");
    } finally { setBusy(""); }
  };

  if (!session) return <Login email={email} password={password} setEmail={setEmail} setPassword={setPassword}
    busy={busy} error={error} onSubmit={async (e: any) => {
      e.preventDefault(); setBusy("login"); setError("");
      try {
        const r = await login({ data: { email, password } });
        localStorage.setItem("orbitfs_panel_session", r.token);
        localStorage.setItem("orbitfs_panel_user", JSON.stringify(r.user));
        const s = { ...r.user, token: r.token }; setSession(s); setPassword(""); await load(s);
      } catch (x: any) { setError(x.message || "Unable to sign in."); }
      finally { setBusy(""); }
    }} />;

  const allReleases = [...(data.base.releases || []), ...(data.engine.releases || [])]
    .sort((a: any, b: any) => new Date(b.created_at || 0).getTime() - new Date(a.created_at || 0).getTime());

  return (
    <div className="min-h-screen bg-background">
      <Header connected={masterConnected} loading={loading} onRefresh={() => load()} onSignOut={signOut} user={session} />
      <div className="mx-auto flex min-h-[calc(100vh-57px)] max-w-[1680px]">
        <Sidebar tab={tab} setTab={setTab} activeRun={!!run && !run.conclusion} />
        <main className="min-w-0 flex-1 px-4 py-5 sm:px-6 xl:px-8">
          <div className="mx-auto max-w-[1440px] space-y-4">
            {error && <Alert tone="error" onClose={() => setError("")}>{error}</Alert>}
            {notice && <Alert tone="success" onClose={() => setNotice("")}>{notice}</Alert>}
            {tab === "overview" && <Dashboard stats={stats} releases={allReleases} connected={masterConnected} run={run} channels={availableChannels}
              onBase={() => { resetComposer(); setTab("base"); }} onEngine={() => { resetComposer(); setTab("engine"); }}
              onActivity={() => setTab("activity")} onReleases={() => setTab("releases")} />}
            {tab === "releases" && <ReleasesPage releases={allReleases} session={session} onChanged={()=>load(session,true)} onBase={() => { resetComposer(); setTab("base"); }} onEngine={() => { resetComposer(); setTab("engine"); }} />}
            {tab === "base" && <Composer type="base" releases={data.base.releases||[]} session={session} {...composerProps({ channel, setChannel, version, setVersion, notes, setNotes, files, commits, baseline,
              setFiles, setCommits, components, setComponents, minBase, setMinBase, protocol, setProtocol, busy, reviewOpen, availableChannels,
              changelogTemplate, setChangelogTemplate, changelogDraft, setChangelogDraft })}
              onInspect={() => inspect("base")} onStart={() => start("base")}
              run={runRepo === "lucaskerim123/V1-vercel-base" ? run : null} runRepo={runRepo} handoff={handoff} connected={masterConnected} />}
            {tab === "engine" && <Composer type="engine" releases={data.engine.releases||[]} session={session} {...composerProps({ channel, setChannel, version, setVersion, notes, setNotes, files, commits, baseline,
              setFiles, setCommits, components, setComponents, minBase, setMinBase, protocol, setProtocol, busy, reviewOpen, availableChannels,
              changelogTemplate, setChangelogTemplate, changelogDraft, setChangelogDraft })}
              onInspect={() => inspect("engine")} onStart={() => start("engine")}
              run={runRepo === "lucaskerim123/V1-vercel-engine" ? run : null} runRepo={runRepo} handoff={handoff} connected={masterConnected} />}
            {tab === "activity" && <MonitoringPage releases={allReleases} run={run} connected={masterConnected} session={session} />}
            {tab === "repositories" && <RepositoriesPage data={data} session={session} onBase={() => { resetComposer(); setTab("base"); }} onEngine={() => { resetComposer(); setTab("engine"); }} />}
            {tab === "channels" && <ChannelsPage channels={availableChannels} data={data} session={session} />}
            {tab === "portal" && <CustomerPortalPage releases={allReleases} channels={availableChannels} session={session} />}
            {tab === "monitoring" && <SystemMonitoringPage releases={allReleases} connected={masterConnected} run={run} />}
            {tab === "audit" && <AuditPage releases={allReleases} run={run} session={session} />}
            {tab === "access" && <AccessPage session={session} />}
            {tab === "settings" && <SettingsPage data={data} connected={masterConnected} />}
          </div>
        </main>
      </div>
    </div>
  );

  function resetComposer() {
    setVersion(""); setNotes(""); setFiles([]); setCommits([]); setComponents([]); setReviewOpen(false); setBaseline(null);
  }
}

function composerProps(p: any) {
  return p;
}

function Login(p: any) {
  return <div className="min-h-screen grid place-items-center p-5 bg-background">
    <form onSubmit={p.onSubmit} className="w-full max-w-[420px] rounded-2xl border bg-card p-7 shadow-2xl">
      <div className="mb-7">
        <div className="flex items-center gap-3"><div className="flex h-10 w-10 items-center justify-center rounded-xl bg-primary text-primary-foreground font-black">O</div>
          <div><p className="text-xs font-semibold uppercase tracking-[.18em] text-primary">OrbitFS</p><h1 className="text-xl font-semibold">Release Control</h1></div></div>
        <p className="mt-5 text-sm leading-6 text-muted-foreground">Stage 1 release preparation. Inspect source, build the release handoff, and send the candidate to License Master.</p>
      </div>
      <div className="space-y-3">
        <Field label="Email"><input className="control" type="email" value={p.email} onChange={e => p.setEmail(e.target.value)} required /></Field>
        <Field label="Password"><input className="control" type="password" value={p.password} onChange={e => p.setPassword(e.target.value)} required /></Field>
      </div>
      {p.error && <Alert tone="error">{p.error}</Alert>}
      <button className="mt-5 w-full rounded-xl bg-primary px-4 py-3 text-sm font-semibold text-primary-foreground" disabled={p.busy === "login"}>
        {p.busy === "login" ? "Signing in…" : "Sign in"}
      </button>
    </form>
  </div>;
}

function Header({ connected, loading, onRefresh, onSignOut, user }: any) {
  return <header className="orbit-topbar sticky top-0 z-30 border-b lg:ml-0">
    <div className="flex h-[66px] items-center justify-between gap-3 px-4 sm:px-6">
      <div className="flex min-w-0 flex-1 items-center gap-3">
        <div className="lg:hidden orbit-logo scale-90"><span></span></div>
        <div className="orbit-search hidden max-w-[560px] flex-1 items-center gap-2 md:flex">
          <Search size={15}/><span className="text-xs text-muted-foreground">Search repositories, releases, or commits...</span><kbd>/</kbd>
        </div>
      </div>
      <div className="flex items-center gap-2">
        <button className="icon-button border-0 bg-transparent" title="Refresh" onClick={onRefresh}><RefreshCw className={loading ? "animate-spin" : ""} size={16} /></button>
        <span className={`hidden rounded-full border px-2.5 py-1 text-[10px] font-semibold sm:inline-flex ${connected ? "border-emerald-400/30 bg-emerald-400/10 text-emerald-300" : "border-destructive/40 bg-destructive/10 text-destructive"}`}>
          {connected ? "Master online" : "Master offline"}
        </span>
        <div className="hidden h-8 w-px bg-border sm:block"/>
        <div className="hidden text-right sm:block"><p className="text-xs font-medium">{user.display_name || user.email}</p><p className="text-[10px] text-muted-foreground">{user.role || "operator"}</p></div>
        <button className="orbit-avatar" title="Sign out" onClick={onSignOut}>{String(user.display_name || user.email || "O").slice(0,1).toUpperCase()}</button>
      </div>
    </div>
  </header>;
}

function Sidebar({ tab, setTab, activeRun }: any) {
  const items = [
    ["overview", "Dashboard", "Release control overview", Gauge],
    ["base", "Base Deployments", "Base release workspace", Rocket],
    ["engine", "Updates", "Manifest-driven updates", Layers3],
    ["releases", "Releases", "Combined release registry", PackageCheck],
    ["activity", "Release Monitoring", "Live workflow health", Activity],
    ["channels", "Channels", "Release access channels", Server],
    ["portal", "Customer Portal", "Publication & access state", Globe2],
    ["repositories", "Repositories", "Source & workers", Boxes],
    ["monitoring", "Monitoring", "System telemetry", BarChart3],
    ["audit", "Audit & History", "Release and access events", History],
    ["access", "Users & Access", "Owner-managed access", Users],
    ["settings", "Configuration", "Runtime configuration", Settings2],
  ] as const;
  return <aside className="orbit-sidebar hidden w-[230px] shrink-0 lg:block">
    <div className="sticky top-0 flex h-screen flex-col px-3 py-5">
      <div className="mb-7 flex items-center gap-3 px-2">
        <div className="orbit-logo"><span></span></div>
        <div><p className="text-lg font-semibold tracking-tight">OrbitFS</p><p className="text-[10px] text-muted-foreground">Release Control</p></div>
      </div>
      <nav className="space-y-1">
        {items.map(([id, label, detail, Icon]) => <button key={id} onClick={() => setTab(id as Tab)}
          className={`orbit-nav-item ${tab === id ? "orbit-nav-active" : ""}`}>
          <span className="orbit-nav-icon"><Icon size={16} /></span>
          <span className="min-w-0 flex-1"><b>{label}</b><small>{detail}</small></span>
          {id === "activity" && activeRun && <span className="h-2 w-2 rounded-full bg-emerald-400 animate-pulse" />}
        </button>)}
      </nav>
      <div className="mt-auto rounded-xl border border-[#173555] bg-[#081828]/70 p-3">
        <p className="text-[10px] uppercase tracking-[.14em] text-muted-foreground">Pipeline authority</p>
        <div className="mt-3 space-y-2">
          <StepLine n="1" text="Dev Panel prepares" active />
          <StepLine n="2" text="License Master validates" />
          <StepLine n="3" text="Billing Store reviews" />
          <StepLine n="4" text="Customer release publishes" />
        </div>
      </div>
      <p className="px-2 pt-5 text-xs leading-5 text-[#6885a3]">Build further.<br/>Ship with OrbitFS.</p>
    </div>
  </aside>;
}

function StepLine({ n, text, active }: any) {
  return <div className={`flex items-center gap-2 ${active ? "text-foreground" : ""}`}><span className="flex h-5 w-5 items-center justify-center rounded-full border text-[9px] font-bold">{n}</span>{text}</div>;
}

function Dashboard({ stats, releases, connected, run, channels, onBase, onEngine, onActivity, onReleases }: any) {
  const recent = releases.slice(0, 5);
  const series = releaseSeries(releases);
  const healthy = releases.filter((r:any)=>r.manifest?.validation?.status!=="failed").length;
  const health = releases.length ? Math.round((healthy/releases.length)*100) : 100;
  return <section className="space-y-5">
    <div className="flex flex-col justify-between gap-4 xl:flex-row xl:items-end">
      <div>
        <p className="text-[10px] font-semibold uppercase tracking-[.18em] text-primary">Release workspace</p>
        <h1 className="mt-2 text-3xl font-semibold tracking-tight">Ship what’s next.</h1>
        <p className="mt-2 max-w-2xl text-sm leading-6 text-muted-foreground">Create, manage, and monitor OrbitFS releases while keeping License Master as the technical authority.</p>
      </div>
      <div className="flex gap-2"><button className="button-secondary" onClick={onReleases}>All releases</button><button className="button-primary" onClick={onEngine}><Rocket size={15}/> New release</button></div>
    </div>

    <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
      <Metric label="Release health" value={`${health}%`} detail={connected ? "License Master connected" : "Master connection unavailable"} />
      <Metric label="Candidates" value={stats.candidates} detail="Awaiting validation/review" />
      <Metric label="Published" value={stats.published} detail="Visible release history" />
      <Metric label="Active pipeline" value={run && !run.conclusion ? "1" : "0"} detail={run && !run.conclusion ? `Run #${run.id}` : "No workflow running"} />
    </div>

    <div className="grid gap-4 xl:grid-cols-[minmax(0,1.5fr)_360px]">
      <section className="release-surface overflow-hidden">
        <div className="flex items-center justify-between border-b p-4">
          <SectionHead icon={PackageCheck} title="Recent releases" detail="Latest release candidates known to License Master."/>
          <button className="text-xs font-medium text-primary" onClick={onReleases}>View all →</button>
        </div>
        <div>{recent.map((r:any)=><ReleaseSummaryRow key={r.id} release={r}/>)}
          {!recent.length&&<div className="p-10 text-center text-sm text-muted-foreground">No release records are currently visible.</div>}
        </div>
      </section>

      <div className="space-y-4">
        <section className="release-surface p-4">
          <div className="flex items-center justify-between"><SectionHead icon={Activity} title="Release activity" detail="Release records created over the last 7 days."/><span className="text-xs font-semibold">{series.reduce((n:number,x:any)=>n+x.count,0)}</span></div>
          <MiniLineChart data={series}/>
        </section>
        <section className="release-surface p-4">
          <SectionHead icon={ShieldCheck} title="Connected pipeline" detail="Authority stays separated across systems."/>
          <div className="mt-4 space-y-2"><StatusRow label="License Master" value={connected ? "Connected" : "Unavailable"} good={connected}/><StatusRow label="Release channels" value={channels.length ? channels.join(", ") : "None reported"}/><StatusRow label="Base worker" value="V1-vercel-base"/><StatusRow label="Engine worker" value="V1-vercel-engine"/></div>
        </section>
      </div>
    </div>

    <section className="release-surface p-4 sm:p-5">
      <SectionHead icon={Zap} title="Release pipeline" detail="The handoff remains the same; only the control surface is changing." />
      <div className="mt-5 grid gap-2 sm:grid-cols-4">
        <PipelineStep icon={FileCode2} title="Inspect" text="Compare source against the approved baseline." />
        <PipelineStep icon={ScrollText} title="Prepare" text="Build version, changelog and compatibility metadata." />
        <PipelineStep icon={Github} title="Run" text="Dispatch the existing GitHub release worker." />
        <PipelineStep icon={ShieldCheck} title="Handoff" text="License Master receives and validates the candidate." />
      </div>
    </section>
  </section>;
}

function Metric({ label, value, detail }: any) {
  return <div className="border-r bg-card p-4 last:border-r-0"><p className="text-[10px] font-semibold uppercase tracking-[.14em] text-muted-foreground">{label}</p><p className="mt-2 text-2xl font-semibold">{value}</p><p className="mt-1 text-[11px] text-muted-foreground">{detail}</p></div>;
}

function PipelineStep({ icon: Icon, title, text }: any) {
  return <div className="rounded-lg border bg-background/40 p-3"><Icon size={16} className="text-primary"/><p className="mt-3 text-xs font-semibold">{title}</p><p className="mt-1 text-[11px] leading-5 text-muted-foreground">{text}</p></div>;
}

function Composer(p: any) {
  const base = p.type === "base";
  const currentVersion = p.baseline?.version || null;
  const suggestedVersion = currentVersion && /^\d+\.\d+\.\d+/.test(String(currentVersion))
    ? String(currentVersion).replace(/^(\d+)\.(\d+)\.(\d+).*$/, (_: string, major: string, minor: string, patch: string) => `${major}.${minor}.${Number(patch) + 1}`)
    : "";
  const canStart = Boolean(p.version.trim()) && (base || p.components.length > 0);
  const inspected = Boolean(p.reviewOpen);
  const runState = p.run?.conclusion || p.run?.status || "";
  const runDone = ["success","failure","cancelled","skipped"].includes(runState);
  const runGood = runState === "success";
  const validation = p.handoff?.manifest?.validation?.status || "";
  const sourceRepo = p.baseline?.repo || (base ? "lucaskerim123/V1-vercel-base" : "lucaskerim123/V1-vercel-engine");
  const sourceRef = p.baseline?.ref || (base ? "main" : "main");
  const sourceSha = p.baseline?.head || "";
  const status = (ready:boolean, active=false) => ready ? "passed" : active ? "running" : "waiting";

  return <section className="space-y-4">
    <div className="orbit-page-hero">
      <div>
        <div className="flex flex-wrap items-center gap-2">
          <span className="orbit-eyebrow">{base ? "BASE DEPLOYMENT" : "ENGINE UPDATE"}</span>
          <span className="orbit-status-chip"><span className={`orbit-dot ${p.connected ? "orbit-dot-good" : "orbit-dot-bad"}`}/>{p.connected ? "License Master connected" : "License Master unavailable"}</span>
        </div>
        <h1>{base ? "Base Deployment" : "Updates"}</h1>
        <p>{base ? "Prepare, build and hand off a complete OrbitFS Base release from one control surface." : "Prepare a manifest-driven OrbitFS update, validate compatibility and hand it through technical approval."}</p>
      </div>
      <div className="orbit-hero-meta">
        <div><span>Repository</span><code>{sourceRepo.replace("lucaskerim123/","")}</code></div>
        <div><span>Ref</span><code>{sourceRef}</code></div>
        <div><span>Channel</span><code>{p.channel}</code></div>
      </div>
    </div>

    <div className="orbit-pipeline-strip">
      <PipelineNode n="01" label="Source" state={status(inspected, p.busy==="inspect")} />
      <PipelineNode n="02" label={base ? "Definition" : "Targets"} state={status(Boolean(p.version && (base || p.components.length)))} />
      <PipelineNode n="03" label={base ? "Review" : "Compatibility"} state={status(inspected)} />
      <PipelineNode n="04" label="Build" state={status(runGood, Boolean(p.run && !runDone))} />
      <PipelineNode n="05" label="Validation" state={status(validation==="passed" || validation==="approved", Boolean(p.handoff && !validation))} />
      <PipelineNode n="06" label={base ? "Handoff" : "Publish review"} state={status(Boolean(p.handoff), Boolean(p.handoff && !runDone))} />
    </div>

    <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_340px]">
      <div className="space-y-4">
        <section className="release-surface overflow-hidden">
          <div className="orbit-section-bar">
            <SectionHead icon={Github} title={base ? "Base source" : "Engine source"} detail="Inspect the configured release repository against the last approved source." />
            <button className="button-secondary" disabled={p.busy==="inspect"} onClick={p.onInspect}>{p.busy==="inspect"?<Loader2 className="animate-spin" size={14}/>:<RefreshCw size={14}/>} {inspected ? "Re-inspect" : "Inspect source"}</button>
          </div>
          <div className="grid gap-px bg-border/40 sm:grid-cols-2 lg:grid-cols-4">
            <TechStat label="Repository" value={sourceRepo.replace("lucaskerim123/","")} />
            <TechStat label="Ref" value={sourceRef} mono />
            <TechStat label="Current commit" value={sourceSha ? sourceSha.slice(0,8) : "Inspect to resolve"} mono />
            <TechStat label="Previous approved" value={currentVersion ? `v${currentVersion}` : "Not resolved"} mono />
          </div>
          <div className="grid gap-px border-t bg-border/40 sm:grid-cols-3">
            <TechStat label="Commits detected" value={inspected ? String(p.commits.length) : "—"} />
            <TechStat label="Changed files" value={inspected ? String(p.files.length) : "—"} />
            <TechStat label="Inspection" value={inspected ? "Complete" : "Waiting"} good={inspected} />
          </div>
        </section>

        <section className="release-surface overflow-hidden">
          <div className="orbit-section-bar"><SectionHead icon={Settings2} title={base ? "Release definition" : "Update definition"} detail={base ? "Define the Base candidate that will be sent to the release worker." : "Define the update and target only the components that belong in its manifest."}/></div>
          <div className="p-4 sm:p-5">
            {!base && <>
              <div className="mb-5">
                <div className="mb-3 flex items-end justify-between"><div><p className="text-xs font-semibold">Target components</p><p className="mt-1 text-[11px] text-muted-foreground">Only selected components are included in the update handoff.</p></div><span className="text-[10px] text-muted-foreground">{p.components.length} selected</span></div>
                <div className="grid gap-2 sm:grid-cols-4">{["base","apex","mcp","studio"].map((name:string)=>{
                  const selected=p.components.includes(name);
                  return <button type="button" key={name} onClick={()=>p.setComponents((x:string[])=>x.includes(name)?x.filter(y=>y!==name):[...x,name])} className={`orbit-component ${selected?"orbit-component-selected":""}`}>
                    <span className="orbit-component-icon"><Layers3 size={15}/></span><span><b>{name.toUpperCase()}</b><small>{selected?"Included in manifest":"Not selected"}</small></span>{selected&&<CheckCircle2 size={14} className="ml-auto text-primary"/>}
                  </button>})}</div>
              </div>
              <div className="mb-5 border-t border-border/70"/>
            </>}
            <div className="grid gap-4 sm:grid-cols-2">
              <div><Field label={base ? "Base version" : "Update version"}><input className="control" placeholder="1.2.3" value={p.version} onChange={e=>p.setVersion(e.target.value)}/></Field>{suggestedVersion&&<button type="button" className="mt-1.5 text-[11px] font-medium text-primary" onClick={()=>p.setVersion(suggestedVersion)}>Use suggested {suggestedVersion}</button>}</div>
              <Field label="Release channel"><select className="control" value={p.channel} onChange={e=>p.setChannel(e.target.value)}>{(p.availableChannels?.length?p.availableChannels:["stable"]).map((x:string)=><option key={x}>{x}</option>)}</select></Field>
              {!base&&<><Field label="Minimum Base version"><input className="control" value={p.minBase} onChange={e=>p.setMinBase(e.target.value)}/></Field><Field label="Minimum deployer protocol"><input className="control" value={p.protocol} onChange={e=>p.setProtocol(e.target.value)}/></Field></>}
            </div>
            <div className="mt-5"><Field label={base?"Operator notes":"Developer notes"}><textarea className="control min-h-20 resize-y" placeholder="Optional context for the generated release log." value={p.notes} onChange={e=>p.setNotes(e.target.value)}/></Field></div>
          </div>
        </section>

        {inspected && <section className="release-surface overflow-hidden">
          <div className="orbit-section-bar"><SectionHead icon={GitCommit} title="Detected changes" detail="Live compare data returned from the configured source repository."/></div>
          <div className="grid lg:grid-cols-2">
            <div className="min-w-0 border-b lg:border-b-0 lg:border-r">
              <div className="orbit-subhead">COMMITS <span>{p.commits.length}</span></div>
              <div className="max-h-[360px] overflow-auto">{p.commits.length?p.commits.map((commit:any,i:number)=><div key={commit.sha||commit.id||i} className="orbit-change-row"><code>{String(commit.sha||commit.id||"").slice(0,7)||"commit"}</code><span>{commit.subject||commit.message||"Commit"}</span></div>):<EmptyInline text="No commits returned for this source range."/>}</div>
            </div>
            <div className="min-w-0">
              <div className="orbit-subhead">CHANGED FILES <span>{p.files.length}</span></div>
              <div className="max-h-[360px] overflow-auto">{p.files.length?p.files.map((f:any)=><div key={f.filename} className="orbit-file-row"><StatusPill text={f.status||"changed"}/><code title={f.filename}>{f.filename}</code><span>+{f.additions||0} −{f.deletions||0}</span></div>):<EmptyInline text="No changed files returned."/>}</div>
            </div>
          </div>
        </section>}

        <section className="release-surface overflow-hidden">
          <div className="orbit-section-bar">
            <SectionHead icon={ScrollText} title={base?"Base Deployment Log":"Update Changelog"} detail="Generated from source inspection. Review and edit before dispatch."/>
            <span className="orbit-status-chip">{inspected?"EDITABLE":"WAITING FOR INSPECTION"}</span>
          </div>
          <div className="grid xl:grid-cols-[minmax(0,1fr)_260px]">
            <div className="p-4"><textarea className="control mt-0 min-h-[410px] resize-y font-mono text-[11px] leading-5" value={p.changelogDraft||""} onChange={e=>p.setChangelogDraft(e.target.value)} placeholder="Inspect source to generate this release document."/></div>
            <div className="border-t p-4 xl:border-l xl:border-t-0">
              <p className="text-[10px] font-semibold uppercase tracking-[.14em] text-muted-foreground">Review gate</p>
              <div className="mt-3 space-y-1"><GateRow label="Source inspection" ok={inspected}/><GateRow label="Release version" ok={Boolean(p.version)}/>{!base&&<GateRow label="Components selected" ok={p.components.length>0}/>}<GateRow label="Release document" ok={Boolean(p.changelogDraft?.trim())}/></div>
              <div className="mt-5 border-t pt-4"><button className="button-primary w-full" disabled={!canStart || !inspected || !p.changelogDraft?.trim() || p.busy==="start"} onClick={p.onStart}>{p.busy==="start"?<Loader2 className="animate-spin" size={15}/>:<Rocket size={15}/>} {p.busy==="start"?"Sending…":base?"Build & send Base release":"Build & send update"}</button><p className="mt-2 text-[10px] leading-4 text-muted-foreground">{base?"The Base worker builds the complete package and sends it to License Master.":"The Engine worker packages the selected update and sends it to License Master."}</p></div>
            </div>
          </div>
        </section>

        {p.run && <LiveConsole run={p.run} repo={p.runRepo} handoff={p.handoff} />}
      </div>

      <aside className="space-y-4">
        {!base && <section className="release-surface overflow-hidden">
          <div className="orbit-section-bar"><SectionHead icon={ShieldCheck} title="Compatibility" detail="Required update gates."/></div>
          <div className="p-4 space-y-1">
            <GateRow label="Published Base resolved" ok={Boolean(p.baseline?.baseBaseline?.version || p.minBase)} />
            <GateRow label="Minimum Base version" ok={Boolean(p.minBase)} />
            <GateRow label="Deployer protocol" ok={Boolean(p.protocol)} />
            <GateRow label="Components selected" ok={p.components.length>0} />
            <GateRow label="Source inspected" ok={inspected} />
          </div>
          <div className="border-t px-4 py-3 text-[10px] text-muted-foreground">Current compatibility floor: <code className="text-foreground">Base {p.minBase || "—"} · Protocol {p.protocol || "—"}</code></div>
        </section>}

        <section className="release-surface overflow-hidden">
          <div className="orbit-section-bar"><SectionHead icon={PackageCheck} title={base?"Release package":"Manifest preview"} detail={base?"Worker-generated package requirements.":"Current update handoff inputs; file targets are generated by the worker."}/></div>
          <div className="p-4 space-y-1">
            <TechRow label="Product" value="orbitfs_base"/>
            <TechRow label="Type" value={base?"base":"update"}/>
            <TechRow label="Version" value={p.version||"Not set"}/>
            <TechRow label="Channel" value={p.channel}/>
            <TechRow label="Source SHA" value={sourceSha?sourceSha.slice(0,8):"Waiting"}/>
            {!base&&<><TechRow label="Components" value={p.components.length?p.components.map((x:string)=>x.toUpperCase()).join(", "):"None"}/><TechRow label="Min Base" value={p.minBase||"Not set"}/><TechRow label="Protocol" value={p.protocol||"Not set"}/></>}
            <TechRow label="Changed files" value={inspected?String(p.files.length):"Waiting"}/>
            <TechRow label="Artifact" value={p.run?(runDone?(runGood?"Built":"Failed"):"Building"):"Waiting"}/>
            <TechRow label="Manifest" value={p.handoff?"Received by License Master":p.run?"Generated by worker":"Waiting"}/>
            <TechRow label="SHA-256" value={p.handoff?"Reported in handoff":p.run?"Calculated by worker":"Waiting"}/>
          </div>
        </section>

        <section className="release-surface overflow-hidden">
          <div className="orbit-section-bar"><SectionHead icon={ShieldCheck} title="Technical handoff" detail={base?"Base release authority flow.":"Update authority and publication flow."}/></div>
          <div className="p-4">
            <HandoffRow label="Dev Panel" detail="Prepare candidate" state={inspected?"passed":"waiting"}/>
            <HandoffRow label={base?"Base worker":"Engine worker"} detail="Build release artifact" state={p.run?(runDone?(runGood?"passed":"failed"):"running"):"waiting"}/>
            <HandoffRow label="License Master" detail={base?"Validate & approve":"Technical validation"} state={validation|| (p.handoff?"running":"waiting")}/>
            {!base&&<HandoffRow label="Billing Store" detail="Final publication review" state={validation==="passed"||validation==="approved"?"next":"waiting"}/>}
          </div>
          <div className="border-t px-4 py-3 text-[10px] leading-4 text-muted-foreground">{base?"License Master remains the technical release authority. This page does not deploy customer infrastructure.":"License Master remains technical authority. Billing Store owns customer-facing publication."}</div>
        </section>
      </aside>
    </div>
  </section>;
}

function PipelineNode({n,label,state}:any){
  const good=state==="passed", active=state==="running", bad=state==="failed";
  return <div className={`orbit-pipeline-node ${good?"is-good":active?"is-active":bad?"is-bad":""}`}><span>{n}</span><b>{label}</b><small>{state}</small></div>;
}
function TechStat({label,value,mono,good}:any){return <div className="orbit-tech-stat"><span>{label}</span><strong className={`${mono?"font-mono":""} ${good?"text-emerald-300":""}`}>{value}</strong></div>}
function TechRow({label,value}:any){return <div className="orbit-tech-row"><span>{label}</span><code>{value}</code></div>}
function GateRow({label,ok}:any){return <div className="orbit-gate-row"><span>{ok?<CheckCircle2 size={14}/>:<Clock3 size={14}/>}</span><p>{label}</p><small>{ok?"ready":"waiting"}</small></div>}
function HandoffRow({label,detail,state}:any){const good=["passed","success","approved","received"].includes(state), active=["running","pending"].includes(state), bad=["failed","failure"].includes(state);return <div className="orbit-handoff-row"><span className={`orbit-handoff-icon ${good?"good":active?"active":bad?"bad":""}`}>{good?<CheckCircle2 size={14}/>:bad?<XCircle size={14}/>:<Clock3 size={14}/>}</span><div><b>{label}</b><small>{detail}</small></div><code>{state}</code></div>}
function EmptyInline({text}:any){return <div className="p-5 text-center text-[11px] text-muted-foreground">{text}</div>}

function buildChangelog(type: ReleaseType, data: any) {
  const base = type === "base";
  const commits = (data.commits || []).map((c:any) => String(c.subject || c.message || "").trim()).filter(Boolean).slice(0, 20);
  const files = data.files || [];
  const fileLines = files.length ? files.map((f:any) => `• ${f.filename} (${f.status}, +${f.additions || 0} / -${f.deletions || 0})`).join("\n") : "No source changes were detected against the previous approved source commit.";
  const commitLines = commits.length ? commits.map((s:string) => `• ${s}`).join("\n") : "No commits were returned for this source range.";
  const changes = files.length
    ? `This ${base ? "deployment" : "update"} contains ${files.length} changed source file${files.length === 1 ? "" : "s"}.${base ? "" : ` The selected components are ${(data.components || []).map((x:string)=>x.toUpperCase()).join(", ") || "not specified"}.`}`
    : base
      ? "No source changes were detected against the previous approved source commit. This is still a complete Base deployment: the current Base source state will be packaged and go through the normal checks."
      : "No source changes were detected. An Engine update requires source changes, so this release cannot be dispatched until changes are available.";
  const checks = [
    "✓ Source checked",
    "✓ Change detection completed",
    base ? "✓ Deployment package will be created" : "✓ Update package will be created",
    "✓ Package integrity will be checked",
    "✓ License Master technical validation will run",
  ].join("\n");
  const summary = base
    ? "This is a complete OrbitFS Base deployment. The current Base system will be packaged and sent through the normal technical checks."
    : "This is an OrbitFS system update. It contains changes intended to be applied to an existing OrbitFS Base installation.";
  return `# OrbitFS ${base ? "Base Deployment" : "Update"} — v${data.version || "VERSION"}

## What is this?
${summary}

## What's changing?
${changes}

## Main changes
${commitLines}

## What was included?
${checks}

## Compatibility
${base ? "This is a complete Base deployment; normal Base deployment compatibility checks apply." : `Minimum Base version: ${data.minBase || "1.0.0"}\nMinimum updater/deployer protocol: ${data.protocol || "1"}`}

## What happens next?
The release will be sent to License Master for technical validation. If those checks pass, it moves to the next review stage.

## Changed files
${fileLines}

## Notes
${data.notes?.trim() || "No additional operator notes."}
`;
}

function ChangelogEditor({ type, template, value, onChange, commits, files, canStart, reviewOpen, busy, onStart }: any) {
  const label = type === "base" ? "Base Deployment Log" : "Update Changelog";
  const ready = Boolean(canStart && reviewOpen && value?.trim());
  return <section className="release-surface overflow-hidden">
    <div className="flex flex-col gap-2 border-b p-4 sm:flex-row sm:items-center sm:justify-between">
      <SectionHead icon={ScrollText} title={label} detail="Automatically filled from the inspected source. Review or edit it here before sending." />
      <span className="rounded-full bg-muted px-2 py-1 text-[10px]">{template === "base_deployment_log" ? "BASE TEMPLATE" : "UPDATE TEMPLATE"}</span>
    </div>
    <div className="grid gap-4 p-4 xl:grid-cols-[1fr_250px]">
      <textarea className="control min-h-[520px] resize-y font-mono text-xs leading-5" value={value || ""} onChange={e => onChange(e.target.value)} placeholder="Inspect source to generate the changelog." />
      <div className="rounded-lg border bg-background/50 p-3 text-xs">
        <p className="font-semibold">Review before sending</p>
        <div className="mt-3 space-y-2 text-muted-foreground">
          <p>Source commits: <span className="text-foreground">{commits.length}</span></p>
          <p>Changed files: <span className="text-foreground">{files.length}</span></p>
          <p>Code scan: <span className="text-foreground">{reviewOpen ? "Source inspection complete" : "Waiting for inspection"}</span></p>
          <p>Packaging: <span className="text-foreground">{reviewOpen ? "Queued after Send" : "Waiting"}</span></p>
          <p>Technical validation: <span className="text-foreground">{reviewOpen ? "Runs in License Master" : "Waiting"}</span></p>
        </div>
      </div>
    </div>
    <div className="border-t bg-muted/20 p-4">
      <div className="mb-3 text-[11px] text-muted-foreground">
        {ready ? "Changelog reviewed. The release is ready to be sent to the V1 worker." : "Inspect the source and review the generated changelog. The release cannot be sent until both are complete."}
      </div>
      <button className="button-primary w-full sm:w-auto" disabled={!ready || busy==="start"} onClick={onStart}>
        {busy==="start"?<Loader2 className="animate-spin" size={15}/>:<Rocket size={15}/>}
        {busy==="start" ? "Sending release…" : type === "base" ? "Send reviewed Base release" : "Send reviewed update"}
      </button>
    </div>
  </section>;
}

function ChangeList({ files }: any) {
  return <section className="release-surface overflow-hidden"><div className="flex items-center justify-between border-b p-4"><SectionHead icon={FileCode2} title="Detected source changes" detail={`${files.length} files returned by GitHub compare.`}/><span className="rounded-full bg-muted px-2 py-1 text-[10px]">INSPECTED</span></div><div className="max-h-[420px] overflow-auto">{files.map((f:any)=><div key={f.filename} className="grid grid-cols-[72px_minmax(0,1fr)_90px] gap-3 border-b px-4 py-2.5 text-xs last:border-b-0"><span className="font-semibold uppercase text-muted-foreground">{f.status}</span><code className="truncate">{f.filename}</code><span className="text-right text-muted-foreground">+{f.additions} −{f.deletions}</span></div>)}</div></section>;
}

function LiveConsole({ run, repo, handoff }: any) {
  const state = run.conclusion || run.status || "queued";
  const terminal = ["success","failure","cancelled","skipped"].includes(state);
  const jobs = run.jobs || [];
  const icon = state==="success"?CheckCircle2:state==="failure"?XCircle:terminal?AlertCircle:Activity;
  const Icon = icon;
  return <section className={`release-surface overflow-hidden ${terminal?"":"ring-1 ring-primary/20"}`}>
    <div className="flex flex-col gap-3 border-b p-4 sm:flex-row sm:items-center sm:justify-between"><div className="flex items-center gap-3"><span className={`flex h-9 w-9 items-center justify-center rounded-lg ${state==="success"?"bg-emerald-400/10 text-emerald-400":state==="failure"?"bg-destructive/10 text-destructive":"bg-primary/10 text-primary"}`}><Icon size={18}/></span><div><div className="flex items-center gap-2"><h2 className="text-sm font-semibold">Live release console</h2><span className="rounded-full bg-muted px-2 py-0.5 text-[10px] font-semibold uppercase">{state}</span></div><p className="mt-1 text-[11px] text-muted-foreground">{repo} · run #{run.id}</p></div></div><a className="button-secondary" href={run.html_url || `https://github.com/${repo}/actions/runs/${run.id}`} target="_blank" rel="noreferrer"><Github size={14}/> Open GitHub run <ArrowRight size={13}/></a></div>
    <div className="grid gap-4 p-4 xl:grid-cols-[1fr_320px]"><div className="space-y-2">{jobs.length?jobs.map((job:any)=><JobRow key={job.id} job={job}/>):<div className="rounded-lg border border-dashed p-5 text-center text-xs text-muted-foreground"><Loader2 size={16} className="mx-auto mb-2 animate-spin"/>Waiting for GitHub to report jobs…</div>}</div>
      <div className="rounded-lg border bg-background/40 p-4"><p className="text-[10px] font-semibold uppercase tracking-[.14em] text-muted-foreground">Pipeline handoff</p><ConsoleStage label="GitHub workflow" state={terminal?state:"running"} /><ConsoleStage label="License Master candidate" state={handoff?"received":"waiting"} /><ConsoleStage label="Technical validation" state={handoff?.manifest?.validation?.status||"pending"} /><ConsoleStage label="Billing Store final review" state="next" /><p className="mt-4 text-[10px] leading-5 text-muted-foreground">Stage 1 stops at the License Master handoff. Publication is deliberately owned by the next stages.</p></div>
    </div>
    {handoff&&<div className="border-t bg-muted/20 px-4 py-3 text-xs"><span className="font-semibold">License Master candidate #{handoff.id}</span><span className="ml-3 text-muted-foreground">review: {handoff.review_status||"pending"} · validation: {handoff.manifest?.validation?.status||"pending"}</span></div>}
  </section>;
}

function JobRow({ job }: any) {
  const s=job.conclusion||job.status||"queued";
  return <div className="rounded-lg border bg-background/40 px-3 py-2.5"><div className="flex items-center justify-between gap-3"><div className="flex min-w-0 items-center gap-2"><CircleDot size={13} className={s==="success"?"text-emerald-400":s==="failure"?"text-destructive":"text-primary"}/><span className="truncate text-xs font-medium">{job.name}</span></div><span className="text-[10px] font-semibold uppercase text-muted-foreground">{s}</span></div>{job.steps?.length?<div className="mt-2 grid gap-1 sm:grid-cols-2">{job.steps.map((x:any)=><div key={x.number||x.name} className="flex justify-between gap-3 text-[10px] text-muted-foreground"><span className="truncate">{x.name}</span><span className="shrink-0">{x.conclusion||x.status||"queued"}</span></div>)}</div>:null}</div>;
}

function ConsoleStage({ label, state }: any) {
  const done=["success","received","passed","approved"].includes(state);
  const fail=["failure","failed"].includes(state);
  return <div className="flex items-center gap-3 border-b py-2.5 last:border-b-0"><span className={`flex h-6 w-6 items-center justify-center rounded-full ${done?"bg-emerald-400/10 text-emerald-400":fail?"bg-destructive/10 text-destructive":"bg-muted text-muted-foreground"}`}>{done?<CheckCircle2 size={13}/>:fail?<XCircle size={13}/>:<Clock3 size={13}/>}</span><div className="min-w-0 flex-1"><p className="text-xs font-medium">{label}</p><p className="text-[10px] text-muted-foreground">{state}</p></div></div>;
}

function ActivityPage({ releases, run }: any) {
  return <section className="space-y-4"><PageHead title="Releases & runs" detail="One place for release history and the currently monitored GitHub workflow."/><div className="release-surface overflow-hidden"><ReleaseTable releases={releases}/></div>{run&&<div className="rounded-lg border border-primary/20 bg-primary/5 p-4 text-xs"><p className="font-semibold">Active console: run #{run.id}</p><p className="mt-1 text-muted-foreground">Use the live console above for job-level progress.</p></div>}</section>;
}

function ReleaseTable({ releases }: any) {
  return <div>{releases.map((r:any)=><div key={r.id} className="grid gap-3 border-b p-4 last:border-b-0 md:grid-cols-[1fr_120px_150px_160px] md:items-center"><div className="min-w-0"><p className="truncate text-sm font-medium">{r.product_name||"OrbitFS"} <span className="text-muted-foreground">v{r.version}</span></p><p className="mt-1 truncate text-[11px] text-muted-foreground">{r.release_type} · {r.channel} · {r.source_ref||"—"} · {(r.source_sha||"").slice(0,8)}</p></div><StatusPill text={r.status||"candidate"}/><StatusPill text={`review ${r.review_status||"pending"}`}/><StatusPill text={`validation ${r.manifest?.validation?.status||"not run"}`}/></div>)}{!releases.length&&<div className="p-10 text-center text-sm text-muted-foreground">No releases are currently visible.</div>}</div>;
}

function releaseSeries(releases:any[]) {
  const now = new Date();
  const days = Array.from({length:7},(_,i)=>{
    const d=new Date(now); d.setHours(0,0,0,0); d.setDate(d.getDate()-(6-i));
    return {key:d.toISOString().slice(0,10), label:d.toLocaleDateString(undefined,{weekday:"short"}), count:0};
  });
  for(const r of releases||[]) {
    const d=new Date(r.created_at||r.published_at||0);
    const key=Number.isFinite(d.getTime())?d.toISOString().slice(0,10):"";
    const row=days.find(x=>x.key===key); if(row) row.count++;
  }
  return days;
}

function MiniLineChart({data}:any) {
  const max=Math.max(1,...data.map((x:any)=>x.count));
  const pts=data.map((x:any,i:number)=>`${i*(100/(data.length-1||1))},${42-(x.count/max)*34}`).join(" ");
  return <div className="mt-4">
    <svg viewBox="0 0 100 48" className="h-28 w-full overflow-visible" preserveAspectRatio="none">
      <defs><linearGradient id="orbitArea" x1="0" x2="0" y1="0" y2="1"><stop offset="0%" stopColor="currentColor" stopOpacity=".32"/><stop offset="100%" stopColor="currentColor" stopOpacity="0"/></linearGradient></defs>
      <line x1="0" y1="42" x2="100" y2="42" className="text-border" stroke="currentColor" strokeWidth=".5"/>
      <polygon points={`0,42 ${pts} 100,42`} className="text-primary" fill="url(#orbitArea)"/>
      <polyline points={pts} fill="none" className="text-primary" stroke="currentColor" strokeWidth="1.4" vectorEffect="non-scaling-stroke"/>
      {data.map((x:any,i:number)=><circle key={x.key} cx={i*(100/(data.length-1||1))} cy={42-(x.count/max)*34} r="1.4" className="text-primary" fill="currentColor"/>)}
    </svg>
    <div className="grid grid-cols-7 text-center text-[9px] text-muted-foreground">{data.map((x:any)=><span key={x.key}>{x.label}</span>)}</div>
  </div>;
}

function ReleaseSummaryRow({release:r}:any) {
  const published=r.status==="published";
  return <div className="group grid gap-3 border-b border-border/70 p-4 last:border-b-0 sm:grid-cols-[1fr_auto] sm:items-center">
    <div className="min-w-0">
      <div className="flex items-center gap-2"><span className="orbit-release-icon"><PackageCheck size={14}/></span><p className="truncate text-sm font-semibold">OrbitFS <span className="text-muted-foreground">v{r.version}</span></p><StatusPill text={published?"published":r.status||"candidate"}/></div>
      <p className="mt-1.5 truncate pl-9 text-[11px] text-muted-foreground">{r.release_type} · {r.channel} · {r.source_ref||"—"} · {(r.source_sha||"").slice(0,8)}</p>
    </div>
    <div className="flex items-center gap-4 pl-9 text-[10px] text-muted-foreground sm:pl-0"><span>{r.review_status||"pending"} review</span><ChevronRight size={14}/></div>
  </div>;
}

function ReleasesPage({releases,onBase,onEngine}:any) {
  return <section className="space-y-4">
    <div className="flex flex-col justify-between gap-4 border-b pb-5 md:flex-row md:items-end"><PageHead title="All releases" detail="Every Base and Engine candidate currently visible from License Master."/><div className="flex gap-2"><button className="button-secondary" onClick={onBase}><Rocket size={14}/> New Base</button><button className="button-primary" onClick={onEngine}><Layers3 size={14}/> New Engine update</button></div></div>
    <section className="release-surface overflow-hidden">
      <div className="flex items-center justify-between border-b p-4"><SectionHead icon={PackageCheck} title="Release registry" detail={`${releases.length} release records`}/><span className="text-[10px] text-muted-foreground">License Master authoritative state</span></div>
      <ReleaseTable releases={releases}/>
    </section>
  </section>;
}

function MonitoringPage({releases,run,connected}:any) {
  const series=releaseSeries(releases);
  return <section className="space-y-4">
    <PageHead title="Release monitoring" detail="Live workflow state, handoff health, and recent release activity."/>
    <div className="grid gap-4 xl:grid-cols-[1.5fr_.8fr]">
      <section className="release-surface p-4"><SectionHead icon={Activity} title="7-day release activity" detail="Release records created per day."/><MiniLineChart data={series}/></section>
      <section className="release-surface p-4"><SectionHead icon={Gauge} title="Current state" detail="Live control-plane status."/><div className="mt-4 space-y-2"><StatusRow label="License Master" value={connected?"Connected":"Unavailable"} good={connected}/><StatusRow label="Workflow" value={run?(run.conclusion||run.status||"queued"):"Idle"} good={run?.conclusion==="success"}/><StatusRow label="Visible releases" value={String(releases.length)}/></div></section>
    </div>
    <ActivityPage releases={releases} run={run}/>
  </section>;
}

function RepositoriesPage({data,session,onBase,onEngine}:any) {
  const [rows,setRows]=useState<any[]>([]);
  const [loading,setLoading]=useState(true);
  const [error,setError]=useState("");
  const loadRepos=async()=>{setLoading(true);setError("");try{const r=await getRepositoryStatus({data:{token:session.token}});setRows(r.repositories||[])}catch(x:any){setError(x.message||"Unable to load repository status.")}finally{setLoading(false)}};
  useEffect(()=>{void loadRepos()},[session.token]);
  return <section className="space-y-4">
    <div className="flex flex-col justify-between gap-3 border-b pb-5 md:flex-row md:items-end"><PageHead title="Repositories" detail="Live source refs and the latest release-builder workflow for the two allowed release repositories."/><button className="button-secondary" onClick={loadRepos} disabled={loading}><RefreshCw size={14} className={loading?"animate-spin":""}/> Refresh</button></div>
    {error&&<Alert tone="error" onClose={()=>setError("")}>{error}</Alert>}
    <div className="grid gap-4 lg:grid-cols-2">{rows.map((row:any)=><section key={row.key} className="release-surface overflow-hidden"><div className="flex items-start justify-between border-b p-4"><SectionHead icon={row.key==="base"?Rocket:Layers3} title={row.key==="base"?"OrbitFS Base":"OrbitFS Engine"} detail={row.repo}/><StatusPill text={row.head?"connected":"unavailable"}/></div><div className="space-y-2 p-4"><StatusRow label="Release ref" value={row.ref}/><StatusRow label="Current SHA" value={row.head?String(row.head).slice(0,12):"Unavailable"}/><StatusRow label="Workflow" value={row.workflow}/><StatusRow label="Latest run" value={row.run?"#"+row.run.id+" · "+(row.run.conclusion||row.run.status):"No run found"}/></div><div className="flex flex-wrap gap-2 border-t p-4">{row.run?.html_url&&<a className="button-secondary" href={row.run.html_url} target="_blank" rel="noreferrer"><Github size={14}/> Open latest run</a>}<button className="button-primary" onClick={row.key==="base"?onBase:onEngine}><Rocket size={14}/> Prepare release</button></div></section>)}{!loading&&!rows.length&&<div className="release-surface p-8 text-center text-xs text-muted-foreground">No repository state returned.</div>}</div>
  </section>;
}


function RepositoryCard({title,repo,refName,workflow,icon:Icon,onCreate}:any) {
  return <section className="release-surface overflow-hidden"><div className="flex items-start justify-between border-b p-4"><SectionHead icon={Icon} title={title} detail={repo||"Repository unavailable"}/><span className="rounded-full border border-emerald-400/30 bg-emerald-400/10 px-2 py-1 text-[9px] text-emerald-300">CONNECTED</span></div><div className="space-y-2 p-4"><StatusRow label="Repository" value={repo||"—"}/><StatusRow label="Release ref" value={refName||"—"}/><StatusRow label="Workflow" value={workflow||"—"}/></div><div className="border-t p-4"><button className="button-primary" onClick={onCreate}><Rocket size={14}/> Prepare release</button></div></section>;
}

function ChannelsPage({channels,data,session}:any) {
  const [state,setState]=useState<any>({channels:[],requests:[],access:[]});
  const [loading,setLoading]=useState(true);
  const [error,setError]=useState("");
  const [notice,setNotice]=useState("");
  const [editing,setEditing]=useState<any>(null);
  const loadChannels=async()=>{setLoading(true);setError("");try{setState(await getChannelsState({data:{token:session.token}}))}catch(x:any){setError(x.message||"Unable to load channels.")}finally{setLoading(false)}};
  useEffect(()=>{void loadChannels()},[session.token]);
  const edit=(row:any)=>setEditing({channel:row.channel,label:row.label||row.channel,description:row.description||"",enabled:row.enabled!==false,customerVisible:row.customer_visible!==false,accessMode:row.access_mode||"assigned",accessRequestEnabled:Boolean(row.access_request_enabled),selfJoinEnabled:Boolean(row.self_join_enabled),sortOrder:Number(row.sort_order||0)});
  const save=async(e:any)=>{e.preventDefault();setError("");setNotice("");try{await saveReleaseChannel({data:{token:session.token,...editing}});setEditing(null);setNotice("Channel settings saved to License Master.");await loadChannels()}catch(x:any){setError(x.message||"Unable to save channel.")}};
  const review=async(req:any,action:"grant"|"reject")=>{setError("");setNotice("");try{await reviewChannelAccess({data:{token:session.token,action,licenseId:req.license_id,channel:req.channel}});setNotice(action==="grant"?"Channel access approved.":"Channel access rejected.");await loadChannels()}catch(x:any){setError(x.message||"Unable to review access request.")}};
  const rows=state.channels.length?state.channels:channels.map((x:string)=>({channel:x,label:x,enabled:true,customer_visible:true,access_mode:"assigned"}));
  return <section className="space-y-4">
    <div className="flex flex-col justify-between gap-3 border-b pb-5 md:flex-row md:items-end"><PageHead title="Channels" detail="License Master channel policy, self-service access, and pending customer access requests."/><button className="button-secondary" onClick={loadChannels} disabled={loading}><RefreshCw size={14} className={loading?"animate-spin":""}/> Refresh</button></div>
    {error&&<Alert tone="error" onClose={()=>setError("")}>{error}</Alert>}{notice&&<Alert tone="success" onClose={()=>setNotice("")}>{notice}</Alert>}
    {editing&&<form onSubmit={save} className="release-surface p-4"><SectionHead icon={Settings2} title={"Edit "+editing.channel} detail="These settings are authoritative in License Master and determine customer portal behaviour."/><div className="mt-4 grid gap-3 md:grid-cols-2"><Field label="Label"><input className="control" value={editing.label} onChange={e=>setEditing({...editing,label:e.target.value})}/></Field><Field label="Access mode"><select className="control" value={editing.accessMode} onChange={e=>setEditing({...editing,accessMode:e.target.value})}><option value="open">Open</option><option value="assigned">Assigned</option><option value="request">Request</option><option value="closed">Closed</option></select></Field><Field label="Description"><input className="control" value={editing.description} onChange={e=>setEditing({...editing,description:e.target.value})}/></Field><Field label="Sort order"><input className="control" type="number" value={editing.sortOrder} onChange={e=>setEditing({...editing,sortOrder:Number(e.target.value)})}/></Field></div><div className="mt-4 grid gap-2 sm:grid-cols-3"><label className="flex items-center gap-2 rounded-lg border p-3 text-xs"><input type="checkbox" checked={editing.enabled} onChange={e=>setEditing({...editing,enabled:e.target.checked})}/> Enabled</label><label className="flex items-center gap-2 rounded-lg border p-3 text-xs"><input type="checkbox" checked={editing.customerVisible} onChange={e=>setEditing({...editing,customerVisible:e.target.checked})}/> Customer visible</label><label className="flex items-center gap-2 rounded-lg border p-3 text-xs"><input type="checkbox" checked={editing.selfJoinEnabled} onChange={e=>setEditing({...editing,selfJoinEnabled:e.target.checked})}/> Self join</label><label className="flex items-center gap-2 rounded-lg border p-3 text-xs"><input type="checkbox" checked={editing.accessRequestEnabled} onChange={e=>setEditing({...editing,accessRequestEnabled:e.target.checked})}/> Access requests</label></div><div className="mt-4 flex justify-end gap-2"><button type="button" className="button-secondary" onClick={()=>setEditing(null)}>Cancel</button><button className="button-primary">Save channel</button></div></form>}
    <div className="grid gap-4 xl:grid-cols-[1.1fr_.9fr]">
      <section className="release-surface overflow-hidden"><div className="border-b p-4"><SectionHead icon={Server} title="Release channels" detail={loading?"Loading authoritative policy…":String(rows.length)+" channels"}/></div><div>{rows.map((row:any)=><div key={row.channel} className="grid gap-3 border-b p-4 last:border-b-0 md:grid-cols-[1fr_100px_120px_auto] md:items-center"><div><div className="flex items-center gap-2"><p className="text-sm font-semibold">{row.label||row.channel}</p><code className="text-[10px] text-muted-foreground">{row.channel}</code></div><p className="mt-1 text-[10px] text-muted-foreground">{row.description||"No description"}</p></div><StatusPill text={row.enabled?"enabled":"disabled"}/><StatusPill text={row.access_mode||"assigned"}/><button className="button-secondary" onClick={()=>edit(row)}>Configure</button></div>)}</div></section>
      <section className="release-surface overflow-hidden"><div className="border-b p-4"><SectionHead icon={ScrollText} title="Access requests" detail="Pending requests can be approved or rejected here; License Master remains authoritative."/></div><div>{state.requests.filter((x:any)=>x.status==="pending").map((req:any)=><div key={req.id||req.license_id+req.channel} className="border-b p-4 last:border-b-0"><div className="flex items-start justify-between gap-3"><div><p className="text-xs font-semibold">{req.channel}</p><p className="mt-1 text-[10px] text-muted-foreground">License {req.license_id}</p></div><StatusPill text={req.status}/></div><div className="mt-3 flex gap-2"><button className="button-primary" onClick={()=>review(req,"grant")}>Approve</button><button className="button-secondary" onClick={()=>review(req,"reject")}>Reject</button></div></div>)}{!loading&&!state.requests.some((x:any)=>x.status==="pending")&&<div className="p-8 text-center text-xs text-muted-foreground">No pending channel access requests.</div>}</div></section>
    </div>
    <section className="release-surface p-4"><SectionHead icon={Globe2} title="Customer Portal behaviour" detail="Open channels show Join channel. Request-enabled channels show Request access. Closed/assigned channels expose no self-service join action."/><div className="mt-4 grid gap-2 sm:grid-cols-3"><PipelineStep icon={CheckCircle2} title="Open" text="Customer can join directly."/><PipelineStep icon={ScrollText} title="Request" text="Customer submits an access request."/><PipelineStep icon={ShieldCheck} title="Assigned / closed" text="Access is granted by an administrator only."/></div></section>
  </section>;
}


function CustomerPortalPage({releases,channels,session}:any) {
  const [state,setState]=useState<any>({releases,published:releases.filter((r:any)=>r.status==="published"),channels:[],portalUrl:""});
  const [loading,setLoading]=useState(true);
  const [error,setError]=useState("");
  const loadPortal=async()=>{setLoading(true);setError("");try{setState(await getPortalMonitor({data:{token:session.token}}))}catch(x:any){setError(x.message||"Unable to load portal monitor.")}finally{setLoading(false)}};
  useEffect(()=>{void loadPortal()},[session.token]);
  const published=state.published||[];
  const all=state.releases||[];
  const rolledBack=all.filter((r:any)=>Boolean(r.manifest?.rollback_from)||String(r.status||"").toLowerCase().includes("rollback"));
  const unpublished=all.filter((r:any)=>r.status==="disabled"&&!r.archived_at);
  return <section className="space-y-4">
    <div className="flex flex-col justify-between gap-3 border-b pb-5 md:flex-row md:items-end"><PageHead title="Customer Portal Status" detail="Monitor authoritative release visibility and channel access without turning Dev Panel into the publication system."/><div className="flex gap-2"><button className="button-secondary" onClick={loadPortal} disabled={loading}><RefreshCw size={14} className={loading?"animate-spin":""}/> Refresh</button>{state.portalUrl&&<a className="button-primary" href={state.portalUrl+"/portal/orbitfs/releases"} target="_blank" rel="noreferrer"><Globe2 size={14}/> Open portal</a>}</div></div>
    {error&&<Alert tone="error" onClose={()=>setError("")}>{error}</Alert>}
    <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4"><Metric label="Published" value={published.length} detail="Customer-visible release state"/><Metric label="Unpublished" value={unpublished.length} detail="Withdrawn from customer visibility"/><Metric label="Rollback history" value={rolledBack.length} detail="Rollback-derived release state"/><Metric label="Channels" value={(state.channels||[]).filter((x:any)=>x.enabled).length} detail="Enabled release channels"/></div>
    <div className="grid gap-4 xl:grid-cols-[1.35fr_.65fr]">
      <section className="release-surface overflow-hidden"><div className="flex items-center justify-between border-b p-4"><SectionHead icon={Globe2} title="Customer-visible releases" detail="Only License Master releases currently marked published are treated as visible."/><span className="text-[10px] text-muted-foreground">Billing Store owns final Update publication</span></div><ReleaseTable releases={published}/></section>
      <section className="release-surface overflow-hidden"><div className="border-b p-4"><SectionHead icon={Server} title="Portal channel actions" detail="Expected customer action from each authoritative channel policy."/></div><div>{(state.channels||[]).filter((x:any)=>x.enabled&&x.customer_visible).map((ch:any)=><div key={ch.channel} className="border-b p-4 last:border-b-0"><div className="flex items-center justify-between gap-2"><p className="text-xs font-semibold">{ch.label||ch.channel}</p><StatusPill text={ch.access_mode||"assigned"}/></div><p className="mt-2 text-[10px] text-muted-foreground">{ch.access_mode==="open"||ch.self_join_enabled?"Portal action: Join channel":ch.access_request_enabled?"Portal action: Request access":"Portal action: assigned by administrator"}</p></div>)}{!loading&&!(state.channels||[]).some((x:any)=>x.enabled&&x.customer_visible)&&<div className="p-8 text-center text-xs text-muted-foreground">No customer-visible channels are enabled.</div>}</div></section>
    </div>
    <section className="release-surface p-4"><SectionHead icon={ShieldCheck} title="Publication boundary" detail="This page reads downstream state only."/><p className="mt-3 text-xs leading-6 text-muted-foreground">Dev Panel prepares and controls technical release state through License Master. It does not publish Update releases from this page. If Billing Store unpublishes an Update or License Master rolls a Base release back, the next refresh stops reporting that release as published.</p></section>
  </section>;
}


function AuditPage({releases,run,session}:any) {
  const [events,setEvents]=useState<any[]>([]);
  const [loading,setLoading]=useState(true);
  const [error,setError]=useState("");
  const loadAudit=async()=>{setLoading(true);setError("");try{const r=await getAuditState({data:{token:session.token,limit:150}});setEvents(r.events||[])}catch(x:any){setError(x.message||"Unable to load audit history.")}finally{setLoading(false)}};
  useEffect(()=>{void loadAudit()},[session.token]);
  return <section className="space-y-4">
    <div className="flex flex-col justify-between gap-3 border-b pb-5 md:flex-row md:items-end"><PageHead title="Audit & History" detail="License Master technical audit history plus Dev Panel workflow context."/><button className="button-secondary" onClick={loadAudit} disabled={loading}><RefreshCw size={14} className={loading?"animate-spin":""}/> Refresh</button></div>
    {error&&<Alert tone="error" onClose={()=>setError("")}>{error}</Alert>}
    <div className="grid gap-4 xl:grid-cols-[1.25fr_.75fr]">
      <section className="release-surface overflow-hidden"><div className="border-b p-4"><SectionHead icon={History} title="Authoritative audit events" detail={loading?"Loading…":String(events.length)+" recent License Master events"}/></div><div className="max-h-[680px] overflow-auto">{events.map((ev:any)=><div key={ev.id} className="grid gap-2 border-b p-4 last:border-b-0 md:grid-cols-[160px_1fr_130px] md:items-start"><div><p className="text-[10px] text-muted-foreground">{ev.created_at?new Date(ev.created_at).toLocaleString():"—"}</p><p className="mt-1 text-[10px] font-medium">{ev.actor||"system"}</p></div><div className="min-w-0"><p className="text-xs font-semibold">{ev.action}</p><p className="mt-1 truncate text-[10px] text-muted-foreground">{ev.resource_type||"resource"} · {ev.resource_id||"—"}</p>{ev.details&&<code className="mt-2 block max-h-20 overflow-auto whitespace-pre-wrap text-[9px] text-muted-foreground">{JSON.stringify(ev.details,null,2)}</code>}</div><StatusPill text={ev.resource_type||"event"}/></div>)}{!loading&&!events.length&&<div className="p-10 text-center text-xs text-muted-foreground">No audit events returned.</div>}</div></section>
      <div className="space-y-4"><section className="release-surface p-4"><SectionHead icon={Activity} title="Current workflow" detail="Latest monitored GitHub workflow context."/><div className="mt-4 space-y-2"><StatusRow label="Run" value={run?.id?"#"+run.id:"None"}/><StatusRow label="Status" value={run?(run.conclusion||run.status||"queued"):"Idle"}/><StatusRow label="Jobs" value={String(run?.jobs?.length||0)}/></div></section><section className="release-surface p-4"><SectionHead icon={PackageCheck} title="Release records" detail="Recent License Master release lifecycle state."/><div className="mt-3 space-y-2">{releases.slice(0,8).map((r:any)=><div key={r.id} className="flex items-center justify-between gap-3 border-b py-2 last:border-b-0"><div><p className="text-xs font-medium">v{r.version}</p><p className="text-[9px] text-muted-foreground">{r.release_type} · {r.channel}</p></div><StatusPill text={r.status||"draft"}/></div>)}</div></section></div>
    </div>
  </section>;
}


function AccessPage({session}:any) {
  const [state,setState]=useState<any>({users:[],groups:[],memberships:[],permissions:[],ownerOnly:false});
  const [loading,setLoading]=useState(true);
  const [message,setMessage]=useState("");
  const [accessError,setAccessError]=useState("");
  const [showUserForm,setShowUserForm]=useState(false);
  const [showGroupForm,setShowGroupForm]=useState(false);
  const [userForm,setUserForm]=useState({email:"",displayName:"",role:"admin",password:"",groupIds:[] as string[]});
  const [groupForm,setGroupForm]=useState({name:"",description:"",permissions:[] as string[]});
  const owner=String(session?.role||"").toLowerCase()==="owner";

  const loadAccess=async()=>{
    setLoading(true);setAccessError("");
    try{const r=await getAccessState({data:{token:session.token}});setState(r)}
    catch(x:any){setAccessError(x.message||"Unable to load users and access groups.")}
    finally{setLoading(false)}
  };
  useEffect(()=>{loadAccess()},[session?.token]);

  const createUser=async(e:any)=>{
    e.preventDefault();setAccessError("");setMessage("");
    try{await createPanelUser({data:{token:session.token,email:userForm.email,displayName:userForm.displayName,role:userForm.role as "owner"|"admin",password:userForm.password,groupIds:userForm.groupIds}});setUserForm({email:"",displayName:"",role:"admin",password:"",groupIds:[]});setShowUserForm(false);setMessage("User created.");await loadAccess()}
    catch(x:any){setAccessError(x.message||"Unable to create user.")}
  };
  const createGroup=async(e:any)=>{
    e.preventDefault();setAccessError("");setMessage("");
    try{await createAccessGroup({data:{token:session.token,name:groupForm.name,description:groupForm.description,permissions:groupForm.permissions}});setGroupForm({name:"",description:"",permissions:[]});setShowGroupForm(false);setMessage("Group created.");await loadAccess()}
    catch(x:any){setAccessError(x.message||"Unable to create group.")}
  };
  const toggleUser=async(user:any)=>{
    try{await updatePanelUser({data:{token:session.token,userId:user.id,status:user.status==="active"?"disabled":"active"}});await loadAccess()}
    catch(x:any){setAccessError(x.message||"Unable to update user.")}
  };
  const setRole=async(user:any,role:"owner"|"admin")=>{
    try{await updatePanelUser({data:{token:session.token,userId:user.id,role}});await loadAccess()}
    catch(x:any){setAccessError(x.message||"Unable to update role.")}
  };

  if(!owner) return <section className="space-y-4"><PageHead title="Users & Access" detail="Owner-only access management."/><section className="release-surface p-5"><SectionHead icon={KeyRound} title="Owner access required" detail="Admins can operate releases but cannot change users, groups or permissions."/></section></section>;

  return <section className="space-y-4">
    <div className="flex flex-col justify-between gap-3 border-b pb-5 md:flex-row md:items-end"><PageHead title="Users & Access" detail="Private Dev Panel access. Only Owner and Admin roles are supported."/><div className="flex gap-2"><button className="button-secondary" onClick={()=>setShowGroupForm(!showGroupForm)}><UserCog size={14}/> New group</button><button className="button-primary" onClick={()=>setShowUserForm(!showUserForm)}><UserPlus size={14}/> Add user</button></div></div>
    {accessError&&<Alert tone="error" onClose={()=>setAccessError("")}>{accessError}</Alert>}
    {message&&<Alert tone="success" onClose={()=>setMessage("")}>{message}</Alert>}
    {showUserForm&&<form onSubmit={createUser} className="release-surface p-4"><SectionHead icon={UserPlus} title="Add user" detail="Create a private Dev Panel account with a temporary password."/><div className="mt-4 grid gap-3 sm:grid-cols-2"><Field label="Display name"><input className="control" value={userForm.displayName} onChange={e=>setUserForm({...userForm,displayName:e.target.value})} required/></Field><Field label="Email"><input className="control" type="email" value={userForm.email} onChange={e=>setUserForm({...userForm,email:e.target.value})} required/></Field><Field label="Role"><select className="control" value={userForm.role} onChange={e=>setUserForm({...userForm,role:e.target.value})}><option value="admin">Admin</option><option value="owner">Owner</option></select></Field><Field label="Temporary password"><input className="control" type="password" minLength={10} value={userForm.password} onChange={e=>setUserForm({...userForm,password:e.target.value})} required/></Field></div><div className="mt-4 flex justify-end"><button className="button-primary">Create user</button></div></form>}
    {showGroupForm&&<form onSubmit={createGroup} className="release-surface p-4"><SectionHead icon={Users} title="New access group" detail="Groups bundle operational permissions. Owner still controls membership and roles."/><div className="mt-4 grid gap-3 sm:grid-cols-2"><Field label="Group name"><input className="control" value={groupForm.name} onChange={e=>setGroupForm({...groupForm,name:e.target.value})} required/></Field><Field label="Description"><input className="control" value={groupForm.description} onChange={e=>setGroupForm({...groupForm,description:e.target.value})}/></Field></div><div className="mt-4 grid gap-2 sm:grid-cols-3">{state.permissions.map((p:string)=><label key={p} className="flex items-center gap-2 rounded-lg border bg-background/40 p-2 text-[11px]"><input type="checkbox" checked={groupForm.permissions.includes(p)} onChange={()=>setGroupForm({...groupForm,permissions:groupForm.permissions.includes(p)?groupForm.permissions.filter(x=>x!==p):[...groupForm.permissions,p]})}/><code>{p}</code></label>)}</div><div className="mt-4 flex justify-end"><button className="button-primary">Create group</button></div></form>}
    <div className="grid gap-4 xl:grid-cols-[1.4fr_.8fr]">
      <section className="release-surface overflow-hidden"><div className="flex items-center justify-between border-b p-4"><SectionHead icon={Users} title="Users" detail={loading?"Loading…":`${state.users.length} private accounts`}/><span className="text-[10px] text-muted-foreground">Owner / Admin only</span></div>
        <div>{state.users.map((u:any)=><div key={u.id} className="grid gap-3 border-b p-4 last:border-b-0 md:grid-cols-[1fr_120px_120px_auto] md:items-center"><div><p className="text-sm font-medium">{u.display_name}</p><p className="mt-1 text-[10px] text-muted-foreground">{u.email} · last login {u.last_login_at?new Date(u.last_login_at).toLocaleString():"never"}</p></div><select className="control mt-0" value={u.role} onChange={e=>setRole(u,e.target.value as any)}><option value="admin">Admin</option><option value="owner">Owner</option></select><StatusPill text={u.status}/><button className="button-secondary" onClick={()=>toggleUser(u)}>{u.status==="active"?"Disable":"Enable"}</button></div>)}{!loading&&!state.users.length&&<div className="p-8 text-center text-xs text-muted-foreground">No users returned.</div>}</div>
      </section>
      <section className="release-surface overflow-hidden"><div className="border-b p-4"><SectionHead icon={UserCog} title="Groups" detail="Optional permission bundles for this private panel."/></div><div>{state.groups.map((g:any)=><div key={g.id} className="border-b p-4 last:border-b-0"><div className="flex items-center justify-between gap-2"><p className="text-sm font-semibold">{g.name}</p><StatusPill text={`${Array.isArray(g.permissions)?g.permissions.length:0} permissions`}/></div><p className="mt-1 text-[10px] text-muted-foreground">{g.description||"No description"}</p><div className="mt-3 flex flex-wrap gap-1">{(g.permissions||[]).map((p:string)=><code key={p} className="rounded bg-muted px-1.5 py-1 text-[9px]">{p}</code>)}</div></div>)}{!loading&&!state.groups.length&&<div className="p-8 text-center text-xs text-muted-foreground">No groups yet.</div>}</div></section>
    </div>
  </section>;
}


function SystemMonitoringPage({releases,connected,run}:any) {
  const failed=releases.filter((r:any)=>r.manifest?.validation?.status==="failed").length;
  const pending=releases.filter((r:any)=>r.review_status==="pending").length;
  return <section className="space-y-4"><PageHead title="Monitoring" detail="Control-plane health derived from the same release and workflow state already used by the Dev Panel."/>
    <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4"><Metric label="Master API" value={connected?"Online":"Offline"} detail="License Master connection"/><Metric label="Validation failures" value={failed} detail="Visible failed validations"/><Metric label="Pending review" value={pending} detail="Candidates awaiting review"/><Metric label="Workflow" value={run?(run.conclusion||run.status||"queued"):"Idle"} detail={run?.id?`Run #${run.id}`:"No active run"}/></div>
    <section className="release-surface p-4"><SectionHead icon={BarChart3} title="Release activity graph" detail="Live from release timestamps returned by License Master."/><MiniLineChart data={releaseSeries(releases)}/></section>
  </section>;
}

function SettingsPage({ data, connected }: any) {
  const base = data.base?.repositories?.base;
  const engine = data.engine?.repositories?.engine;
  const channels = Array.from(new Set([
    ...(data.base?.channels || []),
    ...(data.engine?.channels || []),
  ])).join(", ") || "—";

  return (
    <section className="space-y-4">
      <PageHead
        title="Configuration"
        detail="Read-only runtime configuration visible to Stage 1. Secrets stay server-side."
      />
      <div className="grid gap-4 md:grid-cols-2">
        <ConfigCard
          title="License Master"
          icon={ShieldCheck}
          rows={[
            ["API base", data.base?.masterUrl || "—"],
            ["Connection", connected ? "Connected" : "Unavailable"],
            ["Product", "orbitfs_base"],
          ]}
        />
        <ConfigCard
          title="Base worker"
          icon={Rocket}
          rows={[
            ["Repository", base?.repo || "—"],
            ["Ref", base?.ref || "—"],
            ["Workflow", base?.workflow || "—"],
          ]}
        />
        <ConfigCard
          title="Engine worker"
          icon={Layers3}
          rows={[
            ["Repository", engine?.repo || "—"],
            ["Ref", engine?.ref || "—"],
            ["Workflow", engine?.workflow || "—"],
          ]}
        />
        <ConfigCard
          title="Release channels"
          icon={Activity}
          rows={[
            ["Available", channels],
            ["Role", "Stage 1 preparation"],
            ["Publication", "Not handled here"],
          ]}
        />
      </div>
    </section>
  );
}

function ConfigCard({ title, icon: Icon, rows }: any) {
  return <section className="release-surface p-4"><div className="flex items-center gap-2"><Icon size={15} className="text-primary"/><h2 className="text-sm font-semibold">{title}</h2></div><div className="mt-4 space-y-2">{rows.map(([k,v]:any)=><div key={k} className="flex items-start justify-between gap-4 border-b pb-2 text-[11px] last:border-b-0"><span className="text-muted-foreground">{k}</span><code className="max-w-[70%] break-all text-right">{v}</code></div>)}</div></section>;
}

function PageHead({ title, detail }: any) { return <div className="border-b pb-5"><p className="text-xs font-semibold uppercase tracking-[.16em] text-primary">OrbitFS Release Control</p><h1 className="mt-1 text-3xl font-semibold tracking-tight">{title}</h1><p className="mt-2 text-sm text-muted-foreground">{detail}</p></div>; }
function SectionHead({ icon: Icon, title, detail }: any) { return <div className="flex items-start gap-2.5"><span className="mt-0.5 text-primary"><Icon size={15}/></span><div><h2 className="text-sm font-semibold">{title}</h2><p className="mt-0.5 text-[11px] text-muted-foreground">{detail}</p></div></div>; }
function StatusRow({ label, value, good }: any) { return <div className="flex items-center justify-between border-b py-2 text-xs last:border-b-0"><span className="text-muted-foreground">{label}</span><span className="flex items-center gap-1.5 font-medium">{good&&<i className="h-1.5 w-1.5 rounded-full bg-emerald-400"/>}{value}</span></div>; }
function StatusPill({ text }: any) { return <span className="inline-flex w-fit rounded-full bg-muted px-2 py-1 text-[10px] font-medium">{text}</span>; }
function Field({ label, children }: any) { return <label className="block text-xs font-medium">{label}{children}</label>; }
function Alert({ tone, children, onClose }: any) { return <div className={`flex items-start justify-between gap-3 rounded-lg border px-3 py-2.5 text-xs ${tone==="error"?"border-destructive/40 bg-destructive/10":"border-emerald-400/30 bg-emerald-400/10"}`}><span>{children}</span>{onClose&&<button className="opacity-60 hover:opacity-100" onClick={onClose}><XCircle size={14}/></button>}</div>; }

