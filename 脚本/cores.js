const fs=require('fs'),path=require('path'),{execFile}=require('child_process');
const root=path.resolve(__dirname,'..'), dir=path.join(root,'内核');fs.mkdirSync(dir,{recursive:true});
function candidates(){return [dir,root].flatMap(d=>fs.readdirSync(d,{withFileTypes:true}).filter(e=>e.isFile()&&/^mihomo.*\.exe$/i.test(e.name)).map(e=>({id:path.relative(root,path.join(d,e.name)).replace(/\\/g,'/'),file:path.join(d,e.name)})));}
function version(file){return new Promise(resolve=>execFile(file,['-v'],{windowsHide:true,timeout:5000,maxBuffer:65536},(e,out)=>resolve(e?{valid:false,version:e.message}:{valid:/mihomo|meta/i.test(out),version:out.trim().split(/\r?\n/)[0]})));}
async function list(){return Promise.all(candidates().map(async x=>({...x,...await version(x.file)})));}
async function select(id){const c=candidates().find(x=>x.id===id);if(!c)throw Error('所选内核不存在；请刷新内核列表');const v=await version(c.file);if(!v.valid)throw Error('内核版本验证失败');return {...c,...v};}
module.exports={list,select};
