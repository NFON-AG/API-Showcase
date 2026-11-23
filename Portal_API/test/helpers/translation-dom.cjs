// Minimal DOM surface used by the real shared translator. No translation logic is
// reproduced here: tests execute docs/i18n.js and feed it rendered Portal markup.
const fs=require('node:fs');const path=require('node:path');const vm=require('node:vm');
function translateMarkup(html,language,catalog){
 class Element{
  constructor(tag,attrs={}){this.nodeType=1;this.tagName=tag.toUpperCase();this.attrs=attrs;this.children=[];this.parentElement=null;}
  getAttribute(key){return this.attrs[key]??null;}hasAttribute(key){return Object.hasOwn(this.attrs,key);}setAttribute(key,value){this.attrs[key]=String(value);}
  closest(selector){const selectors=selector.split(',').map(s=>s.trim());for(let el=this;el;el=el.parentElement)if(selectors.some(s=>s.startsWith('[')?el.hasAttribute(s.slice(1,-1)):el.tagName===s.toUpperCase()))return el;return null;}
  append(child){child.parentElement=this;this.children.push(child);}
  get textContent(){return this.children.map(child=>child.nodeType===3?child.nodeValue:child.textContent).join('');}
  set textContent(value){this.children=[];this.append({nodeType:3,nodeValue:String(value)});}
 }
 const decode=value=>value.replace(/&(amp|lt|gt|quot|#39);/g,(_,entity)=>({amp:'&',lt:'<',gt:'>',quot:'"','#39':"'"})[entity]);
 const root=new Element('div');const stack=[root];
 for(const token of html.match(/<!--[\s\S]*?-->|<[^>]+>|[^<]+/g)||[]){
  if(token.startsWith('<!--'))continue;
  if(token.startsWith('</')){if(stack.length>1)stack.pop();continue;}
  if(token.startsWith('<')){const name=token.match(/^<([\w-]+)/)?.[1];if(!name)continue;const attrs={};for(const m of token.slice(name.length+1,-1).matchAll(/([\w:-]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+)))?/g))attrs[m[1]]=decode(m[2]??m[3]??m[4]??'');const element=new Element(name,attrs);stack.at(-1).append(element);if(!['input','br','hr','img','meta','link','wbr'].includes(name)&&!token.endsWith('/>'))stack.push(element);}
  else stack.at(-1).append({nodeType:3,nodeValue:decode(token)});
 }
 const nodes=node=>node.children?.flatMap(child=>[child,...nodes(child)])||[];
 const context={window:{NFON_MESSAGES:catalog,localStorage:{getItem:()=>language,setItem(){}}},navigator:{language,languages:[language]},Node:{ELEMENT_NODE:1,TEXT_NODE:3,DOCUMENT_NODE:9},NodeFilter:{SHOW_ELEMENT:1,SHOW_TEXT:4},document:{body:null,addEventListener(){},createTreeWalker(node){const values=nodes(node);let index=0;return {nextNode:()=>values[index++]||null};}}};
 vm.runInNewContext(fs.readFileSync(path.resolve(__dirname,'../../../docs/i18n.js'),'utf8'),context);
 context.window.NFON_I18N.translateTree(root);
 return {root,elements:nodes(root).filter(node=>node.nodeType===1),api:context.window.NFON_I18N};
}
module.exports={translateMarkup};
