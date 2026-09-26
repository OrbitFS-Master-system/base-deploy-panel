import { createServerFn } from "@tanstack/react-start";
import { createClient } from "@supabase/supabase-js";
import crypto from "node:crypto";

const BASE_REPO=process.env.BASE_RELEASE_REPO||"lucaskerim123/V1-vercel-base";
const BASE_REF=process.env.BASE_RELEASE_REF||"base-release";
const BASE_WORKER_REPO=process.env.BASE_RELEASE_WORKER_REPO||"lucaskerim123/Dev-panel";
const BASE_WORKER_REF=process.env.BASE_RELEASE_WORKER_REF||"main";
const ENGINE_REPO=process.env.ENGINE_RELEASE_REPO||"lucaskerim123/V1-vercel-engine";
const ENGINE_REF=process.env.ENGINE_RELEASE_REF||"UPDATE_RELEASE";
const BASE_WORKFLOW=process.env.BASE_RELEASE_WORKER_WORKFLOW||"package-base-release.yml";
const ENGINE_WORKFLOW=process.env.ENGINE_RELEASE_WORKFLOW||"publish-engine-release.yml";

const required=(name:string)=>{const v=process.env[name];if(!v)throw new Error(`Missing server environment variable: ${name}`);return v};
const masterUrl=()=> {
 const configured=(process.env.LICENSE_MASTER_URL||"https://incendiarynetworks.cc/api/v1").trim();
 const url=new URL(configured);
 const path=url.pathname.replace(/\/+$/,"");
 if(/\/api\/v1(?:\/.*)?$/i.test(path))url.pathname=path.replace(/\/api\/v1(?:\/.*)?$/i,"/api/v1");
 else if(/\/api$/i.test(path))url.pathname=path+"/v1";
 else url.pathname=(path||"")+"/api/v1";
 url.search="";
 url.hash="";
 return url.toString().replace(/\/$/,"");
};
const normalizeChannel=(value:string)=>String(value||"stable").trim().toLowerCase();
const allowedRepos=new Set([BASE_REPO,BASE_WORKER_REPO,ENGINE_REPO]);

type PanelUser={id:string;email:string;display_name:string;role:string};
const sessionSecret=()=>required("APP_SESSION_SECRET");

function signSession(user:PanelUser){
 const payload=Buffer.from(JSON.stringify({...user,exp:Date.now()+7*86400000})).toString("base64url");
 const sig=crypto.createHmac("sha256",sessionSecret()).update(payload).digest("base64url");
 return `${payload}.${sig}`;
}
function readSession(token:string):PanelUser{
 const [payload,sig]=String(token||"").split(".");
 if(!payload||!sig)throw new Error("Not signed in");
 const expected=crypto.createHmac("sha256",sessionSecret()).update(payload).digest("base64url");
 if(sig.length!==expected.length||!crypto.timingSafeEqual(Buffer.from(sig),Buffer.from(expected)))throw new Error("Your session is no longer valid");
 const user=JSON.parse(Buffer.from(payload,"base64url").toString()) as PanelUser & {exp:number};
 if(!user.id||!user.email||user.exp<Date.now())throw new Error("Your session is no longer valid");
 return user;
}

function authClient(){
 return createClient(required("SUPABASE_URL"),required("SUPABASE_SERVICE_ROLE_KEY"),{auth:{persistSession:false,autoRefreshToken:false}});
}
function verifyPassword(password:string,hash:string,salt:string){
 const derived=crypto.scryptSync(password,salt,64);
 const stored=Buffer.from(hash,"hex");
 return derived.length===stored.length&&crypto.timingSafeEqual(derived,stored);
}

function requireOwner(token:string){
 const user=readSession(token);
 if(String(user.role).toLowerCase()!=="owner")throw new Error("Owner access required");
 return user;
}
function hashPassword(password:string){
 if(password.length<10)throw new Error("Temporary password must be at least 10 characters");
 const salt=crypto.randomBytes(16).toString("hex");
 const hash=crypto.scryptSync(password,salt,64).toString("hex");
 return {hash,salt};
}
const GROUP_PERMISSIONS=[
 "release.read","release.create","release.monitor","release.lifecycle",
 "channels.read","portal.read","repositories.read","monitoring.read","audit.read"
] as const;

export const login=createServerFn({method:"POST"}).handler(async({data}:{data:{email:string;password:string}})=>{
 const email=String(data.email||"").trim().toLowerCase(),password=String(data.password||"");
 if(!email||!password)throw new Error("Email and password are required");
 const sb=authClient();
 const {data:user,error}=await sb.from("users").select("id,email,password_hash,password_salt,display_name,role,status").ilike("email",email).maybeSingle();
 if(error)throw new Error("Unable to connect to License Master users");
 if(!user||user.status!=="active"||!verifyPassword(password,user.password_hash,user.password_salt))throw new Error("Invalid credentials");
 await sb.from("users").update({last_login_at:new Date().toISOString()}).eq("id",user.id);
 const safe={id:user.id,email:user.email,display_name:user.display_name,role:user.role};
 return {ok:true,token:signSession(safe),user:safe};
});


export const getAccessState=createServerFn({method:"POST"}).handler(async({data}:{data:{token:string}})=>{
 const actor=readSession(data.token);
 const sb=authClient();
 if(String(actor.role).toLowerCase()!=="owner") return {users:[],groups:[],ownerOnly:true,permissions:GROUP_PERMISSIONS};
 const [{data:users,error:usersError},{data:groups,error:groupsError},{data:memberships,error:membershipError}]=await Promise.all([
  sb.from("users").select("id,email,display_name,role,status,last_login_at,created_at").order("created_at",{ascending:true}),
  sb.from("access_groups").select("id,name,description,permissions,created_at").order("name",{ascending:true}),
  sb.from("user_access_groups").select("user_id,group_id"),
 ]);
 if(usersError)throw new Error("Unable to load Dev Panel users");
 if(groupsError)throw new Error("Unable to load access groups. Apply the Dev Panel access migration first.");
 if(membershipError)throw new Error("Unable to load group memberships");
 return {users:users||[],groups:groups||[],memberships:memberships||[],ownerOnly:false,permissions:GROUP_PERMISSIONS};
});

export const createPanelUser=createServerFn({method:"POST"}).handler(async({data}:{data:{token:string;email:string;displayName:string;role:"owner"|"admin";password:string;groupIds?:string[]}})=>{
 const actor=requireOwner(data.token);
 const email=String(data.email||"").trim().toLowerCase();
 const displayName=String(data.displayName||"").trim();
 const role=String(data.role||"admin").toLowerCase();
 if(!email||!email.includes("@"))throw new Error("Enter a valid email address");
 if(!displayName)throw new Error("Display name is required");
 if(!["owner","admin"].includes(role))throw new Error("Role must be Owner or Admin");
 const {hash,salt}=hashPassword(String(data.password||""));
 const sb=authClient();
 const {data:user,error}=await sb.from("users").insert({email,display_name:displayName,role,status:"active",password_hash:hash,password_salt:salt}).select("id,email,display_name,role,status,last_login_at,created_at").single();
 if(error)throw new Error(error.code==="23505"?"A user with that email already exists":"Unable to create user");
 const groupIds=[...new Set((data.groupIds||[]).map(String).filter(Boolean))];
 if(groupIds.length){
  const {error:membershipError}=await sb.from("user_access_groups").insert(groupIds.map(group_id=>({user_id:user.id,group_id})));
  if(membershipError)throw new Error("User created, but group assignment failed");
 }
 await sb.from("panel_access_audit").insert({actor_id:actor.id,action:"user.created",target_type:"user",target_id:user.id,detail:{email,role}});
 return {user};
});

export const updatePanelUser=createServerFn({method:"POST"}).handler(async({data}:{data:{token:string;userId:string;role?:"owner"|"admin";status?:"active"|"disabled";displayName?:string;password?:string;groupIds?:string[]}})=>{
 const actor=requireOwner(data.token);
 const sb=authClient();
 const patch:any={updated_at:new Date().toISOString()};
 if(data.role){if(!["owner","admin"].includes(data.role))throw new Error("Invalid role");patch.role=data.role}
 if(data.status){if(!["active","disabled"].includes(data.status))throw new Error("Invalid status");patch.status=data.status}
 if(typeof data.displayName==="string"){const v=data.displayName.trim();if(!v)throw new Error("Display name is required");patch.display_name=v}
 if(data.password){const hp=hashPassword(data.password);patch.password_hash=hp.hash;patch.password_salt=hp.salt}
 if(String(data.userId)===actor.id&&patch.status==="disabled")throw new Error("You cannot disable your own Owner account");
 if(patch.role==="admin"||patch.status==="disabled"){
  const {data:target}=await sb.from("users").select("role,status").eq("id",data.userId).maybeSingle();
  if(target?.role==="owner"&&target?.status==="active"){
   const {count}=await sb.from("users").select("id",{count:"exact",head:true}).eq("role","owner").eq("status","active");
   if((count||0)<=1)throw new Error("At least one active Owner account is required");
  }
 }
 const {data:user,error}=await sb.from("users").update(patch).eq("id",data.userId).select("id,email,display_name,role,status,last_login_at,created_at").single();
 if(error)throw new Error("Unable to update user");
 if(Array.isArray(data.groupIds)){
  const {error:deleteError}=await sb.from("user_access_groups").delete().eq("user_id",data.userId);
  if(deleteError)throw new Error("User updated, but group memberships could not be reset");
  const ids=[...new Set(data.groupIds.map(String).filter(Boolean))];
  if(ids.length){
   const {error:insertError}=await sb.from("user_access_groups").insert(ids.map(group_id=>({user_id:data.userId,group_id})));
   if(insertError)throw new Error("User updated, but group membership assignment failed");
  }
 }
 await sb.from("panel_access_audit").insert({actor_id:actor.id,action:"user.updated",target_type:"user",target_id:data.userId,detail:{role:data.role,status:data.status}});
 return {user};
});

export const createAccessGroup=createServerFn({method:"POST"}).handler(async({data}:{data:{token:string;name:string;description?:string;permissions?:string[]}})=>{
 const actor=requireOwner(data.token);
 const name=String(data.name||"").trim();
 if(!name)throw new Error("Group name is required");
 const permissions=[...new Set((data.permissions||[]).filter((x:string)=>GROUP_PERMISSIONS.includes(x as any)))];
 const sb=authClient();
 const {data:group,error}=await sb.from("access_groups").insert({name,description:String(data.description||"").trim(),permissions}).select("*").single();
 if(error)throw new Error(error.code==="23505"?"A group with that name already exists":"Unable to create group");
 await sb.from("panel_access_audit").insert({actor_id:actor.id,action:"group.created",target_type:"group",target_id:group.id,detail:{name,permissions}});
 return {group};
});

export const updateAccessGroup=createServerFn({method:"POST"}).handler(async({data}:{data:{token:string;groupId:string;name?:string;description?:string;permissions?:string[]}})=>{
 const actor=requireOwner(data.token);
 const patch:any={updated_at:new Date().toISOString()};
 if(typeof data.name==="string"){const name=data.name.trim();if(!name)throw new Error("Group name is required");patch.name=name}
 if(typeof data.description==="string")patch.description=data.description.trim();
 if(Array.isArray(data.permissions))patch.permissions=[...new Set(data.permissions.filter((x:string)=>GROUP_PERMISSIONS.includes(x as any)))];
 const sb=authClient();
 const {data:group,error}=await sb.from("access_groups").update(patch).eq("id",data.groupId).select("*").single();
 if(error)throw new Error("Unable to update group");
 await sb.from("panel_access_audit").insert({actor_id:actor.id,action:"group.updated",target_type:"group",target_id:data.groupId,detail:patch});
 return {group};
});

export const getPanelState=createServerFn({method:"POST"}).handler(async({data}:{data:{token:string;type:"base"|"engine";channel?:string}})=>{
 readSession(data.token);
 const releaseType=data.type==="base"?"base":"update",channel=normalizeChannel(data.channel),product="orbitfs_base";
 const [releases,channels]=await Promise.all([
  licenseMaster(`/releases?product=${product}&channel=${encodeURIComponent(channel)}&type=${releaseType}&include_archived=true`),
  licenseMaster(`/release-channels?include_disabled=false`)
 ]);
 const sb=authClient();
 const {data:drafts,error:draftError}=await sb.from("panel_release_drafts").select("*").eq("release_type",releaseType).eq("channel",channel).order("updated_at",{ascending:false});
 if(draftError)throw new Error("Unable to load release drafts: "+draftError.message);
 const ids=(drafts||[]).map((x:any)=>x.id);
 let attempts:any[]=[];
 if(ids.length){
  const {data:rows,error:attemptError}=await sb.from("panel_release_attempts").select("*").in("draft_id",ids).order("attempt_number",{ascending:false});
  if(attemptError)throw new Error("Unable to load release attempts: "+attemptError.message);
  attempts=rows||[];
 }
 const grouped=new Map<string,any[]>();
 for(const attempt of attempts){const list=grouped.get(attempt.draft_id)||[];list.push(attempt);grouped.set(attempt.draft_id,list)}
 const releaseDrafts=(drafts||[]).map((draft:any)=>({...draft,attempts:grouped.get(draft.id)||[]}));
 const availableChannels=Array.isArray(channels?.channels)?channels.channels.filter((x:any)=>x?.enabled===true).map((x:any)=>String(x.channel).trim().toLowerCase()).filter(Boolean):[];
 return {releases:releases?.releases||[],drafts:releaseDrafts,channels:availableChannels,selectedChannel:channel,masterUrl:masterUrl(),product,repositories:{base:{repo:BASE_REPO,ref:BASE_REF,workerRepo:BASE_WORKER_REPO,workerRef:BASE_WORKER_REF,workflow:BASE_WORKFLOW},engine:{repo:ENGINE_REPO,ref:ENGINE_REF,workflow:ENGINE_WORKFLOW}}};
});


export const saveReleaseDraft=createServerFn({method:"POST"}).handler(async({data}:{data:{token:string;draftId?:string|null;type:"base"|"engine";version:string;channel:string;notes?:string;components?:string[];minimumBaseVersion?:string;protocol?:string;changelogTemplate?:string;changelogDraft?:string;sourceSha?:string|null}})=>{
 const actor=readSession(data.token);
 const version=String(data.version||"").trim();
 if(!/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/.test(version))throw new Error("Version must be valid SemVer, e.g. 1.2.3");
 const channel=normalizeChannel(data.channel||"stable");
 const releaseType=data.type==="base"?"base":"update";
 const repo=data.type==="base"?BASE_REPO:ENGINE_REPO;
 const ref=data.type==="base"?BASE_REF:ENGINE_REF;
 const components=data.type==="base"?["base"]:[...new Set((data.components||[]).map(x=>String(x).trim().toLowerCase()).filter(x=>["base","apex","mcp","studio"].includes(x)))];
 if(data.type==="engine"&&!components.length)throw new Error("Select at least one Update component before saving.");
 const expectedTemplate=data.type==="base"?"base_deployment_log":"update_changelog";
 const template=String(data.changelogTemplate||expectedTemplate);
 if(template!==expectedTemplate)throw new Error("Invalid release document template for this release type.");
 const inputs={
   notes:String(data.notes||"").trim(),
   components,
   minimumBaseVersion:data.type==="engine"?String(data.minimumBaseVersion||"").trim():null,
   protocol:data.type==="engine"?String(data.protocol||"").trim():null,
   changelogTemplate:template,
   changelogDraft:String(data.changelogDraft||""),
 };
 const sb=authClient();
 if(data.draftId){
   const {data:existing,error:readError}=await sb.from("panel_release_drafts").select("*").eq("id",data.draftId).single();
   if(readError||!existing)throw new Error("Release draft was not found.");
   if(["building","handed_off"].includes(String(existing.status)))throw new Error("This Stage 1 draft is locked because it is building or has already been handed off.");
   if(existing.archived_at)throw new Error("Restore the draft before editing it.");
   const {data:draft,error}=await sb.from("panel_release_drafts").update({
     version,channel,source_repo:repo,source_ref:ref,source_sha:data.sourceSha||existing.source_sha||null,
     status:"draft",inputs,updated_at:new Date().toISOString()
   }).eq("id",data.draftId).select("*").single();
   if(error)throw new Error(error.code==="23505"?"A Stage 1 draft already exists for this type, version and channel.":"Unable to update release draft: "+error.message);
   return {draft,created:false};
 }
 const {data:draft,error}=await sb.from("panel_release_drafts").insert({
   release_type:releaseType,version,channel,source_repo:repo,source_ref:ref,source_sha:data.sourceSha||null,
   status:"draft",inputs,created_by:actor.email||actor.id
 }).select("*").single();
 if(error)throw new Error(error.code==="23505"?"A Stage 1 draft already exists for this type, version and channel.":"Unable to create release draft: "+error.message);
 return {draft,created:true};
});

export const setReleaseDraftArchived=createServerFn({method:"POST"}).handler(async({data}:{data:{token:string;draftId:string;archived:boolean}})=>{
 readSession(data.token);
 const sb=authClient();
 const {data:existing,error:readError}=await sb.from("panel_release_drafts").select("*").eq("id",data.draftId).single();
 if(readError||!existing)throw new Error("Release draft was not found.");
 if(existing.status==="building")throw new Error("A running build draft cannot be archived.");
 if(existing.status==="handed_off")throw new Error("A handed-off Stage 1 draft is retained as immutable workflow history.");
 const archived=Boolean(data.archived);
 const {data:draft,error}=await sb.from("panel_release_drafts").update({
   status:archived?"archived":"draft",
   archived_at:archived?new Date().toISOString():null,
   updated_at:new Date().toISOString()
 }).eq("id",data.draftId).select("*").single();
 if(error)throw new Error("Unable to "+(archived?"archive":"restore")+" release draft: "+error.message);
 return {draft};
});

export const deleteReleaseDraft=createServerFn({method:"POST"}).handler(async({data}:{data:{token:string;draftId:string}})=>{
 const actor=readSession(data.token);
 if(!["owner","admin"].includes(String(actor.role||"").toLowerCase()))throw new Error("Admin access required to permanently delete a Stage 1 draft.");
 const sb=authClient();
 const {data:existing,error:readError}=await sb.from("panel_release_drafts").select("*").eq("id",data.draftId).single();
 if(readError||!existing)throw new Error("Release draft was not found.");
 if(["building","handed_off"].includes(String(existing.status)))throw new Error("Building or handed-off drafts cannot be deleted.");
 const {error}=await sb.from("panel_release_drafts").delete().eq("id",data.draftId);
 if(error)throw new Error("Unable to delete release draft: "+error.message);
 return {ok:true,id:data.draftId};
});

export const getReleaseLifecycleEvents=createServerFn({method:"POST"}).handler(async({data}:{data:{token:string;limit?:number}})=>{
 readSession(data.token);
 const limit=Math.min(500,Math.max(1,Number(data.limit||200)));
 const sb=authClient();
 const {data:events,error}=await sb.from("panel_release_events").select("*").order("occurred_at",{ascending:false}).limit(limit);
 if(error)throw new Error(error.message||"Unable to load Dev Panel release lifecycle history");
 return {events:events||[]};
});

export const inspectSource=createServerFn({method:"POST"}).handler(async({data}:{data:{token:string;type:"base"|"engine";channel?:string}})=>{
 readSession(data.token);
 const repo=data.type==="base"?BASE_REPO:ENGINE_REPO,ref=data.type==="base"?BASE_REF:ENGINE_REF;
 const releaseType=data.type==="base"?"base":"update";
 const channel=normalizeChannel(data.channel||"stable");
 const branch=await github(`/repos/${repo}/git/ref/heads/${encodeURIComponent(ref)}`);
 const head=branch?.object?.sha;if(!head)throw new Error(`Could not resolve ${repo}@${ref}`);
 let baseline:any=null;
 let baseBaseline:any=null;
 try {
   const baseResult = await licenseMaster(`/releases?product=orbitfs_base&channel=${encodeURIComponent(channel)}&type=base&include_archived=false`);
   baseBaseline=(baseResult?.releases||[])
     .filter((r:any)=>r.review_status==="approved"&&r.status==="published"&&r.source_sha)
     .sort((a:any,b:any)=>new Date(b.published_at||b.created_at||0).getTime()-new Date(a.published_at||a.created_at||0).getTime())[0]||null;
 } catch {}
 try {
   const result=await licenseMaster(`/releases?product=orbitfs_base&channel=${encodeURIComponent(channel)}&type=${releaseType}&include_archived=false`);
   baseline=(result?.releases||[])
     .filter((r:any)=>r.review_status==="approved"&&r.status==="published"&&r.source_sha)
     .sort((a:any,b:any)=>new Date(b.published_at||b.created_at||0).getTime()-new Date(a.published_at||a.created_at||0).getTime())[0]||null;
 } catch {}

 const baselineInfo=baseline?{id:baseline.id,version:baseline.version,sourceSha:baseline.source_sha}:null;
 const baseBaselineInfo=baseBaseline?{id:baseBaseline.id,version:baseBaseline.version,sourceSha:baseBaseline.source_sha}:null;
 const from=baseline?.source_sha||"";

 if(!from){
   const commit=await github(`/repos/${repo}/git/commits/${encodeURIComponent(head)}`);
   const treeSha=commit?.tree?.sha;
   const tree=treeSha?await github(`/repos/${repo}/git/trees/${encodeURIComponent(treeSha)}?recursive=1`):null;
   const files=(tree?.tree||[])
     .filter((entry:any)=>entry.type==="blob"&&entry.path)
     .map((entry:any)=>({filename:String(entry.path),status:"snapshot",additions:0,deletions:0,changes:0,size:Number(entry.size||0)}));
   return {repo,ref,head,baseline:null,baseBaseline:baseBaselineInfo,initialRelease:true,inspectionMode:"full_snapshot",files,commits:[]};
 }

 if(from===head)return {repo,ref,head,baseline:baselineInfo,baseBaseline:baseBaselineInfo,initialRelease:false,inspectionMode:"compare",files:[],commits:[]};
 const cmp=await github(`/repos/${repo}/compare/${encodeURIComponent(from)}...${encodeURIComponent(head)}`);
 return {repo,ref,head,baseline:baselineInfo,baseBaseline:baseBaselineInfo,initialRelease:false,inspectionMode:"compare",files:(cmp?.files||[]).map((f:any)=>({filename:f.filename,status:f.status,additions:f.additions,deletions:f.deletions,changes:f.changes})),commits:cmp?.commits||[]};
});

export const getReleaseHandoff=createServerFn({method:"POST"}).handler(async({data}:{data:{token:string;type:"base"|"engine";version:string;channel:string}})=>{  readSession(data.token);  const product="orbitfs_base";  const releaseType=data.type==="base"?"base":"update";  const channel=normalizeChannel(data.channel);  const result=await licenseMaster(`/releases?product=${product}&channel=${encodeURIComponent(channel)}&type=${releaseType}&include_archived=false`);  const release=(result?.releases||[]).find((r:any)=>String(r.version)===String(data.version)&&!r.archived_at);  return {release:release||null,product,releaseType,channel};});export const getReleaseRun=createServerFn({method:"POST"}).handler(async({data}:{data:{token:string;repo:string;runId?:number}})=>{
  readSession(data.token);
  const repo=String(data.repo||"").trim();
  if(!allowedRepos.has(repo))throw new Error("Release repository is not allowed");
  if(data.runId){
    const run=await github("/repos/"+repo+"/actions/runs/"+data.runId);
    const jobsResult=await github("/repos/"+repo+"/actions/runs/"+data.runId+"/jobs?per_page=100");
    const jobs=await Promise.all((jobsResult?.jobs||[]).map(async(job:any)=>{
      let failure:any=null;
      if(job.conclusion==="failure"){
        try{
          const logs=await operationsGithubText("/repos/"+repo+"/actions/jobs/"+job.id+"/logs");
          failure=extractOperationFailure(logs)||fallbackOperationFailure(job,logs);
        }catch(error:any){
          failure={error:error?.message||"Workflow job failed.",preceding:[],lines:["Unable to retrieve GitHub job logs.",error?.message||"Unknown log error"]};
        }
      }
      return {...job,failure};
    }));
    const failedJob=jobs.find((job:any)=>job.conclusion==="failure");
    const failure=failedJob?.failure||null;
    const completed=["success","failure","cancelled","skipped"].includes(String(run?.conclusion||""));
    if(completed){
      const sb=authClient();
      const outcome=String(run.conclusion||"failure");
      const errorText=failure?.lines?.join("\n")||failure?.error||null;
      await sb.from("panel_release_attempts").update({status:outcome,error_summary:failure?.error||null,error_output:errorText,completed_at:new Date().toISOString(),run_url:run.html_url||null}).eq("run_id",data.runId);
      await sb.from("panel_release_drafts").update({status:outcome==="success"?"handed_off":"draft",last_error:outcome==="success"?null:errorText,last_run_url:run.html_url||null,updated_at:new Date().toISOString()}).eq("last_run_id",data.runId);
    }else{
      const sb=authClient();
      await sb.from("panel_release_attempts").update({status:"in_progress",run_url:run.html_url||null}).eq("run_id",data.runId);
      await sb.from("panel_release_drafts").update({status:"building",last_run_url:run.html_url||null,updated_at:new Date().toISOString()}).eq("last_run_id",data.runId);
    }
    return {run,jobs,failure};
  }
  throw new Error("Release workflow run is not available yet");
});

export const startRelease=createServerFn({method:"POST"}).handler(async({data}:{data:{token:string;type:"base"|"engine";version:string;channel:string;notes:string;changelogDraft:string;files:any[];components:string[];minimumBaseVersion:string;protocol:string;changelogTemplate:string}})=>{
 const actor=readSession(data.token);
 const version=data.version.trim();
 if(!/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/.test(version))throw new Error("Version must be valid SemVer, e.g. 1.2.3");
 if(data.type==="engine"&&!data.components.length)throw new Error("Select at least one update target (Base, Apex, MCP, or Studio).");
 const channel=normalizeChannel(data.channel);
 const expectedTemplate = data.type === "base" ? "base_deployment_log" : "update_changelog";
 if (data.changelogTemplate !== expectedTemplate) throw new Error(`Use the ${expectedTemplate === "base_deployment_log" ? "Base Deployment Log" : "Update Changelog"} template for this release type.`);
 const channels=await licenseMaster(`/release-channels?include_disabled=false`);
 const channelEnabled=Array.isArray(channels?.channels)&&channels.channels.some((x:any)=>String(x.channel).trim().toLowerCase()===channel&&x.enabled===true);
 if(!channelEnabled)throw new Error("Release channel is not configured or is disabled in License Master: "+channel);
 const repo=data.type==="base"?BASE_REPO:ENGINE_REPO;
 const ref=data.type==="base"?BASE_REF:ENGINE_REF;
 const workerRepo=data.type==="base"?BASE_WORKER_REPO:ENGINE_REPO;
 const workerRef=data.type==="base"?BASE_WORKER_REF:ENGINE_REF;
 const workflow=data.type==="base"?BASE_WORKFLOW:ENGINE_WORKFLOW;
 if (data.type === "engine") {
  const minimumBaseVersion=String(data.minimumBaseVersion||"").trim();
  const protocol=Number(data.protocol||"");
  if(!/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/.test(minimumBaseVersion))throw new Error("Minimum Base version must be valid SemVer.");
  if(!Number.isInteger(protocol)||protocol<1||protocol>100)throw new Error("Minimum deployer protocol must be an integer from 1 to 100.");
  const baseResult = await licenseMaster(`/releases?product=orbitfs_base&channel=${encodeURIComponent(channel)}&type=base&include_archived=false`);
  const publishedBase = (baseResult?.releases || []).some((r:any) => r.status === "published" && r.review_status === "approved" && !r.archived_at && String(r.version)===minimumBaseVersion && String(r.channel||"stable")===channel);
  if (!publishedBase) throw new Error(`Published, technically approved OrbitFS Base ${minimumBaseVersion} is required in channel ${channel} before creating this Update.`);
 }
 const previousResult = data.type === "base"
  ? await licenseMaster(`/releases?product=orbitfs_base&channel=${encodeURIComponent(channel)}&type=base&include_archived=false`)
  : await licenseMaster(`/releases?product=orbitfs_base&channel=${encodeURIComponent(channel)}&type=update&include_archived=false`);
 const previousRelease = (previousResult?.releases || [])
  .filter((r:any) => r.review_status === "approved" && r.status === "published" && r.source_sha)
  .sort((a:any,b:any) => new Date(b.published_at || b.created_at || 0).getTime() - new Date(a.published_at || a.created_at || 0).getTime())[0];

 // Stage 1 is authoritative about the source snapshot sent to the worker.
 // Do not trust stale browser state for changed files or the previous commit.
 const branch = await github(`/repos/${repo}/git/ref/heads/${encodeURIComponent(ref)}`);
 const head = branch?.object?.sha;
 if (!head) throw new Error(`Could not resolve ${repo}@${ref}`);
 const previousSourceCommit = previousRelease?.source_sha || "";
 const initialRelease = data.type === "base" && !previousSourceCommit;
 let detectedFiles:any[] = [];
 if (initialRelease) {
   const commit=await github(`/repos/${repo}/git/commits/${encodeURIComponent(head)}`);
   const treeSha=commit?.tree?.sha;
   const tree=treeSha?await github(`/repos/${repo}/git/trees/${encodeURIComponent(treeSha)}?recursive=1`):null;
   detectedFiles=(tree?.tree||[])
     .filter((entry:any)=>entry.type==="blob"&&entry.path)
     .map((entry:any)=>({filename:String(entry.path),status:"snapshot",additions:0,deletions:0,changes:0,size:Number(entry.size||0)}));
 } else if (previousSourceCommit && previousSourceCommit !== head) {
   const cmp = await github(`/repos/${repo}/compare/${encodeURIComponent(previousSourceCommit)}...${encodeURIComponent(head)}`);
   detectedFiles = (cmp?.files || []).map((f:any)=>({
     filename:f.filename,
     status:f.status,
     additions:f.additions,
     deletions:f.deletions,
     changes:f.changes,
   }));
 }

 if (data.type === "engine" && previousSourceCommit && previousSourceCommit === head) {
   throw new Error("No source changes detected since the last approved Engine release.");
 }

 const selectedComponents = data.type === "engine"
   ? [...new Set((data.components || []).map((x:string)=>String(x).trim().toLowerCase()).filter((x:string)=>["base","apex","mcp","studio"].includes(x)))]
   : ["base"];

 const dispatchFileLimit = data.type === "base" ? 100 : detectedFiles.length;
 const dispatchFiles = initialRelease ? [] : detectedFiles.slice(0, dispatchFileLimit);
 const releaseRecord = {
  format: "orbitfs-release-record-v1",
  releaseType: data.type === "base" ? "base" : "update",
  product: "orbitfs_base",
  version,
  channel,
  sourceRepository: repo,
  sourceRef: ref,
  previousSourceCommit: previousSourceCommit || null,
  detectedSourceChanges: detectedFiles.length,
  inspectionMode: initialRelease ? "full_snapshot" : "compare",
  initialRelease,
  changedFiles: dispatchFiles,
  changedFilesTruncated: detectedFiles.length > dispatchFiles.length,
  components: selectedComponents,
  minimumBaseVersion: data.type === "engine" ? (data.minimumBaseVersion || "1.0.0") : null,
  minimumDeployerProtocol: data.type === "engine" ? (data.protocol || "1") : null,
  notes: data.notes.trim(),
  changelogTemplate: data.changelogTemplate,
  generatedAt: new Date().toISOString(),
 };
 const generatedChangelog=String(data.changelogDraft||"").trim();
 if(!generatedChangelog)throw new Error("Review the generated changelog before sending the release.");
 const inputs:any={
  version,
  channel,
  notes:generatedChangelog,
  changed_files:JSON.stringify(dispatchFiles),
  previous_source_commit:previousSourceCommit,
 };
 if(data.type==="base") Object.assign(inputs,{release_record:JSON.stringify(releaseRecord),source_repo:repo,source_ref:ref,source_sha:head});
 if(data.type==="engine")Object.assign(inputs,{base:String(selectedComponents.includes("base")),apex:String(selectedComponents.includes("apex")),mcp:String(selectedComponents.includes("mcp")),studio:String(selectedComponents.includes("studio")),minimum_base_version:data.minimumBaseVersion||"1.0.0",minimum_deployer_protocol:data.protocol||"1"});
 const dispatchBytes=Buffer.byteLength(JSON.stringify({ref:workerRef,inputs}),"utf8");
 if(dispatchBytes>50000)throw new Error(`Release control payload is still too large for GitHub Actions (${dispatchBytes} bytes). Shorten the release notes and inspect again.`);
 const releaseType=data.type==="base"?"base":"update";
 const sb=authClient();
 const {data:existing,error:existingError}=await sb.from("panel_release_drafts").select("*").eq("release_type",releaseType).eq("version",version).eq("channel",channel).maybeSingle();
 if(existingError)throw new Error("Unable to resolve release draft: "+existingError.message);
 if(existing&&["archived","rejected"].includes(String(existing.status)))throw new Error("This release draft is closed. Use a new version instead of creating another attempt.");
 const inputSnapshot={type:data.type,version,channel,notes:data.notes.trim(),changelogDraft:generatedChangelog,components:selectedComponents,minimumBaseVersion:data.minimumBaseVersion||null,protocol:data.protocol||null,changelogTemplate:data.changelogTemplate,sourceSha:head,changedFiles:detectedFiles};
 let draft:any=existing;
 if(!draft){
   const {data:created,error:createError}=await sb.from("panel_release_drafts").insert({release_type:releaseType,version,channel,source_repo:repo,source_ref:ref,source_sha:head,status:"draft",inputs:inputSnapshot,created_by:actor.email||actor.id}).select("*").single();
   if(createError)throw new Error("Unable to create release draft: "+createError.message);
   draft=created;
 }
 const attemptNumber=Number(draft.latest_attempt||0)+1;
 const {error:draftUpdateError}=await sb.from("panel_release_drafts").update({status:"building",latest_attempt:attemptNumber,last_error:null,source_sha:head,inputs:inputSnapshot,updated_at:new Date().toISOString()}).eq("id",draft.id);
 if(draftUpdateError)throw new Error("Unable to prepare release attempt: "+draftUpdateError.message);
 const {data:attemptRow,error:attemptCreateError}=await sb.from("panel_release_attempts").insert({draft_id:draft.id,attempt_number:attemptNumber,status:"queued"}).select("*").single();
 if(attemptCreateError)throw new Error("Unable to create release attempt: "+attemptCreateError.message);

 const dispatchedAt=Date.now();
 let runId:number|undefined;
 let runUrl:string|undefined;
 try{
   await github(`/repos/${workerRepo}/actions/workflows/${encodeURIComponent(workflow)}/dispatches`,{method:"POST",body:JSON.stringify({ref:workerRef,inputs})});
   for(let attempt=0;attempt<5&&!runId;attempt++){
     await new Promise(r=>setTimeout(r,700));
     try{
       const runs=await github(`/repos/${workerRepo}/actions/workflows/${encodeURIComponent(workflow)}/runs?event=workflow_dispatch&branch=${encodeURIComponent(workerRef)}&per_page=10`);
       const candidate=(runs?.workflow_runs||[]).filter((r:any)=>r.head_branch===workerRef&&new Date(r.created_at||0).getTime()>=dispatchedAt-5000).sort((a:any,b:any)=>new Date(b.created_at||0).getTime()-new Date(a.created_at||0).getTime())[0];
       runId=candidate?.id;
       runUrl=candidate?.html_url;
     }catch{}
   }
 }catch(error:any){
   const message=error?.message||"Unable to dispatch release workflow.";
   await sb.from("panel_release_attempts").update({status:"failure",error_summary:message,error_output:message,completed_at:new Date().toISOString()}).eq("id",attemptRow.id);
   await sb.from("panel_release_drafts").update({status:"draft",last_error:message,updated_at:new Date().toISOString()}).eq("id",draft.id);
   throw error;
 }
 if(runId){
   await sb.from("panel_release_attempts").update({run_id:runId,run_url:runUrl||null,status:"queued"}).eq("id",attemptRow.id);
   await sb.from("panel_release_drafts").update({last_run_id:runId,last_run_url:runUrl||null,status:"building",updated_at:new Date().toISOString()}).eq("id",draft.id);
 }
 return {ok:true,repo:workerRepo,ref:workerRef,sourceRepo:repo,sourceRef:ref,sourceSha:head,workflow,channel,runId:runId||null,draftId:draft.id,attemptNumber};
});


export const getControlState=createServerFn({method:"POST"}).handler(async({data}:{data:{token:string}})=>{
 readSession(data.token);
 const [base,updates,channels,audit]=await Promise.all([
  licenseMaster('/releases?product=orbitfs_base&type=base&include_archived=true'),
  licenseMaster('/releases?product=orbitfs_base&type=update&include_archived=true'),
  licenseMaster('/release-channels?include_disabled=true'),
  licenseMaster('/audit-events?limit=100')
 ]);
 return {
  releases:[...(base?.releases||[]),...(updates?.releases||[])].sort((a:any,b:any)=>new Date(b.created_at||0).getTime()-new Date(a.created_at||0).getTime()),
  channels:channels?.channels||[],
  audit:audit?.events||[],
  repositories:{base:{repo:BASE_REPO,ref:BASE_REF,workerRepo:BASE_WORKER_REPO,workerRef:BASE_WORKER_REF,workflow:BASE_WORKFLOW},engine:{repo:ENGINE_REPO,ref:ENGINE_REF,workflow:ENGINE_WORKFLOW}},
  masterUrl:masterUrl()
 };
});

export const controlRelease=createServerFn({method:"POST"}).handler(async({data}:{data:{token:string;releaseId:string;action:"approve"|"reject"|"rollback"|"revert"|"withdraw"|"archive"|"restore";reason?:string}})=>{
 const actor=readSession(data.token);
 if(!["owner","admin"].includes(String(actor.role).toLowerCase()))throw new Error("Admin access required");
 const id=String(data.releaseId||"").trim();
 if(!id)throw new Error("Release ID is required");
 const action=String(data.action||"").trim().toLowerCase();
 if(!["approve","reject","rollback","revert","withdraw","archive","restore"].includes(action))throw new Error("Unsupported release action");
 const reason=String(data.reason||"").trim();
 if(["rollback","revert","archive"].includes(action)&&!reason)throw new Error("A reason is required so this lifecycle change remains auditable.");
 const result=await licenseMaster(`/releases/${encodeURIComponent(id)}`,{method:"POST",body:JSON.stringify({action,reason:reason||undefined})});
 return result;
});

export const getChannelsState=createServerFn({method:"POST"}).handler(async({data}:{data:{token:string}})=>{
 readSession(data.token);
 const channels=await licenseMaster('/release-channels?include_disabled=true');
 return {channels:channels?.channels||[],warnings:[]};
});

export const getAuditState=createServerFn({method:"POST"}).handler(async({data}:{data:{token:string;limit?:number}})=>{
 readSession(data.token);
 const limit=Math.min(200,Math.max(1,Number(data.limit||100)));
 const result=await licenseMaster(`/audit-events?limit=${limit}`);
 return {events:result?.events||[]};
});

export const getRepositoryStatus=createServerFn({method:"POST"}).handler(async({data}:{data:{token:string}})=>{
 readSession(data.token);
 const configs=[
  {key:"base",repo:BASE_REPO,ref:BASE_REF,workflow:BASE_WORKFLOW},
  {key:"engine",repo:ENGINE_REPO,ref:ENGINE_REF,workflow:ENGINE_WORKFLOW},
 ];
 const rows:any[]=[];
 for(const cfg of configs){
  let head:any=null,run:any=null;
  try{const branch=await github(`/repos/${cfg.repo}/git/ref/heads/${encodeURIComponent(cfg.ref)}`);head=branch?.object?.sha||null;}catch{}
  try{
   const runs=await github(`/repos/${cfg.repo}/actions/workflows/${encodeURIComponent(cfg.workflow)}/runs?branch=${encodeURIComponent(cfg.ref)}&per_page=1`);
   run=(runs?.workflow_runs||[])[0]||null;
  }catch{}
  rows.push({...cfg,head,run});
 }
 return {repositories:rows};
});

export const getPortalMonitor=createServerFn({method:"POST"}).handler(async({data}:{data:{token:string}})=>{
 readSession(data.token);
 const [base,updates,channels]=await Promise.all([
  licenseMaster('/releases?product=orbitfs_base&type=base&include_archived=true'),
  licenseMaster('/releases?product=orbitfs_base&type=update&include_archived=true'),
  licenseMaster('/release-channels?include_disabled=true')
 ]);
 const releases=[...(base?.releases||[]),...(updates?.releases||[])];
 return {
  releases,
  published:releases.filter((r:any)=>r.status==="published"&&!r.archived_at),
  channels:channels?.channels||[],
  portalUrl:(process.env.CUSTOMER_PORTAL_URL||process.env.BILLING_STORE_URL||"").replace(/\/+$/,"")
 };
});

async function requestJson(url:string,init:RequestInit={}){
 let r:Response;
 try {
   r=await fetch(url,{...init,cache:"no-store",headers:{accept:"application/json",...(init.body?{"content-type":"application/json"}:{}),...(init.headers||{})}});
 } catch (error:any) {
   throw new Error(`Network request failed: ${url} · ${error?.message || "fetch failed"}`);
 }
 const text=await r.text();
 const contentType=(r.headers.get("content-type")||"").toLowerCase();
 let body:any=null;
 if(text){
   try{ body=JSON.parse(text); }
   catch{
     const looksHtml=contentType.includes("text/html")||/^\\s*<!doctype html/i.test(text)||/^\\s*<html/i.test(text);
     body={error:looksHtml?null:text.trim().slice(0,500)};
   }
 }
 if(!r.ok){
   if(contentType.includes("text/html")||/^\\s*<!doctype html/i.test(text)||/^\\s*<html/i.test(text)){
     throw new Error(`License Master API returned HTTP ${r.status} for ${new URL(url).pathname}. The configured LICENSE_MASTER_URL may point at a deployment that does not expose this API route.`);
   }
   throw new Error(body?.error||body?.message||`Request failed (${r.status}) at ${url}`);
 }
 if(text&&!body){
   throw new Error(`Expected JSON from ${url}, but the response could not be parsed.`);
 }
 return body;
}
async function github(path:string,init:RequestInit={}){
 return requestJson(`https://api.github.com${path}`,{...init,headers:{authorization:`Bearer ${required("ORBITFS_RELEASE_DISPATCH_TOKEN")}`,"x-github-api-version":"2022-11-28",...(init.headers||{})}});
}
async function licenseMaster(path:string,init:RequestInit={}){
 return requestJson(`${masterUrl()}${path}`,{...init,headers:{authorization:`Bearer ${required("LICENSE_MASTER_API_TOKEN")}`,...(init.headers||{})}});
}


const OPERATIONS_CI_WORKFLOW=process.env.OPERATIONS_CI_WORKFLOW||"ci.yml";
const OPERATIONS_DEPLOY_WORKFLOW=process.env.OPERATIONS_DEPLOY_WORKFLOW||"production-deploy.yml";
const OPERATIONS_REPOS={
 licenseManager:{repo:process.env.LICENSE_MANAGER_REPO||"lucaskerim123/Custom-licence-manager",label:"Custom License Manager",ci:OPERATIONS_CI_WORKFLOW,deploy:OPERATIONS_DEPLOY_WORKFLOW},
 billingStore:{repo:process.env.BILLING_STORE_REPO||"lucaskerim123/V2_Billing_Store",label:"V2 Billing Store",ci:OPERATIONS_CI_WORKFLOW,deploy:OPERATIONS_DEPLOY_WORKFLOW},
} as const;

type OperationsSystem=keyof typeof OPERATIONS_REPOS;

function requireOperationsUser(token:string){
 const user=readSession(token);
 if(!["owner","admin","operator"].includes(String(user.role||"").toLowerCase()))throw new Error("Operations access required");
 return user;
}
function operationsConfig(system:string){
 const cfg=OPERATIONS_REPOS[system as OperationsSystem];
 if(!cfg)throw new Error("Unknown Operations system");
 return cfg;
}
function cleanOperationsRun(run:any){
 return run?{id:run.id,status:run.status,conclusion:run.conclusion,run_number:run.run_number,head_sha:run.head_sha,created_at:run.created_at,updated_at:run.updated_at,html_url:run.html_url,name:run.name}:null;
}
async function operationsGithubText(path:string){
 const token=required("ORBITFS_RELEASE_DISPATCH_TOKEN");
 const response=await fetch("https://api.github.com"+path,{headers:{accept:"application/vnd.github+json",authorization:"Bearer "+token,"x-github-api-version":process.env.GITHUB_API_VERSION||"2022-11-28"},cache:"no-store",redirect:"follow"});
 const text=await response.text();
 if(response.status===404&&/\/actions\/jobs\/\d+\/logs(?:\?|$)/.test(path))return "";
 if(!response.ok){
  let detail="";
  try{const body=JSON.parse(text);detail=String(body?.message||"")}catch{}
  throw new Error("GitHub API returned HTTP "+response.status+(detail?" · "+detail:"")+" for "+path+".");
 }
 return text;
}
function cleanOperationLogLine(line:string){
 return line.replace(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z\s*/,"").replace(/^.*?##\[error\]\s*/,"").trim();
}
function extractOperationFailure(log:string){
 const lines=String(log||"").split(/\r?\n/).map(x=>x.trimEnd()).filter(Boolean);
 const pattern=/##\[error\]|(?:npm ERR!|pnpm ERR!|yarn error|Error:|error TS\d+|Type error|Build failed|failed with|Process completed with exit code|ELIFECYCLE|Expected .+ got|SyntaxError|ReferenceError|Module not found|Cannot find module|ENOENT|EADDRINUSE|ERR_[A-Z_]+|fatal:|FATAL|ERROR)/i;
 const hits:number[]=[];
 for(let i=0;i<lines.length;i++)if(pattern.test(lines[i]))hits.push(i);
 if(!hits.length)return null;
 const selected:string[]=[];const seen=new Set<string>();
 for(const i of hits)for(const line of lines.slice(Math.max(0,i-8),Math.min(lines.length,i+4))){const clean=cleanOperationLogLine(line);if(clean&&!seen.has(clean)){seen.add(clean);selected.push(clean)}}
 return {error:selected[selected.length-1]||"Workflow job failed.",preceding:[],lines:selected.slice(-120)};
}
function fallbackOperationFailure(job:any,logTail:string){
 if(job.conclusion!=="failure")return null;
 const lines:string[]=[];
 for(const step of job.steps||[])if(step.conclusion==="failure")lines.push("Failed step: "+step.name);
 lines.push(...String(logTail||"").split(/\r?\n/).map(cleanOperationLogLine).filter(Boolean).slice(-80));
 const unique=[...new Set(lines)].slice(-120);
 if(!unique.length)unique.push("GitHub reported this job as failed, but no console log text was available yet.");
 return {error:unique[unique.length-1],preceding:[],lines:unique};
}
async function operationsRunDetail(cfg:(typeof OPERATIONS_REPOS)[OperationsSystem]){
 const [ciRows,deployRows,deploySuccessRows,ref]=await Promise.all([
  github("/repos/"+cfg.repo+"/actions/workflows/"+cfg.ci+"/runs?branch=main&per_page=1"),
  github("/repos/"+cfg.repo+"/actions/workflows/"+cfg.deploy+"/runs?branch=main&per_page=1"),
  github("/repos/"+cfg.repo+"/actions/workflows/"+cfg.deploy+"/runs?branch=main&status=success&per_page=1"),
  github("/repos/"+cfg.repo+"/git/ref/heads/main"),
 ]);
 const ciRun=ciRows?.workflow_runs?.[0]||null;
 const deployRun=deployRows?.workflow_runs?.[0]||null;
 const deployedRun=deploySuccessRows?.workflow_runs?.[0]||null;
 const run=[ciRun,deployRun].filter(Boolean).find((x:any)=>x.status!=="completed")||ciRun||deployRun||null;
 const currentSha=String(ref?.object?.sha||"");
 const deployedSha=String(deployedRun?.head_sha||"");
 const productionCurrent=!!currentSha&&!!deployedSha&&currentSha===deployedSha;
 if(!run)return {repo:cfg.repo,label:cfg.label,currentSha,deployedSha,productionCurrent,run:null,latestDeployment:cleanOperationsRun(deployedRun),latestDeploymentAttempt:cleanOperationsRun(deployRun),jobs:[],failure:null,chatPrompt:null,monitoring:"Workflow"};
 const jobsResult=await github("/repos/"+cfg.repo+"/actions/runs/"+run.id+"/jobs?per_page=100");
 const jobs=await Promise.all((jobsResult?.jobs||[]).map(async(job:any)=>{
  let failure:any=null,logTail="",logError="";
  if(job.status==="completed"){
   try{
    const logs=await operationsGithubText("/repos/"+cfg.repo+"/actions/jobs/"+job.id+"/logs");
    if(logs){
     const lines=logs.split(/\r?\n/).filter(Boolean);
     logTail=lines.slice(-250).join("\n");
     if(job.conclusion==="failure")failure=extractOperationFailure(logs);
    }else{
     logError="GitHub has not exposed the final job log yet.";
    }
   }catch(error:any){logError=error?.message||"Unable to retrieve GitHub job logs."}
  }else{
   logTail=(job.steps||[]).map((s:any)=>`${s.status==="completed"?(s.conclusion==="success"?"✓":s.conclusion==="failure"?"✕":"•"):"…"} ${s.name} · ${s.status}${s.conclusion?" · "+s.conclusion:""}`).join("\n");
  }
  if(job.conclusion==="failure"&&!failure)failure=fallbackOperationFailure(job,logTail);
  return {id:job.id,name:job.name,status:job.status,conclusion:job.conclusion,started_at:job.started_at,completed_at:job.completed_at,html_url:job.html_url,steps:(job.steps||[]).map((s:any)=>({name:s.name,status:s.status,conclusion:s.conclusion,started_at:s.started_at,completed_at:s.completed_at})),failure,logTail,logError};
 }));
 const failedJob=jobs.find((j:any)=>j.conclusion==="failure");
 const failure=failedJob?.failure||null;
 const chatPrompt=failure?[
  "Fix this failed GitHub Actions job.","",
  "Repository: https://github.com/"+cfg.repo,
  "Branch: main",
  "Commit: "+run.head_sha,
  "Workflow: "+(run.name||"Unknown"),
  "Run: "+(failedJob?.html_url||run.html_url),
  "Failed job: "+(failedJob?.name||"Unknown"),"",
  "Captured error/output:",...failure.lines,"",
  "Trace the root cause in the repository, fix the implementation rather than masking the failure, and run the relevant validation/build checks. Do not deploy automatically.",
 ].join("\n"):null;
 return {repo:cfg.repo,label:cfg.label,currentSha,deployedSha,productionCurrent,run:cleanOperationsRun(run),ciRun:cleanOperationsRun(ciRun),deployRun:cleanOperationsRun(deployRun),latestDeployment:cleanOperationsRun(deployedRun),latestDeploymentAttempt:cleanOperationsRun(deployRun),jobs,failure,chatPrompt,monitoring:run.name||"Workflow"};
}

export const getOperationsState=createServerFn({method:"POST"}).handler(async({data}:{data:{token:string}})=>{
 requireOperationsUser(data.token);
 const entries=await Promise.all((Object.keys(OPERATIONS_REPOS) as OperationsSystem[]).map(async key=>[key,await operationsRunDetail(OPERATIONS_REPOS[key])] as const));
 return {checkedAt:new Date().toISOString(),systems:Object.fromEntries(entries)};
});

async function findOperationsRun(cfg:(typeof OPERATIONS_REPOS)[OperationsSystem],workflow:string,startedAt:number){
 for(let attempt=0;attempt<8;attempt++){
  const runs=await github("/repos/"+cfg.repo+"/actions/workflows/"+workflow+"/runs?branch=main&per_page=5");
  const run=(runs?.workflow_runs||[]).find((x:any)=>new Date(x.created_at).getTime()>=startedAt-2000);
  if(run)return cleanOperationsRun(run);
  await new Promise(resolve=>setTimeout(resolve,750));
 }
 return null;
}

export const runOperation=createServerFn({method:"POST"}).handler(async({data}:{data:{token:string;system:OperationsSystem;action:"ci"|"deploy"|"override-deploy"}})=>{
 requireOperationsUser(data.token);
 const cfg=operationsConfig(data.system);
 const action=String(data.action||"");
 if(!["ci","deploy","override-deploy"].includes(action))throw new Error("Unknown Operations action");
 const workflow=action==="ci"?cfg.ci:cfg.deploy;
 if(action==="deploy"){
  const [latest,latestDeploy,ref]=await Promise.all([
   github("/repos/"+cfg.repo+"/actions/workflows/"+cfg.ci+"/runs?branch=main&per_page=1"),
   github("/repos/"+cfg.repo+"/actions/workflows/"+cfg.deploy+"/runs?branch=main&status=success&per_page=1"),
   github("/repos/"+cfg.repo+"/git/ref/heads/main"),
  ]);
  const latestRun=latest?.workflow_runs?.[0],deployedRun=latestDeploy?.workflow_runs?.[0],mainSha=String(ref?.object?.sha||"");
  if(deployedRun?.head_sha===mainSha)throw new Error("No deployment needed. The latest main commit is already deployed to production.");
  if(!latestRun||latestRun.status!=="completed"||latestRun.conclusion!=="success"||latestRun.head_sha!==mainSha)throw new Error("Deploy is blocked until the current main commit has a successful CI/preflight run. A CI run for an older commit cannot be reused.");
 }
 const startedAt=Date.now();
 await github("/repos/"+cfg.repo+"/actions/workflows/"+workflow+"/dispatches",{method:"POST",body:JSON.stringify({ref:"main"})});
 const run=await findOperationsRun(cfg,workflow,startedAt);
 return {ok:true,run,action,system:data.system,message:cfg.label+" "+(action==="ci"?"CI":action==="override-deploy"?"OVERRIDE DEPLOY":"production deployment")+" queued."};
});

async function operationsFullTree(repo:string,treeSha:string,prefix=""){
 const root=await github("/repos/"+repo+"/git/trees/"+treeSha);
 const files:any[]=[];
 for(const item of root?.tree||[]){const path=prefix?prefix+"/"+item.path:item.path;if(item.type==="tree")files.push(...await operationsFullTree(repo,item.sha,path));else files.push({...item,path})}
 return files;
}
async function operationsAllCompareCommits(repo:string,base:string,head:string){
 const all:any[]=[];
 for(let page=1;page<=100;page++){const rows=await github("/repos/"+repo+"/compare/"+base+"..."+head+"?per_page=100&page="+page);const commits=rows?.commits||[];all.push(...commits);if(commits.length<100)break}
 return all;
}
export const getOperationsScan=createServerFn({method:"POST"}).handler(async({data}:{data:{token:string;system:OperationsSystem}})=>{
 requireOperationsUser(data.token);
 const cfg=operationsConfig(data.system);
 const ref=await github("/repos/"+cfg.repo+"/git/ref/heads/main");
 const currentSha=String(ref?.object?.sha||"");
 if(!currentSha)throw new Error("Unable to resolve main branch for "+cfg.repo+".");
 const [deploySuccess,ciSuccess]=await Promise.all([
  github("/repos/"+cfg.repo+"/actions/workflows/"+cfg.deploy+"/runs?branch=main&status=success&per_page=1"),
  github("/repos/"+cfg.repo+"/actions/workflows/"+cfg.ci+"/runs?branch=main&status=success&per_page=1"),
 ]);
 const deployedRun=deploySuccess?.workflow_runs?.[0]||null;
 const baselineSha=deployedRun?.head_sha||ciSuccess?.workflow_runs?.[0]?.head_sha||null;
 let commits:any[]=[],changedFiles:any[]=[];
 if(baselineSha&&baselineSha!==currentSha){
  commits=await operationsAllCompareCommits(cfg.repo,baselineSha,currentSha);
  const [baseCommit,currentCommit]=await Promise.all([github("/repos/"+cfg.repo+"/commits/"+baselineSha),github("/repos/"+cfg.repo+"/commits/"+currentSha)]);
  const [baseFiles,currentFiles]=await Promise.all([operationsFullTree(cfg.repo,baseCommit.commit.tree.sha),operationsFullTree(cfg.repo,currentCommit.commit.tree.sha)]);
  const baseMap=new Map(baseFiles.map((x:any)=>[x.path,x])),currentMap=new Map(currentFiles.map((x:any)=>[x.path,x]));
  for(const path of new Set([...baseMap.keys(),...currentMap.keys()])){const before:any=baseMap.get(path),after:any=currentMap.get(path);if(!before)changedFiles.push({path,status:"added",sha:after.sha,size:after.size??null});else if(!after)changedFiles.push({path,status:"deleted",sha:null,size:null});else if(before.sha!==after.sha||before.mode!==after.mode)changedFiles.push({path,status:"modified",sha:after.sha,size:after.size??null})}
  changedFiles.sort((a,b)=>a.path.localeCompare(b.path));
 }
 return {key:data.system,label:cfg.label,repo:cfg.repo,branch:"main",currentSha,baselineSha,baselineSource:deployedRun?"production-deployment":"successful-ci",productionCurrent:!!deployedRun&&currentSha===deployedRun.head_sha,updateAvailable:currentSha!==baselineSha,commits:commits.map((c:any)=>({sha:c.sha,html_url:c.html_url,message:String(c.commit?.message||"").split("\n")[0],author:c.commit?.author?.name||c.author?.login||"Unknown",date:c.commit?.author?.date||c.commit?.committer?.date||null})).reverse(),commitCount:commits.length,changedFiles,changedFileCount:changedFiles.length,completeFileScan:true,checkedAt:new Date().toISOString()};
});
