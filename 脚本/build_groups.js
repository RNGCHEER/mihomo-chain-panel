'use strict';
const net=require('net');
const {GROUPS,validateNodes,passed,makePairs}=require('./chain_model');
function build(nodes,results,sites,chains=[]){
 validateNodes(nodes);const good=[],ai=[],blocked=[];
 for(const n of nodes){const r=results[n.name], ok=passed(r,sites), ips=(r?.exitIps||[]).filter(net.isIP);if(!ok||new Set(ips).size>1){blocked.push({name:n.name,reason:!ok?'测试网站失败或未测':'出口IP采样不一致'});continue;}good.push(n);if(r.geo?.cc&&r.geo.cc!=='CN')ai.push(n.name);}
 const names=good.map(n=>n.name), safe=a=>a.length?a:['REJECT'];
 const accepted=chains.filter(c=>names.includes(c.upstream)&&names.includes(c.landing)&&passed(c,sites)&&c.proxy&&c.proxy['dialer-proxy']===c.upstream);
 const groups=[
  {name:'手动选择',type:'select',proxies:['自动选择','ai 自动选择','DIRECT','链式跳板',...names]},
  {name:'自动选择',type:'url-test',url:sites[0][1],interval:300,proxies:safe(names)},
  {name:'ai 自动选择',type:'url-test',url:sites[0][1],interval:300,proxies:safe(ai)},
  {name:'ai 服务',type:'select',proxies:['DIRECT','手动选择','ai 自动选择']},
  {name:'国内网络',type:'select',proxies:['DIRECT']},
  {name:'非中国',type:'select',proxies:['手动选择','ai 自动选择','自动选择']},
  {name:'漏网之鱼',type:'select',proxies:['手动选择','ai 自动选择','自动选择']},
  {name:'链式跳板',type:'select',proxies:safe(accepted.map(c=>c.name))}
 ];
 const cfg={proxies:[...good,...accepted.map(c=>c.proxy)],'proxy-groups':groups,rules:['DOMAIN-SUFFIX,openai.com,ai 服务','DOMAIN-SUFFIX,chatgpt.com,ai 服务','DOMAIN-SUFFIX,claude.ai,ai 服务','DOMAIN,gemini.google.com,ai 服务','GEOIP,LAN,DIRECT,no-resolve','GEOIP,CN,国内网络','MATCH,非中国']};
 return {cfg,report:{total:nodes.length,passed:good.length,blocked,chain:{passed:accepted.length,note:'仅加入实测通过链路；无通过链路时 REJECT'},ai:'非中国出口候选，未验证 AI 服务解锁'}};
}
module.exports={build,makePairs,validateNodes,passed,GROUPS};
