import { createServerFn } from "@tanstack/react-start";
import { createClient } from "@supabase/supabase-js";
import crypto from "node:crypto";

const BASE_REPO=process.env.BASE_RELEASE_REPO||"lucaskerim123/V1-vercel-base";
const BASE_REF=process.env.BASE_RELEASE_REF||"base-release";
const ENGINE_REPO=process.env.ENGINE_RELEASE_REPO||"lucaskerim123/V1-vercel-engine";
const ENGINE_REF=process.env.ENGINE_RELEASE_REF||"UPDATE_RELEASE";
const BASE_WORKFLOW=process.env.BASE_RELEASE_WORKFLOW||"release-to-license-master.yml";
const ENGINE_WORKFLOW=process.env.ENGINE_RELEASE_WORKFLOW||"publish-engine-release.yml";

const required=(name:string)=>{const v=process.env[name];if(!v)throw new Error(`Missing server environment variable: ${name}`);return v};
const masterUrl=()=> (process.env.LICENSE_MASTER_URL||"https://incendiarynetworks.cc/api").replace(/\/+$/,"");

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

export const getPanelState=createServerFn({method:"POST"}).handler(async({data}:{data:{token:string;type:"base"|"engine";channel?:string}})=>{
 readSession(data.token);
 const releaseType=data.type==="base"?"base":"update",channel=data.channel||"stable",product=data.type==="base"?"orbitfs_base":"orbitfs_engine";
 const releases=await licenseMaster(`/v1/releases?product=${product}&channel=${encodeURIComponent(channel)}&type=${releaseType}&include_archived=true`);
 return {releases:releases?.releases||[],masterUrl:masterUrl(),product,repositories:{base:{repo:BASE_REPO,ref:BASE_REF,workflow:BASE_WORKFLOW},engine:{repo:ENGINE_REPO,ref:ENGINE_REF,workflow:ENGINE_WORKFLOW}}};
});

export const inspectSource=createServerFn({method:"POST"}).handler(async({data}:{data:{token:string;type:"base"|"engine";from?:string}})=>{
 readSession(data.token);
 const repo=data.type==="base"?BASE_REPO:ENGINE_REPO,ref=data.type==="base"?BASE_REF:ENGINE_REF;
 const branch=await github(`/repos/${repo}/git/ref/heads/${encodeURIComponent(ref)}`);
 const head=branch?.object?.sha;if(!head)throw new Error(`Could not resolve ${repo}@${ref}`);
 if(!data.from)return {repo,ref,head,files:[],commits:[]};
 const cmp=await github(`/repos/${repo}/compare/${encodeURIComponent(data.from)}...${encodeURIComponent(head)}`);
 return {repo,ref,head,files:(cmp?.files||[]).map((f:any)=>({filename:f.filename,status:f.status,additions:f.additions,deletions:f.deletions,changes:f.changes})),commits:cmp?.commits||[]};
});

export const getReleaseRun=createServerFn({method:"POST"}).handler(async({data}:{data:{token:string;repo:string;runId?:number}})=>{\n  readSession(data.token);\n  const repo=String(data.repo||"").trim();\n  if(!repo.includes("/"))throw new Error("Invalid release repository");\n  if(data.runId){\n    const run=await github("/repos/"+repo+"/actions/runs/"+data.runId);\n    const jobs=await github("/repos/"+repo+"/actions/runs/"+data.runId+"/jobs?per_page=100");\n    return {run,jobs:jobs?.jobs||[]};\n  }\n  throw new Error("Release workflow run is not available yet");\n});\n\nexport const startRelease=createServerFn({method:"POST"}).handler(async({data}:{data:{token:string;type:"base"|"engine";version:string;channel:string;notes:string;files:any[];components:string[];minimumBaseVersion:string;protocol:string}})=>{
 readSession(data.token);
 const version=data.version.trim();
 if(!/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/.test(version))throw new Error("Version must be valid SemVer, e.g. 1.2.3");
 if(data.type==="engine"&&!data.components.length)throw new Error("Select at least one Engine component.");
 const repo=data.type==="base"?BASE_REPO:ENGINE_REPO,ref=data.type==="base"?BASE_REF:ENGINE_REF,workflow=data.type==="base"?BASE_WORKFLOW:ENGINE_WORKFLOW;
 const inputs:any={version,channel:data.channel,notes:data.notes.trim(),changed_files:JSON.stringify(data.files||[])};
 if(data.type==="engine")Object.assign(inputs,{apex:String(data.components.includes("apex")),mcp:String(data.components.includes("mcp")),studio:String(data.components.includes("studio")),minimum_base_version:data.minimumBaseVersion||"1.0.0",minimum_deployer_protocol:data.protocol||"1",previous_source_commit:""});
 const dispatchedAt=Date.now();\n  await github(`/repos/${repo}/actions/workflows/${encodeURIComponent(workflow)}/dispatches`,{method:"POST",body:JSON.stringify({ref,inputs})});\n  let runId:number|undefined;\n  for(let attempt=0;attempt<5&&!runId;attempt++){\n    await new Promise(r=>setTimeout(r,700));\n    try{\n      const runs=await github(`/repos/${repo}/actions/workflows/${encodeURIComponent(workflow)}/runs?event=workflow_dispatch&branch=${encodeURIComponent(ref)}&per_page=10`);\n      const candidates=(runs?.workflow_runs||[]).filter((r:any)=>r.head_branch===ref&&new Date(r.created_at||0).getTime()>=dispatchedAt-5000);\n      runId=candidates.sort((a:any,b:any)=>new Date(b.created_at||0).getTime()-new Date(a.created_at||0).getTime())[0]?.id;\n    }catch{}\n  }\n  return {ok:true,repo,ref,workflow,runId:runId||null};
});

async function requestJson(url:string,init:RequestInit={}){
 const r=await fetch(url,{...init,cache:"no-store",headers:{accept:"application/json",...(init.body?{"content-type":"application/json"}:{}),...(init.headers||{})}});
 const text=await r.text();let body:any=null;try{body=text?JSON.parse(text):null}catch{body={error:text||r.statusText}}
 if(!r.ok)throw new Error(body?.error||body?.message||`Request failed (${r.status})`);
 return body;
}
async function github(path:string,init:RequestInit={}){
 return requestJson(`https://api.github.com${path}`,{...init,headers:{authorization:`Bearer ${required("ORBITFS_RELEASE_DISPATCH_TOKEN")}`,"x-github-api-version":"2022-11-28",...(init.headers||{})}});
}
async function licenseMaster(path:string,init:RequestInit={}){
 return requestJson(`${masterUrl()}${path}`,{...init,headers:{authorization:`Bearer ${required("LICENSE_MASTER_API_TOKEN")}`,...(init.headers||{})}});
}
