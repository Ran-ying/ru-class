import {createSite,loadSiteConfig} from './site.js';
const config=loadSiteConfig();
const server=createSite();
server.listen(config.port,config.host,()=>console.log(JSON.stringify({
  service:'ru-class',version:'0.2.0-browser-byok',host:config.host,port:config.port,
  mode:'static-browser-direct',publicOrigin:config.publicOrigin||undefined
})));
for(const signal of ['SIGINT','SIGTERM'])process.on(signal,()=>server.close(()=>process.exit(0)));
