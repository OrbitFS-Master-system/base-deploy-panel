import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import {
  Activity, AlertCircle, ArrowRight, CheckCircle2, ChevronRight, CircleDot,
  Clock3, FileCode2, GitBranch, Github, Layers3, Loader2, PackageCheck,
  RefreshCw, Rocket, ScrollText, Server, Settings2, ShieldCheck, Terminal,
  UploadCloud, XCircle, Zap
} from "lucide-react";
import {
  getPanelState, inspectSource, startRelease, getReleaseRun,
  getReleaseHandoff, login
} from "@/lib/panel.server";

export const Route = createFileRoute("/")({ component: Index });

type Tab = "overview" | "base" | "engine" | "activity" | "settings";
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
    setRun(null); setRunRepo(""); setHandoff(null);
  };

  const inspect = async (type: ReleaseType) => {
    setBusy("inspect");
    setError(""); setNotice("");
    try {
      const current = data[type].releases?.find((r: any) => r.review_status === "approved" && r.source_sha)?.source_sha;
      const r = await inspectSource({ data: { token: session.token, type, from: current } });
      setFiles(r.files || []);
      setCommits(r.commits || []);
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
      setNotice(r.runId ? `GitHub workflow started · run #${r.runId}` : "Workflow dispatched. Waiting for GitHub run details.");
      setVersion(""); setNotes(""); setChangelogDraft(""); setChangelogTemplate("base_deployment_log"); setFiles([]); setCommits([]);
      await load();
      setTab("activity");
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
            {run && <LiveConsole run={run} repo={runRepo} handoff={handoff} />}
            {tab === "overview" && <Dashboard stats={stats} releases={allReleases} onBase={() => { resetComposer(); setTab("base"); }}
              onEngine={() => { resetComposer(); setTab("engine"); }} onActivity={() => setTab("activity")} />}
            {tab === "base" && <Composer type="base" {...composerProps({ channel, setChannel, version, setVersion, notes, setNotes, files, commits,
              setFiles, setCommits, components, setComponents, minBase, setMinBase, protocol, setProtocol, busy, reviewOpen, availableChannels,
              changelogTemplate, setChangelogTemplate, changelogDraft, setChangelogDraft })}
              onInspect={() => inspect("base")} onStart={() => start("base")} />}
            {tab === "engine" && <Composer type="engine" {...composerProps({ channel, setChannel, version, setVersion, notes, setNotes, files, commits,
              setFiles, setCommits, components, setComponents, minBase, setMinBase, protocol, setProtocol, busy, reviewOpen, availableChannels,
              changelogTemplate, setChangelogTemplate, changelogDraft, setChangelogDraft })}
              onInspect={() => inspect("engine")} onStart={() => start("engine")} />}
            {tab === "activity" && <ActivityPage releases={allReleases} run={run} />}
            {tab === "settings" && <SettingsPage data={data} connected={masterConnected} />}
          </div>
        </main>
      </div>
    </div>
  );

  function resetComposer() {
    setVersion(""); setNotes(""); setFiles([]); setCommits([]); setComponents([]); setReviewOpen(false);
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
  return <header className="sticky top-0 z-30 border-b bg-background/95 backdrop-blur">
    <div className="mx-auto flex h-14 max-w-[1680px] items-center justify-between px-4 sm:px-6 xl:px-8">
      <div className="flex items-center gap-3 min-w-0"><div className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary text-sm font-black text-primary-foreground">O</div>
        <div className="min-w-0"><div className="truncate text-sm font-semibold">OrbitFS Release Control</div><div className="hidden text-[11px] text-muted-foreground sm:block">Stage 1 · Release preparation</div></div>
      </div>
      <div className="flex items-center gap-2">
        <div className="hidden items-center gap-2 rounded-lg border bg-card px-2.5 py-1.5 text-xs sm:flex"><i className={`h-1.5 w-1.5 rounded-full ${connected ? "bg-emerald-400" : "bg-destructive"}`} />{connected ? "License Master" : "Master offline"}</div>
        <button className="icon-button" title="Refresh" onClick={onRefresh}><RefreshCw className={loading ? "animate-spin" : ""} size={15} /></button>
        <div className="hidden border-l pl-2 text-right sm:block"><p className="text-xs font-medium">{user.display_name || user.email}</p><p className="text-[10px] text-muted-foreground">{user.role || "operator"}</p></div>
        <button className="icon-button" title="Sign out" onClick={onSignOut}><UploadCloud className="rotate-180" size={15} /></button>
      </div>
    </div>
  </header>;
}

function Sidebar({ tab, setTab, activeRun }: any) {
  const items = [
    ["overview", "Dashboard", "System overview", Activity],
    ["base", "Base release", "orbitfs_base", Rocket],
    ["engine", "Engine updates", "MCP · Apex · Studio", Layers3],
    ["activity", "Releases & runs", "History and live jobs", Terminal],
    ["settings", "Configuration", "Connections and sources", Settings2],
  ] as const;
  return <aside className="hidden w-60 shrink-0 border-r lg:block">
    <div className="sticky top-14 p-3">
      <p className="px-3 pb-2 text-[10px] font-semibold uppercase tracking-[.16em] text-muted-foreground">Workspace</p>
      <nav className="space-y-1">
        {items.map(([id, label, detail, Icon]) => <button key={id} onClick={() => setTab(id as Tab)}
          className={`nav-item ${tab === id ? "nav-item-active" : ""}`}>
          <span className="nav-icon"><Icon size={15} /></span><span className="min-w-0"><b>{label}</b><small>{detail}</small></span>
          {id === "activity" && activeRun && <span className="ml-auto h-2 w-2 rounded-full bg-emerald-400 animate-pulse" />}
        </button>)}
      </nav>
      <div className="mt-6 rounded-xl border bg-card/60 p-3">
        <p className="flex items-center gap-2 text-xs font-semibold"><ShieldCheck size={14} /> Controlled pipeline</p>
        <div className="mt-3 space-y-2 text-[11px] text-muted-foreground">
          <StepLine n="1" text="Dev Panel prepares" active />
          <StepLine n="2" text="License Master validates" />
          <StepLine n="3" text="Billing Store reviews" />
          <StepLine n="4" text="Customer release publishes" />
        </div>
      </div>
    </div>
  </aside>;
}

function StepLine({ n, text, active }: any) {
  return <div className={`flex items-center gap-2 ${active ? "text-foreground" : ""}`}><span className="flex h-5 w-5 items-center justify-center rounded-full border text-[9px] font-bold">{n}</span>{text}</div>;
}

function Dashboard({ stats, releases, onBase, onEngine, onActivity }: any) {
  const recent = releases.slice(0, 6);
  return <section className="space-y-5">
    <div className="flex flex-col justify-between gap-4 border-b pb-5 md:flex-row md:items-end">
      <div><p className="text-xs font-semibold uppercase tracking-[.16em] text-primary">Developer workspace</p>
        <h1 className="mt-1 text-3xl font-semibold tracking-tight">Prepare the next OrbitFS release.</h1>
        <p className="mt-2 max-w-2xl text-sm leading-6 text-muted-foreground">Stage 1 handles source inspection, change detection, release metadata, changelog context and workflow dispatch before License Master takes over technical validation.</p></div>
      <div className="flex gap-2"><button className="button-primary" onClick={onBase}><Rocket size={15}/> New Base</button><button className="button-secondary" onClick={onEngine}><Layers3 size={15}/> New Engine update</button></div>
    </div>
    <div className="grid grid-cols-2 overflow-hidden rounded-xl border bg-border md:grid-cols-4">
      <Metric label="Candidates" value={stats.candidates} detail="Awaiting validation/review" />
      <Metric label="Validation failed" value={stats.validationFailed} detail="Needs attention" />
      <Metric label="Ready" value={stats.ready} detail="Approved, not published" />
      <Metric label="Published" value={stats.published} detail="Current release history" />
    </div>
    <div className="grid gap-4 xl:grid-cols-[1.4fr_.9fr]">
      <section className="release-surface p-4 sm:p-5">
        <SectionHead icon={Zap} title="Release pipeline" detail="The handoff path for every product release." />
        <div className="mt-5 grid gap-2 sm:grid-cols-4">
          <PipelineStep icon={FileCode2} title="Inspect" text="Compare source against the last approved commit." />
          <PipelineStep icon={ScrollText} title="Prepare" text="Build version, channel, notes and compatibility metadata." />
          <PipelineStep icon={Github} title="Run" text="Dispatch the existing GitHub worker and watch every job." />
          <PipelineStep icon={ShieldCheck} title="Handoff" text="License Master receives the candidate for validation." />
        </div>
      </section>
      <section className="release-surface p-4 sm:p-5">
        <SectionHead icon={Server} title="System status" detail="Live connections used by Stage 1." />
        <div className="mt-4 space-y-2"><StatusRow label="License Master API" value="Connected" good /><StatusRow label="Base worker" value="V1-vercel-base" /><StatusRow label="Engine worker" value="V1-vercel-engine" /></div>
      </section>
    </div>
    <section className="release-surface overflow-hidden">
      <div className="flex items-center justify-between border-b p-4"><SectionHead icon={Clock3} title="Recent releases" detail="Latest candidates known to License Master."/><button className="text-xs font-medium text-primary" onClick={onActivity}>View all →</button></div>
      <ReleaseTable releases={recent} />
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
  const canStart = Boolean(p.version.trim()) && (base || p.components.length > 0);
  const templateLabel = base ? "Base Deployment Log" : "Update Changelog";
  return <section className="space-y-4">
    <div className="flex flex-col justify-between gap-4 border-b pb-5 md:flex-row md:items-end">
      <div><p className="text-xs font-semibold uppercase tracking-[.16em] text-primary">{base ? "Base release" : "Engine update"}</p>
        <h1 className="mt-1 text-3xl font-semibold tracking-tight">{base ? "Prepare a Base release." : "Prepare an Engine update."}</h1>
        <p className="mt-2 max-w-2xl text-sm leading-6 text-muted-foreground">{base ? "Package the current orbitfs_base source state through the existing Base worker." : "Choose affected components, inspect source changes and prepare the Engine handoff."}</p></div>
      <div className="flex items-center gap-2 rounded-lg border bg-card px-3 py-2 text-xs"><GitBranch size={14}/><code>{base ? "base-release" : "UPDATE_RELEASE"}</code></div>
    </div>
    <div className="grid gap-4 xl:grid-cols-[1fr_330px]">
      <section className="release-surface p-4 sm:p-5">
        <SectionHead icon={Settings2} title="Release definition" detail="These values become the Stage 1 handoff inputs." />
        <div className="mt-5 grid gap-4 sm:grid-cols-2">
          <Field label="Version"><input className="control" placeholder="1.2.3" value={p.version} onChange={e => p.setVersion(e.target.value)}/></Field>
          <Field label="Channel"><select className="control" value={p.channel} onChange={e => p.setChannel(e.target.value)}>{(p.availableChannels?.length ? p.availableChannels : ["stable"]).map((x:string)=><option key={x}>{x}</option>)}</select></Field>
        </div>
        {!base && <><div className="mt-5 border-t pt-5"><p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Components</p><div className="mt-3 grid gap-2 sm:grid-cols-3">{["apex","mcp","studio"].map((c:string)=><button type="button" key={c} onClick={()=>p.setComponents((x:string[])=>x.includes(c)?x.filter(y=>y!==c):[...x,c])} className={`rounded-lg border p-3 text-left ${p.components.includes(c)?"border-primary bg-primary/10":"bg-background hover:bg-accent"}`}><span className="text-xs font-semibold">{c.toUpperCase()}</span><span className="mt-1 block text-[11px] text-muted-foreground">{p.components.includes(c)?"Included":"Not selected"}</span></button>)}</div></div>
        <div className="mt-5 grid gap-4 border-t pt-5 sm:grid-cols-2"><Field label="Minimum Base version"><input className="control" value={p.minBase} onChange={e=>p.setMinBase(e.target.value)}/></Field><Field label="Minimum deployer protocol"><input className="control" value={p.protocol} onChange={e=>p.setProtocol(e.target.value)}/></Field></div></>}
        <div className="mt-5 border-t pt-5">
          <Field label="Changelog template">
            <select className="control" value={p.changelogTemplate} onChange={e => p.setChangelogTemplate(e.target.value)}>
              <option value="base_deployment_log">Base Deployment Log</option>
              <option value="update_changelog">Update Changelog</option>
            </select>
          </Field>
          <p className="mt-1 text-[11px] text-muted-foreground">The template is filled automatically after source inspection. You can edit the completed changelog before sending it.</p>
        </div>
        <div className="mt-5 border-t pt-5"><Field label={base ? "Additional operator notes" : "Additional developer notes"}><textarea className="control min-h-24 resize-y" placeholder="Optional extra context. It will be included when the changelog is generated." value={p.notes} onChange={e=>p.setNotes(e.target.value)}/></Field></div>
        <div className="mt-5 flex flex-col gap-2 border-t pt-5 sm:flex-row sm:items-center sm:justify-between"><button className="button-secondary" disabled={p.busy==="inspect"} onClick={p.onInspect}>{p.busy==="inspect"?<Loader2 className="animate-spin" size={15}/>:<FileCode2 size={15}/>} Inspect source changes</button><button className="button-primary" disabled={!canStart||p.busy==="start"||!p.reviewOpen||!p.changelogDraft.trim()} onClick={p.onStart}>{p.busy==="start"?<Loader2 className="animate-spin" size={15}/>:<Rocket size={15}/>} {p.reviewOpen ? (base ? "Send reviewed Base release" : "Send reviewed update") : "Inspect & review first"}</button></div>
        {!canStart && <p className="mt-2 text-right text-[11px] text-muted-foreground">{base?"Enter a SemVer version to continue.":"Enter a version and select at least one component."}</p>}
        {canStart&&!p.reviewOpen&&<p className="mt-2 text-right text-[11px] text-muted-foreground">Inspect the source first. The release stays gated until the generated changelog has been reviewed.</p>}
      </section>
      <section className="release-surface p-4 sm:p-5">
        <SectionHead icon={ScrollText} title={base?"Release summary":"Review gate"} detail={base?"What Stage 1 will hand to the worker.":"Confirm the generated source context before dispatch."}/>
        <div className="mt-4 rounded-lg border bg-background/50 p-3 font-mono text-[11px] leading-6 text-muted-foreground">
          <p><span className="text-foreground">product</span> = orbitfs_base</p><p><span className="text-foreground">type</span> = {base?"base":"update"}</p><p><span className="text-foreground">version</span> = {p.version||"not set"}</p><p><span className="text-foreground">channel</span> = {p.channel}</p><p><span className="text-foreground">changes</span> = {p.files.length}</p>{!base&&<><p><span className="text-foreground">components</span> = {p.components.join(", ")||"none"}</p><p><span className="text-foreground">minBase</span> = {p.minBase}</p><p><span className="text-foreground">protocol</span> = {p.protocol}</p></>}
        </div>
        <div className="mt-4 rounded-lg border p-3 text-xs"><p className="font-medium">Stage 1 does not publish customers.</p><p className="mt-1 leading-5 text-muted-foreground">It prepares and dispatches the candidate. License Master validates it; Billing Store handles the final publication workflow.</p></div>
      </section>
    </div>
    <ChangelogEditor type={p.type} template={p.changelogTemplate} value={p.changelogDraft} onChange={p.setChangelogDraft} commits={p.commits || []} files={p.files || []} />
  </section>;
}

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

function ChangelogEditor({ type, template, value, onChange, commits, files }: any) {
  const label = type === "base" ? "Base Deployment Log" : "Update Changelog";
  return <section className="release-surface overflow-hidden">
    <div className="flex flex-col gap-2 border-b p-4 sm:flex-row sm:items-center sm:justify-between">
      <SectionHead icon={ScrollText} title={label} detail="Automatically filled from the inspected source. Edit it before the release is sent." />
      <span className="rounded-full bg-muted px-2 py-1 text-[10px]">{template === "base_deployment_log" ? "BASE TEMPLATE" : "UPDATE TEMPLATE"}</span>
    </div>
    <div className="grid gap-4 p-4 xl:grid-cols-[1fr_250px]">
      <textarea className="control min-h-[520px] resize-y font-mono text-xs leading-5" value={value || ""} onChange={e => onChange(e.target.value)} placeholder="Inspect source to generate the changelog." />
      <div className="rounded-lg border bg-background/50 p-3 text-xs">
        <p className="font-semibold">Review before sending</p>
        <div className="mt-3 space-y-2 text-muted-foreground">
          <p>Commits: <span className="text-foreground">{commits.length}</span></p>
          <p>Changed files: <span className="text-foreground">{files.length}</span></p>
          <p className="pt-2 leading-5">This text is the release changelog handed to the worker. Your edits are preserved.</p>
          <p className="pt-2 leading-5">For Base deployments, the changelog is generated even when no changes are detected.</p>
        </div>
      </div>
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

