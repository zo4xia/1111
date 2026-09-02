import{bJ as x,bK as d,r as o}from"./index-HQgyMGI8.js";function w(n,e,t,i){for(var r=n.length,f=t+-1;++f<r;)if(e(n[f],f,n))return f;return-1}function I(n){return n!==n}function R(n,e,t){for(var i=t-1,r=n.length;++i<r;)if(n[i]===e)return i;return-1}function E(n,e,t){return e===e?R(n,e,t):w(n,I,t)}function A(n,e){var t=n==null?0:n.length;return!!t&&E(n,e,0)>-1}function C(n,e,t){for(var i=-1,r=n==null?0:n.length;++i<r;)if(t(e,n[i]))return!0;return!1}var L=200;function O(n,e,t,i){var r=-1,f=A,l=!0,c=n.length,h=[],b=e.length;if(!c)return h;i?(f=C,l=!1):e.length>=L&&(f=d,l=!1,e=new x(e));n:for(;++r<c;){var s=n[r],u=s;if(s=i||s!==0?s:0,l&&u===u){for(var g=b;g--;)if(e[g]===u)continue n;h.push(s)}else f(e,u,i)||h.push(s)}return h}/**
 * tdesign v1.18.2
 * (c) 2026 tdesign
 * @license MIT
 */function S(n){var e=o.useRef(null);return o.useEffect(function(){e.current=n},[n]),e.current}export{A as a,O as b,C as c,S as u};
