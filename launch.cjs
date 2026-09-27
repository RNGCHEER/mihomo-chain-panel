const fs=require('fs'),path=require('path'),http=require('http'),{spawn,execSync}=require('child_process');
const root=__dirname,url='http://127.0.0.1:39242/';
const runtime=path.join(root,'runtime');
const nodeDir=path.join(runtime,'node'),pythonDir=path.join(runtime,'python'),curlDir=path.join(runtime,'curl');

function findTool(bundled,cmd){
 const exe=path.join(bundled,cmd+'.exe');
 if(fs.existsSync(exe))return exe;
 try{return execSync('where '+cmd,{encoding:'utf8',stdio:['ignore','pipe','ignore']}).trim().split('\n')[0]}catch{}
 return null;
}
const nodeExe=findTool(nodeDir,'node');
if(!nodeExe){console.error('Bundled Node runtime is missing: '+path.join(nodeDir,'node.exe'));console.error('Please install Node.js or place node.exe in runtime/node/');process.exit(1);}

const bundledEnv={...process.env,PYTHONIOENCODING:'utf-8'};
const inheritedPath=Object.keys(bundledEnv).filter(k=>k.toUpperCase()==='PATH').map(k=>{const value=bundledEnv[k];delete bundledEnv[k];return value;}).join(path.delimiter);
const pathParts=[];
if(fs.existsSync(path.join(nodeDir,'node.exe')))pathParts.push(nodeDir);
if(fs.existsSync(path.join(pythonDir,'python.exe')))pathParts.push(pythonDir);
if(fs.existsSync(path.join(curlDir,'curl.exe')))pathParts.push(curlDir);
bundledEnv.PATH=[...pathParts,inheritedPath].join(path.delimiter);

function probe(){return new Promise(resolve=>{const r=http.get(url,res=>{let s='';res.on('data',x=>s+=x);res.on('end',()=>resolve(res.statusCode===200&&s.includes('节点测试与链式编辑器')?'ready':'occupied'));});r.setTimeout(1500,()=>r.destroy());r.on('error',()=>resolve('absent'));});}
(async()=>{
 let state=await probe();if(state==='occupied')throw Error('端口39242已被其他服务占用，未启动。');
 if(state!=='ready'){
  const log=fs.openSync(path.join(root,'启动日志.txt'),'a');
  const child=spawn(nodeExe,[path.join(root,'脚本','server_v2.js')],{cwd:root,detached:true,windowsHide:true,env:bundledEnv,stdio:['ignore',log,log]});child.unref();fs.closeSync(log);
  for(let i=0;i<40;i++){await new Promise(r=>setTimeout(r,250));state=await probe();if(state==='ready')break;}
 }
 if(state!=='ready')throw Error('后端启动失败，请查看同目录的启动日志.txt');
 console.log('READY '+url);
 if(!process.argv.includes('--check')){
  const c=spawn('powershell.exe',['-NoProfile','-NonInteractive','-Command',"Start-Process 'http://127.0.0.1:39242/'"],{windowsHide:true,stdio:'ignore'});
  await new Promise((resolve,reject)=>{c.on('error',reject);c.on('exit',code=>code===0?resolve():reject(Error('浏览器打开失败，请手动打开 '+url)));});
  console.log('已打开面板，后端在后台运行。重复双击会复用现有服务。');
 }
})().catch(e=>{console.error(e.message);process.exitCode=1;});
