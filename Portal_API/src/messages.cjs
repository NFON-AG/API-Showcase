// Only exact, complete known literals are accepted for legacy callers. Dynamic
// messages carry their catalog identity at the call site; API names never get guessed.
const catalog = require('../i18n-messages.json');
const exact = new Map();
for (const [key, entry] of Object.entries(catalog)) {
  for (const source of new Set([entry.en, entry.de, ...(entry.sources || [])].filter(Boolean))) {
    if (!/\{\w+\}/.test(source)) exact.set(source, {key, params:{}});
  }
}
function serverMessage(key, params={}) {
  if (!catalog[key]) throw new Error('Unknown Portal message: '+key);
  const text=catalog[key].en.replace(/\{(\w+)\}/g,(token,name)=>Object.hasOwn(params,name)?String(params[name]):token);
  const value=new String(text);
  value.messageKey=key; value.messageParams=params;
  return value;
}
function messageDescriptor(text) {
  if(text?.messageKey) return {key:text.messageKey,params:text.messageParams||{}};
  return typeof text==='string' ? exact.get(text)||null : null;
}
const opaque = new Set(['inventory','items','data','raw','body','contacts','callflow']);
function responseMessages(value) {
  if(Array.isArray(value))return value.map(responseMessages);
  if(!value || typeof value!=='object')return value;
  if(value instanceof String)return String(value);
  const result={...value};
  for(const field of ['message','error','title','note','behaviorNote','reason','memberError']) {
    if(result[field+'Key'])continue;
    const descriptor=messageDescriptor(value[field]);
    if(descriptor){result[field]=String(value[field]);result[field+'Key']=descriptor.key;result[field+'Params']=descriptor.params;}
  }
  for(const [key,item]of Object.entries(result))if(!opaque.has(key)&&!/Key$|Params$/.test(key)&&item&&typeof item==='object')result[key]=responseMessages(item);
  return result;
}
module.exports={serverMessage,messageDescriptor,responseMessages};
