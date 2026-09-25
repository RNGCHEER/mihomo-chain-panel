'use strict';
const GROUPS=['手动选择','自动选择','ai 自动选择','ai 服务','国内网络','非中国','漏网之鱼','链式跳板'];
function validateNodes(nodes){
 if(!Array.isArray(nodes)||!nodes.length||nodes.length>300)throw Error('需要 1–300 个内联 proxies 节点');
 const names=new Set([...GROUPS,'DIRECT','REJECT','GLOBAL','PASS','COMPATIBLE']);
 for(const n of nodes){if(!n||typeof n.name!=='string'||!n.name.trim()||names.has(n.name))throw Error('节点名称为空、重复或与策略组/内置名称冲突');names.add(n.name);if(!n.type||!n.server||!Number.isInteger(n.port)||n.port<1||n.port>65535)throw Error('节点缺少有效 type/server/port');if(Object.hasOwn(n,'dialer-proxy'))throw Error('输入已含 dialer-proxy；请提供独立节点，避免歧义或循环');}
 return nodes;
}
function passed(r,sites){return !!r&&sites.length>0&&sites.every(([k])=>r.sites?.[k]?.status>=200&&r.sites[k].status<400&&!r.sites[k].err&&(r.sites[k].code===undefined||r.sites[k].code===0));}
function makePairs(nodes,results,sites,pairs){
 validateNodes(nodes);if(!Array.isArray(pairs)||pairs.length>300)throw Error('链路必须为数组，最多300对');
 const by=new Map(nodes.map(n=>[n.name,n])),used=new Set(nodes.map(n=>n.name)),seen=new Set();
 return pairs.map((p,i)=>{const u=by.get(p.upstream),l=by.get(p.landing);if(!u||!l||!passed(results[u.name],sites)||!passed(results[l.name],sites))throw Error('两端必须是本轮全部网站实测通过的节点');if(u.name===l.name)throw Error('不允许节点连接自身');const key=JSON.stringify([u.name,l.name]);if(seen.has(key))throw Error('重复链路');seen.add(key);let name=`链路 ${i+1}：${u.name} → ${l.name}`;while(used.has(name))name+=' #';used.add(name);const proxy=structuredClone(l);proxy.name=name;proxy['dialer-proxy']=u.name;return {name,upstream:u.name,landing:l.name,proxy};});
}
module.exports={GROUPS,validateNodes,passed,makePairs};
