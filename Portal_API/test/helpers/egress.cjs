// Hermetic child processes may connect only to their explicitly assigned mock provider.
const net=require('node:net');
const connect=net.Socket.prototype.connect;
net.Socket.prototype.connect=function(...args){
 let options=args[0];if(Array.isArray(options))options=options[0];
 const host=typeof options==='object'?options.host:args[1];
 const port=typeof options==='object'?options.port:options;
 if(!['127.0.0.1','::1','localhost'].includes(host)||String(port)!==process.env.TEST_PROVIDER_PORT){
  process.nextTick(()=>this.destroy(Object.assign(new Error('Test egress blocked'),{code:'ECONNREFUSED'})));return this;
 }
 return connect.apply(this,args);
};
