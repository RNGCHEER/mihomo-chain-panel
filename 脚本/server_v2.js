'use strict';
const http=require('http'),fs=require('fs'),path=require('path'),crypto=require('crypto'),{spawn}=require('child_process'),YAML=require('yaml');
const {build,validateNodes,makePairs,passed}=require('./build_groups'),cores=require('./cores');
const ROOT=path.resolve(__dirname,'..'),PORT=39242,runs=new Map();let busy=false;
const IMPORT_MAX=4*1024*1024,IMPORT_TIMEOUT=10000,IMPORT_REDIRECTS=3;
fs.mkdirSync(path.join(ROOT,'任务'),{recursive:true});
function importFailure(message){const e=Error(message);e.safeImport=true;return e}
function importError(message){throw importFailure(message)}
function safeImportError(e){if(e.safeImport)return e.message;return ({ETIMEDOUT:'订阅请求超时',ECONNREFUSED:'无法连接订阅服务器',ENOTFOUND:'订阅服务器域名解析失败',CERT_HAS_EXPIRED:'订阅服务器证书已过期',DEPTH_ZERO_SELF_SIGNED_CERT:'订阅服务器证书不受信任',UNABLE_TO_VERIFY_LEAF_SIGNATURE:'订阅服务器证书验证失败'})[e.code]||'订阅获取失败（网络连接或证书校验失败）'}
function decodeSubscription(body){
 const text=body.toString('utf8').replace(/^\uFEFF/,'').trim();
 if(!text)importError('订阅内容为空');
 let doc;try{doc=YAML.parse(text)}catch{}
 if(doc&&Array.isArray(doc.proxies)){try{validateNodes(doc.proxies)}catch{importError('订阅 YAML 需要有效的 1–300 个独立内联节点')}return text}
 if(doc&&doc['proxy-providers'])importError('不支持嵌套 proxy-provider，请提供内联 proxies');
 const lines=text.split(/\r?\n/).map(x=>x.trim()).filter(Boolean);
 if(lines.some(x=>/^(?:vless|vmess|trojan|ss|hysteria2|hy2|tuic|anytls):\/\//i.test(x)))return lines.join('\n');
 let decoded;try{decoded=Buffer.from(text.replace(/\s+/g,''),'base64').toString('utf8')}catch{}
 if(decoded&&decoded!==text&&/^(?:vless|vmess|trojan|ss|hysteria2|hy2|tuic|anytls):\/\//im.test(decoded))return decoded.trim();
 let decodedYaml;try{decodedYaml=YAML.parse(decoded)}catch{}
 if(decodedYaml&&Array.isArray(decodedYaml.proxies)){try{validateNodes(decodedYaml.proxies)}catch(e){importError('Base64 YAML: '+e.message)}return decoded.trim()}
 importError('订阅内容不是支持的内联 YAML、分享链接或 Base64 分享链接/节点');
}
async function fetchSubscription(url,redirects=0,deadline=Date.now()+IMPORT_TIMEOUT){
 let timer;try{return await new Promise((resolve,reject)=>{
 let u;try{u=new URL(url)}catch{return reject(importFailure('订阅 URL 无效'))}
 if(!['http:','https:'].includes(u.protocol)||u.username||u.password)return reject(importFailure('订阅 URL 必须是 HTTP/HTTPS 且不含账号密码'));
 if(Date.now()>=deadline)return reject(importFailure('订阅请求超时'));
 const mod=u.protocol==='https:'?require('https'):http;
 const req=mod.get(u,{headers:{'user-agent':'mihomo-chain-panel subscription importer','accept-encoding':'identity'},rejectUnauthorized:true},r=>{
  if(r.statusCode>=300&&r.statusCode<400&&r.headers.location){const location=r.headers.location;r.destroy();if(redirects>=IMPORT_REDIRECTS)return reject(importFailure('订阅重定向次数过多'));let next;try{next=new URL(location,u).href}catch{return reject(importFailure('订阅重定向地址无效'))}return fetchSubscription(next,redirects+1,deadline).then(resolve,reject)}
  if(!r.statusCode||r.statusCode<200||r.statusCode>=300){r.destroy();return reject(importFailure('订阅服务器返回 HTTP '+r.statusCode))}
  if(r.headers['content-encoding']&&r.headers['content-encoding']!=='identity'){r.destroy();return reject(importFailure('订阅服务器未返回未压缩文本'))}
  const chunks=[];let size=0;
  r.on('data',c=>{size+=c.length;if(size>IMPORT_MAX){reject(importFailure('订阅响应超过4MB'));req.destroy()}else chunks.push(c)});
  r.on('end',()=>size<=IMPORT_MAX&&resolve(Buffer.concat(chunks)));r.on('error',reject);
 });timer=setTimeout(()=>{reject(importFailure('订阅请求超时'));req.destroy()},Math.max(1,deadline-Date.now()));req.on('error',reject);
 })}finally{clearTimeout(timer)}
}

function run(cmd,args,cwd,log,env={}){return new Promise((ok,no)=>{
 const c=spawn(cmd,args,{cwd,windowsHide:true,env:{...process.env,...env,PYTHONIOENCODING:'utf-8'}});
 c.stdout.on('data',x=>log(x.toString()));c.stderr.on('data',x=>log(x.toString()));c.on('error',no);c.on('exit',x=>x?no(Error('脚本退出 '+x)):ok());
});}
async function convert(text,dir,log){
 let nodes;if(/^\s*(?:vless|vmess|trojan|ss|hysteria2|hy2|tuic|anytls):\/\//m.test(text)){
  fs.writeFileSync(path.join(dir,'输入.txt'),text);
  await run(path.join(ROOT,'runtime/python/python.exe'),[path.join(__dirname,'sub2mihomo.py'),path.join(dir,'输入.txt'),'--no-groups','-o',path.join(dir,'输入.yaml'),'--proxies-only',path.join(dir,'proxies.yaml')],dir,log);
  nodes=YAML.parse(fs.readFileSync(path.join(dir,'输入.yaml'),'utf8')).proxies;
 }else{let doc;try{doc=YAML.parse(text)}catch(e){throw Error('YAML解析失败: '+e.message)};if(doc&&Array.isArray(doc.proxies)){nodes=doc.proxies}else if(Array.isArray(doc)){nodes=doc}else{throw Error('YAML中未找到proxies数组(当前键: '+(doc?Object.keys(doc).join(','):'空文档')+')')}}
 if(Array.isArray(nodes)&&nodes.some(n=>n&&Object.hasOwn(n,'dialer-proxy')))throw Error('输入 YAML 已含 dialer-proxy；请使用未链式节点，避免歧义链');
 validateNodes(nodes);fs.writeFileSync(path.join(dir,'输入.yaml'),YAML.stringify({proxies:nodes}));return nodes;
}
http.createServer(async(req,res)=>{
 if(req.headers.host!==`127.0.0.1:${PORT}`||(req.headers.origin&&req.headers.origin!==`http://127.0.0.1:${PORT}`)){res.writeHead(403,{'Content-Type':'application/json;charset=utf-8'});return res.end(JSON.stringify({error:'请求来源不允许，请使用 http://127.0.0.1:'+PORT+'/ 打开面板'}));}
 if(req.method==='GET'&&req.url==='/'){res.setHeader('Content-Type','text/html;charset=utf-8');return res.end(fs.readFileSync(path.join(ROOT,'panel.html')));}
 if(req.method==='GET'&&req.url==='/panel.js'){res.setHeader('Content-Type','text/javascript;charset=utf-8');return res.end(fs.readFileSync(path.join(ROOT,'panel.js')));}
 if(req.method==='GET'&&req.url==='/api/health'){res.setHeader('Content-Type','application/json');return res.end(JSON.stringify({app:'mihomo-chain-editor',version:2,pid:process.pid,root:ROOT,busy}));}
 if(req.method==='GET'&&req.url==='/api/cores'){res.setHeader('Content-Type','application/json;charset=utf-8');return res.end(JSON.stringify(await cores.list()));}
 if(req.method==='POST'&&req.url==='/api/import-subscription'){
  let raw='';for await(const c of req){raw+=c;if(raw.length>16000)break}let b;try{b=JSON.parse(raw)}catch{res.writeHead(400);return res.end(JSON.stringify({error:'请求格式无效'}))}
  try{const text=decodeSubscription(await fetchSubscription(String(b.url||'')));res.setHeader('Content-Type','application/json;charset=utf-8');return res.end(JSON.stringify({text}))}catch(e){res.writeHead(400);return res.end(JSON.stringify({error:safeImportError(e)}))}
 }
 if(req.method!=='POST'||!['/api/run','/api/chains'].includes(req.url)){res.writeHead(404);return res.end();}
 if(busy){res.writeHead(409);return res.end('已有任务运行');}busy=true;res.setHeader('Content-Type','application/x-ndjson;charset=utf-8');
 const log=x=>res.write(JSON.stringify({log:x})+'\n');
 try{
 let raw='';for await(const c of req){raw+=c;if(raw.length>4000000)throw Error('输入超过4MB');}const b=JSON.parse(raw);let state,chains=[];
 if(req.url==='/api/run'){
  const core=await cores.select(b.core);
  const sites=[...new Set((b.sites||['https://github.com/','https://google.com/']).map(x=>x.trim()).filter(Boolean))].map(x=>{
   const u=new URL(x.includes('://')?x:'https://'+x);if(!['http:','https:'].includes(u.protocol)||u.username||u.password)throw Error('网站URL无效');return [u.href,u.href]
  });if(!sites.length)throw Error('至少一个网站');
  const id=crypto.randomUUID(),dir=path.join(ROOT,'任务',id);fs.mkdirSync(dir,{recursive:true});
  const nodes=await convert(String(b.nodes||''),dir,log);fs.writeFileSync(path.join(dir,'nodes.json'),JSON.stringify(nodes));fs.writeFileSync(path.join(dir,'sites.json'),JSON.stringify({sites}));
  await run(process.execPath,[path.join(__dirname,'21_matrix.js')],dir,log,{TEST_OUTPUT:dir,MIHOMO_CORE:core.file,CURL_BIN:path.join(ROOT,'runtime/curl/curl.exe')});
  const results=JSON.parse(fs.readFileSync(path.join(dir,'matrix.json'),'utf8'));state={id,dir,nodes,results,sites,core};runs.set(id,state);
 }else{
  state=runs.get(b.runId);if(!state)throw Error('本轮结果不存在或服务已重启，请重新测试节点');
  const planned=makePairs(state.nodes,state.results,state.sites,b.pairs||[]),dir=path.join(state.dir,'pairs-'+crypto.randomUUID());fs.mkdirSync(dir,{recursive:true});
  for(const f of ['nodes.json','sites.json','matrix.json'])fs.copyFileSync(path.join(state.dir,f),path.join(dir,f));
  fs.writeFileSync(path.join(dir,'pairs.json'),JSON.stringify(planned));
  await run(process.execPath,[path.join(__dirname,'chain_matrix.js')],dir,log,{TEST_OUTPUT:dir,MIHOMO_CORE:state.core.file,CURL_BIN:path.join(ROOT,'runtime/curl/curl.exe')});
  chains=Object.values(JSON.parse(fs.readFileSync(path.join(dir,'chain.json'),'utf8')));state={...state,dir};
 }
 const {nodes,results,sites,dir,core,id}=state,{cfg,report}=build(nodes,results,sites,chains);let output=null;
 if(b.generate===true&&req.url==='/api/chains'){
  const name=String(b.yamlName||'123').replace(/\.ya?ml$/i,'');
  if(!name||/[<>:"/\\|?*\x00-\x1f]/.test(name)||/[. ]$/.test(name)||/^(con|prn|aux|nul|com\d|lpt\d)$/i.test(name))throw Error('文件名无效');
  const temp=path.join(dir,'validated.yaml');fs.writeFileSync(temp,YAML.stringify(cfg));
  for(const f of ['country.mmdb','geoip.metadb'])fs.copyFileSync(path.join(ROOT,'数据',f),path.join(dir,f));
  await run(core.file,['-t','-d',dir,'-f',temp],dir,log);
  output=path.join(ROOT,name+'.yaml');if(fs.existsSync(output))output=path.join(ROOT,name+'_'+Date.now()+'.yaml');
  fs.copyFileSync(temp,output);fs.writeFileSync(output.replace(/\.yaml$/,'.proxies.yaml'),YAML.stringify({proxies:cfg.proxies}));
 }
 fs.writeFileSync(path.join(dir,'报告.json'),JSON.stringify(report,null,2));
 res.write(JSON.stringify({done:true,runId:id,dir,output,report,available:nodes.filter(n=>passed(results[n.name],sites)).map(n=>({name:n.name,type:n.type})),results:nodes.map(n=>({name:n.name,type:n.type,passed:passed(results[n.name],sites)}))})+'\n');
 }catch(e){res.write(JSON.stringify({error:e.message})+'\n')}finally{busy=false;res.end();}
}).listen(PORT,'127.0.0.1',()=>console.log('http://127.0.0.1:'+PORT));
