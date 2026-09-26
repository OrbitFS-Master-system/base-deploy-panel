import { createFileRoute } from "@tanstack/react-router";
import { ReleaseWorkspace } from "@/components/release-workspace";
import { OperationsWorkspace } from "@/components/operations-workspace";
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
  controlRelease, getChannelsState,
  getAuditState, getRepositoryStatus, getPortalMonitor, getReleaseLifecycleEvents
} from "@/lib/panel.server";

export const Route = createFileRoute("/")({ component: Index });

type Tab = "overview" | "releases" | "base" | "engine" | "activity" | "operations" | "channels" | "portal" | "repositories" | "monitoring" | "audit" | "access" | "settings";
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
        setRun({ ...r.run, jobs: r.jobs || [], failure: r.failure || null });
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
        const type: ReleaseType = runRepo === "lucaskerim123/Dev-panel" ? "base" : "engine";
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
      candidates: all.filter((r: any) => !r.archived_at && r.review_status === "pending").length,
      validationFailed: all.filter((r: any) => !r.archived_at && r.manifest?.validation?.status === "failed").length,
      ready: all.filter((r: any) => !r.archived_at && r.review_status === "approved" && r.status !== "published").length,
      published: all.filter((r: any) => !r.archived_at && r.status === "published").length,
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
      const r = await inspectSource({ data: { token: session.token, type, channel } });
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
        initialRelease: r.initialRelease === true,
      }));
      setReviewOpen(true);
      setNotice(r.initialRelease
        ? `${r.repo}@${r.ref} resolved at ${r.head.slice(0, 8)} · initial Base snapshot · ${r.files.length} tracked files inspected.`
        : `${r.repo}@${r.ref} resolved at ${r.head.slice(0, 8)} · ${r.files.length} changed files detected against published baseline.`);
    } catch (x: any) {
      setError(x.message || "Unable to inspect source.");
    } finally { setBusy(""); }
  };

  const start = async (type: ReleaseType) => {
    setBusy("start"); setError(""); setNotice("");
    try {
      const r = await startRelease({
        data: { token: session.token, type, version, channel, notes, changelogDraft, files, components,
          minimumBaseVersion: minBase, protocol, changelogTemplate }
      });
      setReviewOpen(false);
      setRun(r.runId ? { id: r.runId, status: "queued", conclusion: null, name: `${type === "base" ? "Base" : "Engine"} release`, draftId: r.draftId, attemptNumber: r.attemptNumber, failure: null } : null);
      setRunRepo(r.repo); setRunVersion(version); setRunChannel(channel); setHandoff(null);
      setNotice(r.runId ? `Release sent · GitHub workflow run #${r.runId} started.` : "Release sent to GitHub. Waiting for the workflow run to appear.");
      try { await load(session, true); } catch {}
      setTab(type === "base" ? "base" : "engine");
      return true;
    } catch (x: any) {
      setError(x.message || "Unable to start release.");
      return false;
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
      <MobileNav tab={tab} setTab={setTab} activeRun={!!run && !run.conclusion} />
      <div className="mx-auto flex min-h-[calc(100vh-66px)] max-w-[1680px]">
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
              run={runRepo === "lucaskerim123/Dev-panel" ? run : null} runRepo={runRepo} handoff={handoff} drafts={data.base.drafts||[]} connected={masterConnected} onChanged={()=>load(session,true)} />}
            {tab === "engine" && <Composer type="engine" releases={data.engine.releases||[]} session={session} {...composerProps({ channel, setChannel, version, setVersion, notes, setNotes, files, commits, baseline,
              setFiles, setCommits, components, setComponents, minBase, setMinBase, protocol, setProtocol, busy, reviewOpen, availableChannels,
              changelogTemplate, setChangelogTemplate, changelogDraft, setChangelogDraft })}
              onInspect={() => inspect("engine")} onStart={() => start("engine")}
              run={runRepo === "lucaskerim123/V1-vercel-engine" ? run : null} runRepo={runRepo} handoff={handoff} drafts={data.engine.drafts||[]} connected={masterConnected} onChanged={()=>load(session,true)} />}
            {tab === "activity" && <MonitoringPage releases={allReleases} run={run} connected={masterConnected} session={session} />}
            {tab === "operations" && <OperationsWorkspace session={session} />}
            {tab === "repositories" && <RepositoriesPage data={data} session={session} onBase={() => { resetComposer(); setTab("base"); }} onEngine={() => { resetComposer(); setTab("engine"); }} />}
            {tab === "channels" && <ChannelsPage channels={availableChannels} data={data} session={session} />}
            {tab === "portal" && <CustomerPortalPage releases={allReleases} channels={availableChannels} session={session} />}
            {tab === "monitoring" && <MonitoringPage releases={allReleases} run={run} connected={masterConnected} session={session} />}
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
  return <div className="orbit-login-shell">
    <div className="orbit-login-brand"><div className="orbit-brandmark"><span></span></div><div><b>OrbitFS</b><small>Release Control</small></div></div>
    <form onSubmit={p.onSubmit} className="orbit-login-card">
      <p className="orbit-reference-kicker">PRIVATE OPERATIONS CONSOLE</p>
      <h1>Sign in to OrbitFS</h1>
      <p className="orbit-login-copy">Prepare Base deployments and manifest-driven updates, monitor release builders, and hand candidates to License Master.</p>
      <div className="mt-6 space-y-3">
        <Field label="Email"><input className="control" type="email" value={p.email} onChange={e=>p.setEmail(e.target.value)} required/></Field>
        <Field label="Password"><input className="control" type="password" value={p.password} onChange={e=>p.setPassword(e.target.value)} required/></Field>
      </div>
      {p.error&&<div className="mt-4"><Alert tone="error">{p.error}</Alert></div>}
      <button className="button-primary mt-5 w-full" disabled={p.busy==="login"}>{p.busy==="login"?"Signing in…":"Sign in"}</button>
      <div className="orbit-login-authority"><ShieldCheck size={14}/><span>License Manager remains the technical authority. Billing Store remains the customer publication gate for updates.</span></div>
    </form>
  </div>;
}

function Header({ connected, loading, onRefresh, onSignOut, user }: any) {
  return <header className="orbit-topbar sticky top-0 z-40 border-b">
    <div className="flex h-[72px] items-center gap-4 px-4 sm:px-6">
      <div className="flex min-w-0 items-center gap-3 md:hidden">
        <div className="orbit-brandmark"><span></span></div>
        <div className="min-w-0">
          <p className="truncate text-sm font-semibold tracking-tight">OrbitFS Control</p>
          <p className="truncate text-[10px] text-muted-foreground">Release operations</p>
        </div>
      </div>
      <div className="hidden min-w-0 flex-1 md:block">
        <div className="orbit-commandbar max-w-[720px]">
          <Search size={15}/><span>Search releases, repositories, runs…</span><kbd>/</kbd>
        </div>
      </div>
      <div className="ml-auto flex items-center gap-2">
        <div className={`orbit-master-badge ${connected?"is-online":"is-offline"}`}><span></span>{connected?"License Master online":"License Master offline"}</div>
        <button className="icon-button" title="Refresh" onClick={onRefresh}><RefreshCw className={loading ? "animate-spin" : ""} size={15}/></button>
        <div className="orbit-user-chip">
          <div className="orbit-avatar">{String(user.display_name || user.email || "O").slice(0,1).toUpperCase()}</div>
          <div className="hidden sm:block"><p>{user.display_name || user.email}</p><small>{user.role || "operator"}</small></div>
          <button onClick={onSignOut} title="Sign out"><ChevronDown size={14}/></button>
        </div>
      </div>
    </div>
  </header>;
}

const NAV_STANDALONE = [
  ["overview","Overview","Command center",Gauge],
] as const;

const NAV_GROUPS = [
  {label:"Operate",items:[
    ["base","Base Releases","Build, package & handoff",Rocket],
    ["engine","Update Releases","Detect, package & handoff",Layers3],
    ["operations","Operations","Deploy Billing Store & License Manager",Terminal],
  ]},
  {label:"Monitor",items:[
    ["releases","Release Registry","Lifecycle state",PackageCheck],
    ["activity","Release Runs","Workflow execution",Activity],
    ["monitoring","Monitoring","System health",BarChart3],
  ]},
  {label:"Control",items:[
    ["channels","Channels","Read only",Server],
    ["portal","Customer Portal","Publication state",Globe2],
    ["repositories","Repositories","Sources & workers",Boxes],
  ]},
  {label:"Govern",items:[
    ["audit","Audit History","Authority events",History],
    ["access","Users & Access","Panel permissions",Users],
    ["settings","Configuration","Runtime & panel settings",Settings2],
  ]},
] as const;

function MobileNav({ tab, setTab, activeRun }: any) {
  const items = [
    ...NAV_STANDALONE,
    ...NAV_GROUPS.flatMap(group=>group.items),
  ];
  return <div className="orbit-mobile-nav md:hidden">
    <div className="orbit-mobile-nav-track">
      {items.map(([id,label,,Icon])=><button key={id} onClick={()=>setTab(id as Tab)} className={`orbit-mobile-nav-item ${tab===id?"is-active":""}`}>
        <Icon size={15}/><span>{label}</span>{id==="activity"&&activeRun&&<i/>}
      </button>)}
    </div>
  </div>;
}

function Sidebar({ tab, setTab, activeRun }: any) {
  return <aside className="orbit-sidebar hidden shrink-0 md:block">
    <div className="sticky top-[72px] flex h-[calc(100vh-72px)] flex-col overflow-y-auto p-3">
      <div className="orbit-sidebar-brand"><div className="orbit-brandmark"><span></span></div><div><b>OrbitFS</b><small>Release Control</small></div></div>
      <nav className="space-y-5">
        <div>
          <div className="space-y-1">
            {NAV_STANDALONE.map(([id,label,detail,Icon])=><button key={id} onClick={()=>setTab(id as Tab)}
              className={`orbit-nav-item ${tab===id?"orbit-nav-active":""}`}>
              <span className="orbit-nav-icon"><Icon size={16}/></span>
              <span className="min-w-0 flex-1"><b>{label}</b><small>{detail}</small></span>
            </button>)}
          </div>
        </div>
        {NAV_GROUPS.map(group=><div key={group.label}>
          <p className="orbit-nav-group">{group.label}</p>
          <div className="mt-2 space-y-1">
            {group.items.map(([id,label,detail,Icon])=><button key={id} onClick={()=>setTab(id as Tab)}
              className={`orbit-nav-item ${tab===id?"orbit-nav-active":""}`}>
              <span className="orbit-nav-icon"><Icon size={16}/></span>
              <span className="min-w-0 flex-1"><b>{label}</b><small>{detail}</small></span>
              {id==="activity"&&activeRun&&<span className="orbit-run-dot"/>}
            </button>)}
          </div>
        </div>)}
      </nav>
    </div>
  </aside>;
}

function StepLine({ n, text, active }: any) {
  return <div className={`flex items-center gap-2 ${active ? "text-foreground" : ""}`}><span className="flex h-5 w-5 items-center justify-center rounded-full border text-[9px] font-bold">{n}</span>{text}</div>;
}

function Dashboard({ stats, releases, connected, run, channels, onBase, onEngine, onActivity, onReleases }: any) {
  const recent=releases.slice(0,7);
  const series=releaseSeries(releases);
  const healthy=releases.filter((r:any)=>r.manifest?.validation?.status!=="failed").length;
  const health=releases.length?Math.round((healthy/releases.length)*100):100;
  const latest=releases[0];
  const pending=releases.filter((r:any)=>r.review_status==="pending").length;
  return <section className="orbit-screen space-y-4">
    <div className="orbit-reference-head">
      <div><p className="orbit-reference-kicker">RELEASE OPERATIONS</p><h1>Overview</h1><span>Build, review, and hand off OrbitFS releases from one operational control surface.</span></div>
      <div className="orbit-reference-actions">
        <button className="button-secondary" onClick={onReleases}><PackageCheck size={14}/> Release history</button>
        <button className="button-secondary" onClick={onBase}><Rocket size={14}/> Base deployment</button>
        <button className="button-primary" onClick={onEngine}><Layers3 size={14}/> Update release</button>
      </div>
    </div>
    <div className="orbit-metric-grid">
      <Metric label="Latest release" value={latest?"v"+latest.version:"—"} detail={latest?(latest.release_type+" · "+latest.channel):"No release records"} />
      <Metric label="Pending review" value={pending} detail="Technical candidates" />
      <Metric label="Published" value={stats.published||0} detail="Customer-visible releases" />
      <Metric label="Validation failed" value={stats.validationFailed||0} detail={stats.validationFailed?"Needs attention":"No failed validations"} />
    </div>
    <div className="orbit-dashboard-reference-grid">
      <section className="orbit-panel orbit-release-list-panel">
        <div className="orbit-panel-toolbar"><SectionHead icon={PackageCheck} title="Recent releases" detail="Latest candidates and published releases from License Master."/><button onClick={onReleases}>View all <ArrowRight size={13}/></button></div>
        <div className="orbit-release-table-head"><span>Release</span><span>Type</span><span>Channel</span><span>Review</span><span>Status</span></div>
        <div className="orbit-release-rows">
          {recent.map((r:any)=><button className="orbit-release-row" key={r.id} onClick={onReleases}>
            <span className="orbit-release-title"><b>OrbitFS v{r.version}</b><small>{(r.source_sha||"").slice(0,8)||"no commit"}</small></span>
            <span>{r.release_type||"—"}</span><span>{r.channel||"stable"}</span><StatusPill text={r.review_status||"pending"}/><StatusPill text={r.archived_at?"archived":r.status||"draft"}/>
          </button>)}
          {!recent.length&&<div className="orbit-empty">No release records are currently visible.</div>}
        </div>
      </section>
      <aside className="space-y-4">
        <section className="orbit-panel p-4"><SectionHead icon={ShieldCheck} title="System status" detail="Live authority and worker state"/><div className="mt-4 space-y-1"><StatusRow label="License Master" value={connected?"Connected":"Unavailable"} good={connected}/><StatusRow label="Release health" value={health+"%"} good={health===100}/><StatusRow label="Workflow" value={run?(run.conclusion||run.status||"queued"):"Idle"} good={!run||run.conclusion==="success"}/>{run?.id&&<StatusRow label="Run" value={"#"+run.id}/>}</div><button className="button-secondary mt-3 w-full" onClick={onActivity}>Open monitoring <ArrowRight size={13}/></button></section>
        <section className="orbit-panel p-4"><SectionHead icon={Server} title="Release channels" detail="Enabled authoritative channels"/><div className="orbit-chip-list mt-4">{channels.length?channels.map((x:string)=><span key={x}>{x}</span>):<span>None reported</span>}</div></section>
      </aside>
    </div>
    <div className="orbit-dashboard-bottom-grid">
      <section className="orbit-panel p-4"><div className="flex items-center justify-between"><SectionHead icon={Activity} title="Release activity" detail="Release records created during the last seven days."/><strong className="text-xs">{series.reduce((n:number,x:any)=>n+x.count,0)}</strong></div><MiniLineChart data={series}/></section>
    </div>
  </section>;
}

function Metric({ label, value, detail }: any) {
  return <div className="orbit-metric"><div className="orbit-metric-label">{label}</div><div className="orbit-metric-value">{value}</div><div className="orbit-metric-detail">{detail}</div></div>;
}

function PipelineStep({ icon: Icon, title, text }: any) {
  return <div className="rounded-lg border bg-background/40 p-3"><Icon size={16} className="text-primary"/><p className="mt-3 text-xs font-semibold">{title}</p><p className="mt-1 text-[11px] leading-5 text-muted-foreground">{text}</p></div>;
}

function Composer(p:any){ return <ReleaseWorkspace {...p}/>; }

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
  const initialRelease = data.initialRelease === true;
  const fileLines = files.length ? files.map((f:any) => initialRelease ? `• ${f.filename} (snapshot)` : `• ${f.filename} (${f.status}, +${f.additions || 0} / -${f.deletions || 0})`).join("\n") : "No source changes were detected against the previous published Base release.";
  const commitLines = commits.length ? commits.map((s:string) => `• ${s}`).join("\n") : "No commits were returned for this source range.";
  const changes = initialRelease
    ? `No previously published Base release exists in this channel. This initial Base deployment will package the complete current source snapshot (${files.length} tracked files).`
    : files.length
    ? `This ${base ? "deployment" : "update"} contains ${files.length} changed source file${files.length === 1 ? "" : "s"}.${base ? "" : ` The selected components are ${(data.components || []).map((x:string)=>x.toUpperCase()).join(", ") || "not specified"}.`}`
    : base
      ? "No source changes were detected against the previous published Base release. This is still a complete Base deployment: the current Base source state will be packaged and go through the normal checks."
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

function ReleasesPage({releases,session,onChanged,onBase,onEngine}:any) {
  const [type,setType]=useState("all"),[state,setState]=useState("all"),[channel,setChannelFilter]=useState("all"),[query,setQuery]=useState("");
  const [busy,setBusy]=useState(""),[message,setMessage]=useState(""),[error,setError]=useState("");
  const [lifecycleEvents,setLifecycleEvents]=useState<any[]>([]);
  useEffect(()=>{let live=true;(async()=>{try{const r=await getReleaseLifecycleEvents({data:{token:session.token,limit:250}});if(live)setLifecycleEvents(r.events||[])}catch{}})();return()=>{live=false}},[session.token,releases.length]);
  const channels=Array.from(new Set(releases.map((r:any)=>String(r.channel||"stable"))));
  const lifecycleFor=(r:any)=>lifecycleEvents.find((e:any)=>!e.installation_id&&(String(e.release_id||"")===String(r.id)||(!e.release_id&&String(e.release_version)===String(r.version)&&String(e.release_type)===String(r.release_type)&&String(e.channel||"stable")===String(r.channel||"stable"))));
  const filtered=releases.filter((r:any)=>{if(type!=="all"&&String(r.release_type)!==type)return false;if(state!=="all"){const life=String(r.manifest?.lifecycle?.state||lifecycleFor(r)?.event_type||"");const s=life==="rolled_back"?"rolled_back":life==="reverted"?"reverted":(lifecycleFor(r)?.archived||r.archived_at)?"archived":String(r.status||"draft");if(s!==state)return false;}if(channel!=="all"&&String(r.channel)!==channel)return false;const q=query.trim().toLowerCase();if(q&&!String(r.version||"").toLowerCase().includes(q)&&!String(r.source_sha||"").toLowerCase().includes(q)&&!String(r.product_name||"orbitfs").toLowerCase().includes(q))return false;return true;});
  const act=async(row:any,action:"approve"|"reject"|"rollback"|"revert"|"withdraw"|"archive"|"restore")=>{setBusy(row.id+":"+action);setError("");setMessage("");try{let reason:string|undefined;if(action==="rollback"||action==="revert"||action==="archive"){reason=prompt(action==="rollback"?"Reason this version was rolled back:":action==="revert"?"Reason this version was reverted:":"Reason for archiving this release:","")||undefined;if(!reason?.trim()){setBusy("");return}}await controlRelease({data:{token:session.token,releaseId:row.id,action,reason}});setMessage(action==="rollback"?"Version marked rolled back and archived.":action==="revert"?"Version marked reverted and archived.":"Release action completed: "+action+".");await onChanged?.()}catch(x:any){setError(x.message||"Release action failed.")}finally{setBusy("")}};
  const published=releases.filter((r:any)=>r.status==="published"&&!r.archived_at).length,pending=releases.filter((r:any)=>r.review_status==="pending"&&!r.archived_at).length,failed=releases.filter((r:any)=>r.manifest?.validation?.status==="failed"&&!r.archived_at).length;
  return <section className="orbit-screen space-y-4">
    <div className="orbit-reference-head"><div><p className="orbit-reference-kicker">RELEASE REGISTRY</p><h1>Releases</h1><span>Review Base and Update release state, validation, technical approval, and lifecycle actions.</span></div><div className="orbit-reference-actions"><button className="button-secondary" onClick={onBase}><Rocket size={14}/> New Base</button><button className="button-primary" onClick={onEngine}><Layers3 size={14}/> New Update</button></div></div>
    {error&&<Alert tone="error" onClose={()=>setError("")}>{error}</Alert>}{message&&<Alert tone="success" onClose={()=>setMessage("")}>{message}</Alert>}
    <section className="orbit-filterbar"><div className="orbit-filter-search"><Search size={14}/><input value={query} onChange={e=>setQuery(e.target.value)} placeholder="Search version, product, or commit…"/></div><select value={type} onChange={e=>setType(e.target.value)}><option value="all">All types</option><option value="base">Base</option><option value="update">Update</option></select><select value={state} onChange={e=>setState(e.target.value)}><option value="all">All states</option><option value="draft">Draft</option><option value="published">Published</option><option value="disabled">Unpublished</option><option value="archived">Archived</option><option value="rolled_back">Rolled back</option><option value="reverted">Reverted</option></select><select value={channel} onChange={e=>setChannelFilter(e.target.value)}><option value="all">All channels</option>{channels.map((x:any)=><option key={x} value={x}>{x}</option>)}</select></section>
    <div className="orbit-registry-grid">
      <section className="orbit-panel overflow-hidden">
        <div className="orbit-panel-toolbar"><SectionHead icon={PackageCheck} title="Release history" detail={String(filtered.length)+" of "+String(releases.length)+" releases"}/><span className="orbit-small-note">Technical state + Dev Panel rollback history</span></div>
        <div className="orbit-registry-head"><span>Release</span><span>Type</span><span>Channel</span><span>Validation</span><span>Review</span><span>Status</span></div>
        <div>{filtered.map((r:any)=>{const lifecycle=lifecycleFor(r);return <div key={r.id} className="orbit-registry-row"><div className="orbit-release-title"><b>{r.product_name||"OrbitFS"} v{r.version}</b><small>{r.source_ref||"—"} · {(r.source_sha||"").slice(0,8)||"no SHA"}{r.manifest?.lifecycle?.state?` · ${String(r.manifest.lifecycle.state).replaceAll("_"," ")}: ${r.manifest.lifecycle.reason||"No reason recorded"}`:lifecycle?` · ${String(lifecycle.event_type).replaceAll("_"," ")}: ${lifecycle.reason}`:""}</small></div><span>{r.release_type||"—"}</span><span>{r.channel||"stable"}</span><StatusPill text={r.manifest?.validation?.status||"not run"}/><StatusPill text={r.review_status||"pending"}/><StatusPill text={r.manifest?.lifecycle?.state?String(r.manifest.lifecycle.state).replaceAll("_"," "):lifecycle?String(lifecycle.event_type).replaceAll("_"," "):r.archived_at?"archived":r.status||"draft"}/><div className="orbit-registry-actions">{r.review_status==="pending"&&r.manifest?.validation?.status==="passed"&&<button className="button-primary" disabled={!!busy} onClick={()=>act(r,"approve")}>Approve</button>}{r.review_status==="pending"&&<button className="button-secondary" disabled={!!busy} onClick={()=>act(r,"reject")}>Reject</button>}{r.status==="published"&&<button className="button-secondary" disabled={!!busy} onClick={()=>act(r,"rollback")}>Mark rolled back</button>}{r.status==="published"&&<button className="button-secondary" disabled={!!busy} onClick={()=>act(r,"revert")}>Mark reverted</button>}{r.status==="published"&&<button className="button-secondary" disabled={!!busy} onClick={()=>act(r,"withdraw")}>Unpublish</button>}{!r.archived_at&&r.status!=="published"&&<button className="button-secondary" disabled={!!busy} onClick={()=>act(r,"archive")}>Archive</button>}{r.archived_at&&!r.manifest?.lifecycle?.state&&<button className="button-secondary" disabled={!!busy} onClick={()=>act(r,"restore")}>Restore</button>}</div></div>})}{!filtered.length&&<div className="orbit-empty">No releases match these filters.</div>}</div>
      </section>
      <aside className="space-y-4"><section className="orbit-panel p-4"><SectionHead icon={BarChart3} title="Registry summary" detail="Current visible release state"/><div className="mt-4"><StatusRow label="Published" value={String(published)} good/><StatusRow label="Pending review" value={String(pending)}/><StatusRow label="Validation failed" value={String(failed)} good={failed===0}/><StatusRow label="Channels" value={String(channels.length)}/></div></section><section className="orbit-panel overflow-hidden"><div className="border-b p-4"><SectionHead icon={History} title="Rollback / revert history" detail="Operational results reported back to Dev Panel."/></div><div className="max-h-[360px] overflow-auto">{lifecycleEvents.slice(0,10).map((ev:any)=><div key={ev.id||ev.event_id} className="border-b p-3 last:border-b-0"><div className="flex items-center justify-between gap-2"><p className="text-xs font-semibold">v{ev.release_version}</p><StatusPill text={String(ev.event_type||"event").replaceAll("_"," ")}/></div><p className="mt-1 text-[10px] text-muted-foreground">{ev.release_type} · {ev.channel||"stable"}{ev.target_version?" → v"+ev.target_version:""}</p><p className="mt-2 text-[10px] leading-5">{ev.reason}</p><p className="mt-1 text-[9px] text-muted-foreground">{ev.occurred_at?new Date(ev.occurred_at).toLocaleString():""}{ev.installation_id?" · installation "+String(ev.installation_id).slice(0,10)+"…":""}</p></div>)}{!lifecycleEvents.length&&<div className="p-6 text-center text-[10px] text-muted-foreground">No rollback or revert events recorded.</div>}</div></section></aside>
    </div>
  </section>;
}

function MonitoringPage({releases,run,connected,session}:any) {
  const series=releaseSeries(releases);
  const [repos,setRepos]=useState<any[]>([]);
  const [loading,setLoading]=useState(true);
  useEffect(()=>{let live=true;(async()=>{try{const r=await getRepositoryStatus({data:{token:session.token}});if(live)setRepos(r.repositories||[])}catch{}finally{if(live)setLoading(false)}})();return()=>{live=false}},[session.token,run?.id,run?.status,run?.conclusion]);
  const failed=releases.filter((r:any)=>r.manifest?.validation?.status==="failed").length;
  const pending=releases.filter((r:any)=>r.review_status==="pending").length;
  return <section className="space-y-4">
    <PageHead title="Release Monitoring" detail="Live workflow state, repository workers, License Master validation, and recent release activity."/>
    <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4"><Metric label="Master API" value={connected?"Online":"Offline"} detail="License Master connection"/><Metric label="Validation failures" value={failed} detail="Visible failed validations"/><Metric label="Pending review" value={pending} detail="Candidates awaiting technical review"/><Metric label="Active workflow" value={run&&!run.conclusion?"1":"0"} detail={run?.id?"Run #"+run.id:"No active monitored run"}/></div>
    <div className="grid gap-4 xl:grid-cols-[1.2fr_.8fr]">
      <section className="release-surface p-4"><SectionHead icon={Activity} title="7-day release activity" detail="Release records created per day."/><MiniLineChart data={series}/></section>
      <section className="release-surface overflow-hidden"><div className="border-b p-4"><SectionHead icon={Github} title="Release workers" detail={loading?"Loading latest runs…":"Latest GitHub release-builder status"}/></div><div>{repos.map((row:any)=><div key={row.key} className="border-b p-4 last:border-b-0"><div className="flex items-center justify-between gap-3"><div><p className="text-xs font-semibold">{row.key==="base"?"Base worker":"Engine worker"}</p><p className="mt-1 text-[10px] text-muted-foreground">{row.repo} · {row.ref}</p></div><StatusPill text={row.run?(row.run.conclusion||row.run.status||"queued"):"idle"}/></div>{row.run?.html_url&&<a className="mt-3 inline-flex text-[10px] font-medium text-primary" href={row.run.html_url} target="_blank" rel="noreferrer">Open run #{row.run.id} →</a>}</div>)}</div></section>
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

function ChannelsPage({channels,session}:any) {
  const [state,setState]=useState<any>({channels:[],warnings:[]});
  const [loading,setLoading]=useState(true);
  const [error,setError]=useState("");
  const loadChannels=async()=>{setLoading(true);setError("");try{setState(await getChannelsState({data:{token:session.token}}))}catch(x:any){setError(x.message||"Unable to load channels.")}finally{setLoading(false)}};
  useEffect(()=>{void loadChannels()},[session.token]);
  const rows=state.channels.length?state.channels:channels.map((x:string)=>({channel:x,label:x,enabled:true,customer_visible:true,access_mode:"closed"}));
  return <section className="space-y-4">
    <div className="flex flex-col justify-between gap-3 border-b pb-5 md:flex-row md:items-end"><PageHead title="Release Channels" detail="Read-only License Manager channel reference for Stage 1 release preparation."/><button className="button-secondary" onClick={loadChannels} disabled={loading}><RefreshCw size={14} className={loading?"animate-spin":""}/> Refresh</button></div>
    {error&&<Alert tone="error" onClose={()=>setError("")}>{error}</Alert>}
    <section className="release-surface overflow-hidden">
      <div className="border-b p-4"><SectionHead icon={Activity} title="Authoritative channels" detail="Definitions and access policy are owned by License Manager. Dev Panel only consumes enabled channels when preparing releases."/></div>
      <div>{rows.map((row:any)=><div key={row.channel} className="grid gap-3 border-b p-4 last:border-b-0 md:grid-cols-[1fr_auto] md:items-center"><div><div className="flex items-center gap-2"><p className="text-sm font-semibold">{row.label||row.channel}</p><StatusPill text={row.enabled===false?"disabled":"enabled"}/><StatusPill text={row.access_mode==="open"?"open":"controlled"}/></div><p className="mt-1 text-[10px] text-muted-foreground">{row.channel} · {row.customer_visible===false?"internal":"customer visible"}</p><p className="mt-2 text-xs leading-5 text-muted-foreground">{row.description||"No description."}</p></div><div className="text-right text-[10px] text-muted-foreground"><p>{row.access_request_enabled?"Requests enabled":"Requests disabled"}</p><p>{row.self_join_enabled||row.access_mode==="open"?"Self-join enabled":"Self-join disabled"}</p></div></div>)}{!loading&&!rows.length&&<div className="p-8 text-center text-xs text-muted-foreground">No channels reported by License Manager.</div>}</div>
    </section>
    <section className="release-surface p-4"><SectionHead icon={ShieldCheck} title="Authority boundary" detail="Use License Manager for channel definitions and technical entitlement policy. Use Billing Store for customer join, request, approval, grant and revoke workflows."/></section>
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
  const [editingGroup,setEditingGroup]=useState<any>(null);
  const [userForm,setUserForm]=useState({email:"",displayName:"",role:"admin",password:"",groupIds:[] as string[]});
  const [groupForm,setGroupForm]=useState({name:"",description:"",permissions:[] as string[]});
  const owner=String(session?.role||"").toLowerCase()==="owner";

  const loadAccess=async()=>{setLoading(true);setAccessError("");try{setState(await getAccessState({data:{token:session.token}}))}catch(x:any){setAccessError(x.message||"Unable to load users and access groups.")}finally{setLoading(false)}};
  useEffect(()=>{void loadAccess()},[session?.token]);
  const groupsFor=(userId:string)=>state.memberships.filter((m:any)=>m.user_id===userId).map((m:any)=>m.group_id);

  const createUser=async(e:any)=>{e.preventDefault();setAccessError("");setMessage("");try{await createPanelUser({data:{token:session.token,email:userForm.email,displayName:userForm.displayName,role:userForm.role as "owner"|"admin",password:userForm.password,groupIds:userForm.groupIds}});setUserForm({email:"",displayName:"",role:"admin",password:"",groupIds:[]});setShowUserForm(false);setMessage("User created.");await loadAccess()}catch(x:any){setAccessError(x.message||"Unable to create user.")}};
  const saveGroup=async(e:any)=>{e.preventDefault();setAccessError("");setMessage("");try{if(editingGroup){await updateAccessGroup({data:{token:session.token,groupId:editingGroup.id,name:groupForm.name,description:groupForm.description,permissions:groupForm.permissions}});setMessage("Group updated.")}else{await createAccessGroup({data:{token:session.token,name:groupForm.name,description:groupForm.description,permissions:groupForm.permissions}});setMessage("Group created.")}setGroupForm({name:"",description:"",permissions:[]});setShowGroupForm(false);setEditingGroup(null);await loadAccess()}catch(x:any){setAccessError(x.message||"Unable to save group.")}};
  const toggleUser=async(user:any)=>{setAccessError("");try{await updatePanelUser({data:{token:session.token,userId:user.id,status:user.status==="active"?"disabled":"active"}});await loadAccess()}catch(x:any){setAccessError(x.message||"Unable to update user.")}};
  const setRole=async(user:any,role:"owner"|"admin")=>{setAccessError("");try{await updatePanelUser({data:{token:session.token,userId:user.id,role}});await loadAccess()}catch(x:any){setAccessError(x.message||"Unable to update role.")}};
  const toggleMembership=async(user:any,groupId:string)=>{setAccessError("");const current=groupsFor(user.id);const next=current.includes(groupId)?current.filter((x:string)=>x!==groupId):[...current,groupId];try{await updatePanelUser({data:{token:session.token,userId:user.id,groupIds:next}});await loadAccess()}catch(x:any){setAccessError(x.message||"Unable to update group membership.")}};
  const startGroup=(g?:any)=>{if(g){setEditingGroup(g);setGroupForm({name:g.name,description:g.description||"",permissions:Array.isArray(g.permissions)?g.permissions:[]})}else{setEditingGroup(null);setGroupForm({name:"",description:"",permissions:[]})}setShowGroupForm(true)};

  if(!owner)return <section className="space-y-4"><PageHead title="Users & Access" detail="Owner-only access management."/><section className="release-surface p-5"><SectionHead icon={KeyRound} title="Owner access required" detail="Admins can operate release workflows but cannot change users, groups or permissions."/></section></section>;

  return <section className="space-y-4">
    <div className="flex flex-col justify-between gap-3 border-b pb-5 md:flex-row md:items-end"><PageHead title="Users & Access" detail="Private Dev Panel access with only Owner and Admin roles. Groups provide optional operational permission bundles."/><div className="flex gap-2"><button className="button-secondary" onClick={()=>startGroup()}><UserCog size={14}/> New group</button><button className="button-primary" onClick={()=>setShowUserForm(!showUserForm)}><UserPlus size={14}/> Add user</button></div></div>
    {accessError&&<Alert tone="error" onClose={()=>setAccessError("")}>{accessError}</Alert>}{message&&<Alert tone="success" onClose={()=>setMessage("")}>{message}</Alert>}
    {showUserForm&&<form onSubmit={createUser} className="release-surface p-4"><SectionHead icon={UserPlus} title="Add user" detail="Create a private account. No public registration is available."/><div className="mt-4 grid gap-3 sm:grid-cols-2"><Field label="Display name"><input className="control" value={userForm.displayName} onChange={e=>setUserForm({...userForm,displayName:e.target.value})} required/></Field><Field label="Email"><input className="control" type="email" value={userForm.email} onChange={e=>setUserForm({...userForm,email:e.target.value})} required/></Field><Field label="Role"><select className="control" value={userForm.role} onChange={e=>setUserForm({...userForm,role:e.target.value})}><option value="admin">Admin</option><option value="owner">Owner</option></select></Field><Field label="Temporary password"><input className="control" type="password" minLength={10} value={userForm.password} onChange={e=>setUserForm({...userForm,password:e.target.value})} required/></Field></div>{state.groups.length>0&&<div className="mt-4"><p className="text-xs font-medium">Groups</p><div className="mt-2 flex flex-wrap gap-2">{state.groups.map((g:any)=><label key={g.id} className="flex items-center gap-2 rounded-lg border px-3 py-2 text-[11px]"><input type="checkbox" checked={userForm.groupIds.includes(g.id)} onChange={()=>setUserForm({...userForm,groupIds:userForm.groupIds.includes(g.id)?userForm.groupIds.filter(x=>x!==g.id):[...userForm.groupIds,g.id]})}/>{g.name}</label>)}</div></div>}<div className="mt-4 flex justify-end gap-2"><button type="button" className="button-secondary" onClick={()=>setShowUserForm(false)}>Cancel</button><button className="button-primary">Create user</button></div></form>}
    {showGroupForm&&<form onSubmit={saveGroup} className="release-surface p-4"><SectionHead icon={Users} title={editingGroup?"Edit group":"New access group"} detail="Group permissions are for Dev Panel operations only; they do not change License Master authority."/><div className="mt-4 grid gap-3 sm:grid-cols-2"><Field label="Group name"><input className="control" value={groupForm.name} onChange={e=>setGroupForm({...groupForm,name:e.target.value})} required/></Field><Field label="Description"><input className="control" value={groupForm.description} onChange={e=>setGroupForm({...groupForm,description:e.target.value})}/></Field></div><div className="mt-4 grid gap-2 sm:grid-cols-3">{state.permissions.map((perm:string)=><label key={perm} className="flex items-center gap-2 rounded-lg border bg-background/40 p-2 text-[11px]"><input type="checkbox" checked={groupForm.permissions.includes(perm)} onChange={()=>setGroupForm({...groupForm,permissions:groupForm.permissions.includes(perm)?groupForm.permissions.filter(x=>x!==perm):[...groupForm.permissions,perm]})}/><code>{perm}</code></label>)}</div><div className="mt-4 flex justify-end gap-2"><button type="button" className="button-secondary" onClick={()=>{setShowGroupForm(false);setEditingGroup(null)}}>Cancel</button><button className="button-primary">{editingGroup?"Save group":"Create group"}</button></div></form>}
    <div className="grid gap-4 xl:grid-cols-[1.4fr_.8fr]">
      <section className="release-surface overflow-hidden"><div className="flex items-center justify-between border-b p-4"><SectionHead icon={Users} title="Users" detail={loading?"Loading…":String(state.users.length)+" private accounts"}/><span className="text-[10px] text-muted-foreground">Owner / Admin only</span></div><div>{state.users.map((u:any)=><div key={u.id} className="border-b p-4 last:border-b-0"><div className="grid gap-3 md:grid-cols-[1fr_120px_110px_auto] md:items-center"><div><p className="text-sm font-medium">{u.display_name}</p><p className="mt-1 text-[10px] text-muted-foreground">{u.email} · last login {u.last_login_at?new Date(u.last_login_at).toLocaleString():"never"}</p></div><select className="control mt-0" value={u.role} onChange={e=>setRole(u,e.target.value as any)}><option value="admin">Admin</option><option value="owner">Owner</option></select><StatusPill text={u.status}/><button className="button-secondary" onClick={()=>toggleUser(u)}>{u.status==="active"?"Disable":"Enable"}</button></div>{state.groups.length>0&&<div className="mt-3 flex flex-wrap gap-2">{state.groups.map((g:any)=><label key={g.id} className="flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[10px]"><input type="checkbox" checked={groupsFor(u.id).includes(g.id)} onChange={()=>toggleMembership(u,g.id)}/>{g.name}</label>)}</div>}</div>)}{!loading&&!state.users.length&&<div className="p-8 text-center text-xs text-muted-foreground">No users returned.</div>}</div></section>
      <section className="release-surface overflow-hidden"><div className="border-b p-4"><SectionHead icon={UserCog} title="Groups" detail="Optional permission bundles for this private panel."/></div><div>{state.groups.map((g:any)=><button key={g.id} type="button" onClick={()=>startGroup(g)} className="block w-full border-b p-4 text-left last:border-b-0 hover:bg-muted/20"><div className="flex items-center justify-between gap-2"><p className="text-sm font-semibold">{g.name}</p><StatusPill text={String(Array.isArray(g.permissions)?g.permissions.length:0)+" permissions"}/></div><p className="mt-1 text-[10px] text-muted-foreground">{g.description||"No description"}</p><div className="mt-3 flex flex-wrap gap-1">{(g.permissions||[]).map((perm:string)=><code key={perm} className="rounded bg-muted px-1.5 py-1 text-[9px]">{perm}</code>)}</div></button>)}{!loading&&!state.groups.length&&<div className="p-8 text-center text-xs text-muted-foreground">No groups yet.</div>}</div></section>
    </div>
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
  return <section className="orbit-panel"><div className="orbit-panel-head"><span className="orbit-panel-icon"><Icon size={15}/></span><div><h2>{title}</h2><p>Runtime configuration</p></div></div><div className="orbit-kv-list">{rows.map(([k,v]:any)=><div key={k}><span>{k}</span><code>{v}</code></div>)}</div></section>;
}

function PageHead({ title, detail }: any) {
  return <div className="orbit-reference-page-head"><p>ORBITFS RELEASE CONTROL</p><h1>{title}</h1><span>{detail}</span></div>;
}

function SectionHead({ icon: Icon, title, detail }: any) {
  return <div className="orbit-section-head"><span className="orbit-section-icon"><Icon size={15}/></span><div><h2>{title}</h2><p>{detail}</p></div></div>;
}
function StatusRow({ label, value, good }: any) { return <div className="orbit-status-row"><span>{label}</span><strong className={good?"is-good":""}>{good&&<i/>}{value}</strong></div>; }
function statusTone(text:any){
  const s=String(text||"").toLowerCase();
  if(["failed","failure","rejected","error","offline","unavailable","disabled","unpublished"].some(x=>s.includes(x)))return "danger";
  if(["pending","queued","running","draft","waiting","review","request","assigned"].some(x=>s.includes(x)))return "warning";
  if(["published","approved","passed","success","connected","enabled","ready","active","received","open"].some(x=>s.includes(x)))return "success";
  if(["archived","idle","closed","not run","not validated"].some(x=>s.includes(x)))return "neutral";
  return "info";
}
function StatusPill({ text }: any) { return <span className={`orbit-status-pill orbit-status-tone-${statusTone(text)}`}>{text}</span>; }
function Field({ label, children }: any) { return <label className="block text-xs font-medium">{label}{children}</label>; }
function Alert({ tone, children, onClose }: any) {
  const cls=tone==="error"?"border-red-400/40 bg-red-400/10 text-red-100":tone==="warning"?"border-amber-400/40 bg-amber-400/10 text-amber-100":"border-emerald-400/30 bg-emerald-400/10 text-emerald-100";
  return <div className={`flex items-start justify-between gap-3 rounded-lg border px-3 py-2.5 text-xs ${cls}`}><span>{children}</span>{onClose&&<button className="opacity-60 hover:opacity-100" onClick={onClose}><XCircle size={14}/></button>}</div>;
}

