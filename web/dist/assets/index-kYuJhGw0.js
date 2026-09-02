import{b0 as H,b1 as K,b2 as V,b3 as Z,b4 as Y,b5 as q,r as F,k as M,a3 as G,o as J,R as e,n as Q,aV as U,e as O,p as S,Y as W}from"./index-HQgyMGI8.js";var X=Object.prototype,ee=X.hasOwnProperty,k=H(function(h,s){if(K(s)||V(s)){Z(s,Y(s),h);return}for(var t in s)ee.call(s,t)&&q(h,t,s[t])});/**
 * tdesign v1.18.2
 * (c) 2026 tdesign
 * @license MIT
 */var te={bordered:!1,column:2,itemLayout:"horizontal",layout:"horizontal",size:"medium",tableLayout:"auto"},A={span:1};/**
 * tdesign v1.18.2
 * (c) 2026 tdesign
 * @license MIT
 */var T=F.createContext(null);/**
 * tdesign v1.18.2
 * (c) 2026 tdesign
 * @license MIT
 */var L=function(){return null};L.displayName="DescriptionsItem";/**
 * tdesign v1.18.2
 * (c) 2026 tdesign
 * @license MIT
 */var $=function(s){var t=s.row,C=M(),P=C.classPrefix,b=G("descriptions"),g=J(b,2),E=g[0],D=g[1],i=F.useContext(T),_="".concat(P,"-descriptions"),v=function(a){var r=arguments.length>1&&arguments[1]!==void 0?arguments[1]:"horizontal",d=arguments.length>2?arguments[2]:void 0,n=a.span,u=r==="horizontal"?1:n;return e.createElement("td",{key:d,colSpan:u,className:"".concat(_,"__label"),style:i.labelStyle},a.label,i.colon&&D(E.colonText))},f=function(a){var r=arguments.length>1&&arguments[1]!==void 0?arguments[1]:"horizontal",d=arguments.length>2?arguments[2]:void 0,n=a.span,u=n>1&&r==="horizontal"?n*2-1:n;return e.createElement("td",{key:d,colSpan:u,className:"".concat(_,"__content"),style:i.contentStyle},a.content)},w=function(){return e.createElement("tr",null,t.map(function(a,r){return e.createElement(e.Fragment,{key:r},v(a),f(a))}))},m=function(){return e.createElement(e.Fragment,null,e.createElement("tr",null,t.map(function(a,r){return v(a,"vertical","top_".concat(r))})),e.createElement("tr",null,t.map(function(a,r){return f(a,"vertical","bottom_".concat(r))})))},x=function(){return e.createElement(e.Fragment,null,t.map(function(a,r){return e.createElement("tr",{key:r},v(a),f(a))}))},z=function(){return e.createElement(e.Fragment,null,t.map(function(a,r){return e.createElement(e.Fragment,{key:r},e.createElement("tr",null,v(a)),e.createElement("tr",null,f(a)))}))};return i.layout==="horizontal"?i.itemLayout==="horizontal"?w():m():i.itemLayout==="horizontal"?x():z()};$.displayName="DescriptionsRow";/**
 * tdesign v1.18.2
 * (c) 2026 tdesign
 * @license MIT
 */var I=function(s){var t=Q(s,te),C=t.className,P=t.style,b=t.title,g=t.bordered,E=t.column,D=t.layout,i=t.items,_=t.children,v=t.tableLayout,f=M(),w=f.classPrefix,m="".concat(w,"-descriptions"),x=U(),z=x.SIZE,p=function(){var n=[];if(W(i))n=i.map(function(o){var l=k({},A,o),c=l.span;return{label:o.label,content:o.content,span:c}});else{var u=e.Children.toArray(_).filter(function(o){var l;return((l=o.type)===null||l===void 0?void 0:l.displayName)===L.displayName});u.length!==0&&(n=u.map(function(o){var l,c=o.props,j=k({},A,c),B=j.span;return{label:c.label,content:(l=c.content)!==null&&l!==void 0?l:c.children,span:B}}))}if(D==="vertical")return[n];var y=[],N=E,R=[];return n.forEach(function(o,l){var c=o.span;N>=c?(y.push(o),N-=c):(R.push(y),y=[o],N=E-c),l===n.length-1&&(Reflect.set(o,"span",c+N),R.push(y))}),R},a=function(){return b?e.createElement("div",{className:"".concat(m,"__header")},b):""},r=function(){var n=["".concat(m,"__body"),z[t.size],S({},"".concat(m,"__body--fixed"),v==="fixed"),S({},"".concat(m,"__body--border"),g)];return e.createElement("table",{className:O(n)},e.createElement("tbody",null,p().map(function(u,y){return e.createElement($,{row:u,key:y})})))};return e.createElement(T.Provider,{value:t},e.createElement("div",{className:O(C,m),style:P},a(),r()))};I.displayName="Descriptions";I.DescriptionsItem=L;/**
 * tdesign v1.18.2
 * (c) 2026 tdesign
 * @license MIT
 */var re=I;export{re as D};
